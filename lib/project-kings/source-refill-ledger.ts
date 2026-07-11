import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectKingsPilotProfileKey } from "./pilot-production-profiles";

export const PROJECT_KINGS_SOURCE_REFILL_LEDGER_VERSION =
  "project-kings-source-refill-ledger-v2" as const;

export type ProjectKingsSourceRefillMode = "dry_run" | "shadow" | "execute";

export type ProjectKingsSourceRefillCandidateStage =
  | "discovered"
  | "downloaded"
  | "media_extracted"
  | "duplicate_rejected"
  | "policy_blocked"
  | "source_fit_failed"
  | "qualified_shadow"
  | "uploaded"
  | "failed";

export type ProjectKingsSourceRefillAgentAttempt = Readonly<{
  role: "source_policy" | "source_fit";
  attempt: number;
  routeId: string;
  provider: string;
  model: string;
  reasoningLevel: string;
  benchmarkVersion: string;
  startedAt: string;
  durationMs: number;
  promptSha256: string;
  outputSha256: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  costMicros: number | null;
  costUnit: "usd" | "codex_credits" | null;
  costSource: "rate_card" | "benchmark_mean" | null;
  outcome: string;
  error: string | null;
}>;

export type ProjectKingsSourceRefillLedgerCandidate = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  provider: "instagram" | "youtube_ask";
  route: "instagram_donor_pool" | "youtube_ask_v3";
  donorUsername: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  caption: string;
  provisionalStoryEventId: string;
  discoveryEvidenceSha256: string;
  stage: ProjectKingsSourceRefillCandidateStage;
  contentSha256: string | null;
  storyEventId: string | null;
  agentAttempts: readonly ProjectKingsSourceRefillAgentAttempt[];
  evidenceSha256: string;
  updatedAt: string;
  blockerCode: string | null;
  blocker: string | null;
}>;

export type ProjectKingsSourceRefillLedgerChannel = Readonly<{
  profileKey: ProjectKingsPilotProfileKey;
  profileVersion: string;
  qualifiedAvailableBefore: number;
  targetQualifiedAvailable: number;
  candidateBudget: number;
  providerOrder: readonly string[];
  status: "planned" | "running" | "complete" | "blocked";
  attempts: number;
  qualified: number;
  uploaded: number;
  blockerCode: string | null;
  blocker: string | null;
  candidates: readonly ProjectKingsSourceRefillLedgerCandidate[];
  updatedAt: string;
}>;

export type ProjectKingsSourceRefillLedgerRequest = Readonly<{
  requestId: string;
  workspaceId: string;
  logicalDate: string;
  mode: ProjectKingsSourceRefillMode;
  discoveryScopeSha256?: string | null;
  routeManifestId: string;
  routeManifestSha256: string;
  runtimeSnapshotSha256: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "running" | "complete" | "partial" | "blocked";
  channels: readonly ProjectKingsSourceRefillLedgerChannel[];
  requestSha256: string;
}>;

export type ProjectKingsSourceRefillLedger = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_REFILL_LEDGER_VERSION;
  requests: readonly ProjectKingsSourceRefillLedgerRequest[];
  ledgerSha256: string;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function hashProjectKingsSourceRefillLedgerValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function requestPayload(
  request: Omit<ProjectKingsSourceRefillLedgerRequest, "requestSha256"> |
    ProjectKingsSourceRefillLedgerRequest
): Omit<ProjectKingsSourceRefillLedgerRequest, "requestSha256"> {
  const { requestSha256: ignored, ...payload } = request as ProjectKingsSourceRefillLedgerRequest;
  void ignored;
  return payload;
}

function ledgerPayload(
  ledger: Omit<ProjectKingsSourceRefillLedger, "ledgerSha256"> | ProjectKingsSourceRefillLedger
): Omit<ProjectKingsSourceRefillLedger, "ledgerSha256"> {
  const { ledgerSha256: ignored, ...payload } = ledger as ProjectKingsSourceRefillLedger;
  void ignored;
  return payload;
}

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "token",
  "tokens",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "auth_token",
  "authtoken",
  "bearer_token",
  "bearertoken",
  "session_token",
  "sessiontoken",
  "api_token",
  "apitoken",
  "secret",
  "client_secret",
  "clientsecret",
  "authorization",
  "cookie",
  "cookies",
  "password"
]);

function assertNoCredentialFields(value: unknown, trail = "ledger"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCredentialFields(entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key.toLowerCase())) {
      throw new Error(`Credential-like field is forbidden in source-refill ledger: ${trail}.${key}`);
    }
    assertNoCredentialFields(entry, `${trail}.${key}`);
  }
}

function sealRequest(
  request: Omit<ProjectKingsSourceRefillLedgerRequest, "requestSha256">
): ProjectKingsSourceRefillLedgerRequest {
  const payload = structuredClone(requestPayload(
    request as ProjectKingsSourceRefillLedgerRequest
  ));
  return Object.freeze({
    ...payload,
    requestSha256: hashProjectKingsSourceRefillLedgerValue(payload)
  });
}

function sealLedger(
  requests: readonly ProjectKingsSourceRefillLedgerRequest[]
): ProjectKingsSourceRefillLedger {
  const payload = {
    schemaVersion: PROJECT_KINGS_SOURCE_REFILL_LEDGER_VERSION,
    requests: [...requests]
  } as const;
  return Object.freeze({
    ...payload,
    ledgerSha256: hashProjectKingsSourceRefillLedgerValue(payload)
  });
}

export function verifyProjectKingsSourceRefillLedger(
  ledger: ProjectKingsSourceRefillLedger
): void {
  if (ledger.schemaVersion !== PROJECT_KINGS_SOURCE_REFILL_LEDGER_VERSION) {
    throw new Error("Unsupported Project Kings source-refill ledger version.");
  }
  assertNoCredentialFields(ledger);
  const requestIds = new Set<string>();
  for (const request of ledger.requests) {
    if (!request.requestId.trim() || requestIds.has(request.requestId)) {
      throw new Error("Source-refill ledger contains a missing or duplicate requestId.");
    }
    requestIds.add(request.requestId);
    if (
      request.discoveryScopeSha256 !== undefined &&
      request.discoveryScopeSha256 !== null &&
      !/^[a-f0-9]{64}$/.test(request.discoveryScopeSha256)
    ) {
      throw new Error(`Source-refill discovery scope is invalid: ${request.requestId}.`);
    }
    if (hashProjectKingsSourceRefillLedgerValue(requestPayload(request)) !== request.requestSha256) {
      throw new Error(`Source-refill request hash mismatch: ${request.requestId}.`);
    }
    const profileKeys = new Set<ProjectKingsPilotProfileKey>();
    for (const channel of request.channels) {
      if (profileKeys.has(channel.profileKey)) {
        throw new Error(`Source-refill request repeats profile ${channel.profileKey}.`);
      }
      profileKeys.add(channel.profileKey);
      if (
        !Number.isInteger(channel.candidateBudget) ||
        channel.candidateBudget < 0 ||
        channel.candidateBudget > 9 ||
        channel.attempts < 0 ||
        channel.attempts > channel.candidateBudget ||
        channel.targetQualifiedAvailable < channel.qualifiedAvailableBefore ||
        channel.targetQualifiedAvailable > 12
      ) {
        throw new Error(`Source-refill channel bounds are invalid for ${channel.profileKey}.`);
      }
      const candidateIds = new Set<string>();
      for (const candidate of channel.candidates) {
        if (!candidate.candidateId.trim() || candidateIds.has(candidate.candidateId)) {
          throw new Error(`Source-refill candidate identity is invalid for ${channel.profileKey}.`);
        }
        candidateIds.add(candidate.candidateId);
        if (
          candidate.profileKey !== channel.profileKey ||
          !candidate.sourceUrl.startsWith("https://") ||
          !candidate.canonicalUrl.startsWith("https://") ||
          !/^[a-f0-9]{64}$/.test(candidate.discoveryEvidenceSha256) ||
          !/^[a-f0-9]{64}$/.test(candidate.evidenceSha256)
        ) {
          throw new Error(`Source-refill candidate evidence hash is invalid: ${candidate.candidateId}.`);
        }
        if (!Array.isArray(candidate.agentAttempts)) {
          throw new Error(`Source-refill candidate telemetry is missing: ${candidate.candidateId}.`);
        }
        for (const attempt of candidate.agentAttempts) {
          if (
            (attempt.role !== "source_policy" && attempt.role !== "source_fit") ||
            !Number.isInteger(attempt.attempt) ||
            attempt.attempt < 1 ||
            !attempt.routeId.trim() ||
            !attempt.model.trim() ||
            !attempt.reasoningLevel.trim() ||
            !Number.isInteger(attempt.durationMs) ||
            attempt.durationMs < 0 ||
            !/^[a-f0-9]{64}$/.test(attempt.promptSha256) ||
            (attempt.outputSha256 !== null && !/^[a-f0-9]{64}$/.test(attempt.outputSha256)) ||
            (attempt.costMicros === null) !== (attempt.costUnit === null) ||
            (attempt.costMicros === null) !== (attempt.costSource === null)
          ) {
            throw new Error(`Source-refill agent telemetry is invalid: ${candidate.candidateId}.`);
          }
        }
      }
    }
  }
  if (hashProjectKingsSourceRefillLedgerValue(ledgerPayload(ledger)) !== ledger.ledgerSha256) {
    throw new Error("Source-refill ledger hash mismatch.");
  }
}

export function emptyProjectKingsSourceRefillLedger(): ProjectKingsSourceRefillLedger {
  return sealLedger([]);
}

export class FileProjectKingsSourceRefillLedgerStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly filePath: string) {}

  async read(): Promise<ProjectKingsSourceRefillLedger> {
    const details = await stat(this.filePath).catch(() => null);
    if (!details) return emptyProjectKingsSourceRefillLedger();
    if (!details.isFile()) throw new Error("Source-refill ledger path is not a regular file.");
    const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as ProjectKingsSourceRefillLedger;
    verifyProjectKingsSourceRefillLedger(parsed);
    return parsed;
  }

  async upsertRequest(
    request: Omit<ProjectKingsSourceRefillLedgerRequest, "requestSha256">
  ): Promise<ProjectKingsSourceRefillLedgerRequest> {
    return this.serialized(async () => {
      const ledger = await this.read();
      const existing = ledger.requests.find((entry) => entry.requestId === request.requestId);
      const sealed = sealRequest(request);
      if (existing && existing.requestSha256 === sealed.requestSha256) return existing;
      const requests = existing
        ? ledger.requests.map((entry) => entry.requestId === request.requestId ? sealed : entry)
        : [...ledger.requests, sealed];
      await this.write(sealLedger(requests));
      return sealed;
    });
  }

  async mutateRequest(
    requestId: string,
    mutate: (request: ProjectKingsSourceRefillLedgerRequest) =>
      Omit<ProjectKingsSourceRefillLedgerRequest, "requestSha256">
  ): Promise<ProjectKingsSourceRefillLedgerRequest> {
    return this.serialized(async () => {
      const ledger = await this.read();
      const current = ledger.requests.find((entry) => entry.requestId === requestId);
      if (!current) throw new Error(`Source-refill request is missing: ${requestId}.`);
      const sealed = sealRequest(mutate(current));
      const requests = ledger.requests.map((entry) => entry.requestId === requestId ? sealed : entry);
      await this.write(sealLedger(requests));
      return sealed;
    });
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return await next;
  }

  private async write(ledger: ProjectKingsSourceRefillLedger): Promise<void> {
    verifyProjectKingsSourceRefillLedger(ledger);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.filePath), 0o700);
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }
}
