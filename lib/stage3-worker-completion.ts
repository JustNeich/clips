type CompleteRemoteStage3ArtifactInput = {
  url: string;
  authHeaders: HeadersInit;
  jobId: string;
  artifactBytes: Uint8Array;
  artifactName: string;
  artifactMimeType: string;
  resultJson: string | null;
  fetchImpl?: typeof fetch;
  warn?: (message: string) => void;
};

type CompleteRemoteStage3ArtifactResult = {
  mode: "multipart" | "raw";
};

async function readCompletionError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `Failed to complete remote Stage 3 job (status ${response.status}).`;
}

function shouldRetryAlternateArtifactUpload(status: number | null): boolean {
  return status !== 401 && status !== 403 && status !== 404 && status !== 409;
}

export async function completeRemoteStage3Artifact(
  input: CompleteRemoteStage3ArtifactInput
): Promise<CompleteRemoteStage3ArtifactResult> {
  const fetchImpl = input.fetchImpl ?? fetch;

  const uploadRawArtifact = async (primaryError: string): Promise<CompleteRemoteStage3ArtifactResult> => {
    const fallbackResponse = await fetchImpl(input.url, {
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
    if (!fallbackResponse.ok) {
      const fallbackError = await readCompletionError(fallbackResponse);
      throw new Error(`${primaryError}; raw upload retry failed: ${fallbackError}`);
    }
    return { mode: "raw" };
  };

  const form = new FormData();
  if (input.resultJson) {
    form.set("resultJson", input.resultJson);
  }
  form.set(
    "artifact",
    new Blob([input.artifactBytes], { type: input.artifactMimeType }),
    input.artifactName
  );

  let multipartResponse: Response;
  try {
    multipartResponse = await fetchImpl(input.url, {
      method: "POST",
      headers: input.authHeaders,
      body: form
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
