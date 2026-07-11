import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ChannelPublication,
  Stage2Response,
  Stage3SnapshotManagedTemplateState,
  Stage3StateSnapshot
} from "../app/components/types";
import { getAppDataDir } from "./app-paths";
import { appendChatEvent, createOrGetChatBySource, getChannelById } from "./chat-history";
import { createOrUpdateQueuedPublicationFromRenderExport } from "./channel-publication-service";
import { scheduleChannelPublicationProcessing } from "./channel-publication-runtime";
import {
  cancelChannelPublication,
  getChannelPublicationById,
  getChannelPublicationProcessingState,
  getChannelPublishIntegration,
  findLatestPublicationForRenderExport,
  getRenderExportByStage3JobId,
  markChannelPublicationPublicVerified
} from "./publication-store";
import {
  buildProductionOutboxDedupeKey,
  buildProductionPublicVerificationOutboxIntent,
  calculateQualityVerdictBindingSha256,
  createReplacementProductionItem,
  getProductionItem,
  getProductionProfile,
  getProductionRun,
  listAgentAttempts,
  listChannelSourceCandidates,
  listProductionRunChannels,
  listPublicVerifications,
  quarantineChannelSourceCandidate,
  recordAgentAttempt,
  recordPublicVerification,
  recordQualityVerdict,
  resolveProductionPublicVerificationDeadlineAt,
  transitionProductionItem,
  type AgentAttemptRecord,
  type ProductionItemRecord,
  type ProductionItemState,
  type ProductionOutboxRecord
} from "./portfolio-production-store";
import {
  buildProductionArtifactBindingSha256,
  decideProductionRevision,
  evaluateProductionQualityGate,
  probeFinalProductionMp4,
  type ProductionArtifactBinding,
  type ProductionQualityDefect,
  type ProductionVisionVerdict
} from "./production-quality-gate";
import { getSourceDecompositionForChat } from "./source-decomposition-store";
import { enqueueAndRunSourceJob } from "./source-job-runtime";
import { getCachedSourceMedia } from "./source-media-cache";
import { buildDefaultStage3RenderSnapshot } from "./stage3-default-snapshot";
import { resolveSnapshotManagedTemplateStateForEnqueue } from "./managed-template-runtime";
import { readManagedTemplate } from "./managed-template-store";
import { calculateManagedTemplateApiSha } from "./portfolio-production-live-preflight";
import { getWorkspaceStage3ExecutionTarget } from "./team-store";
import {
  enqueueAndScheduleStage3Job,
  getStage3JobOrThrow as getStage3RenderJobOrThrow,
  waitForStage3Job
} from "./stage3-job-runtime";
import {
  buildStage3PreviewDedupeKey,
  type Stage3PreviewRequestBody
} from "./stage3-preview-service";
import { buildStage3RenderRequestDedupeKey } from "./stage3-render-request";
import type { Stage3RenderRequestBody } from "./stage3-render-service";
import {
  type ProductionAgentModelSelection,
  type ProductionAgentAttemptTelemetry
} from "./project-kings/production-agent-runtime";
import {
  validateProductionAgentOutput,
  type CaptionOutput,
  type MontagePlannerOutput,
  type ProductionAgentArtifact,
  type ProductionAgentOutputByRole,
  type ProductionAgentPacketByRole,
  type ProductionModelAgentRole,
  type RevisionOutput,
  type SourceFitOutput
} from "./project-kings/production-agent-contracts";
import {
  applyPersistedRevision,
  applyRevisionLedgerToSnapshot,
  buildDeterministicRevisionPlan,
  countRevisionApplications,
  createEmptyRevisionApplicationLedger,
  parseRevisionApplicationLedger,
  RevisionApplicationError,
  type RevisionApplicationArtifact,
  type RevisionApplicationLedger,
  type RevisionCaptionState
} from "./project-kings/revision-application";
import { calculateProjectKingsCodexCreditMicros } from "./project-kings/codex-credit-cost";
import { enqueueProductionSemanticStage3Job } from "./project-kings/production-semantic-job-enqueue";
import {
  parseProductionSemanticJobResultJson,
  type ProductionSemanticJobResult,
  type ProductionSemanticJobRole
} from "./project-kings/production-semantic-job-contract";
import { reconcileYouTubePublicVerification } from "./youtube-public-verification";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 500;
const PREVIEW_TIMEOUT_MS = 5 * 60_000;
const FINAL_RENDER_TIMEOUT_MS = 12 * 60_000;
const PUBLICATION_TIMEOUT_MS = 6 * 60_000;
const PUBLIC_VERIFICATION_POLLING_WINDOW_MS = 5 * 60_000;
const SEMANTIC_JOB_TIMEOUT_MS = 13 * 60_000;
const REVISION_LEDGER_ARTIFACT_ID = "revision-ledger";

export type ProductionAgentSelections = Record<ProductionModelAgentRole, ProductionAgentModelSelection>;

export type PortfolioLiveRuntimeOptions = {
  workspaceId: string;
  userId: string;
  routeManifestId: string;
  routeManifestSha256: string;
  selections: ProductionAgentSelections;
  fetch?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => Date;
};

export type PortfolioLiveEventKind =
  | "source_ingest.requested"
  | "source_fit.requested"
  | "brief.requested"
  | "preview.requested"
  | "preview_revision.requested"
  | "revision.requested"
  | "final_render.requested"
  | "publication.requested"
  | "public_verify.requested"
  | "production.item.cancel_requested"
  | "production.item.public_verified";

export type PortfolioLiveEventHandler = (
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
) => Promise<void>;

export type PortfolioLiveRuntimeDependencies = {
  getItem?: (itemId: string) => ProductionItemRecord | null;
  handlers?: Partial<Record<PortfolioLiveEventKind, PortfolioLiveEventHandler>>;
};

export type PortfolioLiveRecoveryBudget = {
  canRework: boolean;
  canReplace: boolean;
  remainingReworks: number;
  remainingReplacements: number;
};

export function resolvePortfolioPublicVerificationPollingBudget(
  event: Pick<ProductionOutboxRecord, "eventKind" | "payload">,
  now: Date
): { deadlineAt: string; maxElapsedMs: number } {
  const deadlineAt = resolveProductionPublicVerificationDeadlineAt(event);
  if (!deadlineAt) {
    throw new Error("Public verification event is missing its immutable 24-hour deadline.");
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Public verification clock is invalid.");
  const remainingMs = Date.parse(deadlineAt) - nowMs;
  if (remainingMs <= 0) {
    throw new Error(`Public verification deadline reached at ${deadlineAt}.`);
  }
  return {
    deadlineAt,
    maxElapsedMs: Math.min(PUBLIC_VERIFICATION_POLLING_WINDOW_MS, remainingMs)
  };
}

export function decidePortfolioLiveRecoveryBudget(
  item: Pick<ProductionItemRecord, "attempts" | "attemptBudget" | "generation">
): PortfolioLiveRecoveryBudget {
  const valid =
    Number.isInteger(item.attempts) &&
    item.attempts >= 0 &&
    Number.isInteger(item.attemptBudget) &&
    item.attemptBudget > 0 &&
    Number.isInteger(item.generation) &&
    item.generation > 0;
  if (!valid) {
    return {
      canRework: false,
      canReplace: false,
      remainingReworks: 0,
      remainingReplacements: 0
    };
  }
  return {
    canRework: item.attempts < item.attemptBudget,
    canReplace: item.generation < item.attemptBudget,
    remainingReworks: Math.max(0, item.attemptBudget - item.attempts),
    remainingReplacements: Math.max(0, item.attemptBudget - item.generation)
  };
}

type FrozenManagedTemplateBinding = {
  managedTemplateState: Stage3SnapshotManagedTemplateState;
  templateSha256: string;
};

type ApprovedStage3Snapshot = Stage3StateSnapshot & {
  zoroKingApproval: {
    status: "approved";
    source: string;
    judgeVerdict: "approved";
    innerVideoOnly: true;
    donorWrapperVisible: false;
    approvedAt: string;
    previewFrames: string[];
    overlayFrames: string[];
    cleanExperimentId: string;
  };
};

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function artifactRoot(item: ProductionItemRecord): string {
  return path.join(getAppDataDir(), "production-artifacts", item.runId, item.id);
}

async function writeJsonArtifact(
  item: ProductionItemRecord,
  id: string,
  kind: ProductionAgentArtifact["kind"],
  value: unknown
): Promise<ProductionAgentArtifact> {
  const dir = artifactRoot(item);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, content, "utf-8");
  return {
    id,
    kind,
    mediaType: "json",
    path: filePath,
    sha256: sha256Text(content)
  };
}

async function imageArtifact(
  id: string,
  filePath: string
): Promise<ProductionAgentArtifact> {
  return {
    id,
    kind: "preview_frame",
    mediaType: "image",
    path: filePath,
    sha256: await sha256File(filePath)
  };
}

async function extractQaFrames(input: {
  item: ProductionItemRecord;
  videoPath: string;
  durationSec: number;
  prefix: string;
  count?: number;
}): Promise<ProductionAgentArtifact[]> {
  const count = input.count ?? 9;
  const dir = path.join(artifactRoot(input.item), input.prefix);
  await fs.mkdir(dir, { recursive: true });
  const frames: ProductionAgentArtifact[] = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp =
      count === 1
        ? Math.max(0, input.durationSec / 2)
        : Math.max(0, (input.durationSec * index) / (count - 1) - (index === count - 1 ? 0.05 : 0));
    const filePath = path.join(dir, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-ss", timestamp.toFixed(3), "-i", input.videoPath, "-frames:v", "1", "-q:v", "2", filePath],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
    );
    frames.push(await imageArtifact(`${input.prefix}-frame-${index + 1}`, filePath));
  }
  return frames;
}

function sleepDefault(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForPublication(
  publicationId: string,
  sleep: (delayMs: number) => Promise<void>
) {
  const deadline = Date.now() + PUBLICATION_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const publication = getChannelPublicationById(publicationId);
    if (!publication) throw new Error("Publication disappeared.");
    if (publication.status === "scheduled" && publication.youtubeVideoId) return publication;
    if (publication.status === "failed" || publication.status === "canceled") {
      throw new Error(publication.lastError || `Publication became ${publication.status}.`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("YouTube upload/scheduling timed out.");
}

function requireItem(itemId: string): ProductionItemRecord {
  const item = getProductionItem(itemId);
  if (!item) throw new Error(`Production item not found: ${itemId}`);
  return item;
}

function currentProfile(item: ProductionItemRecord) {
  const channel = listProductionRunChannels(item.runId).find(
    (entry) => entry.id === item.runChannelId
  );
  if (!channel) throw new Error("Run channel not found.");
  const profile = getProductionProfile(channel.profileId);
  if (!profile) throw new Error("Production profile not found.");
  return profile;
}

async function resolveFrozenManagedTemplateBinding(input: {
  workspaceId: string;
  templateId: string;
  expectedTemplateSha256: string;
}): Promise<FrozenManagedTemplateBinding> {
  const managedTemplateState = await resolveSnapshotManagedTemplateStateForEnqueue(
    input.templateId,
    { workspaceId: input.workspaceId }
  );
  if (!managedTemplateState || managedTemplateState.managedId !== input.templateId) {
    throw new Error(
      `Frozen managed template could not be embedded for enqueue: ${input.templateId}`
    );
  }
  const template = await readManagedTemplate(input.templateId, {
    workspaceId: input.workspaceId
  });
  if (!template || template.id !== input.templateId) {
    throw new Error(`Frozen managed template could not be read: ${input.templateId}`);
  }
  const templateSha256 = calculateManagedTemplateApiSha(template);
  if (templateSha256 !== input.expectedTemplateSha256) {
    throw new Error(
      `Frozen managed template drifted: expected ${input.expectedTemplateSha256}, got ${templateSha256}`
    );
  }
  return { managedTemplateState, templateSha256 };
}

function replaceProductionItemOrBlock(input: {
  item: ProductionItemRecord;
  terminalState: "replaced" | "quarantined";
  eventType: string;
  reason: string;
  eventPayload?: Record<string, unknown>;
}): void {
  const budget = decidePortfolioLiveRecoveryBudget(input.item);
  if (!budget.canReplace) {
    transitionProductionItem({
      itemId: input.item.id,
      expectedVersion: input.item.version,
      toState: "policy_blocked",
      eventType: "production.replacement_budget_exhausted",
      eventPayload: {
        reason: input.reason,
        generation: input.item.generation,
        attemptBudget: input.item.attemptBudget,
        ...input.eventPayload
      },
      patch: { lastError: `Replacement budget exhausted: ${input.reason}` }
    });
    return;
  }
  const terminal = transitionProductionItem({
    itemId: input.item.id,
    expectedVersion: input.item.version,
    toState: input.terminalState,
    eventType: input.eventType,
    eventPayload: {
      reason: input.reason,
      ...input.eventPayload
    }
  });
  createReplacementProductionItem({
    replacedItemId: terminal.id,
    expectedVersion: terminal.version
  });
}

function recordAgentTelemetry(
  item: ProductionItemRecord,
  role: string,
  attempts: readonly ProductionAgentAttemptTelemetry[],
  stage3JobId: string,
  qualityBindingSha256?: string | null,
  artifactIds: readonly string[] = []
): AgentAttemptRecord[] {
  const existing = listAgentAttempts({
    runId: item.runId,
    productionItemId: item.id
  }).filter((attempt) => attempt.role === role);
  const bound = existing
    .filter((attempt) => attempt.stage3JobId === stage3JobId)
    .sort((left, right) => left.attemptNo - right.attemptNo);
  if (bound.length > attempts.length) {
    throw new Error(`${role} has more durable attempts than its bound Stage 3 result.`);
  }
  const baseAttemptNo = bound.length > 0
    ? bound[0]!.attemptNo
    : existing.reduce((maximum, attempt) => Math.max(maximum, attempt.attemptNo), 0) + 1;
  if (bound.some((attempt, index) => attempt.attemptNo !== baseAttemptNo + index)) {
    throw new Error(`${role} has a non-contiguous durable attempt sequence for Stage 3 job ${stage3JobId}.`);
  }
  return attempts.map((attempt, index) => {
    const expectedAttemptNo = baseAttemptNo + index;
    const alreadyRecorded = bound.find((record) => record.attemptNo === expectedAttemptNo);
    if (alreadyRecorded) return alreadyRecorded;
    const costMicros = attempt.provider === "codex" && attempt.usage
      ? calculateProjectKingsCodexCreditMicros({ model: attempt.model, usage: attempt.usage })
      : null;
    return recordAgentAttempt({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      stage3JobId,
      role,
      attemptNo: expectedAttemptNo,
      model: attempt.model,
      reasoningLevel: attempt.reasoningEffort,
      promptHash: attempt.promptSha256,
      qualityBindingSha256: qualityBindingSha256 ?? null,
      outputHash: attempt.outputSha256,
      artifactIds: [...artifactIds],
      status: attempt.outcome === "passed" ? "passed" : "failed",
      outcome: attempt.outcome,
      verdict: attempt.outcome === "passed" ? "pass" : "fail",
      errorCode: attempt.error,
      inputTokens: attempt.usage?.inputTokens ?? null,
      cachedInputTokens: attempt.usage?.cachedInputTokens ?? null,
      outputTokens: attempt.usage?.outputTokens ?? null,
      reasoningOutputTokens: attempt.usage?.reasoningOutputTokens ?? null,
      costMicros,
      costUnit: costMicros === null ? null : "codex_credits",
      durationMs: Math.round(attempt.durationMs),
      startedAt: attempt.startedAt,
      finishedAt: new Date(Date.parse(attempt.startedAt) + attempt.durationMs).toISOString()
    });
  });
}

export type PortfolioProductionSemanticTransportDependencies = Readonly<{
  enqueue?: typeof enqueueProductionSemanticStage3Job;
  waitForJob?: typeof waitForStage3Job;
}>;

export async function runPortfolioProductionSemanticStage3Agent<
  R extends ProductionSemanticJobRole
>(input: {
  role: R;
  packet: ProductionAgentPacketByRole[R];
  item: ProductionItemRecord;
  options: PortfolioLiveRuntimeOptions;
  qualityBindingSha256?: string | null;
  dependencies?: PortfolioProductionSemanticTransportDependencies;
}): Promise<{
  output: ProductionAgentOutputByRole[R];
  successfulAttempt: AgentAttemptRecord;
}> {
  if (
    input.item.workspaceId !== input.options.workspaceId ||
    input.packet.runId !== input.item.runId ||
    input.packet.itemId !== input.item.id
  ) {
    throw new Error("Production semantic Stage 3 job does not match its exact item/workspace scope.");
  }
  const enqueue = input.dependencies?.enqueue ?? enqueueProductionSemanticStage3Job;
  const waitForJob = input.dependencies?.waitForJob ?? waitForStage3Job;
  const queued = await enqueue({
    workspaceId: input.options.workspaceId,
    userId: input.options.userId,
    role: input.role,
    packet: input.packet,
    qualityBindingSha256: input.qualityBindingSha256,
    routeManifestId: input.options.routeManifestId,
    routeManifestSha256: input.options.routeManifestSha256,
    selection: input.options.selections[input.role],
    attemptLimit: 3,
    attemptGroup: `project-kings-semantic:${input.item.runId}:${input.item.id}:${input.role}`,
    reuseCompleted: true
  });
  const completed = await waitForJob(queued.enqueue.job.id, {
    timeoutMs: SEMANTIC_JOB_TIMEOUT_MS
  });
  if (completed.status !== "completed") {
    throw new Error(
      completed.errorMessage ||
        `Production semantic Stage 3 job ${completed.id} became ${completed.status}.`
    );
  }
  if (!completed.resultJson?.trim()) {
    throw new Error(`Completed production semantic Stage 3 job ${completed.id} has no result.`);
  }
  const result = parseProductionSemanticJobResultJson(
    completed.resultJson,
    queued.payload
  ) as ProductionSemanticJobResult<R>;
  const persistedAttempts = recordAgentTelemetry(
    input.item,
    input.role,
    result.attempts,
    completed.id,
    input.qualityBindingSha256,
    input.packet.artifacts.map((artifact) => artifact.id)
  );
  const successfulIndex = result.attempts.findIndex(
    (attempt) =>
      attempt.outcome === "passed" && attempt.routeId === result.selectedRouteId
  );
  const successfulAttempt = successfulIndex >= 0 ? persistedAttempts[successfulIndex] : null;
  if (!successfulAttempt || successfulAttempt.status !== "passed") {
    throw new Error(`${input.role} completed without an exact durable successful attempt.`);
  }
  return { output: result.output, successfulAttempt };
}

export function resolvePortfolioProductionAgentChannelId(
  item: Pick<ProductionItemRecord, "expectedYoutubeChannelId">
): string {
  const channelId = item.expectedYoutubeChannelId.trim();
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
    throw new Error("Production semantic agents require the stable 24-character YouTube UC channel ID.");
  }
  return channelId;
}

export function buildPortfolioProductionVisionBinding(input: {
  item: Pick<ProductionItemRecord, "expectedYoutubeChannelId">;
  sourceSha256: string;
  previewSha256: string;
  templateSha256: string;
  settingsSha256: string;
}): ProductionArtifactBinding {
  return {
    channelId: resolvePortfolioProductionAgentChannelId(input.item),
    sourceSha256: input.sourceSha256,
    previewSha256: input.previewSha256,
    templateSha256: input.templateSha256,
    settingsSha256: input.settingsSha256
  };
}

export function buildPortfolioProductionAgentPacketBase<R extends ProductionModelAgentRole>(
  role: R,
  item: ProductionItemRecord,
  profileVersion: number,
  artifacts: ProductionAgentArtifact[]
) {
  return {
    schemaVersion: "production-agent-packet-v1" as const,
    role,
    runId: item.runId,
    itemId: item.id,
    channelId: resolvePortfolioProductionAgentChannelId(item),
    profileVersion: String(profileVersion),
    artifacts
  };
}

function qualityBindingSha256(input: {
  item: ProductionItemRecord;
  gateType: "source" | "preview" | "final";
  artifactSha256: string;
}): string {
  return calculateQualityVerdictBindingSha256({
    gateType: input.gateType,
    artifactSha256: input.artifactSha256,
    sourceSha256: input.item.sourceSha256,
    previewSha256: input.item.previewSha256,
    templateSha256: input.item.templateSha256,
    settingsSha256: input.item.settingsSha256
  });
}

function fitCaptionPart(text: string, min: number, max: number, fallback: string): string {
  const normalized = text.replace(/\s+/g, " ").trim() || fallback;
  if (normalized.length > max) {
    const clipped = normalized.slice(0, max).replace(/\s+\S*$/, "").trim();
    return clipped.length >= min ? clipped : normalized.slice(0, max);
  }
  if (normalized.length < min) {
    return `${normalized} ${fallback}`.slice(0, max).padEnd(min, ".");
  }
  return normalized;
}

function buildStage2Payload(input: {
  sourceUrl: string;
  sourceTitle: string;
  sourceSha256: string;
  caption: CaptionOutput;
  top: string;
  bottom: string;
}): Stage2Response {
  const constraintCheck = {
    passed: true,
    repaired: false,
    topLength: input.top.length,
    bottomLength: input.bottom.length,
    issues: [] as string[]
  };
  return {
    source: {
      url: input.sourceUrl,
      title: input.sourceTitle,
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0,
      sourceCacheKey: input.sourceSha256
    },
    output: {
      inputAnalysis: {
        visualAnchors: [input.caption.action, input.caption.payoff],
        commentVibe: "",
        keyPhraseToAdapt: input.caption.hook
      },
      captionOptions: [
        {
          option: 1,
          candidateId: "production-caption-1",
          laneId: "production-agent",
          angle: "hook-action-payoff",
          top: input.top,
          bottom: input.bottom,
          topRu: input.top,
          bottomRu: input.bottom,
          displayTier: "finalist",
          sourceStage: "oneShotReference",
          displayReason: "Typed Project Kings Caption Agent winner.",
          retainedHandle: false,
          constraintCheck
        }
      ],
      finalists: [
        {
          option: 1,
          candidateId: "production-caption-1",
          laneId: "production-agent",
          angle: "hook-action-payoff",
          top: input.top,
          bottom: input.bottom,
          displayTier: "finalist",
          sourceStage: "oneShotReference",
          displayReason: "Typed Project Kings Caption Agent winner.",
          retainedHandle: false,
          preservedHandle: false,
          constraintCheck
        }
      ],
      titleOptions: [{ option: 1, title: input.caption.title }],
      finalPick: { option: 1, reason: "Typed Caption Agent PASS." },
      winner: {
        candidateId: "production-caption-1",
        option: 1,
        reason: "Typed Caption Agent PASS.",
        displayTier: "finalist",
        sourceStage: "oneShotReference",
        constraintCheck
      }
    },
    seo: {
      description: input.caption.title,
      tags: input.caption.factualClaims.join(", ")
    },
    warnings: [],
    model: "project-kings-caption-agent",
    reasoningEffort: "benchmarked"
  };
}

function applyMontagePlan(
  snapshot: Stage3StateSnapshot,
  plan: MontagePlannerOutput
): Stage3StateSnapshot {
  const start = plan.segments[0]?.startSec ?? 0;
  return {
    ...snapshot,
    clipStartSec: start,
    clipDurationSec: plan.targetDurationSec,
    focusX: plan.crop.focusX,
    focusY: plan.crop.focusY,
    renderPlan: {
      ...snapshot.renderPlan,
      targetDurationSec: plan.targetDurationSec,
      segments: plan.segments.map((segment) => ({
        startSec: segment.startSec,
        endSec: segment.endSec,
        speed: 1,
        label: segment.purpose,
        focusY: plan.crop.focusY
      }))
    }
  };
}

async function handleSourceIngest(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  let item = requireItem(event.productionItemId);
  if (item.state !== "reserved" || !item.sourceCandidateId) return;
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).find((entry) => entry.id === item.sourceCandidateId);
  if (!candidate) throw new Error("Reserved source candidate not found.");
  const channel = await getChannelById(item.channelId);
  if (!channel) throw new Error("Channel not found.");
  const chat = await createOrGetChatBySource({
    rawUrl: candidate.sourceUrl,
    channelIdRaw: item.channelId,
    title: String(candidate.evidence.title ?? candidate.categoryKey),
    eventText: "Project Kings portfolio pipeline reserved this owner-approved source."
  });
  const completed = await enqueueAndRunSourceJob({
    workspaceId: item.workspaceId,
    creatorUserId: options.userId,
    request: {
      sourceUrl: candidate.sourceUrl,
      autoRunStage2: false,
      agentDecomposition: true,
      trigger: "fetch",
      chat: { id: chat.id, channelId: item.channelId },
      channel: { id: channel.id, name: channel.name, username: channel.username }
    }
  });
  if (completed.status !== "completed") {
    throw new Error(completed.errorMessage || "Source ingestion failed.");
  }
  const cached = await getCachedSourceMedia(candidate.sourceUrl);
  if (!completed.resultData?.stage1Ready || !cached) {
    throw new Error("Source job completed without a readable cached source.");
  }
  const sourceSha256 = await sha256File(cached.sourcePath);
  if (!candidate.contentSha256 || sourceSha256 !== candidate.contentSha256) {
    const reason = candidate.contentSha256
      ? `Downloaded source hash ${sourceSha256} differs from qualified hash ${candidate.contentSha256}.`
      : "Qualified source candidate has no immutable content hash.";
    quarantineChannelSourceCandidate({ candidateId: candidate.id, reason });
    replaceProductionItemOrBlock({
      item,
      terminalState: "quarantined",
      eventType: "production.source_hash_mismatch",
      reason,
      eventPayload: {
        candidateId: candidate.id,
        qualifiedSourceSha256: candidate.contentSha256,
        downloadedSourceSha256: sourceSha256
      }
    });
    return;
  }
  item = transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "source_ingested",
    eventType: "production.source_ingested",
    patch: { sourceSha256, chatId: chat.id },
    outbox: {
      eventKind: "source_fit.requested",
      dedupeKey: buildProductionOutboxDedupeKey("source_fit.requested", {
        gate: "source_fit",
        sourceSha256
      }),
      payload: { sourceSha256, chatId: chat.id },
      maxAttempts: 3
    }
  });
}

async function sourceArtifacts(item: ProductionItemRecord): Promise<{
  artifacts: ProductionAgentArtifact[];
  durationSec: number;
}> {
  const profile = currentProfile(item);
  const decomposition = item.chatId
    ? getSourceDecompositionForChat(item.workspaceId, item.chatId)
    : null;
  if (!decomposition) throw new Error("Source decomposition is missing.");
  const concept = await writeJsonArtifact(
    item,
    "concept-contract",
    "concept_contract",
    profile.config
  );
  const metadata = await writeJsonArtifact(
    item,
    "source-metadata",
    "source_metadata",
    {
      sourceUrl: decomposition.sourceUrl,
      sourceKey: decomposition.sourceKey,
      meta: decomposition.artifact.meta,
      comments: decomposition.artifact.comments.slice(0, 50),
      subtitles: decomposition.artifact.subtitles
    }
  );
  const selectedFrames = decomposition.artifact.frames.filter((_, index, frames) => {
    if (frames.length <= 12) return true;
    const step = (frames.length - 1) / 11;
    return Array.from({ length: 12 }, (_value, position) => Math.round(position * step)).includes(index);
  });
  const frameArtifacts = await Promise.all(
    selectedFrames.map(async (frame) => {
      const filePath = path.join(decomposition.framesDir, frame.fileName);
      return {
        id: `source-frame-${frame.index}`,
        kind: "key_frame" as const,
        mediaType: "image" as const,
        path: filePath,
        sha256: await sha256File(filePath)
      };
    })
  );
  return {
    artifacts: [concept, metadata, ...frameArtifacts],
    durationSec: decomposition.artifact.meta.durationSec ?? 30
  };
}

async function handleSourceFit(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  let item = requireItem(event.productionItemId);
  if (item.state !== "source_ingested" || !item.sourceSha256 || !item.sourceCandidateId) return;
  const profile = currentProfile(item);
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).find((entry) => entry.id === item.sourceCandidateId);
  if (!candidate) throw new Error("Source candidate not found.");
  const source = await sourceArtifacts(item);
  const cached = await getCachedSourceMedia(candidate.sourceUrl);
  if (!cached) throw new Error("Source Fit lost the exact cached media artifact.");
  const sourceProbe = await probeFinalProductionMp4(cached.sourcePath);
  const deterministicDefects: ProductionQualityDefect[] = [];
  if (sourceProbe.artifactSha256 !== item.sourceSha256) {
    deterministicDefects.push({
      code: "source_hash_mismatch",
      severity: "critical",
      message: "Decoded source bytes differ from the qualified source hash."
    });
  }
  if (!sourceProbe.fullyDecodable) {
    deterministicDefects.push({
      code: "corrupt_mp4",
      severity: "critical",
      message: sourceProbe.decodeError ?? "Source does not fully decode."
    });
  }
  const deterministicEvidence = await writeJsonArtifact(
    item,
    `source-deterministic-probe-${Math.max(1, event.attempts)}`,
    "quality_verdict",
    {
      schemaVersion: "project-kings-deterministic-quality-evidence-v1",
      gateType: "source",
      sourceSha256: item.sourceSha256,
      probe: sourceProbe,
      defects: deterministicDefects
    }
  );
  if (deterministicDefects.length > 0) {
    recordQualityVerdict({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      gateType: "source",
      judgeKind: "deterministic",
      verdict: "fail",
      attemptNo: Math.max(1, event.attempts),
      artifactSha256: item.sourceSha256,
      sourceSha256: item.sourceSha256,
      previewSha256: item.previewSha256,
      templateSha256: item.templateSha256,
      settingsSha256: item.settingsSha256,
      evidenceSha256: deterministicEvidence.sha256,
      evidenceArtifactPath: deterministicEvidence.path,
      defects: deterministicDefects
    });
    const reason = deterministicDefects.map((defect) => defect.message).join(" ");
    quarantineChannelSourceCandidate({ candidateId: candidate.id, reason });
    replaceProductionItemOrBlock({
      item,
      terminalState: "quarantined",
      eventType: "production.source_decode_failed",
      reason,
      eventPayload: { deterministicEvidenceSha256: deterministicEvidence.sha256 }
    });
    return;
  }
  const known = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).filter((entry) => entry.id !== candidate.id);
  const bindingSha256 = qualityBindingSha256({
    item,
    gateType: "source",
    artifactSha256: item.sourceSha256
  });
  const sourceFitRun = await runPortfolioProductionSemanticStage3Agent({
    role: "source_fit",
    item,
    options,
    qualityBindingSha256: bindingSha256,
    packet: {
      ...buildPortfolioProductionAgentPacketBase("source_fit", item, profile.version, source.artifacts),
      task: {
        candidateId: candidate.id,
        sourceUrl: candidate.sourceUrl,
        sourceSha256: item.sourceSha256,
        claimedStoryEventId: candidate.eventFingerprint ?? candidate.id,
        knownSourceSha256: known
          .map((entry) => entry.contentSha256)
          .filter((value): value is string => Boolean(value)),
        knownStoryEventIds: known
          .map((entry) => entry.eventFingerprint)
          .filter((value): value is string => Boolean(value))
      }
    }
  });
  const output = sourceFitRun.output as SourceFitOutput;
  item = requireItem(item.id);
  const semanticEvidence = await writeJsonArtifact(
    item,
    `source-fit-verdict-${sourceFitRun.successfulAttempt.attemptNo}`,
    "quality_verdict",
    {
      schemaVersion: "project-kings-semantic-quality-evidence-v1",
      gateType: "source",
      bindingSha256,
      agentAttemptId: sourceFitRun.successfulAttempt.id,
      output
    }
  );
  recordQualityVerdict({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType: "source",
    judgeKind: "deterministic",
    verdict: "pass",
    attemptNo: sourceFitRun.successfulAttempt.attemptNo,
    artifactSha256: item.sourceSha256!,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    evidenceSha256: deterministicEvidence.sha256,
    evidenceArtifactPath: deterministicEvidence.path,
    defects: []
  });
  const semanticPass =
    output.decision === "PASS" &&
    output.conceptMatch &&
    output.factualFit &&
    !output.duplicateVideo &&
    !output.duplicateEvent &&
    output.sourceUsable;
  recordQualityVerdict({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType: "source",
    judgeKind: "semantic",
    verdict: semanticPass ? "pass" : "fail",
    attemptNo: sourceFitRun.successfulAttempt.attemptNo,
    artifactSha256: item.sourceSha256!,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    agentAttemptId: sourceFitRun.successfulAttempt.id,
    evidenceSha256: semanticEvidence.sha256,
    evidenceArtifactPath: semanticEvidence.path,
    defects: semanticPass ? [] : [{ code: "source_fit_failed", message: output.reason }]
  });
  if (
    !semanticPass
  ) {
    quarantineChannelSourceCandidate({
      candidateId: candidate.id,
      reason: output.reason
    });
    replaceProductionItemOrBlock({
      item,
      terminalState: "quarantined",
      eventType: "production.source_quarantined",
      reason: output.reason
    });
    return;
  }
  if (!item.sourceSha256) {
    throw new Error("Source hash disappeared before the source quality verdict.");
  }
  transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "source_qualified",
    eventType: "production.source_qualified",
    outbox: {
      eventKind: "brief.requested",
      dedupeKey: buildProductionOutboxDedupeKey("brief.requested", {
        gate: "brief",
        sourceSha256: item.sourceSha256
      }),
      payload: { sourceSha256: item.sourceSha256 },
      maxAttempts: 3
    }
  });
}

async function handleBrief(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  let item = requireItem(event.productionItemId);
  if (item.state !== "source_qualified" || !item.sourceCandidateId || !item.sourceSha256) return;
  const profile = currentProfile(item);
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).find((entry) => entry.id === item.sourceCandidateId);
  if (!candidate) throw new Error("Source candidate not found.");
  const source = await sourceArtifacts(item);
  const channel = await getChannelById(item.channelId);
  if (!channel) throw new Error("Channel not found.");
  const caption = (await runPortfolioProductionSemanticStage3Agent({
    role: "caption",
    item,
    options,
    packet: {
      ...buildPortfolioProductionAgentPacketBase("caption", item, profile.version, source.artifacts),
      task: {
        candidateId: candidate.id,
        language: "en",
        templateType: profile.templateId.includes("cop-scopes") ? "lead_main" : "top_bottom",
        maxCharacters:
          channel.stage2HardConstraints.topLengthMax +
          channel.stage2HardConstraints.bottomLengthMax,
        bannedWords: channel.stage2HardConstraints.bannedWords
      }
    }
  })).output as CaptionOutput;
  if (caption.decision !== "PASS" || caption.bannedWordsFound.length) {
    throw new Error("Caption Agent failed the text gate.");
  }
  const top = fitCaptionPart(
    caption.hook,
    channel.stage2HardConstraints.topLengthMin,
    channel.stage2HardConstraints.topLengthMax,
    "WATCH THIS"
  );
  const bottom = fitCaptionPart(
    caption.caption,
    channel.stage2HardConstraints.bottomLengthMin,
    channel.stage2HardConstraints.bottomLengthMax,
    caption.payoff
  );
  const captionBrief = await writeJsonArtifact(item, "caption-brief", "caption_brief", {
    ...caption,
    top,
    bottom
  });
  const montage = (await runPortfolioProductionSemanticStage3Agent({
    role: "montage_planner",
    item,
    options,
    packet: {
      ...buildPortfolioProductionAgentPacketBase("montage_planner", item, profile.version, [
        ...source.artifacts,
        captionBrief
      ]),
      task: {
        candidateId: candidate.id,
        sourceDurationSec: source.durationSec,
        targetDurationSec: Math.min(60, source.durationSec),
        captionText: `${top}\n${bottom}`
      }
    }
  })).output as MontagePlannerOutput;
  if (montage.decision !== "PASS") throw new Error("Montage Planner failed.");
  const montagePlan = await writeJsonArtifact(item, "montage-plan", "montage_plan", montage);
  const stage2 = buildStage2Payload({
    sourceUrl: candidate.sourceUrl,
    sourceTitle: String(candidate.evidence.title ?? candidate.categoryKey),
    sourceSha256: item.sourceSha256,
    caption,
    top,
    bottom
  });
  await appendChatEvent(item.chatId!, {
    role: "assistant",
    type: "stage2",
    text: "Project Kings Caption Agent prepared the approved caption.",
    data: stage2
  });
  transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "brief_ready",
    eventType: "production.brief_ready",
    outbox: {
      eventKind: "preview.requested",
      dedupeKey: buildProductionOutboxDedupeKey("preview.requested", {
        gate: "preview",
        sourceSha256: item.sourceSha256,
        captionArtifactId: captionBrief.id,
        montageArtifactId: montagePlan.id
      }),
      payload: {
        captionArtifactId: captionBrief.id,
        montageArtifactId: montagePlan.id
      },
      maxAttempts: 5
    }
  });
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
}

async function readRevisionLedger(
  item: ProductionItemRecord
): Promise<RevisionApplicationLedger> {
  try {
    const value = await readJsonFile<unknown>(
      path.join(artifactRoot(item), `${REVISION_LEDGER_ARTIFACT_ID}.json`)
    );
    return parseRevisionApplicationLedger(value);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return createEmptyRevisionApplicationLedger();
    }
    throw error;
  }
}

async function existingRevisionArtifact(input: {
  item: ProductionItemRecord;
  id: "caption-brief" | "montage-plan";
  kind: "caption_brief" | "montage_plan";
}): Promise<RevisionApplicationArtifact & ProductionAgentArtifact> {
  const filePath = path.join(artifactRoot(input.item), `${input.id}.json`);
  await fs.access(filePath);
  return {
    id: input.id,
    kind: input.kind,
    mediaType: "json",
    path: filePath,
    sha256: await sha256File(filePath)
  };
}

async function blockRevisionApplication(input: {
  item: ProductionItemRecord;
  error: unknown;
  stage: "decision" | "apply" | "snapshot";
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const code =
    input.error instanceof RevisionApplicationError
      ? input.error.code
      : "revision_application_failed";
  const rejection = await writeJsonArtifact(
    input.item,
    `revision-application-rejected-${input.item.attempts}`,
    "quality_verdict",
    { stage: input.stage, code, message, ...input.evidence }
  );
  transitionProductionItem({
    itemId: input.item.id,
    expectedVersion: input.item.version,
    toState: "policy_blocked",
    eventType: "production.revision_application_blocked",
    eventPayload: {
      stage: input.stage,
      code,
      message,
      evidenceArtifactId: rejection.id,
      evidenceSha256: rejection.sha256
    },
    patch: { lastError: `${code}: ${message}` }
  });
}

async function readRevisionCounts(item: ProductionItemRecord): Promise<{
  total: number;
  text: number;
  visual: number;
}> {
  return countRevisionApplications(await readRevisionLedger(item));
}

async function readApprovedStage3Snapshot(
  item: ProductionItemRecord
): Promise<ApprovedStage3Snapshot> {
  const snapshot = await readJsonFile<ApprovedStage3Snapshot>(
    path.join(artifactRoot(item), "approved-snapshot.json")
  );
  const approval = snapshot?.zoroKingApproval;
  if (
    !approval ||
    approval.status !== "approved" ||
    approval.judgeVerdict !== "approved" ||
    approval.innerVideoOnly !== true ||
    approval.donorWrapperVisible !== false ||
    typeof approval.cleanExperimentId !== "string" ||
    !approval.cleanExperimentId
  ) {
    throw new Error("Approved Stage 3 snapshot is missing its fail-closed Vision QA binding.");
  }
  return snapshot;
}

async function renderPreviewAndJudge(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions,
  revision = false
): Promise<void> {
  let item = requireItem(event.productionItemId);
  const profile = currentProfile(item);
  const channel = await getChannelById(item.channelId);
  if (!channel || !item.chatId || !item.sourceCandidateId || !item.sourceSha256) {
    throw new Error("Preview prerequisites are missing.");
  }
  const chatId = item.chatId;
  const sourceCandidateId = item.sourceCandidateId;
  const sourceSha256 = item.sourceSha256;
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).find((entry) => entry.id === sourceCandidateId);
  if (!candidate) throw new Error("Source candidate not found.");
  const captionBrief = await readJsonFile<CaptionOutput & { top: string; bottom: string }>(
    path.join(artifactRoot(item), "caption-brief.json")
  );
  const montage = await readJsonFile<MontagePlannerOutput>(
    path.join(artifactRoot(item), "montage-plan.json")
  );
  const stage2 = buildStage2Payload({
    sourceUrl: candidate.sourceUrl,
    sourceTitle: String(candidate.evidence.title ?? candidate.categoryKey),
    sourceSha256,
    caption: captionBrief,
    top: captionBrief.top,
    bottom: captionBrief.bottom
  });
  const templateBinding = await resolveFrozenManagedTemplateBinding({
    workspaceId: item.workspaceId,
    templateId: profile.templateId,
    expectedTemplateSha256: profile.templateSnapshotSha256
  });
  let snapshot = buildDefaultStage3RenderSnapshot({
    stage2,
    channel,
    templateId: profile.templateId,
    managedTemplateState: templateBinding.managedTemplateState,
    sourceDurationSec: montage.targetDurationSec
  });
  snapshot = applyMontagePlan(snapshot, montage);
  let revisionEvidence: {
    entryId: string;
    revisionBindingSha256: string;
    settingsSha256: string;
  } | null = null;
  let settingsSha256: string;
  if (revision) {
    const entryId =
      typeof event.payload.revisionLedgerEntryId === "string"
        ? event.payload.revisionLedgerEntryId
        : "";
    try {
      if (!entryId) {
        throw new RevisionApplicationError(
          "invalid_binding",
          "Preview revision event has no revision ledger entry id."
        );
      }
      const ledger = await readRevisionLedger(item);
      const applied = applyRevisionLedgerToSnapshot({
        ledger,
        entryId,
        caption: captionBrief,
        montage,
        snapshot
      });
      snapshot = applied.snapshot;
      settingsSha256 = applied.settingsSha256;
      const ledgerArtifact = await writeJsonArtifact(
        item,
        REVISION_LEDGER_ARTIFACT_ID,
        "quality_verdict",
        applied.ledger
      );
      revisionEvidence = {
        entryId: applied.entry.entryId,
        revisionBindingSha256: applied.entry.revisionBindingSha256,
        settingsSha256: applied.settingsSha256
      };
      if (ledgerArtifact.sha256.length !== 64) {
        throw new RevisionApplicationError("invalid_binding", "Revision ledger artifact hash is invalid.");
      }
    } catch (error) {
      await blockRevisionApplication({
        item,
        error,
        stage: "snapshot",
        evidence: { revisionLedgerEntryId: entryId || null }
      });
      return;
    }
  } else {
    settingsSha256 = sha256Text(JSON.stringify(snapshot));
  }
  const resumeQa =
    item.state === "preview_ready" && (!revision || event.attempts > 1);
  if (revision && item.state === "preview_ready" && !resumeQa) {
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "rework",
      resumeState: "preview_ready",
      eventType: "production.preview_revision_started",
      eventPayload: revisionEvidence ?? undefined
    });
  }
  const previewBody: Stage3PreviewRequestBody = {
    sourceUrl: candidate.sourceUrl,
    chatId,
    channelId: item.channelId,
    workspaceId: item.workspaceId,
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    snapshot
  };
  let previewArtifactPath: string;
  let previewSha256: string;
  if (resumeQa) {
    if (
      !item.stage3JobId ||
      !item.previewSha256 ||
      item.templateSha256 !== templateBinding.templateSha256 ||
      item.settingsSha256 !== settingsSha256
    ) {
      throw new Error("Preview QA retry lost its exact render bindings.");
    }
    const completed = getStage3RenderJobOrThrow(item.stage3JobId);
    if (completed.status !== "completed" || !completed.artifactFilePath) {
      throw new Error(completed.errorMessage || "Completed preview artifact is unavailable for QA retry.");
    }
    previewArtifactPath = completed.artifactFilePath;
    previewSha256 = await sha256File(previewArtifactPath);
    if (previewSha256 !== item.previewSha256) {
      throw new Error("Preview artifact changed before its QA retry.");
    }
  } else {
    const executionTarget = getWorkspaceStage3ExecutionTarget(item.workspaceId);
    const job = enqueueAndScheduleStage3Job({
      workspaceId: item.workspaceId,
      userId: options.userId,
      kind: "preview",
      executionTarget,
      dedupeKey: await buildStage3PreviewDedupeKey(previewBody, {
        workspaceId: item.workspaceId,
        userId: options.userId
      }),
      payloadJson: JSON.stringify(previewBody),
      attemptLimit: 3,
      reuseCompleted: false
    });
    const completed = await waitForStage3Job(job.id, { timeoutMs: PREVIEW_TIMEOUT_MS });
    if (completed.status !== "completed" || !completed.artifactFilePath) {
      throw new Error(completed.errorMessage || "Preview render failed.");
    }
    previewArtifactPath = completed.artifactFilePath;
    previewSha256 = await sha256File(previewArtifactPath);
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "preview_ready",
      eventType: revision ? "production.preview_revised" : "production.preview_ready",
      eventPayload: revisionEvidence ?? undefined,
      patch: {
        previewSha256,
        templateSha256: templateBinding.templateSha256,
        settingsSha256,
        stage3JobId: job.id
      }
    });
  }
  const previewProbe = await probeFinalProductionMp4(previewArtifactPath);
  const previewExpectations = {
    artifactSha256: previewSha256,
    width: 1080,
    height: 1920,
    durationSec: montage.targetDurationSec,
    durationToleranceSec: 0.35,
    requireAudio: true
  } as const;
  const deterministicEvidence = await writeJsonArtifact(
    item,
    `preview-deterministic-probe-${item.attempts + 1}-${Math.max(1, event.attempts)}`,
    "quality_verdict",
    {
      schemaVersion: "project-kings-deterministic-quality-evidence-v1",
      gateType: "preview",
      sourceSha256: item.sourceSha256,
      previewSha256,
      templateSha256: item.templateSha256,
      settingsSha256: item.settingsSha256,
      probe: previewProbe,
      expectations: previewExpectations
    }
  );
  const frames = await extractQaFrames({
    item,
    videoPath: previewArtifactPath,
    durationSec: montage.targetDurationSec,
    prefix: revision ? `preview-revision-${item.attempts}` : "preview"
  });
  const concept = await writeJsonArtifact(item, "concept-contract", "concept_contract", profile.config);
  const previewQualityBindingSha256 = qualityBindingSha256({
    item,
    gateType: "preview",
    artifactSha256: previewSha256
  });
  const visionRun = await runPortfolioProductionSemanticStage3Agent({
    role: "vision_qa",
    item,
    options,
    qualityBindingSha256: previewQualityBindingSha256,
    packet: {
      ...buildPortfolioProductionAgentPacketBase("vision_qa", item, profile.version, [concept, ...frames]),
      task: {
        templateSha256: templateBinding.templateSha256,
        conceptId: String(
          (profile.config as { concept?: { conceptId?: string } }).concept?.conceptId ?? "unknown"
        ),
        sourceSha256,
        previewSha256,
        knownSourceSha256: [],
        knownStoryEventIds: []
      }
    }
  });
  const vision = visionRun.output as ProductionVisionVerdict;
  item = requireItem(item.id);
  if (!item.sourceSha256 || !item.templateSha256 || !item.settingsSha256) {
    throw new Error("Preview approval lost one or more exact artifact bindings.");
  }
  const visionBinding = buildPortfolioProductionVisionBinding({
    item,
    sourceSha256: item.sourceSha256,
    previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256
  });
  const approvalBindingSha256 = buildProductionArtifactBindingSha256(visionBinding);
  const qualityVerdict = evaluateProductionQualityGate({
    binding: visionBinding,
    recordedApprovalBindingSha256: approvalBindingSha256,
    finalProbe: previewProbe,
    finalExpectations: previewExpectations,
    vision
  });
  const visionEvidence = await writeJsonArtifact(
    item,
    `preview-vision-verdict-${visionRun.successfulAttempt.attemptNo}`,
    "quality_verdict",
    {
      schemaVersion: "project-kings-vision-quality-evidence-v1",
      gateType: "preview",
      qualityBindingSha256: previewQualityBindingSha256,
      agentAttemptId: visionRun.successfulAttempt.id,
      output: vision
    }
  );
  recordQualityVerdict({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType: "preview",
    judgeKind: "deterministic",
    verdict: qualityVerdict.deterministicPass ? "pass" : "fail",
    attemptNo: visionRun.successfulAttempt.attemptNo,
    artifactSha256: previewSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    evidenceSha256: deterministicEvidence.sha256,
    evidenceArtifactPath: deterministicEvidence.path,
    defects: qualityVerdict.deterministicDefects
  });
  recordQualityVerdict({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType: "preview",
    judgeKind: "vision",
    verdict: qualityVerdict.visionPass ? "pass" : "fail",
    attemptNo: visionRun.successfulAttempt.attemptNo,
    artifactSha256: previewSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    agentAttemptId: visionRun.successfulAttempt.id,
    evidenceSha256: visionEvidence.sha256,
    evidenceArtifactPath: visionEvidence.path,
    defects: qualityVerdict.visionDefects
  });
  if (qualityVerdict.decision === "PASS") {
    const approvedSnapshot: ApprovedStage3Snapshot = {
      ...snapshot,
      zoroKingApproval: {
        status: "approved",
        source: "project-kings-vision-qa",
        judgeVerdict: "approved",
        innerVideoOnly: true,
        donorWrapperVisible: false,
        approvedAt: (options.now ?? (() => new Date()))().toISOString(),
        previewFrames: frames.map((frame) => frame.sha256),
        overlayFrames: [],
        cleanExperimentId: approvalBindingSha256
      }
    };
    await writeJsonArtifact(item, "approved-snapshot", "montage_plan", approvedSnapshot);
    transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "preview_approved",
      eventType: "production.preview_approved",
      outbox: {
        eventKind: "final_render.requested",
        dedupeKey: buildProductionOutboxDedupeKey("final_render.requested", {
          gate: "final_render",
          attemptNo: item.attempts + 1,
          approvalBindingSha256
        }),
        payload: { approvalBindingSha256 },
        maxAttempts: 5
      }
    });
    return;
  }
  let revisionCounts: Awaited<ReturnType<typeof readRevisionCounts>>;
  try {
    revisionCounts = await readRevisionCounts(item);
    if (revisionCounts.total !== item.attempts) {
      throw new RevisionApplicationError(
        "invalid_ledger",
        `Revision attempt mismatch: item=${item.attempts}, ledger=${revisionCounts.total}.`
      );
    }
  } catch (error) {
    await blockRevisionApplication({ item, error, stage: "decision" });
    return;
  }
  const decision = decideProductionRevision({
    defects: qualityVerdict.defects,
    totalAttempts: revisionCounts.total,
    textAttempts: revisionCounts.text,
    visualAttempts: revisionCounts.visual
  });
  if (decision.action === "quarantine_source") {
    quarantineChannelSourceCandidate({
      candidateId: sourceCandidateId,
      reason: decision.reason
    });
    replaceProductionItemOrBlock({
      item,
      terminalState: "quarantined",
      eventType: "production.preview_quarantined",
      reason: decision.reason,
      eventPayload: { defects: qualityVerdict.defects }
    });
    return;
  }
  if (decision.action === "replace_source") {
    replaceProductionItemOrBlock({
      item,
      terminalState: "replaced",
      eventType: "production.preview_replaced",
      reason: decision.reason,
      eventPayload: { defects: qualityVerdict.defects }
    });
    return;
  }
  if (!decidePortfolioLiveRecoveryBudget(item).canRework) {
    replaceProductionItemOrBlock({
      item,
      terminalState: "replaced",
      eventType: "production.preview_rework_budget_exhausted",
      reason: `Rework budget exhausted after ${item.attempts} attempts.`,
      eventPayload: { defects: qualityVerdict.defects }
    });
    return;
  }
  transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "rework",
    resumeState: decision.resumeState,
    eventType: "production.preview_rework",
    eventPayload: { defects: qualityVerdict.defects, decision },
    patch: { incrementAttempts: true },
    outbox: {
      eventKind: "revision.requested",
      dedupeKey: buildProductionOutboxDedupeKey("revision.requested", {
        gate: "preview",
        attemptNo: item.attempts + 1,
        previewSha256: item.previewSha256,
        expectedRevisionAction: decision.action
      }),
      payload: { defects: qualityVerdict.defects, expectedRevisionAction: decision.action },
      maxAttempts: 3
    }
  });
}

async function handleRevision(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  const item = requireItem(event.productionItemId);
  if (item.state !== "rework" || !item.resumeState) return;
  if (!item.sourceSha256 || !item.settingsSha256) {
    throw new Error("Revision cannot run without bound source and settings hashes.");
  }
  const profile = currentProfile(item);
  const verdicts = listPublicVerifications(item.id);
  const defects = Array.isArray(event.payload.defects)
    ? (event.payload.defects as ProductionQualityDefect[])
    : [];
  const quality = await writeJsonArtifact(item, `revision-defects-${item.attempts}`, "quality_verdict", {
    defects,
    previousPublicChecks: verdicts.length
  });
  const [captionArtifact, montageArtifact] = await Promise.all([
    existingRevisionArtifact({ item, id: "caption-brief", kind: "caption_brief" }),
    existingRevisionArtifact({ item, id: "montage-plan", kind: "montage_plan" })
  ]);
  const expectedRevisionAction =
    typeof event.payload.expectedRevisionAction === "string"
      ? event.payload.expectedRevisionAction
      : null;
  if (
    expectedRevisionAction !== "deterministic_repair" &&
    expectedRevisionAction !== "targeted_regenerate" &&
    expectedRevisionAction !== "targeted_visual_revision"
  ) {
    await blockRevisionApplication({
      item,
      error: new RevisionApplicationError(
        "invalid_binding",
        `Revision event has no applicable expected action: ${expectedRevisionAction ?? "missing"}.`
      ),
      stage: "decision"
    });
    return;
  }
  let output: RevisionOutput;
  try {
    output = buildDeterministicRevisionPlan({
      action: expectedRevisionAction,
      defects
    });
  } catch (error) {
    await blockRevisionApplication({ item, error, stage: "decision" });
    return;
  }
  const revisionPlan = await writeJsonArtifact(
    item,
    `revision-plan-${item.attempts}`,
    "quality_verdict",
    output
  );
  const persistedOutput = validateProductionAgentOutput(
    "revision",
    await readJsonFile<RevisionOutput>(revisionPlan.path)
  );
  if (
    persistedOutput.action !== "replace_source" &&
    persistedOutput.action !== "quarantine_source" &&
    persistedOutput.action !== expectedRevisionAction
  ) {
    await blockRevisionApplication({
      item,
      error: new RevisionApplicationError(
        "invalid_binding",
        `Revision action mismatch: expected ${expectedRevisionAction ?? "missing"}, got ${persistedOutput.action}.`
      ),
      stage: "apply",
      evidence: { revisionPlanSha256: revisionPlan.sha256 }
    });
    return;
  }
  if (persistedOutput.action === "quarantine_source") {
    if (!item.sourceCandidateId) {
      throw new Error("Revision requested quarantine without a bound source candidate.");
    }
    quarantineChannelSourceCandidate({
      candidateId: item.sourceCandidateId,
      reason: persistedOutput.reason
    });
    replaceProductionItemOrBlock({
      item,
      terminalState: "quarantined",
      eventType: "production.revision_quarantined",
      reason: persistedOutput.reason,
      eventPayload: { defects, revisionPlanSha256: revisionPlan.sha256 }
    });
    return;
  }
  if (persistedOutput.action === "replace_source") {
    replaceProductionItemOrBlock({
      item,
      terminalState: "replaced",
      eventType: "production.revision_replaced",
      reason: persistedOutput.reason,
      eventPayload: { defects, revisionPlanSha256: revisionPlan.sha256 }
    });
    return;
  }
  if (persistedOutput.resumeState !== item.resumeState) {
    await blockRevisionApplication({
      item,
      error: new RevisionApplicationError(
        "invalid_binding",
        `Revision resume-state mismatch: expected ${item.resumeState}, got ${persistedOutput.resumeState ?? "null"}.`
      ),
      stage: "apply",
      evidence: { revisionPlanSha256: revisionPlan.sha256 }
    });
    return;
  }
  try {
    const channel = await getChannelById(item.channelId);
    if (!channel) throw new Error("Revision channel not found.");
    const [caption, montage, ledger] = await Promise.all([
      readJsonFile<RevisionCaptionState>(captionArtifact.path),
      readJsonFile<MontagePlannerOutput>(montageArtifact.path),
      readRevisionLedger(item)
    ]);
    const applied = applyPersistedRevision({
      revision: persistedOutput,
      defects,
      artifacts: [captionArtifact, montageArtifact],
      caption,
      montage,
      ledger,
      attemptNo: item.attempts,
      previousSettingsSha256: item.settingsSha256,
      textBounds: {
        topMin: channel.stage2HardConstraints.topLengthMin,
        topMax: channel.stage2HardConstraints.topLengthMax,
        bottomMin: channel.stage2HardConstraints.bottomLengthMin,
        bottomMax: channel.stage2HardConstraints.bottomLengthMax,
        bannedWords: channel.stage2HardConstraints.bannedWords
      }
    });
    // Persist the immutable intent first. If a later canonical-input write fails,
    // a retry sees the consumed ledger attempt and fails closed instead of applying
    // the same model decision a second time to a partially rewritten input.
    const ledgerArtifact = await writeJsonArtifact(
      item,
      REVISION_LEDGER_ARTIFACT_ID,
      "quality_verdict",
      applied.ledger
    );
    const nextCaptionArtifact = await writeJsonArtifact(
      item,
      "caption-brief",
      "caption_brief",
      applied.caption
    );
    const nextMontageArtifact = await writeJsonArtifact(
      item,
      "montage-plan",
      "montage_plan",
      applied.montage
    );
    transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: item.resumeState,
      eventType: "production.revision_ready",
      eventPayload: {
        action: persistedOutput.action,
        revisionLedgerEntryId: applied.entry.entryId,
        revisionBindingSha256: applied.entry.revisionBindingSha256,
        revisionPlanSha256: revisionPlan.sha256,
        qualityArtifactSha256: quality.sha256,
        ledgerArtifactSha256: ledgerArtifact.sha256,
        beforeCaptionSha256: applied.entry.before.captionSha256,
        afterCaptionSha256: applied.entry.after.captionSha256,
        beforeMontageSha256: applied.entry.before.montageSha256,
        afterMontageSha256: applied.entry.after.montageSha256,
        nextCaptionArtifactSha256: nextCaptionArtifact.sha256,
        nextMontageArtifactSha256: nextMontageArtifact.sha256
      },
      outbox: {
        eventKind: "preview_revision.requested",
        dedupeKey: buildProductionOutboxDedupeKey("preview_revision.requested", {
          gate: "preview_revision",
          attemptNo: item.attempts,
          revisionBindingSha256: applied.entry.revisionBindingSha256
        }),
        payload: {
          action: persistedOutput.action,
          revisionLedgerEntryId: applied.entry.entryId,
          revisionBindingSha256: applied.entry.revisionBindingSha256
        },
        maxAttempts: 3
      }
    });
  } catch (error) {
    await blockRevisionApplication({
      item,
      error,
      stage: "apply",
      evidence: {
        revisionPlanSha256: revisionPlan.sha256,
        qualityArtifactSha256: quality.sha256,
        captionArtifactSha256: captionArtifact.sha256,
        montageArtifactSha256: montageArtifact.sha256
      }
    });
  }
}

async function handleFinalRender(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  let item = requireItem(event.productionItemId);
  if (
    !["preview_approved", "final_rendered"].includes(item.state) ||
    !item.chatId ||
    !item.sourceCandidateId
  ) return;
  if (
    !item.sourceSha256 ||
    !item.previewSha256 ||
    !item.templateSha256 ||
    !item.settingsSha256
  ) {
    throw new Error("Final render prerequisites lost their approved artifact bindings.");
  }
  const sourceCandidateId = item.sourceCandidateId;
  const sourceSha256 = item.sourceSha256;
  const previewSha256 = item.previewSha256;
  const templateSha256 = item.templateSha256;
  const settingsSha256 = item.settingsSha256;
  const profile = currentProfile(item);
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).find((entry) => entry.id === sourceCandidateId);
  if (!candidate) throw new Error("Source candidate not found.");
  const snapshot = await readApprovedStage3Snapshot(item);
  const { zoroKingApproval, ...renderSnapshot } = snapshot;
  if (sha256Text(JSON.stringify(renderSnapshot)) !== settingsSha256) {
    throw new Error("Approved Stage 3 snapshot no longer matches its settings binding.");
  }
  const templateBinding = await resolveFrozenManagedTemplateBinding({
    workspaceId: item.workspaceId,
    templateId: profile.templateId,
    expectedTemplateSha256: profile.templateSnapshotSha256
  });
  if (templateBinding.templateSha256 !== templateSha256) {
    throw new Error("Live managed template no longer matches the preview-approved template hash.");
  }
  if (
    JSON.stringify(renderSnapshot.managedTemplateState ?? null) !==
    JSON.stringify(templateBinding.managedTemplateState)
  ) {
    throw new Error("Embedded managed template state drifted after preview approval.");
  }
  const approvalBinding = buildProductionArtifactBindingSha256(
    buildPortfolioProductionVisionBinding({
      item,
      sourceSha256,
      previewSha256,
      templateSha256,
      settingsSha256
    })
  );
  if (zoroKingApproval.cleanExperimentId !== approvalBinding) {
    throw new Error("Recorded preview approval does not bind the current production artifacts.");
  }
  const caption = await readJsonFile<CaptionOutput & { top: string; bottom: string }>(
    path.join(artifactRoot(item), "caption-brief.json")
  );
  const montage = await readJsonFile<MontagePlannerOutput>(
    path.join(artifactRoot(item), "montage-plan.json")
  );
  const body: Stage3RenderRequestBody = {
    requestId: `portfolio-${item.id}`,
    sourceUrl: candidate.sourceUrl,
    channelId: item.channelId,
    workspaceId: item.workspaceId,
    chatId: item.chatId,
    publishAfterRender: false,
    renderTitle: caption.title,
    topText: caption.top,
    bottomText: caption.bottom,
    templateId: profile.templateId,
    snapshot
  };
  let finalArtifactPath: string;
  let finalArtifactSha256: string;
  if (item.state === "final_rendered") {
    if (!item.stage3JobId || !item.finalArtifactSha256) {
      throw new Error("Final QA retry lost its completed render binding.");
    }
    const completed = getStage3RenderJobOrThrow(item.stage3JobId);
    if (completed.status !== "completed" || !completed.artifactFilePath) {
      throw new Error(completed.errorMessage || "Completed final artifact is unavailable for QA retry.");
    }
    finalArtifactPath = completed.artifactFilePath;
    finalArtifactSha256 = await sha256File(finalArtifactPath);
    if (finalArtifactSha256 !== item.finalArtifactSha256) {
      throw new Error("Final artifact changed before its QA retry.");
    }
  } else {
    const executionTarget = getWorkspaceStage3ExecutionTarget(item.workspaceId);
    const job = enqueueAndScheduleStage3Job({
      workspaceId: item.workspaceId,
      userId: options.userId,
      kind: "render",
      executionTarget,
      dedupeKey: buildStage3RenderRequestDedupeKey(body, {
        workspaceId: item.workspaceId,
        userId: options.userId
      }),
      payloadJson: JSON.stringify(body),
      attemptLimit: 3,
      reuseCompleted: false
    });
    const completed = await waitForStage3Job(job.id, { timeoutMs: FINAL_RENDER_TIMEOUT_MS });
    if (completed.status !== "completed" || !completed.artifactFilePath) {
      throw new Error(completed.errorMessage || "Final render failed.");
    }
    finalArtifactPath = completed.artifactFilePath;
    finalArtifactSha256 = await sha256File(finalArtifactPath);
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "final_rendered",
      eventType: "production.final_rendered",
      patch: { finalArtifactSha256, stage3JobId: job.id }
    });
  }
  const probe = await probeFinalProductionMp4(finalArtifactPath);
  const finalExpectations = {
    artifactSha256: finalArtifactSha256,
    width: 1080,
    height: 1920,
    durationSec: montage.targetDurationSec,
    durationToleranceSec: 0.35,
    requireAudio: true
  } as const;
  const deterministicEvidence = await writeJsonArtifact(
    item,
    `final-deterministic-probe-${item.attempts + 1}-${Math.max(1, event.attempts)}`,
    "quality_verdict",
    {
      schemaVersion: "project-kings-deterministic-quality-evidence-v1",
      gateType: "final",
      sourceSha256,
      previewSha256,
      templateSha256,
      settingsSha256,
      finalArtifactSha256,
      recordedApprovalBindingSha256: zoroKingApproval.cleanExperimentId,
      probe,
      expectations: finalExpectations
    }
  );
  const frames = await extractQaFrames({
    item,
    videoPath: finalArtifactPath,
    durationSec: montage.targetDurationSec,
    prefix: "final"
  });
  const concept = await writeJsonArtifact(item, "concept-contract", "concept_contract", profile.config);
  const finalQualityBindingSha256 = qualityBindingSha256({
    item,
    gateType: "final",
    artifactSha256: finalArtifactSha256
  });
  const visionRun = await runPortfolioProductionSemanticStage3Agent({
    role: "vision_qa",
    item,
    options,
    qualityBindingSha256: finalQualityBindingSha256,
    packet: {
      ...buildPortfolioProductionAgentPacketBase("vision_qa", item, profile.version, [concept, ...frames]),
      task: {
        templateSha256: templateBinding.templateSha256,
        conceptId: String(
          (profile.config as { concept?: { conceptId?: string } }).concept?.conceptId ?? "unknown"
        ),
        sourceSha256,
        previewSha256: finalArtifactSha256,
        knownSourceSha256: [],
        knownStoryEventIds: []
      }
    }
  });
  const vision = visionRun.output as ProductionVisionVerdict;
  item = requireItem(item.id);
  const verdict = evaluateProductionQualityGate({
    binding: buildPortfolioProductionVisionBinding({
      item,
      sourceSha256,
      previewSha256,
      templateSha256,
      settingsSha256
    }),
    recordedApprovalBindingSha256: zoroKingApproval.cleanExperimentId,
    finalProbe: probe,
    finalExpectations,
    vision
  });
  const visionEvidence = await writeJsonArtifact(
    item,
    `final-vision-verdict-${visionRun.successfulAttempt.attemptNo}`,
    "quality_verdict",
    {
      schemaVersion: "project-kings-vision-quality-evidence-v1",
      gateType: "final",
      qualityBindingSha256: finalQualityBindingSha256,
      agentAttemptId: visionRun.successfulAttempt.id,
      output: vision
    }
  );
  recordQualityVerdict({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType: "final",
    judgeKind: "deterministic",
    verdict: verdict.deterministicPass ? "pass" : "fail",
    attemptNo: visionRun.successfulAttempt.attemptNo,
    artifactSha256: finalArtifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    evidenceSha256: deterministicEvidence.sha256,
    evidenceArtifactPath: deterministicEvidence.path,
    defects: verdict.deterministicDefects
  });
  recordQualityVerdict({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType: "final",
    judgeKind: "vision",
    verdict: verdict.visionPass ? "pass" : "fail",
    attemptNo: visionRun.successfulAttempt.attemptNo,
    artifactSha256: finalArtifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    agentAttemptId: visionRun.successfulAttempt.id,
    evidenceSha256: visionEvidence.sha256,
    evidenceArtifactPath: visionEvidence.path,
    defects: verdict.visionDefects
  });
  if (verdict.decision !== "PASS") {
    let revisionCounts: Awaited<ReturnType<typeof readRevisionCounts>>;
    try {
      revisionCounts = await readRevisionCounts(item);
      if (revisionCounts.total !== item.attempts) {
        throw new RevisionApplicationError(
          "invalid_ledger",
          `Revision attempt mismatch: item=${item.attempts}, ledger=${revisionCounts.total}.`
        );
      }
    } catch (error) {
      await blockRevisionApplication({ item, error, stage: "decision" });
      return;
    }
    const decision = decideProductionRevision({
      defects: verdict.defects,
      totalAttempts: revisionCounts.total,
      textAttempts: revisionCounts.text,
      visualAttempts: revisionCounts.visual
    });
    if (decision.action === "quarantine_source") {
      quarantineChannelSourceCandidate({
        candidateId: sourceCandidateId,
        reason: decision.reason
      });
      replaceProductionItemOrBlock({
        item,
        terminalState: "quarantined",
        eventType: "production.final_quarantined",
        reason: decision.reason,
        eventPayload: { defects: verdict.defects }
      });
      return;
    }
    if (decision.action === "replace_source") {
      replaceProductionItemOrBlock({
        item,
        terminalState: "replaced",
        eventType: "production.final_replaced",
        reason: decision.reason,
        eventPayload: { defects: verdict.defects }
      });
      return;
    }
    if (!decidePortfolioLiveRecoveryBudget(item).canRework) {
      replaceProductionItemOrBlock({
        item,
        terminalState: "replaced",
        eventType: "production.final_rework_budget_exhausted",
        reason: `Rework budget exhausted after ${item.attempts} attempts.`,
        eventPayload: { defects: verdict.defects }
      });
      return;
    }
    transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "rework",
      resumeState: decision.resumeState,
      eventType: "production.final_rework",
      eventPayload: { defects: verdict.defects, decision },
      patch: { incrementAttempts: true },
      outbox: {
        eventKind: "revision.requested",
        dedupeKey: buildProductionOutboxDedupeKey("revision.requested", {
          gate: "final",
          attemptNo: item.attempts + 1,
          finalArtifactSha256,
          expectedRevisionAction: decision.action
        }),
        payload: { defects: verdict.defects, expectedRevisionAction: decision.action },
        maxAttempts: 3
      }
    });
    return;
  }
  transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "final_approved",
    eventType: "production.final_approved",
    outbox: {
      eventKind: "publication.requested",
      dedupeKey: buildProductionOutboxDedupeKey("publication.requested", {
        gate: "publication",
        finalArtifactSha256
      }),
      payload: { finalArtifactSha256 },
      maxAttempts: 3
    }
  });
}

function findProductionPublication(item: ProductionItemRecord): ChannelPublication | null {
  if (item.publicationId) return getChannelPublicationById(item.publicationId);
  if (!item.stage3JobId) return null;
  const renderExport = getRenderExportByStage3JobId(item.stage3JobId);
  return renderExport ? findLatestPublicationForRenderExport(renderExport.id) : null;
}

function publicationMayHaveExternalEffect(publication: ChannelPublication): boolean {
  const processing = getChannelPublicationProcessingState(publication.id);
  return Boolean(
    publication.status === "uploading" ||
    publication.status === "scheduled" ||
    publication.status === "published" ||
    publication.youtubeVideoId ||
    processing?.uploadSessionUrl ||
    processing?.youtubeVideoId
  );
}

function persistObservedScheduledPublication(input: {
  item: ProductionItemRecord;
  publication: ChannelPublication;
}): ProductionItemRecord {
  const youtubeVideoId = input.publication.youtubeVideoId;
  if (!youtubeVideoId) throw new Error("Scheduled publication has no YouTube video ID.");
  const publicVerificationOutbox = buildProductionPublicVerificationOutboxIntent({
    publicationId: input.publication.id,
    youtubeVideoId,
    scheduledAt: input.publication.scheduledAt
  });
  let item = requireItem(input.item.id);
  if (item.publicationId && item.publicationId !== input.publication.id) {
    throw new Error("Production item is already bound to another publication intent.");
  }
  if (item.state === "public_verified") return item;
  if (item.state === "final_approved" || item.state === "cancel_requested") {
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "upload_outcome_unknown",
      eventType: "production.upload_outcome_observed_after_fence",
      eventPayload: { publicationId: input.publication.id, youtubeVideoId },
      patch: { publicationId: input.publication.id, youtubeVideoId },
      outbox: item.state === "cancel_requested" ? publicVerificationOutbox : undefined
    });
  }
  if (item.state === "upload_outcome_unknown" && !getProductionRun(item.runId)?.status.startsWith("cancel")) {
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "publication_scheduled",
      eventType: "production.publication_scheduled",
      patch: { publicationId: input.publication.id, youtubeVideoId, lastError: null },
      outbox: publicVerificationOutbox
    });
  }
  return item;
}

async function handleCancelRequested(
  event: ProductionOutboxRecord,
  options?: Pick<PortfolioLiveRuntimeOptions, "sleep">
): Promise<void> {
  let item = requireItem(event.productionItemId);
  if (item.state !== "cancel_requested" && item.state !== "upload_outcome_unknown") return;
  const publication = findProductionPublication(item);
  if (!publication) {
    if (item.state === "cancel_requested") {
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "canceled",
        eventType: "production.item.canceled_before_publication"
      });
      return;
    }
    throw new Error("Upload outcome is unknown but no durable publication intent can be found.");
  }
  if (item.publicationId && item.publicationId !== publication.id) {
    throw new Error("Cancellation found a publication different from the item's frozen intent.");
  }
  if (publicationMayHaveExternalEffect(publication)) {
    if (publication.youtubeVideoId) {
      persistObservedScheduledPublication({ item, publication });
      return;
    }
    if (item.state === "cancel_requested") {
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "upload_outcome_unknown",
        eventType: "production.cancel_waiting_for_upload_reconciliation",
        eventPayload: { publicationId: publication.id, publicationStatus: publication.status },
        patch: {
          publicationId: publication.id,
          uploadSessionUrl: getChannelPublicationProcessingState(publication.id)?.uploadSessionUrl ?? undefined
        }
      });
    }
    scheduleChannelPublicationProcessing();
    try {
      const scheduled = await waitForPublication(publication.id, options?.sleep ?? sleepDefault);
      persistObservedScheduledPublication({ item: requireItem(item.id), publication: scheduled });
      return;
    } catch (error) {
      const latest = getChannelPublicationById(publication.id);
      if (latest?.youtubeVideoId && (latest.status === "scheduled" || latest.status === "published")) {
        persistObservedScheduledPublication({ item: requireItem(item.id), publication: latest });
        return;
      }
      throw error;
    }
  }
  if (publication.status !== "canceled") cancelChannelPublication(publication.id);
  item = requireItem(item.id);
  transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "canceled",
    eventType: "production.item.canceled_before_upload",
    eventPayload: { publicationId: publication.id },
    patch: { publicationId: publication.id, lastError: null }
  });
}

async function handlePublication(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  let item = requireItem(event.productionItemId);
  if (!["final_approved", "upload_outcome_unknown", "cancel_requested"].includes(item.state)) return;
  if (!item.chatId || !item.stage3JobId) throw new Error("Publication item lost its chat/render binding.");
  let run = getProductionRun(item.runId);
  if (!run) throw new Error("Run not found.");
  if (run.mode === "shadow") return;
  if (run.mode !== "live") throw new Error("Real publisher refuses non-live runs.");

  if (run.status === "cancel_requested" || run.status === "canceled" || item.state === "cancel_requested") {
    return handleCancelRequested(event, options);
  }
  if (!item.sourceCandidateId || !item.sourceSha256) {
    throw new Error("Final-approved item lost its source binding before publication.");
  }
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    limit: 1000
  }).find((entry) => entry.id === item.sourceCandidateId);
  if (!candidate) throw new Error("Publication source candidate not found.");
  const chat = await createOrGetChatBySource({
    rawUrl: candidate.sourceUrl,
    channelIdRaw: item.channelId
  });
  const renderExport = getRenderExportByStage3JobId(item.stage3JobId);
  if (!renderExport) throw new Error("Final render export not found.");
  const caption = await readJsonFile<CaptionOutput & { top: string; bottom: string }>(
    path.join(artifactRoot(item), "caption-brief.json")
  );
  const stage2 = buildStage2Payload({
    sourceUrl: candidate.sourceUrl,
    sourceTitle: String(candidate.evidence.title ?? candidate.categoryKey),
    sourceSha256: item.sourceSha256,
    caption,
    top: caption.top,
    bottom: caption.bottom
  });
  let publication = createOrUpdateQueuedPublicationFromRenderExport({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    chatId: item.chatId,
    chatTitle: chat.title,
    renderExport,
    stage2Result: stage2,
    createdByUserId: options.userId,
    publishAfterRender: true
  });
  if (!publication) throw new Error("Publication intent was not created.");

  if (item.state === "final_approved") {
    try {
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "upload_outcome_unknown",
        eventType: "production.publication_intent_bound",
        eventPayload: { publicationId: publication.id, publicationStatus: publication.status },
        patch: { publicationId: publication.id, lastError: null }
      });
    } catch (error) {
      item = requireItem(item.id);
      run = getProductionRun(item.runId);
      if (item.state === "cancel_requested" || run?.status === "cancel_requested") {
        return handleCancelRequested(event, options);
      }
      throw error;
    }
  }

  // Pre-side-effect cancel fence. The generic publication claim has the same durable SQL fence,
  // so cancellation between this read and worker claim still prevents the upload.
  item = requireItem(item.id);
  run = getProductionRun(item.runId);
  if (!run || run.status === "cancel_requested" || run.status === "canceled" || item.state === "cancel_requested") {
    return handleCancelRequested(event, options);
  }
  publication = getChannelPublicationById(publication.id) ?? publication;
  if ((publication.status === "scheduled" || publication.status === "published") && publication.youtubeVideoId) {
    persistObservedScheduledPublication({ item, publication });
    return;
  }
  if (publication.status === "canceled") {
    throw new Error("Bound publication was canceled before upload completed.");
  }
  if (publication.status === "failed" && publicationMayHaveExternalEffect(publication)) {
    throw new Error(publication.lastError || "Publication failed after upload may have started.");
  }

  scheduleChannelPublicationProcessing();
  try {
    const scheduled = await waitForPublication(publication.id, options.sleep ?? sleepDefault);
    // Post-side-effect fence: always persist the remote identity first; cancellation never hides it.
    persistObservedScheduledPublication({ item: requireItem(item.id), publication: scheduled });
  } catch (error) {
    const latestPublication = getChannelPublicationById(publication.id);
    const latestItem = requireItem(item.id);
    const latestRun = getProductionRun(latestItem.runId);
    if (latestPublication?.youtubeVideoId &&
        (latestPublication.status === "scheduled" || latestPublication.status === "published")) {
      persistObservedScheduledPublication({ item: latestItem, publication: latestPublication });
      return;
    }
    if (latestItem.state === "cancel_requested" || latestRun?.status === "cancel_requested") {
      return handleCancelRequested(event, options);
    }
    throw error;
  }
}

async function handlePublicVerify(
  event: ProductionOutboxRecord,
  options: PortfolioLiveRuntimeOptions
): Promise<void> {
  const item = requireItem(event.productionItemId);
  if (
    !["publication_scheduled", "upload_outcome_unknown", "cancel_requested"].includes(item.state) ||
    !item.publicationId ||
    !item.youtubeVideoId
  ) return;
  if (
    event.payload.publicationId !== item.publicationId ||
    event.payload.youtubeVideoId !== item.youtubeVideoId
  ) {
    throw new Error("Public verification immutable publication identity mismatch.");
  }
  const pollingBudget = resolvePortfolioPublicVerificationPollingBudget(
    event,
    options.now?.() ?? new Date()
  );
  const integration = getChannelPublishIntegration(item.channelId);
  const result = await reconcileYouTubePublicVerification(
    {
      publicationId: item.publicationId,
      expectedVideoId: item.youtubeVideoId,
      expectedChannelId: item.expectedYoutubeChannelId
    },
    {
      readClipsPublication: async (publicationId) => {
        const publication = getChannelPublicationById(publicationId);
        if (!publication) throw new Error("Clips publication not found.");
        return {
          publicationId: publication.id,
          status: publication.status,
          youtubeVideoId: publication.youtubeVideoId,
          youtubeChannelId: integration?.selectedYoutubeChannelId ?? null,
          lastError: publication.lastError
        };
      },
      fetch: options.fetch ?? fetch,
      now: options.now,
      sleep: options.sleep
    },
    {
      maxAttempts: 7,
      initialRetryDelayMs: 5_000,
      maxRetryDelayMs: 120_000,
      maxElapsedMs: pollingBudget.maxElapsedMs
    }
  );
  const attemptNo = listPublicVerifications(item.id).length + 1;
  const last = result.attempts.at(-1);
  if (result.verified && last?.rss && last.shortsPage) {
    markChannelPublicationPublicVerified({
      publicationId: item.publicationId,
      expectedYoutubeVideoId: item.youtubeVideoId,
      expectedYoutubeChannelId: item.expectedYoutubeChannelId,
      verifiedAt: last.checkedAt,
      evidenceSha256: result.evidenceSha256
    });
  }
  const recorded = recordPublicVerification({
    productionItemId: item.id,
    expectedItemVersion: item.version,
    publicationId: item.publicationId,
    expectedYoutubeChannelId: item.expectedYoutubeChannelId,
    youtubeVideoId: item.youtubeVideoId,
    attemptNo,
    clipsStatus: last?.clips.state?.status ?? "unknown",
    clipsMatches: Boolean(last?.clips.state && !last.clips.error),
    rssSeen: last?.rss?.matchingVideoFound === true,
    shortsHttpStatus: last?.shortsPage?.status ?? null,
    pagePlayable:
      last?.shortsPage?.playabilityStatus === "OK" &&
      last?.shortsPage?.isPrivate === false &&
      (last?.shortsPage?.playableStreamCount ?? 0) > 0,
    pageCanonicalVideoId: last?.shortsPage?.videoId ?? null,
    pageChannelId: last?.shortsPage?.channelId ?? null,
    failureCode: result.verified ? null : result.reason,
    evidence: result as unknown as Record<string, unknown>
  });
  if (!recorded.verification.verified) {
    if (result.outcome === "terminal_failure") {
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: recorded.item.version,
        toState: "policy_blocked",
        eventType: "production.public_verification_blocked",
        eventPayload: { reason: result.reason },
        patch: { lastError: result.reason }
      });
      return;
    }
    const deadlineReached = (options.now?.() ?? new Date()).getTime() >= Date.parse(pollingBudget.deadlineAt);
    throw new Error(deadlineReached
      ? `Public verification deadline reached at ${pollingBudget.deadlineAt}: ${result.reason}`
      : `Public verification delayed: ${result.reason}`);
  }
}

const PORTFOLIO_LIVE_EVENT_STATES: Readonly<
  Record<PortfolioLiveEventKind, readonly ProductionItemState[]>
> = {
  "source_ingest.requested": ["reserved"],
  "source_fit.requested": ["source_ingested"],
  "brief.requested": ["source_qualified"],
  "preview.requested": ["brief_ready", "preview_ready"],
  "preview_revision.requested": ["brief_ready", "preview_ready", "rework"],
  "revision.requested": ["rework"],
  "final_render.requested": ["preview_approved", "final_rendered"],
  "publication.requested": ["final_approved", "upload_outcome_unknown", "cancel_requested"],
  "public_verify.requested": ["publication_scheduled", "upload_outcome_unknown", "cancel_requested"],
  "production.item.cancel_requested": ["cancel_requested", "upload_outcome_unknown"],
  "production.item.public_verified": ["public_verified"]
};

function isPortfolioLiveEventKind(value: string): value is PortfolioLiveEventKind {
  return Object.prototype.hasOwnProperty.call(PORTFOLIO_LIVE_EVENT_STATES, value);
}

export function createPortfolioLiveDispatcher(
  options: PortfolioLiveRuntimeOptions,
  dependencies: PortfolioLiveRuntimeDependencies = {}
): (event: ProductionOutboxRecord) => Promise<void> {
  return async (event) => {
    if (event.workspaceId !== options.workspaceId) return;
    if (!isPortfolioLiveEventKind(event.eventKind)) {
      throw new Error(`Unsupported portfolio production event: ${event.eventKind}`);
    }
    const eventKind = event.eventKind;
    const item = (dependencies.getItem ?? getProductionItem)(event.productionItemId);
    if (!item) {
      throw new Error(`Production item not found: ${event.productionItemId}`);
    }
    if (item.workspaceId !== options.workspaceId || item.workspaceId !== event.workspaceId) {
      throw new Error("Portfolio production event and item belong to different workspaces.");
    }
    if (!PORTFOLIO_LIVE_EVENT_STATES[eventKind].includes(item.state)) {
      return;
    }
    const injected = dependencies.handlers?.[eventKind];
    if (injected) {
      return injected(event, options);
    }
    switch (eventKind) {
      case "source_ingest.requested":
        return handleSourceIngest(event, options);
      case "source_fit.requested":
        return handleSourceFit(event, options);
      case "brief.requested":
        return handleBrief(event, options);
      case "preview.requested":
        return renderPreviewAndJudge(event, options, false);
      case "preview_revision.requested":
        return renderPreviewAndJudge(event, options, true);
      case "revision.requested":
        return handleRevision(event, options);
      case "final_render.requested":
        return handleFinalRender(event, options);
      case "publication.requested":
        return handlePublication(event, options);
      case "public_verify.requested":
        return handlePublicVerify(event, options);
      case "production.item.cancel_requested":
        return handleCancelRequested(event, options);
      case "production.item.public_verified":
        return;
    }
  };
}
