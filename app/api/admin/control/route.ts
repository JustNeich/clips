import { randomUUID } from "node:crypto";
import { requireOwnerOrMcpMachineScope, requireSharedCodexAvailable } from "../../../../lib/auth/guards";
import { appendFlowAuditEvent } from "../../../../lib/audit-log-store";
import {
  createChannel,
  createChannelAsset,
  createOrGetChatBySource,
  deleteChannelById,
  getChannelAssetById,
  getChannelById,
  getChatById,
  updateChannelById,
  type Channel
} from "../../../../lib/chat-history";
import {
  buildChannelAssetUrl,
  inspectChannelAssetBuffer,
  readChannelAssetFile,
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
  listChannelPublications,
  upsertChannelPublishSettings
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
  getStage3Job,
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
  resolveCompletedSourceBindingForEnqueue,
  Stage3SourceBindingError,
  type Stage3CompletedSourceBinding,
  type Stage3CompletedSourceExpectation
} from "../../../../lib/stage3-source-binding";

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
  clips_owner_inspect_channel_asset: "flow:read",
  clips_owner_upload_channel_asset: "entity:write",
  clips_owner_update_channel_publish_settings: "entity:write",
  clips_owner_delete_channel: "entity:write",
  clips_owner_list_templates: "flow:read",
  clips_owner_create_template: "entity:write",
  clips_owner_get_template: "flow:read",
  clips_owner_update_template: "entity:write",
  clips_owner_render_video: "pipeline:run",
  clips_owner_preflight_completed_source: "flow:read",
  clips_owner_get_stage3_job: "flow:read",
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

function resolveObject<T>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : undefined;
}

function resolveCompletedSourceExpectation(value: unknown): Stage3CompletedSourceExpectation | null {
  const record = resolveObject<Record<string, unknown>>(value);
  if (!record) {
    return null;
  }
  const jobId = resolveString(record.jobId);
  const expectedCacheKey = resolveString(record.expectedCacheKey);
  const expectedDurationSec = resolveNumber(record.expectedDurationSec);
  const expectedWidth = resolveNumber(record.expectedWidth);
  const expectedHeight = resolveNumber(record.expectedHeight);
  const expectedSizeBytes = resolveNumber(record.expectedSizeBytes);
  if (
    !jobId ||
    !expectedCacheKey ||
    expectedDurationSec === undefined ||
    expectedDurationSec <= 0 ||
    expectedWidth === undefined ||
    expectedWidth <= 0 ||
    expectedHeight === undefined ||
    expectedHeight <= 0
  ) {
    throw new Response(
      JSON.stringify({
        error: "completedSource requires jobId, expectedCacheKey, expectedDurationSec, expectedWidth and expectedHeight."
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
  return {
    jobId,
    expectedCacheKey,
    expectedDurationSec,
    expectedWidth: Math.floor(expectedWidth),
    expectedHeight: Math.floor(expectedHeight),
    ...(expectedSizeBytes !== undefined && expectedSizeBytes > 0
      ? { expectedSizeBytes: Math.floor(expectedSizeBytes) }
      : {})
  };
}

async function resolveOwnerCompletedSourceBinding(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  sourceUrl?: string | null;
  expectation: Stage3CompletedSourceExpectation;
}): Promise<Stage3CompletedSourceBinding> {
  try {
    return await resolveCompletedSourceBindingForEnqueue(input);
  } catch (error) {
    if (error instanceof Stage3SourceBindingError) {
      throw new Response(
        JSON.stringify({
          error: error.code,
          code: error.code,
          message: error.message
        }),
        { status: error.status, headers: { "content-type": "application/json" } }
      );
    }
    throw error;
  }
}

function resolveNullableStringField(
  input: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, key)) {
    return undefined;
  }
  if (input[key] === null) {
    return null;
  }
  return resolveString(input[key]);
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

function assertNormalizedSourceCrop(snapshot: Stage3SnapshotPatch | null | undefined): void {
  const crop = snapshot?.renderPlan?.sourceCrop;
  if (!crop || crop.enabled === false) {
    return;
  }
  const entries = [
    ["x", crop.x],
    ["y", crop.y],
    ["width", crop.width],
    ["height", crop.height]
  ] as const;
  const invalidEntry = entries.find(
    ([key, value]) =>
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1 ||
      ((key === "width" || key === "height") && value <= 0)
  );
  const extendsPastSource =
    !invalidEntry && (crop.x + crop.width > 1 || crop.y + crop.height > 1);
  if (!invalidEntry && !extendsPastSource) {
    return;
  }
  const field = invalidEntry?.[0] ?? (crop.x + crop.width > 1 ? "width" : "height");
  throw new Response(
    JSON.stringify({
      error: "source_crop_must_be_normalized",
      code: "source_crop_must_be_normalized",
      field: `snapshot.renderPlan.sourceCrop.${field}`,
      message:
        "sourceCrop uses normalized fractions from 0 to 1, not source pixels; x + width and y + height must stay within 1."
    }),
    {
      status: 400,
      headers: { "content-type": "application/json" }
    }
  );
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
    systemPrompt: channel.systemPrompt,
    descriptionPrompt: channel.descriptionPrompt,
    examplesJson: channel.examplesJson,
    stage2ExamplesConfig: channel.stage2ExamplesConfig,
    stage2HardConstraints: channel.stage2HardConstraints,
    stage2PromptConfig: channel.stage2PromptConfig,
    stage2SourceOverlayConfig: channel.stage2SourceOverlayConfig,
    templateId: channel.templateId,
    avatarAssetId: channel.avatarAssetId,
    defaultBackgroundAssetId: channel.defaultBackgroundAssetId,
    defaultMusicAssetId: channel.defaultMusicAssetId,
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
      examplesJson: resolveString(input.examplesJson),
      stage2ExamplesConfig: resolveObject<Channel["stage2ExamplesConfig"]>(input.stage2ExamplesConfig),
      stage2HardConstraints: resolveObject<Channel["stage2HardConstraints"]>(input.stage2HardConstraints),
      stage2PromptConfig: resolveObject<Channel["stage2PromptConfig"]>(input.stage2PromptConfig),
      stage2SourceOverlayConfig: resolveObject<Channel["stage2SourceOverlayConfig"]>(input.stage2SourceOverlayConfig),
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
      stage2ExamplesConfig: resolveObject<Channel["stage2ExamplesConfig"]>(input.stage2ExamplesConfig),
      stage2HardConstraints: resolveObject<Channel["stage2HardConstraints"]>(input.stage2HardConstraints),
      stage2PromptConfig: resolveObject<Channel["stage2PromptConfig"]>(input.stage2PromptConfig),
      stage2SourceOverlayConfig: resolveObject<Channel["stage2SourceOverlayConfig"]>(input.stage2SourceOverlayConfig),
      templateId: resolveString(input.templateId),
      defaultClipDurationSec: resolveNumber(input.defaultClipDurationSec),
      avatarAssetId: resolveNullableStringField(input, "avatarAssetId"),
      defaultBackgroundAssetId: resolveNullableStringField(input, "defaultBackgroundAssetId"),
      defaultMusicAssetId: resolveNullableStringField(input, "defaultMusicAssetId")
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

  if (tool === "clips_owner_update_channel_publish_settings") {
    const channel = await requireChannel(auth.workspace.id, input);
    const current = getChannelPublishSettings(channel.id);
    const patch: Parameters<typeof upsertChannelPublishSettings>[0]["patch"] = {};
    const timezone = resolveString(input.timezone);
    const firstSlotLocalTime = resolveString(input.firstSlotLocalTime);
    const dailySlotCount = resolveNumber(input.dailySlotCount);
    const slotIntervalMinutes = resolveNumber(input.slotIntervalMinutes);
    const uploadLeadMinutes = resolveNumber(input.uploadLeadMinutes);
    if (timezone) patch.timezone = timezone;
    if (firstSlotLocalTime) patch.firstSlotLocalTime = firstSlotLocalTime;
    if (dailySlotCount !== undefined) patch.dailySlotCount = dailySlotCount;
    if (slotIntervalMinutes !== undefined) patch.slotIntervalMinutes = slotIntervalMinutes;
    if (typeof input.autoQueueEnabled === "boolean") {
      patch.autoQueueEnabled = input.autoQueueEnabled;
    }
    if (uploadLeadMinutes !== undefined) patch.uploadLeadMinutes = uploadLeadMinutes;
    if (typeof input.notifySubscribersByDefault === "boolean") {
      patch.notifySubscribersByDefault = input.notifySubscribersByDefault;
    }
    if (Object.keys(patch).length === 0) {
      throw new Response(JSON.stringify({ error: "At least one publish setting is required." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const settings = upsertChannelPublishSettings({
      workspaceId: auth.workspace.id,
      channelId: channel.id,
      userId: auth.user.id,
      patch
    });
    scheduleChannelPublicationProcessing();
    auditControl({
      auth,
      action: "owner_control.channel_publish_settings.updated",
      entityType: "channel_publish_settings",
      entityId: channel.id,
      channelId: channel.id,
      status: "succeeded",
      payload: { previousSettings: current, settings }
    });
    return { channel: summarizeChannel(channel), previousSettings: current, settings };
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

  if (tool === "clips_owner_inspect_channel_asset") {
    const channel = await requireChannel(auth.workspace.id, input);
    const assetId = resolveString(input.assetId);
    if (!assetId) {
      throw new Response(JSON.stringify({ error: "assetId is required." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const asset = await getChannelAssetById(channel.id, assetId);
    if (!asset || asset.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Channel asset not found." }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    const stored = await readChannelAssetFile({
      channelId: channel.id,
      fileName: asset.fileName
    });
    if (!stored) {
      throw new Response(
        JSON.stringify({
          error: "Channel asset bytes are unavailable.",
          code: "channel_asset_file_unavailable"
        }),
        {
          status: 410,
          headers: { "content-type": "application/json" }
        }
      );
    }
    const inspection = inspectChannelAssetBuffer(stored.buffer);
    return {
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username
      },
      asset: {
        id: asset.id,
        kind: asset.kind,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        declaredSizeBytes: asset.sizeBytes,
        storedSizeBytes: inspection.sizeBytes,
        sizeMatchesRecord: inspection.sizeBytes === asset.sizeBytes,
        sha256: inspection.sha256,
        signatureMimeType: inspection.signatureMimeType,
        mimeMatchesSignature:
          inspection.signatureMimeType === null ||
          inspection.signatureMimeType === asset.mimeType.toLowerCase(),
        imageDimensions: inspection.imageDimensions,
        activeReferences: {
          avatar: channel.avatarAssetId === asset.id,
          background: channel.defaultBackgroundAssetId === asset.id,
          music: channel.defaultMusicAssetId === asset.id
        }
      }
    };
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

  if (tool === "clips_owner_preflight_completed_source") {
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
    const expectation = resolveCompletedSourceExpectation(input.completedSource);
    if (!expectation) {
      throw new Response(JSON.stringify({ error: "completedSource is required." }), { status: 400 });
    }
    const sourceBinding = await resolveOwnerCompletedSourceBinding({
      workspaceId: auth.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      sourceUrl: chat.url,
      expectation
    });
    return {
      ok: true,
      mode: "completed-source-job",
      createsJob: false,
      urlFallbackAllowed: false,
      channel: summarizeChannel(channel),
      chatId: chat.id,
      sourceBinding
    };
  }

  if (tool === "clips_owner_render_preview") {
    const channel = await requireChannel(auth.workspace.id, input);
    const chatId = resolveString(input.chatId);
    const expectation = resolveCompletedSourceExpectation(input.completedSource);
    const rawSourceUrl = resolveString(input.sourceUrl);
    let sourceBinding: Stage3CompletedSourceBinding | null = null;
    if (expectation) {
      if (!chatId) {
        throw new Response(JSON.stringify({ error: "chatId is required with completedSource." }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
      const chat = await getChatById(chatId);
      if (!chat || chat.workspaceId !== auth.workspace.id) {
        throw new Response(JSON.stringify({ error: "Chat not found." }), { status: 404 });
      }
      if (chat.channelId !== channel.id) {
        throw new Response(JSON.stringify({ error: "Chat does not belong to the channel." }), { status: 400 });
      }
      sourceBinding = await resolveOwnerCompletedSourceBinding({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        chatId: chat.id,
        sourceUrl: rawSourceUrl ?? chat.url,
        expectation
      });
    }
    const sourceUrl = sourceBinding?.sourceUrl ?? (rawSourceUrl ? normalizeSupportedUrl(rawSourceUrl) : "");
    if (!sourceUrl || !isSupportedUrl(sourceUrl)) {
      throw new Response(JSON.stringify({ error: "A supported sourceUrl is required for a preview." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const snapshot =
      input.snapshot && typeof input.snapshot === "object"
        ? (input.snapshot as Partial<Stage3StateSnapshot>)
        : undefined;
    assertNormalizedSourceCrop(snapshot ?? null);
    const normalizedBody = {
      channelId: channel.id,
      sourceUrl,
      workspaceId: auth.workspace.id,
      ...(chatId ? { chatId } : {}),
      ...(sourceBinding ? { sourceBinding } : {}),
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
      payload: {
        executionTarget,
        sourceMode: sourceBinding ? "completed-source-job" : "url"
      }
    });
    return {
      ...buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/preview/jobs/${job.id}?download=1` : null),
      channel: summarizeChannel(channel),
      pollUrl: `/api/stage3/preview/jobs/${job.id}`,
      previewScope: "media-only",
      sourceMode: sourceBinding ? "completed-source-job" : "url",
      validates: ["source_timing", "source_crop", "video_fit", "donor_wrapper_removal"],
      doesNotValidate: ["channel_card", "author_row", "caption_text", "caption_highlights"]
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

  if (tool === "clips_owner_get_stage3_job") {
    const jobId = resolveString(input.jobId);
    if (!jobId) {
      throw new Response(JSON.stringify({ error: "jobId is required." }), { status: 400 });
    }
    const job = getStage3Job(jobId);
    if (!job || job.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Stage 3 job not found." }), { status: 404 });
    }
    const artifactUrl = !job.artifact
      ? null
      : job.kind === "editing-proxy"
        ? `/api/stage3/editing-proxy/jobs/${job.id}?download=1`
        : job.kind === "preview" || job.kind === "render"
          ? `/api/stage3/${job.kind}/jobs/${job.id}?download=1`
          : null;
    return buildStage3JobEnvelope(job, artifactUrl);
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
    const completedSourceExpectation = resolveCompletedSourceExpectation(input.completedSource);
    const sourceBinding = completedSourceExpectation
      ? await resolveOwnerCompletedSourceBinding({
          workspaceId: auth.workspace.id,
          channelId: channel.id,
          chatId: chat.id,
          sourceUrl,
          expectation: completedSourceExpectation
        })
      : null;
    const requestedSourceDurationSec =
      resolveNumber(input.sourceDurationSec) ?? sourceBinding?.sourceDurationSec ?? null;
    if (
      sourceBinding &&
      requestedSourceDurationSec !== null &&
      Math.abs(requestedSourceDurationSec - sourceBinding.sourceDurationSec) > 0.05
    ) {
      throw new Response(
        JSON.stringify({
          error: "completed_source_duration_mismatch",
          code: "completed_source_duration_mismatch",
          message: "sourceDurationSec does not match the completed source binding."
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      );
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
            sourceDurationSec: requestedSourceDurationSec
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
    assertNormalizedSourceCrop(resolvedSnapshot);
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
      ...(resolveString(input.workItemId) ? { workItemId: resolveString(input.workItemId)! } : {}),
      ...(resolveNumber(input.revision) !== null
        ? { revision: Math.max(1, Math.floor(resolveNumber(input.revision)!)) }
        : {}),
      sourceUrl,
      workspaceId: auth.workspace.id,
      ...(sourceBinding ? { sourceBinding } : {}),
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
        sourceMode: sourceBinding ? "completed-source-job" : "url",
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
    const requestedMode = resolveString(input.mode);
    const agentCaptionProvided = input.agentCaption !== undefined && input.agentCaption !== null;
    if (!sourceUrl) {
      if (requestedMode === "agent_manual" || agentCaptionProvided) {
        throw new Response(
          JSON.stringify({
            error: "agent_manual_source_url_required",
            code: "agent_manual_source_url_required",
            message:
              "agent_manual requires a nonempty sourceUrl; daily-pool and publication fallback are forbidden."
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      return runOwnerDailyPool(auth, input);
    }
    const channel = await requireChannel(auth.workspace.id, input);
    const normalizedUrl = normalizeSupportedUrl(sourceUrl);
    if (!isSupportedUrl(normalizedUrl)) {
      throw new Response(JSON.stringify({ error: SUPPORTED_SOURCE_ERROR_MESSAGE }), { status: 400 });
    }
    const mode: Stage2RunMode = requestedMode === "auto" ? "auto" : "manual";
    const agentCaption = parseAgentManualCaption(input.agentCaption);
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
    if (requestedMode === "agent_manual" && !agentCaption) {
      throw new Response(
        JSON.stringify({
          error: "agent_caption_required",
          code: "agent_caption_required",
          message:
            "mode=agent_manual requires agentCaption with string top/bottom fields; platform fallback is forbidden."
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const dryRun = resolveBoolean(input.dryRun);
    if (dryRun) {
      return {
        dryRun: true,
        channel: summarizeChannel(channel),
        sourceUrl: normalizedUrl,
        captionSource: agentCaption ? "agent_manual" : "platform",
        planned: ["create_or_get_chat", "enqueue_stage2_run"],
        note: "Stage 3 render/publication requires a selected Stage 2 option unless using a channel-specific daily pool runner."
      };
    }
    await Promise.all([
      requireRuntimeTool("ffmpeg"),
      requireRuntimeTool("ffprobe"),
      ...(agentCaption ? [] : [requireRuntimeTool("codex")])
    ]);
    if (!agentCaption) {
      const integration = requireSharedCodexAvailable(auth.workspace.id);
      await ensureCodexLoggedIn(integration.codexHomePath as string);
    }
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
      (tool === "clips_owner_render_video" &&
        (result as { job?: { status?: string } }).job?.status !== "completed");
    return Response.json(result, { status: accepted ? 202 : 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
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
