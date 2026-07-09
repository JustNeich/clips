type CompleteRemoteStage3ArtifactInput = {
  url: string;
  authHeaders: HeadersInit;
  jobId: string;
  artifactBytes: Uint8Array;
  artifactName: string;
  artifactMimeType: string;
  resultJson: string | null;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: number[];
  warn?: (message: string) => void;
};

type CompleteRemoteStage3ArtifactResult = {
  mode: "multipart" | "raw";
};

// Extended tail (…60s, 120s, 240s) so a finished artifact survives a multi-minute
// host 502 window (real incident: render 452a792e) instead of burning out in ~60s
// and losing the render after cleanup. ~8.5 min total delay budget across attempts.
const DEFAULT_COMPLETION_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 120_000, 240_000
];

// STAGE3_WORKER_COMPLETION_RETRY_DELAYS_MS: comma-separated millisecond delays that
// override the default backoff (e.g. "1000,5000,30000"). Invalid/empty entries are
// dropped; if nothing valid remains the default schedule is used. Read at call time
// so the Mini worker plist can tune it without a rebuild.
function parseCompletionRetryDelaysEnv(value: string | undefined): number[] | null {
  if (!value) {
    return null;
  }
  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .map((ms) => Math.round(ms));
  return parsed.length > 0 ? parsed : null;
}

function resolveCompletionRetryDelaysMs(): number[] {
  return (
    parseCompletionRetryDelaysEnv(process.env.STAGE3_WORKER_COMPLETION_RETRY_DELAYS_MS) ??
    DEFAULT_COMPLETION_RETRY_DELAYS_MS
  );
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readCompletionError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `Failed to complete remote Stage 3 job (status ${response.status}).`;
}

function isAlternateUploadRetryableStatus(status: number): boolean {
  return status !== 401 && status !== 403 && status !== 404 && status !== 409;
}

function shouldRetryAlternateArtifactUpload(status: number | null): boolean {
  return status === null || isAlternateUploadRetryableStatus(status);
}

function isTransientCompletionStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function buildMultipartForm(input: CompleteRemoteStage3ArtifactInput): FormData {
  const form = new FormData();
  if (input.resultJson) {
    form.set("resultJson", input.resultJson);
  }
  form.set(
    "artifact",
    new Blob([input.artifactBytes], { type: input.artifactMimeType }),
    input.artifactName
  );
  return form;
}

export async function completeRemoteStage3Artifact(
  input: CompleteRemoteStage3ArtifactInput
): Promise<CompleteRemoteStage3ArtifactResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const retryDelaysMs = input.retryDelaysMs ?? resolveCompletionRetryDelaysMs();

  const uploadRawArtifact = async (primaryError: string): Promise<CompleteRemoteStage3ArtifactResult> => {
    let lastError = primaryError;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      if (attempt > 0) {
        await delay(retryDelaysMs[attempt - 1] ?? 0);
      }

      let fallbackResponse: Response;
      try {
        fallbackResponse = await fetchImpl(input.url, {
          method: "POST",
          headers: {
            ...input.authHeaders,
            "Content-Type": input.artifactMimeType,
            "x-stage3-artifact-name": encodeURIComponent(input.artifactName),
            "x-stage3-artifact-mime-type": encodeURIComponent(input.artifactMimeType),
            ...(input.resultJson
              ? {
                  "x-stage3-result-json": Buffer.from(input.resultJson, "utf-8").toString("base64url")
                }
              : {})
          },
          body: input.artifactBytes
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        input.warn?.(
          `Raw Stage 3 completion retry ${attempt + 1} for ${input.jobId} failed before response: ${lastError}`
        );
        continue;
      }

      if (fallbackResponse.ok) {
        return { mode: "raw" };
      }

      const fallbackError = await readCompletionError(fallbackResponse);
      lastError = fallbackError;
      if (!isTransientCompletionStatus(fallbackResponse.status) || attempt >= retryDelaysMs.length) {
        throw new Error(`${primaryError}; raw upload retry failed: ${fallbackError}`);
      }

      input.warn?.(
        `Raw Stage 3 completion retry ${attempt + 1} for ${input.jobId} failed with ${fallbackResponse.status}; retrying.`
      );
    }

    throw new Error(`${primaryError}; raw upload retry failed: ${lastError}`);
  };

  let multipartResponse: Response;
  try {
    multipartResponse = await fetchImpl(input.url, {
      method: "POST",
      headers: input.authHeaders,
      body: buildMultipartForm(input)
    });
  } catch (error) {
    const primaryError = error instanceof Error ? error.message : String(error);
    return uploadRawArtifact(primaryError);
  }

  if (multipartResponse.ok) {
    return { mode: "multipart" };
  }

  const multipartError = await readCompletionError(multipartResponse);
  if (!shouldRetryAlternateArtifactUpload(multipartResponse.status)) {
    throw new Error(multipartError);
  }
  input.warn?.(
    `Multipart Stage 3 completion failed for ${input.jobId} (${multipartResponse.status}); retrying with raw artifact upload.`
  );
  return uploadRawArtifact(multipartError);
}
