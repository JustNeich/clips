import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  discoverProjectKingsInstagramDonors,
  type ProjectKingsInstagramDiscoveryIssue
} from "./instagram-donor-discovery";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import {
  createCodexProductionAgentInvoker,
  type ProductionAgentInvoker
} from "./production-agent-runtime";
import {
  loadFrozenProductionAgentRouteManifest,
  type ProductionReadyAgentRouteManifest
} from "./production-model-route-manifest";
import {
  inspectProjectKingsSourceMedia,
  verifyProjectKingsSourceQualificationEvidence,
  type ProjectKingsSourceQualificationEvidence
} from "./source-buffer-readiness";
import {
  runProjectKingsSourceFitAssessment
} from "./source-fit-assessment-runner";
import {
  runProjectKingsSourcePolicyAssessment
} from "./source-policy-assessment-runner";
import {
  PROJECT_KINGS_SOURCE_POLICY
} from "./source-rights-sensitive-policy";
import {
  hashProjectKingsDiscoveredSourceCandidate,
  type ProjectKingsDiscoveredSourceCandidate,
  type ProjectKingsDiscoveryIssue,
  type ProjectKingsDownloadedSource,
  type ProjectKingsExtractedSourceEvidence,
  type ProjectKingsSourceBufferRuntimeSnapshot,
  type ProjectKingsSourceDiscoveryProvider,
  type ProjectKingsSourceDownloadProvider,
  type ProjectKingsSourceFitAssessor,
  type ProjectKingsSourceMediaEvidenceProvider,
  type ProjectKingsSourcePolicyAssessor,
  type ProjectKingsSourceUploadProvider
} from "./source-refill-contour";
import {
  hashProjectKingsSourceRefillLedgerValue
} from "./source-refill-ledger";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

type RunCommand = (input: Readonly<{
  command: string;
  args: readonly string[];
  timeoutMs: number;
  cwd?: string;
}>) => Promise<Readonly<{ stdout: string; stderr: string }>>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(cookie|token|authorization)=?[^\s,;]*/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100) || "candidate";
}

function insideRepo(repoRoot: string, configuredPath: string, label: string): string {
  const root = path.resolve(repoRoot);
  const absolute = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(root, configuredPath);
  const boundary = path.relative(root, absolute);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error(`${label} must stay inside the Clips repository.`);
  }
  return absolute;
}

function defaultRunCommand(input: Parameters<RunCommand>[0]): ReturnType<RunCommand> {
  return execFileAsync(input.command, [...input.args], {
    cwd: input.cwd,
    timeout: input.timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  }).then(({ stdout, stderr }) => ({ stdout, stderr }));
}

function retryableProviderFailure(error: unknown): boolean {
  const message = normalizeError(error);
  return /\b429\b|\b5\d\d\b|timed? out|timeout|ECONN|network|temporar/i.test(message);
}

function authProviderFailure(error: unknown): boolean {
  return /\b401\b|\b403\b|forbidden|login required|sign in|authentication/i.test(
    normalizeError(error)
  );
}

async function retryCommand(input: {
  run: RunCommand;
  command: string;
  args: readonly string[];
  timeoutMs: number;
  cwd?: string;
  attempts?: number;
}): Promise<Readonly<{ stdout: string; stderr: string }>> {
  let last: unknown = null;
  const attempts = input.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await input.run({
        command: input.command,
        args: input.args,
        timeoutMs: input.timeoutMs,
        cwd: input.cwd
      });
    } catch (error) {
      last = error;
      if (!retryableProviderFailure(error) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last ?? "Provider command failed."));
}

export type ProjectKingsAuthenticatedInstagramDiscoveryFallback = (
  input: Readonly<{
    profileKey: ProjectKingsPilotProfileKey;
    targetCandidateCount: number;
    knownCanonicalUrls: readonly string[];
    capturedAt: string;
  }>
) => Promise<Readonly<{
  candidates: readonly ProjectKingsDiscoveredSourceCandidate[];
  issues: readonly ProjectKingsDiscoveryIssue[];
  evidenceSha256: string;
}>>;

function instagramIssue(issue: ProjectKingsInstagramDiscoveryIssue): ProjectKingsDiscoveryIssue {
  return {
    providerId: "instagram_public_ephemeral",
    code: issue.code,
    retryable: issue.retryable,
    detail: issue.detail
  };
}

export function createProjectKingsInstagramDiscoveryProvider(input: {
  authenticatedFallback?: ProjectKingsAuthenticatedInstagramDiscoveryFallback;
  fetchImpl?: typeof fetch;
} = {}): ProjectKingsSourceDiscoveryProvider {
  return {
    providerId: "instagram_public_ephemeral",
    strategy: "instagram",
    async discover(request) {
      const publicPacket = await discoverProjectKingsInstagramDonors({
        profileKeys: [request.profileKey],
        knownCanonicalUrls: request.knownCanonicalUrls,
        capturedAt: request.capturedAt,
        pagesPerDonor: 2,
        itemsPerDonor: Math.min(24, Math.max(request.targetCandidateCount, 9)),
        pageSize: 12,
        maxAttempts: 3,
        fetchImpl: input.fetchImpl
      });
      const profile = publicPacket.profiles[0];
      const candidates = (profile?.donors ?? [])
        .flatMap((donor) => donor.candidates.map((candidate) => {
          const payload = {
            candidateId: `ig-${request.profileKey}-${candidate.shortcode}`.slice(0, 160),
            profileKey: request.profileKey,
            provider: "instagram" as const,
            route: "instagram_donor_pool" as const,
            donorUsername: candidate.donorUsername,
            sourceUrl: candidate.canonicalUrl,
            canonicalUrl: candidate.canonicalUrl,
            caption: candidate.caption,
            provisionalStoryEventId: `event-provisional-${sha256(
              `${candidate.shortcode}:${candidate.caption}`
            ).slice(0, 32)}`
          };
          return {
            ...payload,
            discoveryEvidenceSha256: hashProjectKingsDiscoveredSourceCandidate(payload)
          };
        }))
        .slice(0, request.targetCandidateCount);
      const issues = (profile?.issues ?? []).map(instagramIssue);
      const needsAuthenticatedFallback =
        candidates.length === 0 &&
        issues.some((issue) =>
          ["instagram_auth_required", "instagram_access_forbidden"].includes(issue.code)
        );
      if (needsAuthenticatedFallback && input.authenticatedFallback) {
        const fallback = await input.authenticatedFallback({
          profileKey: request.profileKey,
          targetCandidateCount: request.targetCandidateCount,
          knownCanonicalUrls: request.knownCanonicalUrls,
          capturedAt: request.capturedAt
        });
        return {
          candidates: fallback.candidates.slice(0, request.targetCandidateCount),
          issues: [...issues, ...fallback.issues],
          evidenceSha256: hashProjectKingsSourceRefillLedgerValue({
            publicEvidenceSha256: publicPacket.evidenceSha256,
            fallbackEvidenceSha256: fallback.evidenceSha256
          })
        };
      }
      return {
        candidates,
        issues,
        evidenceSha256: publicPacket.evidenceSha256
      };
    }
  };
}

export type ProjectKingsYoutubeAskSearch = (input: Readonly<{
  profileKey: ProjectKingsPilotProfileKey;
  targetCandidateCount: number;
  knownCanonicalUrls: readonly string[];
  capturedAt: string;
}>) => Promise<Readonly<{
  candidates: readonly Omit<ProjectKingsDiscoveredSourceCandidate, "discoveryEvidenceSha256">[];
  evidenceSha256: string;
}>>;

export function createProjectKingsYoutubeAskDiscoveryProvider(
  search: ProjectKingsYoutubeAskSearch
): ProjectKingsSourceDiscoveryProvider {
  return {
    providerId: "youtube_ask_approved",
    strategy: "youtube_ask",
    async discover(input) {
      if (!PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[input.profileKey].youtubeAsk) {
        return {
          candidates: [],
          issues: [{
            providerId: "youtube_ask_approved",
            code: "youtube_ask_not_designated",
            retryable: false,
            detail: "YouTube Ask is not designated by the frozen profile policy."
          }],
          evidenceSha256: sha256(`youtube-ask-not-designated:${input.profileKey}`)
        };
      }
      const result = await search(input);
      if (!SHA256.test(result.evidenceSha256)) {
        throw new Error("YouTube Ask search evidence is not hash-bound.");
      }
      return {
        candidates: result.candidates.slice(0, input.targetCandidateCount).map((candidate) => ({
          ...candidate,
          discoveryEvidenceSha256: hashProjectKingsDiscoveredSourceCandidate(candidate)
        })),
        issues: [],
        evidenceSha256: result.evidenceSha256
      };
    }
  };
}

export function createProjectKingsLocalSourceDownloadProvider(input: {
  repoRoot: string;
  cdpOrigin?: string | null;
  runCommand?: RunCommand;
  publicDownloaderBinary?: string;
  nodeBinary?: string;
}): ProjectKingsSourceDownloadProvider {
  const repoRoot = path.resolve(input.repoRoot);
  const run = input.runCommand ?? defaultRunCommand;
  return {
    async download({ requestId, candidate }) {
      const output = insideRepo(
        repoRoot,
        path.join(
          ".data/project-kings/source-refill",
          safeSegment(requestId),
          safeSegment(candidate.profileKey),
          `${safeSegment(candidate.candidateId)}.mp4`
        ),
        "source download output"
      );
      await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      const existing = await fs.stat(output).catch(() => null);
      if (existing?.isFile() && existing.size >= 1_024) {
        const contentSha256 = await sha256File(output);
        return {
          candidateId: candidate.candidateId,
          sourceUrl: candidate.sourceUrl,
          mediaPath: output,
          acquisitionPath: "approved_provider",
          acquisitionEvidenceSha256: hashProjectKingsSourceRefillLedgerValue({
            candidateId: candidate.candidateId,
            sourceUrl: candidate.sourceUrl,
            mediaPath: path.relative(repoRoot, output),
            contentSha256,
            resumed: true
          })
        };
      }
      const partial = `${output}.partial-${process.pid}.mp4`;
      await fs.rm(partial, { force: true });
      let acquisitionPath: ProjectKingsDownloadedSource["acquisitionPath"] = "public_ephemeral";
      try {
        await retryCommand({
          run,
          command: input.publicDownloaderBinary ?? "yt-dlp",
          args: [
            "--no-playlist",
            "--no-warnings",
            "--quiet",
            "--max-filesize",
            String(MAX_SOURCE_BYTES),
            "--merge-output-format",
            "mp4",
            "--recode-video",
            "mp4",
            "--output",
            partial,
            candidate.sourceUrl
          ],
          timeoutMs: 6 * 60_000,
          attempts: 3
        });
        await fs.rename(partial, output);
      } catch (publicError) {
        await fs.rm(partial, { force: true });
        if (
          candidate.provider !== "instagram" ||
          !input.cdpOrigin ||
          (!authProviderFailure(publicError) && !retryableProviderFailure(publicError))
        ) {
          throw publicError;
        }
        acquisitionPath = "owner_clips_cdp_fallback";
        const relativeOutput = path.relative(repoRoot, output);
        await retryCommand({
          run,
          command: input.nodeBinary ?? process.execPath,
          args: [
            "scripts/download-project-kings-source-via-clips-cdp.mjs",
            "--url",
            candidate.sourceUrl,
            "--output",
            relativeOutput,
            "--cdp",
            input.cdpOrigin
          ],
          timeoutMs: 7 * 60_000,
          cwd: repoRoot,
          attempts: 2
        });
      }
      const details = await fs.stat(output).catch(() => null);
      if (!details?.isFile() || details.size < 1_024 || details.size > MAX_SOURCE_BYTES) {
        throw new Error("Downloaded source is missing or outside the bounded size limit.");
      }
      const contentSha256 = await sha256File(output);
      return {
        candidateId: candidate.candidateId,
        sourceUrl: candidate.sourceUrl,
        mediaPath: output,
        acquisitionPath,
        acquisitionEvidenceSha256: hashProjectKingsSourceRefillLedgerValue({
          candidateId: candidate.candidateId,
          sourceUrl: candidate.sourceUrl,
          mediaPath: path.relative(repoRoot, output),
          contentSha256,
          acquisitionPath
        })
      };
    }
  };
}

async function writeTextArtifact(filePath: string, text: string): Promise<{
  artifactId: string;
  filePath: string;
  sha256: string;
}> {
  const normalized = text.trim() ? `${text.trim()}\n` : "No recoverable text.\n";
  await fs.writeFile(filePath, normalized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    artifactId: path.basename(filePath, path.extname(filePath)),
    filePath,
    sha256: sha256(normalized)
  };
}

export function createProjectKingsLocalMediaEvidenceProvider(input: {
  repoRoot: string;
  runCommand?: RunCommand;
  ffmpegBinary?: string;
  tesseractBinary?: string;
  whisperBinary?: string;
  whisperModel?: string;
}): ProjectKingsSourceMediaEvidenceProvider {
  const repoRoot = path.resolve(input.repoRoot);
  const run = input.runCommand ?? defaultRunCommand;
  return {
    async extract({ requestId, candidate, downloaded }) {
      const candidateRoot = insideRepo(
        repoRoot,
        path.join(
          ".data/project-kings/source-refill",
          safeSegment(requestId),
          safeSegment(candidate.profileKey),
          `${safeSegment(candidate.candidateId)}-evidence`
        ),
        "source evidence directory"
      );
      await fs.mkdir(candidateRoot, { recursive: true, mode: 0o700 });
      const relativeMediaPath = path.relative(repoRoot, downloaded.mediaPath);
      const media = await inspectProjectKingsSourceMedia(downloaded.mediaPath, relativeMediaPath);
      if (!media.decodeComplete) {
        throw new Error(media.decodeError ?? "Downloaded source did not fully decode.");
      }
      const durationSec = Math.max(0.5, (media.durationMs ?? 3_000) / 1_000);
      const frameArtifacts: ProjectKingsExtractedSourceEvidence["sourceFitArtifacts"][number][] = [];
      const ocrParts: string[] = [];
      const frameCount = 5;
      for (let index = 0; index < frameCount; index += 1) {
        const timestamp = Math.max(
          0,
          Math.min(durationSec - 0.02, durationSec * ((index + 0.5) / frameCount))
        );
        const framePath = path.join(candidateRoot, `key-frame-${String(index + 1).padStart(2, "0")}.jpg`);
        if (!(await fs.stat(framePath).catch(() => null))) {
          await retryCommand({
            run,
            command: input.ffmpegBinary ?? "ffmpeg",
            args: [
              "-nostdin", "-v", "error", "-ss", timestamp.toFixed(3),
              "-i", downloaded.mediaPath, "-frames:v", "1",
              "-vf", "scale=960:-2:force_original_aspect_ratio=decrease",
              "-q:v", "2", "-n", framePath
            ],
            timeoutMs: 60_000,
            attempts: 1
          });
        }
        const frameSha256 = await sha256File(framePath);
        frameArtifacts.push({
          id: `source-key-frame-${String(index + 1).padStart(2, "0")}`,
          kind: "key_frame",
          mediaType: "image",
          filePath: framePath,
          sha256: frameSha256
        });
        const ocr = await retryCommand({
          run,
          command: input.tesseractBinary ?? "tesseract",
          args: [framePath, "stdout", "-l", "eng"],
          timeoutMs: 45_000,
          attempts: 1
        });
        ocrParts.push(`[frame ${index + 1} at ${timestamp.toFixed(3)}s]\n${ocr.stdout.trim()}`);
      }
      const ocrPath = path.join(candidateRoot, "source-ocr.txt");
      const ocrExisting = await fs.stat(ocrPath).catch(() => null);
      const ocr = ocrExisting
        ? {
            artifactId: "source-ocr",
            filePath: ocrPath,
            sha256: await sha256File(ocrPath)
          }
        : await writeTextArtifact(ocrPath, ocrParts.join("\n\n"));

      const asrPath = path.join(candidateRoot, "source-asr.txt");
      if (!(await fs.stat(asrPath).catch(() => null))) {
        const whisperRoot = path.join(candidateRoot, "whisper");
        await fs.mkdir(whisperRoot, { recursive: true, mode: 0o700 });
        await retryCommand({
          run,
          command: input.whisperBinary ?? "whisper",
          args: [
            downloaded.mediaPath,
            "--model", input.whisperModel ?? "tiny",
            "--output_format", "txt",
            "--output_dir", whisperRoot,
            "--language", "en"
          ],
          timeoutMs: 10 * 60_000,
          attempts: 1
        });
        const generatedPath = path.join(
          whisperRoot,
          `${path.basename(downloaded.mediaPath, path.extname(downloaded.mediaPath))}.txt`
        );
        const transcript = await fs.readFile(generatedPath, "utf8");
        await writeTextArtifact(asrPath, transcript);
      }
      const asr = {
        artifactId: "source-asr",
        filePath: asrPath,
        sha256: await sha256File(asrPath)
      };
      const artifacts = [
        ...frameArtifacts,
        { id: ocr.artifactId, kind: "ocr" as const, mediaType: "text" as const, filePath: ocr.filePath, sha256: ocr.sha256 },
        { id: asr.artifactId, kind: "transcript" as const, mediaType: "text" as const, filePath: asr.filePath, sha256: asr.sha256 }
      ];
      const extractionEvidenceSha256 = hashProjectKingsSourceRefillLedgerValue({
        candidateId: candidate.candidateId,
        media,
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          sha256: artifact.sha256
        }))
      });
      return {
        candidateId: candidate.candidateId,
        mediaPath: downloaded.mediaPath,
        media,
        ocr,
        asr,
        sourceFitArtifacts: artifacts,
        extractionEvidenceSha256
      };
    }
  };
}

export function createProjectKingsSourcePolicyAssessor(input: {
  repoRoot: string;
  invoker: ProductionAgentInvoker;
}): ProjectKingsSourcePolicyAssessor {
  return {
    async assess({ requestId, candidate, extracted, selection }) {
      const profile = PROJECT_KINGS_PILOT_PROFILES[candidate.profileKey];
      const result = await runProjectKingsSourcePolicyAssessment({
        repoRoot: input.repoRoot,
        runId: `${requestId}:source-policy:${candidate.candidateId}`,
        candidate: {
          candidateId: candidate.candidateId,
          profileKey: candidate.profileKey,
          channelId: profile.youtube.channelId,
          profileVersion: profile.profileVersion,
          sourceUrl: candidate.sourceUrl,
          contentSha256: extracted.media.contentSha256,
          mediaPath: extracted.mediaPath
        },
        ocrEvidence: extracted.ocr,
        asrEvidence: extracted.asr,
        selection,
        invoker: input.invoker,
        temporaryRoot: path.join(input.repoRoot, ".data/project-kings/source-refill/tmp")
      });
      return {
        assessment: result.assessment,
        attemptEvidenceSha256: result.attemptEvidenceSha256,
        attempts: result.attempts
      };
    }
  };
}

export function createProjectKingsSourceFitAssessor(input: {
  repoRoot: string;
  invoker: ProductionAgentInvoker;
}): ProjectKingsSourceFitAssessor {
  return {
    async assess({
      requestId,
      candidate,
      extracted,
      liveInventorySha256,
      knownSourceSha256,
      knownStoryEventIds,
      selection
    }) {
      const result = await runProjectKingsSourceFitAssessment({
        repoRoot: input.repoRoot,
        runId: `${requestId}:source-fit:${candidate.candidateId}`,
        candidateId: candidate.candidateId,
        profileKey: candidate.profileKey,
        sourceUrl: candidate.sourceUrl,
        provisionalStoryEventId: candidate.provisionalStoryEventId,
        media: extracted.media,
        mediaPath: extracted.mediaPath,
        liveInventorySha256,
        knownSourceSha256,
        knownStoryEventIds,
        discoveryEvidence: candidate,
        artifacts: extracted.sourceFitArtifacts,
        selection,
        invoker: input.invoker,
        temporaryRoot: path.join(input.repoRoot, ".data/project-kings/source-refill/tmp")
      });
      return { attestation: result.attestation, attempts: result.attempts };
    }
  };
}

export class ProjectKingsSourceRefillHttpError extends Error {
  constructor(
    readonly code: "auth_blocked" | "transient_exhausted" | "http_error" | "protocol_error",
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "ProjectKingsSourceRefillHttpError";
  }
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function projectKingsRefillFetchWithRetry(input: {
  fetchImpl?: typeof fetch;
  url: string;
  init: RequestInit;
  attempts?: number;
  timeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const attempts = input.attempts ?? 3;
  let lastStatus: number | null = null;
  let lastError = "request failed";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
    timer.unref?.();
    try {
      const response = await fetchImpl(input.url, { ...input.init, signal: controller.signal });
      lastStatus = response.status;
      if (response.ok) return response;
      const body = (await response.clone().text()).slice(0, 1_000);
      lastError = normalizeError(body || `HTTP ${response.status}`);
      if (response.status === 401 || response.status === 403) {
        throw new ProjectKingsSourceRefillHttpError(
          "auth_blocked",
          `Project Kings refiller authentication failed with HTTP ${response.status}.`,
          response.status
        );
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable) {
        throw new ProjectKingsSourceRefillHttpError("http_error", lastError, response.status);
      }
    } catch (error) {
      if (error instanceof ProjectKingsSourceRefillHttpError) throw error;
      lastError = normalizeError(error);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await (input.sleep ?? sleep)(500 * 2 ** (attempt - 1));
  }
  throw new ProjectKingsSourceRefillHttpError(
    "transient_exhausted",
    lastError,
    lastStatus
  );
}

export async function readProjectKingsSourceBufferRuntime(input: {
  appUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<ProjectKingsSourceBufferRuntimeSnapshot> {
  const response = await projectKingsRefillFetchWithRetry({
    fetchImpl: input.fetchImpl,
    url: `${input.appUrl.replace(/\/+$/, "")}/api/admin/project-kings/source-buffer`,
    init: {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json"
      }
    },
    attempts: 3,
    timeoutMs: 30_000,
    sleep: input.sleep
  });
  const payload = await response.json() as ProjectKingsSourceBufferRuntimeSnapshot;
  if (
    payload.schemaVersion !== "project-kings-source-buffer-runtime-v1" ||
    !payload.workspaceId ||
    !Array.isArray(payload.channels)
  ) {
    throw new ProjectKingsSourceRefillHttpError(
      "protocol_error",
      "Project Kings source-buffer runtime response is invalid.",
      response.status
    );
  }
  return payload;
}

export function createProjectKingsHttpSourceUploadProvider(input: {
  appUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
}): ProjectKingsSourceUploadProvider {
  return {
    async upload({
      requestId,
      profileKey,
      mediaPath,
      requestEvidenceSha256,
      qualificationEvidence
    }) {
      verifyProjectKingsSourceQualificationEvidence(qualificationEvidence);
      const bytes = await fs.readFile(mediaPath);
      if (bytes.byteLength > MAX_SOURCE_BYTES || sha256(bytes) !== qualificationEvidence.contentSha256) {
        throw new Error("Upload bytes differ from the qualified content hash or exceed the size limit.");
      }
      const body = new FormData();
      body.set("profileKey", profileKey);
      body.set("sourceBufferEvidenceSha256", requestEvidenceSha256);
      body.set("qualificationEvidence", JSON.stringify(qualificationEvidence));
      body.set("file", new Blob([bytes], { type: "video/mp4" }), `${safeSegment(requestId)}-${safeSegment(qualificationEvidence.candidateId)}.mp4`);
      const response = await projectKingsRefillFetchWithRetry({
        fetchImpl: input.fetchImpl,
        url: `${input.appUrl.replace(/\/+$/, "")}/api/admin/project-kings/source-buffer`,
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}` },
          body
        },
        attempts: 3,
        timeoutMs: 10 * 60_000,
        sleep: input.sleep
      });
      const payload = await response.json() as {
        created?: boolean;
        candidate?: { id?: string };
      };
      const durableCandidateId = payload.candidate?.id?.trim();
      if (!durableCandidateId) {
        throw new ProjectKingsSourceRefillHttpError(
          "protocol_error",
          "Source-buffer upload response has no durable candidate id.",
          response.status
        );
      }
      return {
        created: payload.created === true,
        durableCandidateId,
        responseEvidenceSha256: hashProjectKingsSourceRefillLedgerValue(payload)
      };
    }
  };
}

export async function loadProjectKingsSourceRefillSemanticRuntime(input: {
  repoRoot: string;
  manifestPath: string | null | undefined;
  codexHome: string;
}): Promise<Readonly<{
  manifest: ProductionReadyAgentRouteManifest;
  invoker: ProductionAgentInvoker;
}>> {
  const manifest = await loadFrozenProductionAgentRouteManifest({
    repoCwd: input.repoRoot,
    manifestPath: input.manifestPath
  });
  return {
    manifest,
    invoker: createCodexProductionAgentInvoker({
      repoCwd: input.repoRoot,
      codexHome: input.codexHome
    })
  };
}
