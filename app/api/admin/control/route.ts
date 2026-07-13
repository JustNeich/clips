import { randomUUID } from "node:crypto";
import { requireOwnerOrMcpMachineScope, requireSharedCodexAvailable } from "../../../../lib/auth/guards";
import { appendFlowAuditEvent } from "../../../../lib/audit-log-store";
import {
  createChannel,
  createChannelAsset,
  createOrGetChatBySource,
  deleteChannelById,
  getChannelById,
  getChatById,
  updateChannelById,
  type Channel
} from "../../../../lib/chat-history";
import {
  buildChannelAssetUrl,
  saveChannelAssetFile,
  validateChannelAssetMime
} from "../../../../lib/channel-assets";
import {
  deleteChannelPublicationWithRemoteSync,
  restoreCanceledChannelPublicationToQueue,
  updateChannelPublicationFromEditor
} from "../../../../lib/channel-publication-service";
import { scheduleChannelPublicationProcessing } from "../../../../lib/channel-publication-runtime";
import { isChannelPublishIntegrationReady } from "../../../../lib/channel-publish-state";
import { getDb } from "../../../../lib/db/client";
import {
  toPublicationMutationErrorPayload
} from "../../../../lib/publication-mutation-errors";
import {
  getChannelPublicationById,
  getChannelPublishIntegration,
  getChannelPublishSettings,
  listApprovedRenderExportsForChannel,
  listChannelPublications
} from "../../../../lib/publication-store";
import { requireRuntimeTool } from "../../../../lib/runtime-capabilities";
import {
  createManagedTemplate,
  listManagedTemplateSummaries,
  readManagedTemplate,
  updateManagedTemplate
} from "../../../../lib/managed-template-store";
import { ensureCodexLoggedIn } from "../../../../lib/codex-runner";
import { buildStage2RunChannelSnapshot } from "../../../../lib/stage2-run-channel-snapshot";
import { agentManualCaptionIssues, parseAgentManualCaption } from "../../../../lib/stage2-agent-manual";
import { resolveEffectiveStage2HardConstraints } from "../../../../lib/stage2-template-contract";
import { buildStage2RunRequestSnapshot } from "../../../../lib/stage2-run-request";
import {
  enqueueAndScheduleStage2Run,
  scheduleStage2RunProcessing
} from "../../../../lib/stage2-run-runtime";
import {
  findActiveStage2RunForChat,
  type Stage2RunMode
} from "../../../../lib/stage2-progress-store";
import { enqueueAndScheduleSourceJob, getActiveSourceJobForChat } from "../../../../lib/source-job-runtime";
import { getSourceDecompositionForChat } from "../../../../lib/source-decomposition-store";
import { resolvePublicAppOrigin } from "../../../../lib/public-app-origin";
import {
  buildStage3WorkerCommands,
  buildStage3WorkerDesktopDeepLink,
  resolveStage3WorkerPublicOrigin
} from "../../../../lib/stage3-worker-commands";
import {
  issueStage3WorkerPairingToken,
  listStage3Workers
} from "../../../../lib/stage3-worker-store";
import {
  getWorkspaceAnthropicIntegration,
  getWorkspaceCodexIntegration,
  getWorkspaceCodexModelConfig,
  getWorkspaceOpenRouterIntegration,
  getWorkspaceStage2CaptionProviderConfig,
  getWorkspaceStage3ExecutionTarget,
  listChannelAccess,
  listWorkspaceMembers,
  revokeChannelAccess,
  setChannelAccess
} from "../../../../lib/team-store";
import {
  isSupportedUrl,
  normalizeSupportedUrl,
  SUPPORTED_SOURCE_ERROR_MESSAGE
} from "../../../../lib/ytdlp";
import { runCopscopesDailyPool } from "../../../../lib/copscopes-daily-runner";
import { getFlowObservabilityDetail, listFlowObservability } from "../../../../lib/flow-observability";
import type { McpMachineCredentialScope } from "../../../../lib/mcp-machine-credential-store";
import { resolveStage3Execution } from "../../../../lib/stage3-execution";
import { buildStage3PreviewDedupeKey, type Stage3PreviewRequestBody } from "../../../../lib/stage3-preview-service";
import { resolveStage3LocalWorkerReadiness } from "../../../../lib/stage3-worker-readiness";
import { enqueueAndScheduleStage3Job } from "../../../../lib/stage3-job-runtime";
import {
  listCompletedStage3RenderJobsForChat,
  type Stage3JobRecord
} from "../../../../lib/stage3-job-store";
import { buildStage3JobEnvelope } from "../../../../lib/stage3-job-http";
import { buildStage3RenderRequestDedupeKey } from "../../../../lib/stage3-render-request";
import type { Stage3RenderRequestBody } from "../../../../lib/stage3-render-service";
import { resolveSnapshotManagedTemplateStateForEnqueue } from "../../../../lib/managed-template-runtime";
import { findLatestStage2Event } from "../../../../lib/chat-workflow";
import { buildDefaultStage3RenderSnapshot } from "../../../../lib/stage3-default-snapshot";
import { CHANNEL_STORY_TEMPLATE_ID } from "../../../../lib/stage3-template";
import type { Stage3RenderPlan, Stage3StateSnapshot } from "../../../../app/components/types";
import {
  cancelProductionRun,
  createOwnerReplacementAfterQuarantineBudgetBlock,
  createReplacementProductionItem,
  getProductionItem,
  getProductionProfile,
  getProductionRun,
  isOwnerRecoverableReplacementBudgetError,
  isProductionProfileExplicitlyApproved,
  listAgentAttempts,
  listProductionEvents,
  listProductionOutbox,
  listPublicVerifications,
  ProductionStoreError,
  requeueProjectedRecoverableSourceFitDeadLetter,
  requeueProjectedRecoverableBriefDeadLetter,
  requeueRecoverableFinalLedgerPolicyBlock,
  requeueRecoverablePreviewPolicyBlock,
  requeueProductionItemRevision
} from "../../../../lib/portfolio-production-store";
import {
  getPortfolioProductionRun,
  reconcilePortfolioProductionRun,
  startPortfolioProductionRun,
  validatePortfolioProductionProfile,
  PORTFOLIO_PIPELINE_FEATURE_FLAG,
  PORTFOLIO_PIPELINE_POST_CANARY_FEATURE_FLAG,
  PROJECT_KINGS_PUBLISH_POLICY_ID
} from "../../../../lib/portfolio-production-orchestrator";
import { buildPortfolioLiveProfileValidator } from "../../../../lib/portfolio-production-live-preflight";
import { schedulePortfolioProductionLiveBackgroundRun } from "../../../../lib/portfolio-production-live-background-runtime";
import {
  approveProjectKingsPilotProfile,
  prepareProjectKingsPilotProfiles,
  resolveProjectKingsPilotProfilesForRun
} from "../../../../lib/project-kings/pilot-profile-store";
import {
  approveCurrentProjectKingsSourcePolicy
} from "../../../../lib/project-kings/source-policy-approval-store";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "../../../../lib/project-kings/source-rights-sensitive-policy";
import {
  ProjectKingsPortfolioDaemonInputError,
  releaseProjectKingsPortfolioDaemon,
  tickProjectKingsPortfolioDaemon
} from "../../../../lib/project-kings/portfolio-daemon";

export const runtime = "nodejs";

type ControlBody = {
  tool?: string;
  input?: Record<string, unknown>;
};

type OwnerControlAuth = Awaited<ReturnType<typeof requireOwnerOrMcpMachineScope>>;
type ZoroKingVisualApproval = {
  status?: string;
  source?: string;
  judgeVerdict?: string;
  innerVideoOnly?: boolean;
  donorWrapperVisible?: boolean;
  approvedAt?: string;
  previewFrames?: string[];
  overlayFrames?: string[];
  cleanExperimentId?: string;
};
type Stage3SnapshotPatch = Partial<Omit<Stage3StateSnapshot, "renderPlan">> & {
  renderPlan?: Partial<Stage3RenderPlan>;
  zoroKingApproval?: ZoroKingVisualApproval;
};

const TOOL_SCOPES: Record<string, McpMachineCredentialScope> = {
  clips_owner_status: "integration:readiness",
  clips_owner_get_integrations_readiness: "integration:readiness",
  clips_owner_list_channels: "flow:read",
  clips_owner_get_channel: "flow:read",
  clips_owner_create_channel: "entity:write",
  clips_owner_update_channel: "entity:write",
  clips_owner_upload_channel_asset: "entity:write",
  clips_owner_delete_channel: "entity:write",
  clips_owner_list_templates: "flow:read",
  clips_owner_create_template: "entity:write",
  clips_owner_get_template: "flow:read",
  clips_owner_update_template: "entity:write",
  clips_owner_render_video: "pipeline:run",
  clips_owner_list_members: "flow:read",
  clips_owner_list_channel_access: "flow:read",
  clips_owner_set_channel_access: "entity:write",
  clips_owner_revoke_channel_access: "entity:write",
  clips_owner_list_publications: "flow:read",
  clips_owner_list_render_exports: "flow:read",
  clips_owner_render_preview: "pipeline:run",
  clips_owner_get_flow: "flow:read",
  clips_owner_update_publication: "publication:write",
  clips_owner_schedule_publication: "publication:write",
  clips_owner_cancel_publication: "publication:delete",
  clips_owner_list_stage3_workers: "worker:admin",
  clips_owner_pair_stage3_worker: "worker:admin",
  clips_owner_run_video_pipeline: "pipeline:run",
  clips_owner_prepare_production_profiles: "control:write",
  clips_owner_approve_production_profile: "control:write",
  clips_owner_approve_source_policy: "control:write",
  clips_owner_validate_production_profile: "control:write",
  clips_owner_start_portfolio_run: "control:write",
  clips_owner_get_portfolio_run: "flow:read",
  clips_owner_reconcile_portfolio_run: "control:write",
  clips_owner_retry_production_item: "control:write",
  clips_owner_cancel_portfolio_run: "control:write",
  clips_owner_tick_portfolio_daemon: "control:write",
  clips_owner_release_portfolio_daemon: "control:write",
  clips_owner_run_copscopes_daily_pool: "pipeline:run",
  // AGENT-ONLY tools. Additive; the human manual flow does not use these.
  clips_owner_run_agent_pipeline: "pipeline:run",
  clips_flow_get_source_decomposition: "flow:read"
};

function resolveString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveBoolean(value: unknown): boolean {
  return value === true;
}

function resolveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function ownerRetryReconcileDeferred(error: unknown): { code: string; error: string } {
  if (error instanceof ProductionStoreError) {
    const blockerCode = typeof error.details.blockerCode === "string"
      ? error.details.blockerCode
      : error.code;
    return { code: blockerCode, error: error.message };
  }
  const message = error instanceof Error ? error.message : "Owner retry reconciliation failed.";
  return {
    code: message.includes("portfolio_channel_ownership_releasing")
      ? "portfolio_channel_ownership_releasing"
      : "reconcile_failed",
    error: message
  };
}

function mergeStage3SnapshotPatch(
  base: Stage3SnapshotPatch | null,
  patch: Stage3SnapshotPatch | null
): Stage3SnapshotPatch | null {
  if (!base) {
    return patch;
  }
  if (!patch) {
    return base;
  }
  const patchRenderPlan = patch.renderPlan ?? {};
  const textAffectingPatch =
    "topText" in patch ||
    "bottomText" in patch ||
    "sourceOverlayText" in patch ||
    "captionHighlights" in patch ||
    "topFontScale" in patchRenderPlan ||
    "bottomFontScale" in patchRenderPlan ||
    "authorName" in patchRenderPlan ||
    "authorHandle" in patchRenderPlan ||
    "templateId" in patchRenderPlan;
  return {
    ...base,
    ...patch,
    renderPlan: {
      ...base.renderPlan,
      ...(patch.renderPlan ?? {})
    } as Stage3RenderPlan,
    managedTemplateState: patch.managedTemplateState ?? base.managedTemplateState,
    captionHighlights: patch.captionHighlights ?? base.captionHighlights,
    templateSnapshot: textAffectingPatch ? patch.templateSnapshot : patch.templateSnapshot ?? base.templateSnapshot,
    textFit: textAffectingPatch ? patch.textFit : patch.textFit ?? base.textFit
  };
}

function parseJobSnapshot(job: Stage3JobRecord): Stage3SnapshotPatch | null {
  try {
    const payload = JSON.parse(job.payloadJson) as { snapshot?: unknown };
    return payload.snapshot && typeof payload.snapshot === "object"
      ? (payload.snapshot as Stage3SnapshotPatch)
      : null;
  } catch {
    return null;
  }
}

function hasEditorSourceCrop(snapshot: Stage3SnapshotPatch | null): boolean {
  const crop = snapshot?.renderPlan?.sourceCrop;
  return Boolean(crop && crop.enabled === true && crop.width > 0 && crop.height > 0);
}

function hasApprovedVisualGate(snapshot: Stage3SnapshotPatch | null): boolean {
  const approval = snapshot?.zoroKingApproval;
  return Boolean(
    hasEditorSourceCrop(snapshot) &&
      approval &&
      approval.status === "approved" &&
      approval.judgeVerdict === "approved" &&
      approval.innerVideoOnly === true &&
      approval.donorWrapperVisible === false &&
      Array.isArray(approval.previewFrames) &&
      approval.previewFrames.length > 0
  );
}

function requiresChannelStoryVisualGate(input: {
  templateId: string | null | undefined;
  managedTemplateState: Stage3StateSnapshot["managedTemplateState"] | null | undefined;
}): boolean {
  if (input.templateId === CHANNEL_STORY_TEMPLATE_ID) {
    return true;
  }
  const managed = input.managedTemplateState;
  if (!managed || managed.managedId !== input.templateId) {
    return false;
  }
  return (
    managed.baseTemplateId === CHANNEL_STORY_TEMPLATE_ID ||
    managed.templateConfig.layoutKind === "channel_story"
  );
}

function pickMontageRenderPlanPatch(plan: Partial<Stage3RenderPlan>): Partial<Stage3RenderPlan> {
  return {
    targetDurationSec: plan.targetDurationSec,
    durationMode: plan.durationMode,
    timingMode: plan.timingMode,
    normalizeToTargetEnabled: plan.normalizeToTargetEnabled,
    editorSelectionMode: plan.editorSelectionMode,
    audioMode: plan.audioMode,
    sourceAudioEnabled: plan.sourceAudioEnabled,
    sourceAudioGain: plan.sourceAudioGain,
    smoothSlowMo: plan.smoothSlowMo,
    mirrorEnabled: plan.mirrorEnabled,
    cameraMotion: plan.cameraMotion,
    cameraKeyframes: plan.cameraKeyframes,
    cameraPositionKeyframes: plan.cameraPositionKeyframes,
    cameraScaleKeyframes: plan.cameraScaleKeyframes,
    focusX: plan.focusX,
    videoZoom: plan.videoZoom,
    mediaRegionHeightPx: plan.mediaRegionHeightPx,
    videoScaleY: plan.videoScaleY,
    videoScaleX: plan.videoScaleX,
    videoFit: plan.videoFit,
    videoBrightness: plan.videoBrightness,
    videoExposure: plan.videoExposure,
    videoContrast: plan.videoContrast,
    videoSaturation: plan.videoSaturation,
    sourceCrop: plan.sourceCrop,
    musicGain: plan.musicGain,
    textPolicy: plan.textPolicy,
    segments: plan.segments,
    policy: plan.policy,
    backgroundAssetId: plan.backgroundAssetId,
    backgroundAssetMimeType: plan.backgroundAssetMimeType,
    musicAssetId: plan.musicAssetId,
    musicAssetMimeType: plan.musicAssetMimeType
  };
}

function buildMontagePatchFromSnapshot(snapshot: Stage3SnapshotPatch): Stage3SnapshotPatch {
  return {
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    focusX: snapshot.focusX,
    focusY: snapshot.focusY,
    sourceDurationSec: snapshot.sourceDurationSec,
    renderPlan: pickMontageRenderPlanPatch(snapshot.renderPlan ?? {}),
    zoroKingApproval: snapshot.zoroKingApproval
  };
}

function findLatestEditorMontageSnapshot(input: {
  workspaceId: string;
  chatId: string;
}): { job: Stage3JobRecord; snapshot: Stage3SnapshotPatch } | null {
  const jobs = listCompletedStage3RenderJobsForChat({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    limit: 25
  });
  for (const job of jobs) {
    const snapshot = parseJobSnapshot(job);
    if (snapshot && hasApprovedVisualGate(snapshot)) {
      return { job, snapshot };
    }
  }
  return null;
}

function summarizeChannel(channel: Channel): Record<string, unknown> {
  const integration = getChannelPublishIntegration(channel.id);
  const settings = getChannelPublishSettings(channel.id);
  return {
    id: channel.id,
    name: channel.name,
    username: channel.username,
    archivedAt: channel.archivedAt ?? null,
    templateId: channel.templateId,
    defaultClipDurationSec: channel.defaultClipDurationSec,
    publishing: {
      ready: isChannelPublishIntegrationReady(integration),
      settings,
      integration: integration
        ? {
            provider: integration.provider,
            status: integration.status,
            selectedYoutubeChannelId: integration.selectedYoutubeChannelId,
            selectedYoutubeChannelTitle: integration.selectedYoutubeChannelTitle,
            selectedYoutubeChannelCustomUrl: integration.selectedYoutubeChannelCustomUrl,
            selectedGoogleAccountEmail: integration.selectedGoogleAccountEmail,
            youtubeOAuthClientKey: integration.youtubeOAuthClientKey,
            youtubeOAuthClientLabel: integration.youtubeOAuthClientLabel,
            youtubeOAuthProjectNumber: integration.youtubeOAuthProjectNumber,
            lastVerifiedAt: integration.lastVerifiedAt,
            lastError: integration.lastError
          }
        : null
    }
  };
}

async function resolveChannel(workspaceId: string, input: Record<string, unknown>): Promise<Channel | null> {
  const channelId = resolveString(input.channelId);
  if (channelId) {
    const channel = await getChannelById(channelId);
    return channel && channel.workspaceId === workspaceId ? channel : null;
  }
  const username = (resolveString(input.channelUsername) ?? resolveString(input.username))?.replace(/^@+/, "").toLowerCase();
  if (!username) {
    return null;
  }
  const row = getDb()
    .prepare(
      `SELECT id
         FROM channels
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND lower(username) = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, username) as { id?: string } | undefined;
  if (!row?.id) {
    return null;
  }
  return getChannelById(String(row.id));
}

async function requireChannel(workspaceId: string, input: Record<string, unknown>): Promise<Channel> {
  const channel = await resolveChannel(workspaceId, input);
  if (!channel) {
    throw new Response(JSON.stringify({ error: "Channel not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  return channel;
}

function requireDestructiveIntent(input: Record<string, unknown>, entityId: string, actionLabel: string): string {
  const intent = resolveString(input.intent);
  if (!intent || intent.length < 12 || !intent.includes(entityId)) {
    throw new Response(
      JSON.stringify({
        error: `${actionLabel} requires an explicit intent string that includes the exact entity id ${entityId}.`
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  return intent;
}

function auditControl(input: {
  auth: OwnerControlAuth;
  action: string;
  entityType?: string;
  entityId?: string | null;
  channelId?: string | null;
  chatId?: string | null;
  status: string;
  payload?: Record<string, unknown>;
  severity?: "info" | "warn" | "error";
}): void {
  appendFlowAuditEvent({
    workspaceId: input.auth.workspace.id,
    userId: input.auth.user.id,
    action: input.action,
    entityType: input.entityType ?? "mcp_owner_control",
    entityId: input.entityId ?? input.channelId ?? "owner-control",
    channelId: input.channelId ?? null,
    chatId: input.chatId ?? null,
    stage: "mcp",
    status: input.status,
    severity: input.severity ?? "info",
    payload: {
      actor: input.auth.actor,
      ...input.payload
    }
  });
}

async function listChannels(workspaceId: string, includeArchived: boolean): Promise<Channel[]> {
  const rows = getDb()
    .prepare(
      `SELECT id
         FROM channels
        WHERE workspace_id = ?
          ${includeArchived ? "" : "AND archived_at IS NULL"}
        ORDER BY updated_at DESC`
    )
    .all(workspaceId) as Array<{ id: string }>;
  const channels = await Promise.all(rows.map((row) => getChannelById(row.id)));
  return channels.filter((channel): channel is Channel => Boolean(channel));
}

function summarizeIntegrations(workspaceId: string): Record<string, unknown> {
  const codex = getWorkspaceCodexIntegration(workspaceId);
  const anthropic = getWorkspaceAnthropicIntegration(workspaceId);
  const openrouter = getWorkspaceOpenRouterIntegration(workspaceId);
  return {
    stage2CaptionProvider: getWorkspaceStage2CaptionProviderConfig(workspaceId),
    stage3ExecutionTarget: getWorkspaceStage3ExecutionTarget(workspaceId),
    codex: codex
      ? {
          status: codex.status,
          ready: codex.status === "connected" && Boolean(codex.codexHomePath),
          codexHomePath: codex.codexHomePath,
          connectedAt: codex.connectedAt,
          updatedAt: codex.updatedAt,
          loginStatusText: codex.loginStatusText,
          deviceAuthStatus: codex.deviceAuthStatus,
          modelConfig: getWorkspaceCodexModelConfig(workspaceId)
        }
      : { status: "disconnected", ready: false },
    anthropic: anthropic
      ? {
          status: anthropic.status,
          ready: anthropic.status === "connected",
          apiKeyHint: anthropic.apiKeyHint,
          connectedAt: anthropic.connectedAt,
          updatedAt: anthropic.updatedAt,
          lastError: anthropic.lastError
        }
      : { status: "disconnected", ready: false },
    openrouter: openrouter
      ? {
          status: openrouter.status,
          ready: openrouter.status === "connected",
          apiKeyHint: openrouter.apiKeyHint,
          connectedAt: openrouter.connectedAt,
          updatedAt: openrouter.updatedAt,
          lastError: openrouter.lastError
        }
      : { status: "disconnected", ready: false }
  };
}

function listWorkspacePublicationCounts(workspaceId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS count
         FROM channel_publications
        WHERE workspace_id = ?
        GROUP BY status`
    )
    .all(workspaceId) as Array<{ status: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]));
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? null;
}

function buildPortfolioOwnerResponse(runId: string, workspaceId: string) {
  const summary = getPortfolioProductionRun(runId);
  if (summary.run.workspaceId !== workspaceId) {
    throw new Response(JSON.stringify({ error: "Portfolio run not found." }), { status: 404 });
  }
  const attempts = listAgentAttempts({ runId });
  const durations = attempts
    .map((attempt) => attempt.durationMs)
    .filter((value): value is number => typeof value === "number");
  const outbox = listProductionOutbox({ runId });
  const events = listProductionEvents({ runId });
  const verifications = summary.items.flatMap((item) => listPublicVerifications(item.id));
  const roleMetrics = Object.fromEntries(
    [...new Set(attempts.map((attempt) => attempt.role))].sort().map((role) => {
      const roleAttempts = attempts.filter((attempt) => attempt.role === role);
      const roleDurations = roleAttempts
        .map((attempt) => attempt.durationMs)
        .filter((value): value is number => typeof value === "number");
      return [role, {
        calls: roleAttempts.length,
        passed: roleAttempts.filter((attempt) => attempt.status === "passed").length,
        failed: roleAttempts.filter((attempt) => attempt.status === "failed").length,
        durationP50Ms: percentile(roleDurations, 0.5),
        durationP95Ms: percentile(roleDurations, 0.95),
        inputTokens: roleAttempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0),
        outputTokens: roleAttempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0),
        costMicros: roleAttempts.reduce((sum, attempt) => sum + (attempt.costMicros ?? 0), 0),
        costUnits: [...new Set(roleAttempts.map((attempt) => attempt.costUnit).filter(Boolean))]
      }];
    })
  );
  return {
    ...summary,
    nextWakeAt:
      summary.channels
        .map((channel) => channel.nextSlotAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
    metrics: {
      agentCalls: attempts.length,
      inputTokens: attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0),
      cachedInputTokens: attempts.reduce((sum, attempt) => sum + (attempt.cachedInputTokens ?? 0), 0),
      outputTokens: attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0),
      reasoningOutputTokens: attempts.reduce(
        (sum, attempt) => sum + (attempt.reasoningOutputTokens ?? 0),
        0
      ),
      // Codex inputTokens already includes its cached-input subset; do not
      // double-count cachedInputTokens in the July-9 comparable total.
      logicalTokenEvents: attempts.reduce(
        (sum, attempt) => sum + (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0),
        0
      ),
      costByUnit: {
        codexCreditsMicros: attempts
          .filter((attempt) => attempt.costUnit === "codex_credits")
          .reduce((sum, attempt) => sum + (attempt.costMicros ?? 0), 0),
        usdMicros: attempts
          .filter((attempt) => attempt.costUnit === "usd")
          .reduce((sum, attempt) => sum + (attempt.costMicros ?? 0), 0),
        unknownAttempts: attempts.filter(
          (attempt) => attempt.costMicros === null || attempt.costUnit === null
        ).length
      },
      byRole: roleMetrics,
      durationP50Ms: percentile(durations, 0.5),
      durationP95Ms: percentile(durations, 0.95),
      outbox: {
        pending: outbox.filter((entry) => entry.status === "pending").length,
        processing: outbox.filter((entry) => entry.status === "processing").length,
        delivered: outbox.filter((entry) => entry.status === "delivered").length,
        dead: outbox.filter((entry) => entry.status === "dead").length
      },
      retries: outbox.reduce((sum, entry) => sum + Math.max(0, entry.attempts - 1), 0),
      retryReasons: outbox
        .filter((entry) => entry.attempts > 1 || entry.lastError || entry.deadLetterCode)
        .map((entry) => ({
          outboxId: entry.id,
          productionItemId: entry.productionItemId,
          eventKind: entry.eventKind,
          attempts: entry.attempts,
          maxAttempts: entry.maxAttempts,
          status: entry.status,
          lastError: entry.lastError,
          deadLetterCode: entry.deadLetterCode,
          nextAttemptAt: entry.status === "pending" ? entry.availableAt : null
        })),
      publicVerificationAttempts: verifications.length,
      events: events.length
    }
  };
}

async function handleOwnerTool(auth: OwnerControlAuth, request: Request, tool: string, input: Record<string, unknown>) {
  if (tool === "clips_owner_status") {
    const channels = await listChannels(auth.workspace.id, false);
    return {
      workspace: auth.workspace,
      actor: auth.actor,
      integrations: summarizeIntegrations(auth.workspace.id),
      counts: {
        channels: channels.length,
        publications: listWorkspacePublicationCounts(auth.workspace.id)
      },
      workers: listStage3Workers({ workspaceId: auth.workspace.id }),
      recentFlows: listFlowObservability({ workspaceId: auth.workspace.id, filters: { limit: 10 } }).flows
    };
  }

  if (tool === "clips_owner_get_integrations_readiness") {
    return summarizeIntegrations(auth.workspace.id);
  }

  if (tool === "clips_owner_tick_portfolio_daemon") {
    const profileIds = resolveStringArray(input.profileIds) ?? [];
    const mode = resolveString(input.mode);
    if (mode !== "shadow" && mode !== "live") {
      throw new Response(JSON.stringify({ error: "mode shadow|live is required." }), { status: 400 });
    }
    const canaryPolicyRaw = resolveString(input.canaryPolicy);
    if (canaryPolicyRaw && canaryPolicyRaw !== "first_item_per_channel_public_verified" && canaryPolicyRaw !== "none") {
      throw new Response(JSON.stringify({ error: "canaryPolicy must be first_item_per_channel_public_verified|none." }), {
        status: 400
      });
    }
    const canaryPolicy = canaryPolicyRaw === "first_item_per_channel_public_verified" || canaryPolicyRaw === "none"
      ? canaryPolicyRaw
      : undefined;
    if (mode !== "live" && canaryPolicy === "first_item_per_channel_public_verified") {
      throw new Response(JSON.stringify({
        error: `${mode} runs always require canaryPolicy=none.`,
        code: "canary_policy_invalid"
      }), { status: 400 });
    }
    const leaseOwner = auth.actor === "mcp_machine"
      ? `mcp-machine:${auth.credential.machineId}`
      : `owner-session:${auth.user.id}`;
    return tickProjectKingsPortfolioDaemon({
      workspaceId: auth.workspace.id,
      leaseOwner,
      leaseToken: resolveString(input.leaseToken),
      profileIds,
      mode,
      canaryPolicy,
      timezone: resolveString(input.timezone),
      repoCwd: process.cwd(),
      manifestPath: process.env.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH?.trim() || null
    });
  }

  if (tool === "clips_owner_release_portfolio_daemon") {
    const leaseToken = resolveString(input.leaseToken);
    if (!leaseToken) {
      throw new Response(JSON.stringify({ error: "leaseToken is required." }), { status: 400 });
    }
    const result = releaseProjectKingsPortfolioDaemon({
      workspaceId: auth.workspace.id,
      leaseToken
    });
    if (result.released) {
      auditControl({
        auth,
        action: "owner_control.portfolio_daemon.released",
        entityType: "production_daemon_runtime",
        entityId: result.daemonId,
        status: result.status,
        payload: { stoppedRuntimes: result.stoppedRuntimes }
      });
    }
    return result;
  }

  if (tool === "clips_owner_validate_production_profile") {
    const profileId = resolveString(input.profileId);
    const version = resolveNumber(input.version);
    if (!profileId || !version) {
      throw new Response(JSON.stringify({ error: "profileId and version are required." }), { status: 400 });
    }
    const profile = getProductionProfile(profileId);
    if (!profile || profile.workspaceId !== auth.workspace.id || profile.version !== version) {
      throw new Response(JSON.stringify({ error: "Production profile not found." }), { status: 404 });
    }
    return validatePortfolioProductionProfile(profile, {
      validateLiveProfile: buildPortfolioLiveProfileValidator({
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      })
    });
  }

  if (tool === "clips_owner_prepare_production_profiles") {
    const profiles = prepareProjectKingsPilotProfiles({ workspaceId: auth.workspace.id });
    const profileList = Object.values(profiles);
    auditControl({
      auth,
      action: "owner_control.production_profiles.prepared",
      entityType: "production_profile_set",
      entityId: profileList.map((profile) => profile.profileHash).sort().join(":"),
      status: "prepared",
      payload: {
        profiles: profileList.map((profile) => ({
          profileId: profile.id,
          channelId: profile.channelId,
          version: profile.version,
          profileHash: profile.profileHash,
          status: profile.status
        }))
      }
    });
    return { profiles };
  }

  if (tool === "clips_owner_approve_source_policy") {
    const policyVersion = resolveString(input.policyVersion);
    const policySha256 = resolveString(input.policySha256);
    const sourceDesignationsSha256 = resolveString(input.sourceDesignationsSha256);
    const ownerAuthorizationEvidenceSha256 = resolveString(input.ownerAuthorizationEvidenceSha256);
    if (
      !policyVersion ||
      !policySha256 ||
      !sourceDesignationsSha256 ||
      !ownerAuthorizationEvidenceSha256
    ) {
      throw new Response(JSON.stringify({
        error:
          "policyVersion, policySha256, sourceDesignationsSha256 and ownerAuthorizationEvidenceSha256 are required."
      }), { status: 400 });
    }
    const result = approveCurrentProjectKingsSourcePolicy({
      workspaceId: auth.workspace.id,
      ownerUserId: auth.user.id,
      policyVersion,
      policySha256,
      sourceDesignationsSha256,
      ownerAuthorizationEvidenceSha256
    });
    auditControl({
      auth,
      action: "owner_control.source_policy.approved",
      entityType: "project_kings_source_policy_approval",
      entityId: result.approval.id,
      status: result.approval.status,
      payload: {
        existing: result.existing,
        policyVersion: result.approval.policyVersion,
        policySha256: result.approval.policySha256,
        sourceDesignationsSha256: result.approval.sourceDesignationsSha256,
        approvalSha256: result.approval.approvalSha256,
        currentPolicyMatches:
          result.approval.policyVersion === PROJECT_KINGS_SOURCE_POLICY_VERSION &&
          result.approval.policySha256 === PROJECT_KINGS_SOURCE_POLICY_SHA256 &&
          result.approval.sourceDesignationsSha256 === PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256
      }
    });
    return result;
  }

  if (tool === "clips_owner_approve_production_profile") {
    const profileId = resolveString(input.profileId);
    const version = resolveNumber(input.version);
    const profileHash = resolveString(input.profileHash);
    const targetStatus = resolveString(input.targetStatus);
    if (
      !profileId ||
      !version ||
      !profileHash ||
      (targetStatus !== "shadow" && targetStatus !== "active")
    ) {
      throw new Response(JSON.stringify({
        error: "profileId, version, profileHash and targetStatus shadow|active are required."
      }), { status: 400 });
    }
    const profile = approveProjectKingsPilotProfile({
      workspaceId: auth.workspace.id,
      approvedByUserId: auth.user.id,
      profileId,
      expectedVersion: version,
      expectedProfileHash: profileHash,
      targetStatus
    });
    auditControl({
      auth,
      action: "owner_control.production_profile.approved",
      entityType: "production_profile",
      entityId: profile.id,
      channelId: profile.channelId,
      status: profile.status,
      payload: {
        version: profile.version,
        profileHash: profile.profileHash,
        approvalScope: profile.approvalScope,
        approvalBindingSha256: profile.approvalBindingSha256
      }
    });
    return { profile };
  }

  if (tool === "clips_owner_start_portfolio_run") {
    const logicalDate = resolveString(input.logicalDate);
    const mode = resolveString(input.mode);
    const targetPerChannel = resolveNumber(input.targetPerChannel) ?? 3;
    const publishPolicyId = resolveString(input.publishPolicyId) ?? PROJECT_KINGS_PUBLISH_POLICY_ID;
    const canaryPolicyRaw = resolveString(input.canaryPolicy);
    if (!logicalDate || (mode !== "simulation" && mode !== "shadow" && mode !== "live")) {
      throw new Response(JSON.stringify({ error: "logicalDate and mode simulation|shadow|live are required." }), {
        status: 400
      });
    }
    if (targetPerChannel !== 3 && !(mode === "shadow" && targetPerChannel === 1)) {
      throw new Response(JSON.stringify({
        error: "Project Kings owner start supports targetPerChannel=1 only for shadow; live and simulation require 3."
      }), {
        status: 400
      });
    }
    if (canaryPolicyRaw && canaryPolicyRaw !== "first_item_per_channel_public_verified" && canaryPolicyRaw !== "none") {
      throw new Response(JSON.stringify({ error: "canaryPolicy must be first_item_per_channel_public_verified|none." }), {
        status: 400
      });
    }
    const canaryPolicy = canaryPolicyRaw === "first_item_per_channel_public_verified" || canaryPolicyRaw === "none"
      ? canaryPolicyRaw
      : undefined;
    if (mode !== "live" && canaryPolicy === "first_item_per_channel_public_verified") {
      throw new Response(JSON.stringify({
        error: `${mode} runs always require canaryPolicy=none.`,
        code: "canary_policy_invalid"
      }), { status: 400 });
    }
    if (
      mode === "live" &&
      canaryPolicy === "none" &&
      process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED !== "1"
    ) {
      throw new Response(JSON.stringify({
        error: "Live canaryPolicy=none requires PORTFOLIO_PIPELINE_POST_CANARY_ENABLED=1.",
        code: "post_canary_feature_flag_disabled"
      }), { status: 409 });
    }
    const requestedProfileIds = resolveStringArray(input.profileIds);
    const selectedProfiles = requestedProfileIds?.length
      ? requestedProfileIds.map((profileId) => {
          const profile = getProductionProfile(profileId);
          if (!profile || profile.workspaceId !== auth.workspace.id) {
            throw new ProductionStoreError("not_found", "Production profile not found in this workspace.", {
              profileId
            });
          }
          return profile;
        })
      : Object.values(resolveProjectKingsPilotProfilesForRun({
          workspaceId: auth.workspace.id,
          mode
        }));
    if (mode === "live" && selectedProfiles.some((profile) => !isProductionProfileExplicitlyApproved(profile, "live"))) {
      throw new ProductionStoreError(
        "invalid_transition",
        "Live run requires explicitly approved, hash-bound active production profiles."
      );
    }
    if (mode === "shadow" && selectedProfiles.some((profile) => !isProductionProfileExplicitlyApproved(profile, "shadow"))) {
      throw new ProductionStoreError(
        "invalid_transition",
        "Shadow run requires explicitly approved, hash-bound shadow or active production profiles."
      );
    }
    const profileIds = selectedProfiles.map((profile) => profile.id);
    const result = await startPortfolioProductionRun(
      {
        workspaceId: auth.workspace.id,
        profileIds,
        logicalDate,
        mode,
        targetPerChannel,
        publishPolicyId,
        canaryPolicy,
        idempotencyKey: resolveString(input.idempotencyKey)
      },
      {
        validateLiveProfile: buildPortfolioLiveProfileValidator({
          workspaceId: auth.workspace.id,
          userId: auth.user.id
        }),
        featureFlagEnabled: (flag) =>
          flag === PORTFOLIO_PIPELINE_FEATURE_FLAG
            ? process.env.PORTFOLIO_PIPELINE_V1_ENABLED === "1"
            : flag === PORTFOLIO_PIPELINE_POST_CANARY_FEATURE_FLAG &&
              process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED === "1"
      }
    );
    auditControl({
      auth,
      action: "owner_control.portfolio_run.started",
      entityType: "production_run",
      entityId: result.run.id,
      status: result.run.status,
      payload: { mode, logicalDate, targetPerChannel, canaryPolicy: result.canaryPolicy, existing: result.existing }
    });
    const background = await schedulePortfolioProductionLiveBackgroundRun({
      runId: result.run.id,
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    return { ...result, background };
  }

  if (tool === "clips_owner_get_portfolio_run") {
    const runId = resolveString(input.runId);
    if (!runId) {
      throw new Response(JSON.stringify({ error: "runId is required." }), { status: 400 });
    }
    return buildPortfolioOwnerResponse(runId, auth.workspace.id);
  }

  if (tool === "clips_owner_reconcile_portfolio_run") {
    const runId = resolveString(input.runId);
    const expectedVersion = resolveNumber(input.expectedVersion);
    if (!runId) {
      throw new Response(JSON.stringify({ error: "runId is required." }), { status: 400 });
    }
    const run = getProductionRun(runId);
    if (!run || run.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Portfolio run not found." }), { status: 404 });
    }
    if (expectedVersion !== undefined && expectedVersion !== run.version) {
      throw new Response(
        JSON.stringify({ error: "Portfolio run version is stale.", code: "stale_version", actualVersion: run.version }),
        { status: 409 }
      );
    }
    const result = reconcilePortfolioProductionRun({
      runId,
      leaseOwner: `owner-control:${auth.user.id}`
    });
    const background = await schedulePortfolioProductionLiveBackgroundRun({
      runId,
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    return { ...result, detail: buildPortfolioOwnerResponse(runId, auth.workspace.id), background };
  }

  if (tool === "clips_owner_retry_production_item") {
    const runId = resolveString(input.runId);
    const itemId = resolveString(input.itemId);
    const expectedVersion = resolveNumber(input.expectedVersion);
    const reason = resolveString(input.reason);
    if (!runId || !itemId || expectedVersion === undefined || !reason) {
      throw new Response(
        JSON.stringify({ error: "runId, itemId, expectedVersion and reason are required." }),
        { status: 400 }
      );
    }
    const run = getProductionRun(runId);
    const item = getProductionItem(itemId);
    if (!run || run.workspaceId !== auth.workspace.id || !item || item.runId !== runId) {
      throw new Response(JSON.stringify({ error: "Production item not found." }), { status: 404 });
    }
    if (item.version !== expectedVersion) {
      throw new Response(
        JSON.stringify({ error: "Production item version is stale.", code: "stale_version", actualVersion: item.version }),
        { status: 409 }
      );
    }
    let retried;
    let retryIntent = null;
    if (item.state === "rework" && item.resumeState) {
      const revisionIntent = [...listProductionOutbox({
        runId,
        productionItemId: item.id
      })].reverse().find((entry) => entry.eventKind === "revision.requested");
      if (!revisionIntent) {
        throw new Response(JSON.stringify({
          error: "Rework item has no durable revision intent to retry.",
          code: "retry_intent_missing"
        }), { status: 409 });
      }
      const requeued = requeueProductionItemRevision({
        itemId: item.id,
        expectedItemVersion: item.version,
        outboxId: revisionIntent.id,
        reason
      });
      retried = requeued.item;
      retryIntent = {
        outboxId: requeued.outbox.id,
        dedupeKey: requeued.outbox.dedupeKey,
        status: requeued.outbox.status,
        requeued: requeued.requeued
      };
    } else if (item.state === "failed") {
      const projectedSourceFitIntents = listProductionOutbox({
        runId,
        productionItemId: item.id
      }).filter((entry) =>
        entry.eventKind === "source_fit.requested" &&
        entry.status === "dead" &&
        Boolean(entry.projectedAt)
      );
      if (projectedSourceFitIntents.length > 1) {
        throw new Response(JSON.stringify({
          error: "Failed item has more than one projected source-fit retry intent.",
          code: "retry_intent_ambiguous"
        }), { status: 409 });
      }
      const sourceFitIntent = projectedSourceFitIntents[0];
      if (sourceFitIntent) {
        const recovered = requeueProjectedRecoverableSourceFitDeadLetter({
          itemId: item.id,
          expectedItemVersion: item.version,
          outboxId: sourceFitIntent.id,
          reason
        });
        retried = recovered.item;
        retryIntent = {
          outboxId: recovered.outbox.id,
          dedupeKey: recovered.outbox.dedupeKey,
          status: recovered.outbox.status,
          requeued: true,
          preservedSource: true
        };
      } else {
        const projectedBriefIntents = listProductionOutbox({
          runId,
          productionItemId: item.id
        }).filter((entry) =>
          entry.eventKind === "brief.requested" &&
          entry.status === "dead" &&
          Boolean(entry.projectedAt)
        );
        if (projectedBriefIntents.length > 1) {
          throw new Response(JSON.stringify({
            error: "Failed item has more than one projected brief retry intent.",
            code: "retry_intent_ambiguous"
          }), { status: 409 });
        }
        if (projectedBriefIntents.length === 1) {
          const recovered = requeueProjectedRecoverableBriefDeadLetter({
            itemId: item.id,
            expectedItemVersion: item.version,
            reason
          });
          retried = recovered.item;
          retryIntent = {
            outboxId: recovered.outbox.id,
            dedupeKey: recovered.outbox.dedupeKey,
            status: recovered.outbox.status,
            requeued: true,
            preservedSource: true
          };
        } else {
          retried = createReplacementProductionItem({
            replacedItemId: item.id,
            expectedVersion: item.version
          });
        }
      }
    } else if (item.state === "policy_blocked") {
      if (
        item.lastError ===
        "invalid_ledger: Revision attempt mismatch: item=1, ledger=0."
      ) {
        const recovered = requeueRecoverableFinalLedgerPolicyBlock({
          itemId: item.id,
          expectedItemVersion: item.version,
          reason
        });
        retried = recovered.item;
        retryIntent = {
          outboxId: recovered.outbox.id,
          dedupeKey: recovered.outbox.dedupeKey,
          status: recovered.outbox.status,
          requeued: true,
          preservedSource: true,
          preservedPreview: true,
          preservedFinalArtifact: true,
          resetAttemptsTo: recovered.item.attempts
        };
      } else if (
        item.lastError ===
        "invalid_binding: Deterministic targeted_visual_revision has no compatible structured defect."
      ) {
        const recovered = requeueRecoverablePreviewPolicyBlock({
          itemId: item.id,
          expectedItemVersion: item.version,
          reason
        });
        retried = recovered.item;
        retryIntent = {
          outboxId: recovered.outbox.id,
          dedupeKey: recovered.outbox.dedupeKey,
          status: recovered.outbox.status,
          requeued: true,
          preservedSource: true,
          preservedPreview: true
        };
      } else if (isOwnerRecoverableReplacementBudgetError(item.lastError)) {
        const recovered = createOwnerReplacementAfterQuarantineBudgetBlock({
          itemId: item.id,
          expectedItemVersion: item.version,
          reason
        });
        retried = recovered.replacementItem;
        retryIntent = {
          requeued: true,
          ownerReplacementBudgetOverride: true,
          replacedItemId: recovered.item.id,
          replacementItemId: recovered.replacementItem.id,
          replacementGeneration: recovered.replacementItem.generation
        };
      } else {
        throw new Response(JSON.stringify({
          error: "This policy-blocked item is not eligible for a bounded owner recovery.",
          code: "invalid_transition"
        }), { status: 409 });
      }
    } else if (item.state === "replaced" || item.state === "quarantined") {
      retried = createReplacementProductionItem({
        replacedItemId: item.id,
        expectedVersion: item.version
      });
    } else {
      throw new Response(
        JSON.stringify({ error: `Item state ${item.state} is not owner-retryable.`, code: "invalid_transition" }),
        { status: 409 }
      );
    }
    let reconcileDeferred: { code: string; error: string } | null = null;
    try {
      reconcilePortfolioProductionRun({
        runId,
        leaseOwner: `owner-retry:${auth.user.id}`
      });
    } catch (error) {
      // The recovery transaction above is already durable. A follow-up
      // reconcile failure must not turn an accepted, idempotent mutation into
      // a false HTTP failure that encourages the owner client to repeat it.
      reconcileDeferred = ownerRetryReconcileDeferred(error);
    }
    const background = await schedulePortfolioProductionLiveBackgroundRun({
      runId,
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    return { accepted: true, item: retried, retryIntent, reconcileDeferred, background };
  }

  if (tool === "clips_owner_cancel_portfolio_run") {
    const runId = resolveString(input.runId);
    const expectedVersion = resolveNumber(input.expectedVersion);
    const reason = resolveString(input.reason);
    if (!runId || expectedVersion === undefined || !reason) {
      throw new Response(JSON.stringify({ error: "runId, expectedVersion and reason are required." }), {
        status: 400
      });
    }
    const run = getProductionRun(runId);
    if (!run || run.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Portfolio run not found." }), { status: 404 });
    }
    return cancelProductionRun({ runId, expectedVersion, reason });
  }

  if (tool === "clips_owner_list_channels") {
    const channels = await listChannels(auth.workspace.id, resolveBoolean(input.includeArchived));
    return { channels: channels.map(summarizeChannel) };
  }

  if (tool === "clips_owner_get_channel") {
    const channel = await requireChannel(auth.workspace.id, input);
    return { channel: summarizeChannel(channel) };
  }

  if (tool === "clips_owner_create_channel") {
    const channel = await createChannel({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      name: resolveString(input.name),
      username: resolveString(input.username),
      systemPrompt: resolveString(input.systemPrompt),
      descriptionPrompt: resolveString(input.descriptionPrompt),
      templateId: resolveString(input.templateId),
      defaultClipDurationSec: resolveNumber(input.defaultClipDurationSec)
    });
    auditControl({
      auth,
      action: "owner_control.channel.created",
      entityType: "channel",
      entityId: channel.id,
      channelId: channel.id,
      status: "created",
      payload: { username: channel.username }
    });
    return { channel: summarizeChannel(channel) };
  }

  if (tool === "clips_owner_update_channel") {
    const channel = await requireChannel(auth.workspace.id, input);
    const updated = await updateChannelById(channel.id, {
      name: resolveString(input.name),
      username: resolveString(input.username),
      systemPrompt: resolveString(input.systemPrompt),
      descriptionPrompt: resolveString(input.descriptionPrompt),
      examplesJson: resolveString(input.examplesJson),
      templateId: resolveString(input.templateId),
      defaultClipDurationSec: resolveNumber(input.defaultClipDurationSec),
      defaultBackgroundAssetId: resolveString(input.defaultBackgroundAssetId)
    });
    auditControl({
      auth,
      action: "owner_control.channel.updated",
      entityType: "channel",
      entityId: updated.id,
      channelId: updated.id,
      status: "succeeded",
      payload: { username: updated.username }
    });
    return { channel: summarizeChannel(updated) };
  }

  if (tool === "clips_owner_upload_channel_asset") {
    const channel = await requireChannel(auth.workspace.id, input);
    const kindRaw = resolveString(input.kind);
    if (kindRaw !== "avatar" && kindRaw !== "background" && kindRaw !== "music") {
      throw new Response(
        JSON.stringify({ error: "kind must be one of avatar|background|music." }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const kind = kindRaw;
    const mimeType = (resolveString(input.mimeType) ?? "").toLowerCase();
    if (!validateChannelAssetMime(kind, mimeType)) {
      throw new Response(
        JSON.stringify({ error: `Unsupported mime type "${mimeType}" for kind ${kind}.` }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const dataBase64 = resolveString(input.dataBase64);
    if (!dataBase64) {
      throw new Response(JSON.stringify({ error: "dataBase64 is required." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const buffer = Buffer.from(dataBase64, "base64");
    const maxBytes =
      kind === "avatar"
        ? 10 * 1024 * 1024
        : kind === "background"
          ? 50 * 1024 * 1024
          : 80 * 1024 * 1024;
    if (buffer.byteLength <= 0 || buffer.byteLength > maxBytes) {
      throw new Response(
        JSON.stringify({ error: `File must be 1..${Math.round(maxBytes / (1024 * 1024))} MB.` }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const assetId = randomUUID().replace(/-/g, "");
    const saved = await saveChannelAssetFile({ channelId: channel.id, assetId, mimeType, buffer });
    const asset = await createChannelAsset({
      channelId: channel.id,
      kind,
      assetId,
      fileName: saved.fileName,
      originalName: resolveString(input.fileName) ?? `${kind}-asset`,
      mimeType,
      sizeBytes: buffer.byteLength
    });
    // By default, wire the freshly uploaded asset as the channel's active asset of
    // that kind (avatar -> avatarAssetId, background -> defaultBackgroundAssetId),
    // unless the caller passes setAsDefault:false. Replaces the source-blur with a
    // real background for top&&bottom templates.
    const setAsDefault = input.setAsDefault !== false;
    if (kind === "avatar" && setAsDefault) {
      await updateChannelById(channel.id, { avatarAssetId: asset.id });
    }
    if (kind === "background" && setAsDefault) {
      await updateChannelById(channel.id, { defaultBackgroundAssetId: asset.id });
    }
    auditControl({
      auth,
      action: "owner_control.channel.asset_uploaded",
      entityType: "channel",
      entityId: channel.id,
      channelId: channel.id,
      status: "succeeded",
      payload: { kind, assetId: asset.id, sizeBytes: buffer.byteLength, setAsDefault }
    });
    return { asset: { ...asset, url: buildChannelAssetUrl(asset.channelId, asset.id) } };
  }

  if (tool === "clips_owner_delete_channel") {
    const channel = await requireChannel(auth.workspace.id, input);
    const intent = requireDestructiveIntent(input, channel.id, "Delete channel");
    const deleted = await deleteChannelById(channel.id);
    auditControl({
      auth,
      action: "owner_control.channel.deleted",
      entityType: "channel",
      entityId: channel.id,
      channelId: channel.id,
      status: deleted.deleted ? "deleted" : "not_found",
      payload: {
        intent,
        removedAssets: deleted.removedAssets.length,
        removedChats: deleted.removedChats.length
      }
    });
    return {
      deleted: deleted.deleted,
      removedAssets: deleted.removedAssets.length,
      removedChats: deleted.removedChats.length
    };
  }

  if (tool === "clips_owner_list_templates") {
    return { templates: await listManagedTemplateSummaries(auth.workspace.id) };
  }

  if (tool === "clips_owner_create_template") {
    const template = await createManagedTemplate(input, {
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      creatorDisplayName: auth.user.displayName
    });
    auditControl({
      auth,
      action: "owner_control.template.created",
      entityType: "managed_template",
      entityId: template.id,
      status: "created",
      payload: { name: template.name, layoutFamily: template.layoutFamily }
    });
    return { template };
  }

  if (tool === "clips_owner_get_template") {
    const templateId = resolveString(input.templateId);
    if (!templateId) {
      throw new Response(JSON.stringify({ error: "templateId is required." }), { status: 400 });
    }
    const template = await readManagedTemplate(templateId, { workspaceId: auth.workspace.id });
    if (!template) {
      throw new Response(JSON.stringify({ error: "Template not found." }), { status: 404 });
    }
    return { template };
  }

  if (tool === "clips_owner_update_template") {
    const templateId = resolveString(input.templateId);
    if (!templateId) {
      throw new Response(JSON.stringify({ error: "templateId is required." }), { status: 400 });
    }
    const template = await updateManagedTemplate(templateId, input, { workspaceId: auth.workspace.id });
    if (!template) {
      throw new Response(JSON.stringify({ error: "Template not found." }), { status: 404 });
    }
    auditControl({
      auth,
      action: "owner_control.template.updated",
      entityType: "managed_template",
      entityId: template.id,
      status: "succeeded",
      payload: { name: template.name, layoutFamily: template.layoutFamily }
    });
    return { template };
  }

  if (tool === "clips_owner_list_members") {
    return { members: listWorkspaceMembers(auth.workspace.id) };
  }

  if (tool === "clips_owner_list_channel_access") {
    const channel = await requireChannel(auth.workspace.id, input);
    return { channel: summarizeChannel(channel), access: listChannelAccess(channel.id) };
  }

  if (tool === "clips_owner_set_channel_access") {
    const channel = await requireChannel(auth.workspace.id, input);
    const userId = resolveString(input.userId);
    if (!userId) {
      throw new Response(JSON.stringify({ error: "userId is required." }), { status: 400 });
    }
    const access = setChannelAccess({
      channelId: channel.id,
      userId,
      grantedByUserId: auth.user.id
    });
    auditControl({
      auth,
      action: "owner_control.channel_access.set",
      entityType: "channel_access",
      entityId: `${channel.id}:${userId}`,
      channelId: channel.id,
      status: "succeeded",
      payload: { userId, accessRole: access.accessRole }
    });
    return { channel: summarizeChannel(channel), access };
  }

  if (tool === "clips_owner_revoke_channel_access") {
    const channel = await requireChannel(auth.workspace.id, input);
    const userId = resolveString(input.userId);
    if (!userId) {
      throw new Response(JSON.stringify({ error: "userId is required." }), { status: 400 });
    }
    const intent = requireDestructiveIntent(input, `${channel.id}:${userId}`, "Revoke channel access");
    revokeChannelAccess(channel.id, userId);
    auditControl({
      auth,
      action: "owner_control.channel_access.revoked",
      entityType: "channel_access",
      entityId: `${channel.id}:${userId}`,
      channelId: channel.id,
      status: "revoked",
      payload: { userId, intent }
    });
    return { channel: summarizeChannel(channel), revokedUserId: userId };
  }

  if (tool === "clips_owner_list_publications") {
    const channel = await resolveChannel(auth.workspace.id, input);
    const status = resolveString(input.status);
    const limit = Math.max(1, Math.min(200, resolveNumber(input.limit) ?? 50));
    const channels = channel ? [channel] : await listChannels(auth.workspace.id, false);
    const publications = channels
      .flatMap((item) => listChannelPublications(item.id))
      .filter((publication) => !status || publication.status === status)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, limit);
    return {
      channel: channel ? summarizeChannel(channel) : null,
      publications
    };
  }

  if (tool === "clips_owner_get_flow") {
    const chatId = resolveString(input.chatId);
    if (!chatId) {
      throw new Response(JSON.stringify({ error: "chatId is required." }), { status: 400 });
    }
    return getFlowObservabilityDetail({
      workspace: auth.workspace,
      userId: auth.user.id,
      chatId,
      selectedRunId: resolveString(input.selectedRunId)
    });
  }

  if (tool === "clips_owner_list_render_exports") {
    const channel = await requireChannel(auth.workspace.id, input);
    const templateId = resolveString(input.templateId);
    const limit = Math.max(1, Math.min(25, resolveNumber(input.limit) ?? 10));
    const renderExports = listApprovedRenderExportsForChannel({
      workspaceId: auth.workspace.id,
      channelId: channel.id,
      templateId,
      limit
    });
    return {
      channel: summarizeChannel(channel),
      renderExports
    };
  }

  if (tool === "clips_owner_render_preview") {
    const channel = await requireChannel(auth.workspace.id, input);
    const rawSourceUrl = resolveString(input.sourceUrl);
    const sourceUrl = rawSourceUrl ? normalizeSupportedUrl(rawSourceUrl) : "";
    if (!sourceUrl || !isSupportedUrl(sourceUrl)) {
      throw new Response(JSON.stringify({ error: "A supported sourceUrl is required for a preview." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const chatId = resolveString(input.chatId);
    const snapshot =
      input.snapshot && typeof input.snapshot === "object"
        ? (input.snapshot as Partial<Stage3StateSnapshot>)
        : undefined;
    const normalizedBody = {
      channelId: channel.id,
      sourceUrl,
      workspaceId: auth.workspace.id,
      ...(chatId ? { chatId } : {}),
      ...(snapshot ? { snapshot } : {})
    } satisfies Stage3PreviewRequestBody;
    const executionTarget = resolveStage3Execution(auth.workspace.stage3ExecutionTarget).resolvedTarget;
    if (executionTarget === "local") {
      const readiness = await resolveStage3LocalWorkerReadiness({
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      });
      if (!readiness.ready) {
        throw new Response(
          JSON.stringify({
            error: "stage3_worker_unavailable",
            code: readiness.onlineWorkers > 0 ? "worker_runtime_outdated" : "worker_unavailable"
          }),
          {
            status: 503,
            headers: { "content-type": "application/json", "Retry-After": "6", "x-stage3-busy": "1" }
          }
        );
      }
    }
    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "preview",
      executionTarget,
      payloadJson: JSON.stringify(normalizedBody),
      dedupeKey: await buildStage3PreviewDedupeKey(normalizedBody, {
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      })
    });
    auditControl({
      auth,
      action: "owner_control.preview.queued",
      entityType: "stage3_job",
      entityId: job.id,
      channelId: channel.id,
      chatId: chatId ?? null,
      status: job.status,
      payload: { executionTarget }
    });
    return {
      ...buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/preview/jobs/${job.id}?download=1` : null),
      channel: summarizeChannel(channel),
      pollUrl: `/api/stage3/preview/jobs/${job.id}`
    };
  }

  if (tool === "clips_owner_update_publication" || tool === "clips_owner_schedule_publication") {
    const publicationId = resolveString(input.publicationId);
    if (!publicationId) {
      throw new Response(JSON.stringify({ error: "publicationId is required." }), { status: 400 });
    }
    const publication = getChannelPublicationById(publicationId);
    if (!publication || publication.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Publication not found." }), { status: 404 });
    }
    const restored = publication.status === "canceled" && tool === "clips_owner_schedule_publication"
      ? restoreCanceledChannelPublicationToQueue(publication.id, {
          remoteDeleteConfirmed: true,
          reason: "clips_owner_schedule_publication"
        })
      : publication;
    const scheduledAtLocal = resolveString(input.scheduledAtLocal);
    const slotDate = resolveString(input.slotDate);
    const slotIndex = resolveNumber(input.slotIndex);
    const patch = {
      title: resolveString(input.title),
      description: resolveString(input.description),
      tags: resolveStringArray(input.tags),
      notifySubscribers: typeof input.notifySubscribers === "boolean" ? resolveBoolean(input.notifySubscribers) : undefined,
      ...(scheduledAtLocal
        ? {
            scheduleMode: "custom" as const,
            scheduledAtLocal
          }
        : slotDate && typeof slotIndex === "number"
          ? {
              scheduleMode: "slot" as const,
              slotDate,
              slotIndex
            }
          : {})
    };
    const updated = await updateChannelPublicationFromEditor({
      publicationId: restored.id,
      patch
    });
    scheduleChannelPublicationProcessing();
    auditControl({
      auth,
      action: "owner_control.publication.updated",
      entityType: "publication",
      entityId: updated.id,
      channelId: updated.channelId,
      chatId: updated.chatId,
      status: "succeeded",
      payload: {
        tool,
        restoredFromCanceled: publication.status === "canceled" && restored.id === publication.id,
        scheduledAt: updated.scheduledAt,
        scheduleMode: updated.scheduleMode
      }
    });
    return { publication: updated };
  }

  if (tool === "clips_owner_cancel_publication") {
    const publicationId = resolveString(input.publicationId);
    if (!publicationId) {
      throw new Response(JSON.stringify({ error: "publicationId is required." }), { status: 400 });
    }
    const publication = getChannelPublicationById(publicationId);
    if (!publication || publication.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Publication not found." }), { status: 404 });
    }
    const intent = requireDestructiveIntent(input, publication.id, "Cancel/delete publication");
    const allowPublished = resolveBoolean(input.allowPublished);
    if (allowPublished && !intent.toLowerCase().includes("published")) {
      throw new Response(
        JSON.stringify({ error: "Deleting a published YouTube video requires intent to include the word published." }),
        { status: 400 }
      );
    }
    const canceled = await deleteChannelPublicationWithRemoteSync(publication.id, {
      userId: auth.user.id,
      allowPublished
    });
    auditControl({
      auth,
      action: "owner_control.publication.canceled",
      entityType: "publication",
      entityId: canceled.id,
      channelId: canceled.channelId,
      chatId: canceled.chatId,
      status: "succeeded",
      payload: {
        allowPublished,
        intent,
        youtubeVideoUrl: canceled.youtubeVideoUrl
      }
    });
    return { publication: canceled };
  }

  if (tool === "clips_owner_list_stage3_workers") {
    return { workers: listStage3Workers({ workspaceId: auth.workspace.id, userId: resolveString(input.userId) }) };
  }

  if (tool === "clips_owner_pair_stage3_worker") {
    const issued = issueStage3WorkerPairingToken({
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    const origin = resolveStage3WorkerPublicOrigin(request);
    const label = resolveString(input.label) ?? `${auth.user.displayName} ${auth.workspace.name}`.trim();
    auditControl({
      auth,
      action: "owner_control.stage3_worker_pairing.created",
      entityType: "stage3_worker_pairing",
      entityId: issued.expiresAt,
      status: "created",
      payload: {
        expiresAt: issued.expiresAt,
        label
      }
    });
    return {
      pairingToken: issued.token,
      expiresAt: issued.expiresAt,
      serverOrigin: origin,
      suggestedLabel: label,
      desktopDeepLink: buildStage3WorkerDesktopDeepLink({
        origin,
        pairingToken: issued.token,
        label
      }),
      commands: buildStage3WorkerCommands({
        origin,
        pairingToken: issued.token
      })
    };
  }

  if (tool === "clips_owner_render_video") {
    const channel = await requireChannel(auth.workspace.id, input);
    const chatId = resolveString(input.chatId);
    if (!chatId) {
      throw new Response(JSON.stringify({ error: "chatId is required." }), { status: 400 });
    }
    const chat = await getChatById(chatId);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Chat not found." }), { status: 404 });
    }
    if (chat.channelId !== channel.id) {
      throw new Response(JSON.stringify({ error: "Chat does not belong to the channel." }), { status: 400 });
    }
    const sourceUrl = normalizeSupportedUrl(chat.url);
    if (!isSupportedUrl(sourceUrl)) {
      throw new Response(JSON.stringify({ error: SUPPORTED_SOURCE_ERROR_MESSAGE }), { status: 400 });
    }
    const requestedTemplateId = resolveString(input.templateId);
    // The render target is the explicitly-requested template id when the caller
    // supplies one, otherwise the channel's own template (UI parity: the React
    // app always renders the active channel's template). Resolving it here — and
    // resolving managedTemplateState against the SAME id below — is load-bearing:
    // the server snapshot embeds renderPlan.templateId = effectiveTemplateId, and
    // the worker prefers snapshot.renderPlan.templateId. If we resolved managed
    // state only from input.templateId (omitted on the natural MCP call), a
    // managed-channel render would ship a managed renderPlan.templateId with NO
    // embedded managedTemplateState and FK-fail at render stage "template_snapshot"
    // — the exact bug the prior fix closed.
    const effectiveTemplateId = requestedTemplateId ?? resolveString(channel.templateId);
    // Resolve managed (workspace-scoped, non-built-in) templates on the CLOUD at
    // enqueue time and embed the resolved state in the render snapshot, exactly
    // like the interactive app/page.tsx path. The Stage 3 worker keeps its local
    // workspace_templates table empty, so without this it FK-fails at render
    // stage "template_snapshot". Built-in ids resolve to null and are unchanged.
    const managedTemplateState = await resolveSnapshotManagedTemplateStateForEnqueue(
      effectiveTemplateId,
      {
        workspaceId: auth.workspace.id
      }
    );
    // The interactive React app assembles the FULL Stage 3 caption snapshot
    // (text/highlights/renderPlan/templateSnapshot/textFit) before enqueuing.
    // The MCP path has no React state, so without this it would render the
    // template over footage with BLANK captions. When the caller did not supply
    // its own snapshot, rebuild the same no-override snapshot server-side from
    // the chat's latest Stage 2 result. Built-in / no-stage2 chats fall back to
    // the prior sparse body (managedTemplateState only), unchanged.
    const callerSnapshot: Partial<Stage3StateSnapshot> | null =
      input.snapshot && typeof input.snapshot === "object"
        ? (input.snapshot as Partial<Stage3StateSnapshot>)
        : null;
    const stage2Event = findLatestStage2Event(chat);
    const defaultSnapshot =
      stage2Event && stage2Event.payload
        ? buildDefaultStage3RenderSnapshot({
            stage2: stage2Event.payload,
            channel,
            templateId: effectiveTemplateId,
            managedTemplateState,
            sourceDurationSec: resolveNumber(input.sourceDurationSec) ?? null
          })
        : null;
    const reuseApprovedMontage = input.reuseApprovedMontage !== false;
    const reusedMontage =
      callerSnapshot === null && reuseApprovedMontage
        ? findLatestEditorMontageSnapshot({
            workspaceId: auth.workspace.id,
            chatId: chat.id
          })
        : null;
    const montagePatch = reusedMontage ? buildMontagePatchFromSnapshot(reusedMontage.snapshot) : null;
    const resolvedSnapshot =
      mergeStage3SnapshotPatch(
        mergeStage3SnapshotPatch(defaultSnapshot, montagePatch),
        callerSnapshot
      ) ??
      (managedTemplateState ? { managedTemplateState } : null);
    const visualGateRequired = requiresChannelStoryVisualGate({
      templateId: effectiveTemplateId,
      managedTemplateState
    });
    const visualGateApproved = hasApprovedVisualGate(resolvedSnapshot);
    if (visualGateRequired && !visualGateApproved) {
      auditControl({
        auth,
        action: "owner_control.render.blocked",
        entityType: "chat",
        entityId: chat.id,
        channelId: channel.id,
        chatId: chat.id,
        status: "blocked",
        payload: {
          reason: "needs_editor_approval",
          templateId: effectiveTemplateId ?? null,
          reusedApprovedMontageStage3JobId: reusedMontage?.job.id ?? null,
          reuseApprovedMontage
        }
      });
      throw new Response(
        JSON.stringify({
          error: "needs_editor_approval",
          code: "needs_editor_approval",
          message:
            "Channel-story renders require a fresh editor/judge approved snapshot before final MP4 enqueue."
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" }
        }
      );
    }
    // Render-time text-length contract. The agent_manual Stage 2 path validates
    // caption length/banned words, but text injected directly through the render
    // snapshot (snapshot.topText/bottomText) would otherwise bypass it. Enforce
    // the channel's per-element hard constraints here so the char-range contract
    // holds regardless of which text route produced the caption.
    const renderTop = typeof resolvedSnapshot?.topText === "string" ? resolvedSnapshot.topText : "";
    const renderBottom = typeof resolvedSnapshot?.bottomText === "string" ? resolvedSnapshot.bottomText : "";
    if (renderTop.trim() || renderBottom.trim()) {
      const textConstraints = resolveEffectiveStage2HardConstraints({
        hardConstraints: channel.stage2HardConstraints,
        templateId: effectiveTemplateId ?? channel.templateId,
        workspaceId: auth.workspace.id
      });
      const textIssues = agentManualCaptionIssues({ top: renderTop, bottom: renderBottom }, textConstraints);
      if (textIssues.length > 0) {
        auditControl({
          auth,
          action: "owner_control.render.blocked",
          entityType: "chat",
          entityId: chat.id,
          channelId: channel.id,
          chatId: chat.id,
          status: "blocked",
          payload: {
            reason: "text_constraints_failed",
            templateId: effectiveTemplateId ?? null,
            issues: textIssues
          }
        });
        throw new Response(
          JSON.stringify({
            error: "text_constraints_failed",
            code: "text_constraints_failed",
            message: `Caption text is outside the channel's hard constraints: ${textIssues.join(" ")}`,
            issues: textIssues
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" }
          }
        );
      }
    }
    const normalizedBody = {
      channelId: channel.id,
      chatId: chat.id,
      sourceUrl,
      workspaceId: auth.workspace.id,
      publishAfterRender: resolveBoolean(input.publishAfterRender),
      // Carry the effective template id (channel's own when none was requested)
      // so the worker's body-level fallback agrees with the embedded snapshot's
      // renderPlan.templateId, and the no-Stage-2 sparse path still names the
      // managed template whose state we embedded above.
      ...(effectiveTemplateId ? { templateId: effectiveTemplateId } : {}),
      ...(resolvedSnapshot ? { snapshot: resolvedSnapshot as Partial<Stage3StateSnapshot> } : {})
    } satisfies Stage3RenderRequestBody;
    const executionTarget = resolveStage3Execution(auth.workspace.stage3ExecutionTarget).resolvedTarget;
    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "render",
      executionTarget,
      dedupeKey: buildStage3RenderRequestDedupeKey(normalizedBody, {
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      }),
      payloadJson: JSON.stringify(normalizedBody),
      reuseCompleted: false
    });
    auditControl({
      auth,
      action: "owner_control.render.queued",
      entityType: "stage3_job",
      entityId: job.id,
      channelId: channel.id,
      chatId: chat.id,
      status: job.status,
      payload: {
        executionTarget,
        publishAfterRender: normalizedBody.publishAfterRender,
        templateId: effectiveTemplateId ?? null,
        renderGate: visualGateRequired ? "approved_visual_snapshot" : "not_required",
        reusedApprovedMontageStage3JobId: reusedMontage?.job.id ?? null
      }
    });
    return {
      ...buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/render/jobs/${job.id}?download=1` : null),
      channel: summarizeChannel(channel),
      pollUrl: `/api/stage3/render/jobs/${job.id}`,
      downloadUrl: `/api/admin/render-exports/${job.id}`
    };
  }

  if (tool === "clips_owner_run_copscopes_daily_pool") {
    return runOwnerDailyPool(auth, input);
  }

  if (tool === "clips_owner_run_video_pipeline") {
    const sourceUrl = resolveString(input.sourceUrl);
    if (!sourceUrl) {
      return runOwnerDailyPool(auth, input);
    }
    const channel = await requireChannel(auth.workspace.id, input);
    const normalizedUrl = normalizeSupportedUrl(sourceUrl);
    if (!isSupportedUrl(normalizedUrl)) {
      throw new Response(JSON.stringify({ error: SUPPORTED_SOURCE_ERROR_MESSAGE }), { status: 400 });
    }
    const dryRun = resolveBoolean(input.dryRun);
    if (dryRun) {
      return {
        dryRun: true,
        channel: summarizeChannel(channel),
        sourceUrl: normalizedUrl,
        planned: ["create_or_get_chat", "enqueue_stage2_run"],
        note: "Stage 3 render/publication requires a selected Stage 2 option unless using a channel-specific daily pool runner."
      };
    }
    await Promise.all([requireRuntimeTool("ffmpeg"), requireRuntimeTool("ffprobe"), requireRuntimeTool("codex")]);
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    await ensureCodexLoggedIn(integration.codexHomePath as string);
    const chat = await createOrGetChatBySource({
      rawUrl: normalizedUrl,
      channelIdRaw: channel.id,
      title: resolveString(input.title),
      eventText: resolveString(input.eventText)
    });
    const activeSourceJob = getActiveSourceJobForChat(chat.id, auth.workspace.id);
    if (activeSourceJob) {
      throw new Response(JSON.stringify({ error: "source_job_already_active", job: activeSourceJob }), { status: 409 });
    }
    const activeStage2Run = findActiveStage2RunForChat(chat.id, auth.workspace.id);
    if (activeStage2Run) {
      throw new Response(JSON.stringify({ error: "stage2_run_already_active", run: activeStage2Run }), { status: 409 });
    }
    const requestedMode = resolveString(input.mode);
    const mode: Stage2RunMode = requestedMode === "auto" ? "auto" : "manual";
    // agent_manual mode: an external agent supplies the final caption text; the
    // platform skips generation but still runs the hard-constraint validator.
    const agentCaptionProvided = input.agentCaption !== undefined && input.agentCaption !== null;
    const agentCaption = parseAgentManualCaption(input.agentCaption);
    // Fail loudly instead of silently downgrading to platform generation: a
    // malformed agentCaption (missing string top/bottom) used to be swallowed,
    // dropping the agent's text onto the unvalidated path. Surface it so the
    // caller fixes the payload rather than shipping platform-generated text.
    if (agentCaptionProvided && !agentCaption) {
      throw new Response(
        JSON.stringify({
          error: "agent_caption_malformed",
          code: "agent_caption_malformed",
          message:
            "agentCaption was provided but is missing string top/bottom fields; refusing to silently fall back to platform generation."
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const run = enqueueAndScheduleStage2Run({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      chatId: chat.id,
      request: buildStage2RunRequestSnapshot({
        sourceUrl: normalizedUrl,
        userInstruction: resolveString(input.userInstruction) ?? null,
        mode,
        agentCaption,
        baseRunId: null,
        debugMode: "summary",
        channel: buildStage2RunChannelSnapshot(channel, { workspaceId: auth.workspace.id })
      })
    });
    scheduleStage2RunProcessing();
    auditControl({
      auth,
      action: "owner_control.video_pipeline.stage2_queued",
      entityType: "stage2_run",
      entityId: run.runId,
      channelId: channel.id,
      chatId: chat.id,
      status: "queued",
      payload: {
        sourceUrl: normalizedUrl,
        mode,
        captionSource: agentCaption ? "agent_manual" : "platform"
      }
    });
    return {
      channel: summarizeChannel(channel),
      chat,
      run,
      nextStep: "Wait for Stage 2 completion, select/confirm an option, then enqueue Stage 3 render with publishAfterRender=true."
    };
  }

  if (tool === "clips_owner_run_agent_pipeline") {
    // AGENT-ONLY entry. Runs the existing source download + comments and ALSO
    // the Stage-1 decomposition, but never auto-generates Stage 2 captions: the
    // agent supplies its text later through the existing agentCaption path on
    // clips_owner_run_video_pipeline. This does not touch the human manual
    // pipeline.
    const sourceUrl = resolveString(input.sourceUrl);
    if (!sourceUrl) {
      throw new Response(JSON.stringify({ error: "sourceUrl is required." }), { status: 400 });
    }
    const channel = await requireChannel(auth.workspace.id, input);
    const normalizedUrl = normalizeSupportedUrl(sourceUrl);
    if (!isSupportedUrl(normalizedUrl)) {
      throw new Response(JSON.stringify({ error: SUPPORTED_SOURCE_ERROR_MESSAGE }), { status: 400 });
    }
    const dryRun = resolveBoolean(input.dryRun);
    if (dryRun) {
      return {
        dryRun: true,
        channel: summarizeChannel(channel),
        sourceUrl: normalizedUrl,
        planned: ["create_or_get_chat", "enqueue_source_job_with_decomposition"],
        note: "Agent flow: source download + Stage-1 decomposition. No Stage 2 caption generation."
      };
    }
    await Promise.all([requireRuntimeTool("ffmpeg"), requireRuntimeTool("ffprobe")]);
    const chat = await createOrGetChatBySource({
      rawUrl: normalizedUrl,
      channelIdRaw: channel.id,
      title: resolveString(input.title),
      eventText: resolveString(input.eventText)
    });
    const activeSourceJob = getActiveSourceJobForChat(chat.id, auth.workspace.id);
    if (activeSourceJob) {
      throw new Response(JSON.stringify({ error: "source_job_already_active", job: activeSourceJob }), { status: 409 });
    }
    const job = enqueueAndScheduleSourceJob({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      request: {
        sourceUrl: normalizedUrl,
        autoRunStage2: false,
        agentDecomposition: true,
        trigger: "fetch",
        chat: { id: chat.id, channelId: chat.channelId },
        channel: { id: channel.id, name: channel.name, username: channel.username }
      }
    });
    auditControl({
      auth,
      action: "owner_control.agent_pipeline.source_queued",
      entityType: "source_job",
      entityId: job.jobId,
      channelId: channel.id,
      chatId: chat.id,
      status: "queued",
      payload: { sourceUrl: normalizedUrl, agentDecomposition: true }
    });
    return {
      channel: summarizeChannel(channel),
      chat,
      job,
      nextStep:
        "Poll the source job to completion, then read clips_flow_get_source_decomposition{chatId} for comments/frames/subtitles/meta."
    };
  }

  if (tool === "clips_flow_get_source_decomposition") {
    // AGENT-ONLY read tool. Returns the decomposition artifact plus fetchable
    // frame image URLs scoped to this workspace.
    const chatId = resolveString(input.chatId);
    if (!chatId) {
      throw new Response(JSON.stringify({ error: "chatId is required." }), { status: 400 });
    }
    const chat = await getChatById(chatId);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Chat not found." }), { status: 404 });
    }
    const record = getSourceDecompositionForChat(auth.workspace.id, chatId);
    if (!record) {
      throw new Response(
        JSON.stringify({ error: "source_decomposition_not_found", chatId }),
        { status: 404 }
      );
    }
    const origin = resolvePublicAppOrigin(request);
    return {
      sourceKey: record.artifact.sourceKey,
      chatId: record.chatId,
      comments: record.artifact.comments,
      frames: record.artifact.frames.map((frame) => ({
        timestampSec: frame.timestampSec,
        imageUrl: `${origin}/api/admin/source-decomposition/${encodeURIComponent(record.chatId)}/frames/${frame.index}`,
        description: frame.description
      })),
      subtitles: {
        available: record.artifact.subtitles.available,
        segments: record.artifact.subtitles.segments
      },
      meta: record.artifact.meta
    };
  }

  throw new Response(JSON.stringify({ error: `Unknown owner control tool: ${tool}` }), { status: 400 });
}

async function runOwnerDailyPool(auth: OwnerControlAuth, input: Record<string, unknown>) {
  const channel = await requireChannel(auth.workspace.id, input);
  const runAsync = resolveBoolean(input.async) || resolveBoolean(input.background);
  const dryRun = resolveBoolean(input.dryRun);
  const categorySlug = resolveString(input.categorySlug);
  const limit = resolveNumber(input.limit);
  const attemptBudget = resolveNumber(input.attemptBudget);
  if (runAsync && !dryRun) {
    const runId = randomUUID().replace(/-/g, "");
    auditControl({
      auth,
      action: "owner_control.daily_pool.accepted",
      entityType: "copscopes_daily_run",
      entityId: runId,
      channelId: channel.id,
      status: "queued",
      payload: {
        categorySlug: categorySlug ?? null,
        limit: limit ?? null,
        attemptBudget: attemptBudget ?? null
      }
    });
    void runCopscopesDailyPool({
      workspaceId: auth.workspace.id,
      channelId: channel.id,
      userId: auth.user.id,
      runId,
      categorySlug,
      limit,
      attemptBudget,
      dryRun: false
    }).catch((error) => {
      appendFlowAuditEvent({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "owner_control.daily_pool.failed",
        entityType: "copscopes_daily_run",
        entityId: runId,
        channelId: channel.id,
        stage: "mcp",
        status: "failed",
        severity: "error",
        payload: { error: error instanceof Error ? error.message : String(error) }
      });
    });
    return { accepted: true, async: true, runId, channel: summarizeChannel(channel) };
  }
  const result = await runCopscopesDailyPool({
    workspaceId: auth.workspace.id,
    channelId: channel.id,
    userId: auth.user.id,
    categorySlug,
    limit,
    attemptBudget,
    dryRun
  });
  auditControl({
    auth,
    action: "owner_control.daily_pool.succeeded",
    entityType: "copscopes_daily_run",
    entityId: result.runId,
    channelId: channel.id,
    status: "succeeded",
    payload: {
      dryRun,
      queuedCount: result.queuedCount,
      reviewedCount: result.reviewedCount,
      failedCount: result.failedCount
    }
  });
  return { channel: summarizeChannel(channel), ...result };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as ControlBody | null;
    const tool = body?.tool?.trim();
    const input = body?.input && typeof body.input === "object" ? body.input : {};
    if (!tool) {
      return Response.json({ error: "tool is required." }, { status: 400 });
    }
    const requiredScope = TOOL_SCOPES[tool];
    if (!requiredScope) {
      return Response.json({ error: `Unknown owner control tool: ${tool}` }, { status: 400 });
    }
    const auth = await requireOwnerOrMcpMachineScope(request, requiredScope);
    const result = await handleOwnerTool(auth, request, tool, input);
    const accepted =
      (tool === "clips_owner_run_video_pipeline" && (result as { dryRun?: boolean }).dryRun !== true) ||
      tool === "clips_owner_start_portfolio_run" ||
      tool === "clips_owner_reconcile_portfolio_run" ||
      tool === "clips_owner_retry_production_item" ||
      tool === "clips_owner_cancel_portfolio_run" ||
      tool === "clips_owner_tick_portfolio_daemon" ||
      (tool === "clips_owner_render_video" &&
        (result as { job?: { status?: string } }).job?.status !== "completed");
    return Response.json(result, { status: accepted ? 202 : 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof ProductionStoreError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "stale_version" ||
              error.code === "invalid_transition" ||
              error.code === "lease_conflict" ||
              error.code === "idempotency_conflict" ||
              error.code === "uniqueness_conflict" ||
              error.code === "source_conflict" ||
              error.code === "source_budget_exhausted" ||
              error.code === "external_effect_conflict"
            ? 409
            : 400;
      return Response.json(
        { error: error.message, code: error.code, details: error.details },
        { status }
      );
    }
    if (error instanceof ProjectKingsPortfolioDaemonInputError) {
      return Response.json({ error: error.message, code: "invalid_input" }, { status: 400 });
    }
    const publicationError = toPublicationMutationErrorPayload(error, "Owner control action failed.");
    if (publicationError.body.code !== "UNKNOWN") {
      return Response.json(publicationError.body, { status: publicationError.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Owner control action failed." },
      { status: 500 }
    );
  }
}
