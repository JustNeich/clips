import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Stage3AudioMode, Stage3RenderPlan } from "../app/components/types";
import type { Stage3RenderRequestBody } from "../lib/stage3-render-service";
import {
  appendChatEvent,
  createOrGetChatBySource,
  getChannelAssetById,
  getChannelById,
  type Channel
} from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import { readManagedTemplateSync } from "../lib/managed-template-store";
import { publishStage3VideoArtifact } from "../lib/stage3-job-artifacts";
import {
  appendStage3JobEvent,
  completeStage3Job,
  enqueueStage3Job,
  finishStage3Job,
  type Stage3JobRecord
} from "../lib/stage3-job-store";
import {
  renderStage3Video,
  summarizeStage3RenderError
} from "../lib/stage3-render-service";
import { ensureStage3SourceCached } from "../lib/stage3-server-control";
import {
  GHOSTFACE_COUNTRY_TEMPLATE_ID,
  GHOSTFACE_WORKSHOP_TEMPLATE_ID
} from "../lib/stage3-template";
import { persistRenderExportCompletion } from "../lib/stage3-job-runtime";
import { getRenderExportByStage3JobId } from "../lib/publication-store";

type CliArgs = {
  batchPath: string;
  outputPath: string;
  waitTimeoutMs: number;
  workspaceId?: string;
  creatorUserId?: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
};

type UserRow = {
  id: string;
  email: string;
  role: string;
};

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
  template_id: string;
};

type GhostfacePreviewBatchItem = {
  renderId: string;
  requestPath: string | null;
  previewPath: string;
  channelKey: string;
  channelId: string;
  channelName: string;
  channelUsername: string;
  sourceTitle: string;
  sourceDescription: string;
  sourceOriginChannel: string;
  stage3Body: Stage3RenderRequestBody;
};

type GhostfacePreviewResult = {
  render_id: string;
  channel_key: string;
  status: "rendered" | "failed";
  preview_path: string;
  channel_id: string | null;
  chat_id: string | null;
  stage3_job_id: string | null;
  render_export_id: string | null;
  artifact_file_path: string | null;
  output_name: string | null;
  top_compacted: boolean | null;
  bottom_compacted: boolean | null;
  error: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function audioModeValue(value: unknown, fallback: Stage3AudioMode = "source_only"): Stage3AudioMode {
  return value === "source_plus_music" || value === "source_only" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    waitTimeoutMs: 600_000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--batch requires a file path.");
      args.batchPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--batch=")) {
      args.batchPath = arg.slice("--batch=".length).trim();
      continue;
    }
    if (arg === "--output") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--output requires a file path.");
      args.outputPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      args.outputPath = arg.slice("--output=".length).trim();
      continue;
    }
    if (arg === "--wait-timeout-ms") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--wait-timeout-ms must be a positive number.");
      args.waitTimeoutMs = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--wait-timeout-ms=")) {
      const value = Number.parseInt(arg.slice("--wait-timeout-ms=".length), 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--wait-timeout-ms must be a positive number.");
      args.waitTimeoutMs = value;
      continue;
    }
    if (arg === "--workspace-id") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--workspace-id requires a value.");
      args.workspaceId = value;
      index += 1;
      continue;
    }
    if (arg === "--creator-user-id") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--creator-user-id requires a value.");
      args.creatorUserId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.batchPath) {
    throw new Error("Pass --batch with the Channel Operator mp4_render_batch.json path.");
  }
  if (!args.outputPath) {
    args.outputPath = path.join(path.dirname(args.batchPath), "clips_native_render_results.json");
  }
  return args as CliArgs;
}

function resolveWorkspace(workspaceId?: string): WorkspaceRow {
  const db = getDb();
  if (workspaceId) {
    const row = db
      .prepare("SELECT id, name FROM workspaces WHERE id = ? LIMIT 1")
      .get(workspaceId) as WorkspaceRow | undefined;
    if (!row) throw new Error(`Workspace ${workspaceId} was not found.`);
    return row;
  }
  const preferred = db
    .prepare("SELECT id, name FROM workspaces WHERE lower(name) = 'clips' ORDER BY created_at ASC LIMIT 1")
    .get() as WorkspaceRow | undefined;
  if (preferred) return preferred;
  const fallback = db
    .prepare("SELECT id, name FROM workspaces ORDER BY created_at ASC LIMIT 1")
    .get() as WorkspaceRow | undefined;
  if (!fallback) throw new Error("No workspace exists in the local database.");
  return fallback;
}

function resolveCreatorUser(workspaceId: string, creatorUserId?: string): UserRow {
  const db = getDb();
  if (creatorUserId) {
    const row = db
      .prepare(
        `SELECT u.id, u.email, wm.role
           FROM users u
           JOIN workspace_members wm ON wm.user_id = u.id
          WHERE u.id = ? AND wm.workspace_id = ?
          LIMIT 1`
      )
      .get(creatorUserId, workspaceId) as UserRow | undefined;
    if (!row) throw new Error(`User ${creatorUserId} is not a member of workspace ${workspaceId}.`);
    return row;
  }
  const owner = db
    .prepare(
      `SELECT u.id, u.email, wm.role
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ?
        ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, wm.created_at ASC
        LIMIT 1`
    )
    .get(workspaceId) as UserRow | undefined;
  if (!owner) throw new Error(`Workspace ${workspaceId} has no members.`);
  return owner;
}

function findChannelByUsername(username: string, workspaceId: string): ChannelRow | null {
  const db = getDb();
  const normalized = username.trim().replace(/^@+/, "").toLowerCase();
  const row = db
    .prepare(
      `SELECT id, workspace_id, name, username, template_id
         FROM channels
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND lower(username) = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, normalized) as ChannelRow | undefined;
  return row ?? null;
}

function findChannelById(channelId: string, workspaceId: string): ChannelRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, workspace_id, name, username, template_id
         FROM channels
        WHERE id = ?
          AND workspace_id = ?
          AND archived_at IS NULL
        LIMIT 1`
    )
    .get(channelId.trim(), workspaceId) as ChannelRow | undefined;
  return row ?? null;
}

function ghostfaceSpec(channelKey: string): {
  templateId: string;
  authorName: string;
  authorHandle: string;
  videoZoom: number;
} | null {
  if (channelKey === "country") {
    return {
      authorName: "GHOSTFACE COUNTRY",
      authorHandle: "@ghostfacecountry",
      templateId: GHOSTFACE_COUNTRY_TEMPLATE_ID,
      videoZoom: 1.02
    };
  }
  if (channelKey === "workshop") {
    return {
      authorName: "GHOSTFACE WORKSHOP",
      authorHandle: "@ghostfaceworkshop",
      templateId: GHOSTFACE_WORKSHOP_TEMPLATE_ID,
      videoZoom: 1.04
    };
  }
  return null;
}

function sourceCropFor(
  source: Record<string, unknown>,
  fallbackPct: number | null
): Record<string, unknown> | null {
  const rawPct = numberValue(source.crop_safe_center_pct, Number.NaN);
  const resolvedPct = Number.isFinite(rawPct) ? rawPct : fallbackPct;
  if (!Number.isFinite(resolvedPct)) return null;
  const width = Math.min(0.94, Math.max(0.52, Number(resolvedPct) / 100));
  const x = (1 - width) / 2;
  return {
    enabled: true,
    x: Number(x.toFixed(6)),
    y: 0,
    width: Number(width.toFixed(6)),
    height: 1,
    confidence: 0.72,
    source: "channel-operator-center-safe",
    notes: "Center crop from source cleanliness score; prevents side template/text artifacts in Ghostface media slot."
  };
}

export function assertGhostfaceExactChannelId(input: { channelKey: string; channelId: string }): void {
  if (!ghostfaceSpec(input.channelKey)) return;
  if (!input.channelId.trim()) {
    throw new Error(
      `Ghostface render blocked: ${input.channelKey} is missing exact clips_channel_id. ` +
        "Configure it from the live Clips Automations channel selector; username alone is not safe."
    );
  }
}

function baseRenderPlanFor(input: {
  channelKey: string;
  configuredTemplateId: string;
  durationSec: number;
  source: Record<string, unknown>;
}): Record<string, unknown> {
  const spec = ghostfaceSpec(input.channelKey);
  if (spec) {
    return {
      templateId: spec.templateId,
      targetDurationSec: input.durationSec,
      durationMode: "channel_default",
      timingMode: "compress",
      normalizeToTargetEnabled: false,
      policy: "fixed_segments",
      editorSelectionMode: "window",
      audioMode: "source_only",
      sourceAudioEnabled: true,
      mirrorEnabled: true,
      cameraMotion: "disabled",
      videoZoom: spec.videoZoom,
      videoScaleY: 1,
      videoBrightness: 1,
      videoExposure: 0,
      videoContrast: 1,
      videoSaturation: 1,
      sourceCrop: sourceCropFor(input.source, input.channelKey === "country" ? 64 : 70),
      topFontScale: 1.8,
      bottomFontScale: input.channelKey === "country" ? 1 : 1.8,
      textPolicy: "strict_fit",
      musicAssetId: null,
      musicAssetMimeType: null,
      authorName: spec.authorName,
      authorHandle: spec.authorHandle,
      prompt:
        "Channel Operator OS native Ghostface preview render. Do not publish. Keep original source audio only. Do not stretch source video/audio. Maximize top/bottom text size until the last safe fit before overflow."
    };
  }
  return {
    templateId: input.configuredTemplateId || "science-card-v1",
    targetDurationSec: input.durationSec,
    durationMode: "channel_default",
    timingMode: "auto",
    normalizeToTargetEnabled: true,
    audioMode: "source_only",
    sourceAudioEnabled: true,
    mirrorEnabled: true,
    cameraMotion: "disabled",
    videoZoom: 1,
    textPolicy: "strict_fit",
    prompt: "Channel Operator OS native Clips preview render. Do not publish."
  };
}

export function buildGhostfacePreviewBatchItemFromRequest(input: {
  requestPath: string | null;
  renderId: string;
  previewPath: string;
  request: Record<string, unknown>;
}): GhostfacePreviewBatchItem {
  const channel = asRecord(input.request.channel);
  const template = asRecord(input.request.template);
  const source = asRecord(input.request.source);
  const copy = asRecord(input.request.copy);
  const channelKey = stringValue(channel.key, "ghostface");
  const durationSec = numberValue(template.duration_sec, channelKey === "country" ? 20 : 6);
  const renderPlan = baseRenderPlanFor({
    channelKey,
    configuredTemplateId: stringValue(template.template_id),
    durationSec,
    source
  });
  const topText = stringValue(copy.top_text);
  const bottomText = stringValue(copy.bottom_text);
  const sourceOverlayText = "";
  const body: Stage3RenderRequestBody = {
    requestId: `channel-operator-${input.renderId}`,
    sourceUrl: stringValue(source.url),
    publishAfterRender: false,
    renderTitle: stringValue(copy.title, stringValue(source.title, input.renderId)),
    templateId: stringValue(renderPlan.templateId, "science-card-v1"),
    topText,
    bottomText,
    sourceOverlayText,
    clipStartSec: 0,
    clipDurationSec: durationSec,
    focusY: 0.5,
    renderPlan,
    variationSeed: input.renderId,
    snapshot: {
      topText,
      bottomText,
      sourceOverlayText,
      clipStartSec: 0,
      focusY: 0.5
    }
  };
  return {
    renderId: input.renderId,
    requestPath: input.requestPath,
    previewPath: input.previewPath,
    channelKey,
    channelId:
      stringValue(channel.clips_channel_id) || stringValue(channel.clipsChannelId) || stringValue(channel.id),
    channelName: stringValue(channel.name, channelKey === "country" ? "Ghostface Country" : "Ghostface Workshop"),
    channelUsername: stringValue(channel.clips_username, channelKey === "country" ? "ghostfacecountry" : "ghostfaceworkshop"),
    sourceTitle: stringValue(source.title, body.renderTitle ?? input.renderId),
    sourceDescription: stringValue(source.description),
    sourceOriginChannel: stringValue(source.origin_channel),
    stage3Body: body
  };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function loadBatchItems(batchPath: string): Promise<GhostfacePreviewBatchItem[]> {
  const raw = await readJsonFile(batchPath);
  if (!Array.isArray(raw)) {
    throw new Error("Batch file must contain an array.");
  }
  const items: GhostfacePreviewBatchItem[] = [];
  for (const rawItem of raw) {
    const item = asRecord(rawItem);
    const requestPath = stringValue(item.requestPath);
    const request = requestPath ? asRecord(await readJsonFile(requestPath)) : {};
    const renderId = stringValue(item.renderId, path.basename(requestPath, ".json"));
    const previewPath = stringValue(item.previewPath);
    if (!renderId || !previewPath) {
      throw new Error("Every batch item requires renderId and previewPath.");
    }
    const built = buildGhostfacePreviewBatchItemFromRequest({
      requestPath: requestPath || null,
      renderId,
      previewPath,
      request
    });
    const body = asRecord(item.stage3Body);
    if (Object.keys(body).length > 0) {
      built.stage3Body = {
        ...built.stage3Body,
        ...body,
        publishAfterRender: false,
        snapshot: {
          ...asRecord(built.stage3Body.snapshot),
          ...asRecord(body.snapshot)
        }
      };
    }
    items.push(built);
  }
  return items;
}

async function readPromptTextForItem(item: GhostfacePreviewBatchItem): Promise<string | null> {
  if (!item.requestPath) return null;
  const request = asRecord(await readJsonFile(item.requestPath));
  const copy = asRecord(request.copy);
  const meta = asRecord(copy.meta);
  const promptPath = stringValue(meta.system_prompt_path);
  if (!promptPath) return null;
  return fs.readFile(promptPath, "utf8").catch(() => null);
}

function assertGhostfaceTemplate(input: {
  channel: Channel;
  item: GhostfacePreviewBatchItem;
  workspaceId: string;
}): void {
  const spec = ghostfaceSpec(input.item.channelKey);
  if (!spec) return;
  const templateId = input.channel.templateId.trim();
  if (!templateId) {
    throw new Error(`Ghostface render blocked: @${input.channel.username} has no assigned Stage 3 template.`);
  }
  if (templateId.startsWith("science-card-v1")) {
    throw new Error(
      `Ghostface render blocked: @${input.channel.username} is assigned ${templateId}, not ${spec.templateId}. ` +
        "Apply the real Ghostface channel template before rendering."
    );
  }
  if (templateId === spec.templateId) return;
  const managed = readManagedTemplateSync(templateId, {
    workspaceId: input.workspaceId,
    skipEnsure: true
  });
  if (managed?.baseTemplateId === spec.templateId || managed?.layoutFamily === spec.templateId) {
    return;
  }
  throw new Error(
    `Ghostface render blocked: @${input.channel.username} template ${templateId} does not resolve to ${spec.templateId}.`
  );
}

async function requireChannelAsset(input: {
  channel: Channel;
  assetId: string | null;
  kind: "avatar" | "background" | "music";
  required: boolean;
}): Promise<{ assetId: string | null; mimeType: string | null }> {
  if (!input.assetId) {
    if (input.required) {
      throw new Error(`Ghostface render blocked: @${input.channel.username} is missing ${input.kind} asset.`);
    }
    return { assetId: null, mimeType: null };
  }
  const asset = await getChannelAssetById(input.channel.id, input.assetId);
  if (!asset || asset.kind !== input.kind) {
    if (input.required) {
      throw new Error(
        `Ghostface render blocked: @${input.channel.username} ${input.kind} asset ${input.assetId} does not resolve.`
      );
    }
    return { assetId: null, mimeType: null };
  }
  return { assetId: asset.id, mimeType: asset.mimeType };
}

async function resolveExistingGhostfaceChannel(input: {
  item: GhostfacePreviewBatchItem;
  workspaceId: string;
}): Promise<Channel> {
  assertGhostfaceExactChannelId({ channelKey: input.item.channelKey, channelId: input.item.channelId });
  const existing = input.item.channelId
    ? findChannelById(input.item.channelId, input.workspaceId)
    : findChannelByUsername(input.item.channelUsername, input.workspaceId);
  if (!existing?.id) {
    throw new Error(
      `Ghostface render blocked: channel ${input.item.channelId || `@${input.item.channelUsername}`} ` +
        "was not found in active APP_DATA_DIR/workspace. Point the runner at the Clips instance that contains the real selected channel."
    );
  }
  const expectedUsername = input.item.channelUsername.trim().replace(/^@+/, "").toLowerCase();
  const actualUsername = existing.username.trim().replace(/^@+/, "").toLowerCase();
  if (expectedUsername && actualUsername !== expectedUsername) {
    throw new Error(
      `Ghostface render blocked: clips_channel_id ${existing.id} belongs to @${existing.username}, ` +
        `not @${input.item.channelUsername}.`
    );
  }
  const channel = await getChannelById(existing.id);
  if (!channel) {
    throw new Error(`Ghostface render blocked: channel ${existing.id} disappeared before render.`);
  }
  assertGhostfaceTemplate({ channel, item: input.item, workspaceId: input.workspaceId });
  await requireChannelAsset({
    channel,
    assetId: channel.avatarAssetId,
    kind: "avatar",
    required: true
  });
  return channel;
}

async function applyGhostfaceChannelRenderAssets(input: {
  item: GhostfacePreviewBatchItem;
  channel: Channel;
}): Promise<Stage3RenderRequestBody> {
  const avatar = await requireChannelAsset({
    channel: input.channel,
    assetId: input.channel.avatarAssetId,
    kind: "avatar",
    required: true
  });
  const background = await requireChannelAsset({
    channel: input.channel,
    assetId: input.channel.defaultBackgroundAssetId,
    kind: "background",
    required: false
  });
  const basePlan = asRecord(input.item.stage3Body.renderPlan);
  const sourceAudioEnabled =
    typeof basePlan.sourceAudioEnabled === "boolean" ? Boolean(basePlan.sourceAudioEnabled) : true;
  const audioMode = audioModeValue(basePlan.audioMode);
  const renderPlan: Partial<Stage3RenderPlan> = {
    ...basePlan,
    templateId: input.channel.templateId,
    targetDurationSec: input.item.stage3Body.clipDurationSec ?? 6,
    durationMode: "channel_default",
    timingMode: "compress",
    normalizeToTargetEnabled: false,
    policy: "fixed_segments",
    editorSelectionMode: "window",
    sourceAudioEnabled,
    audioMode,
    avatarAssetId: avatar.assetId,
    avatarAssetMimeType: avatar.mimeType,
    backgroundAssetId: background.assetId,
    backgroundAssetMimeType: background.mimeType,
    musicAssetId: null,
    musicAssetMimeType: null
  };
  return {
    ...input.item.stage3Body,
    templateId: input.channel.templateId,
    renderPlan,
    snapshot: {
      topText: input.item.stage3Body.topText ?? "",
      bottomText: input.item.stage3Body.bottomText ?? "",
      sourceOverlayText: input.item.stage3Body.sourceOverlayText ?? "",
      clipStartSec: input.item.stage3Body.clipStartSec ?? 0,
      focusY: input.item.stage3Body.focusY ?? 0.5
    }
  };
}

export function assertGhostfaceSourceDuration(input: {
  channelKey: string;
  sourceDurationSec: number | null;
  targetDurationSec: number;
  sourceUrl: string;
}): void {
  if (input.channelKey !== "country" && input.channelKey !== "workshop") return;
  if (input.sourceDurationSec === null || !Number.isFinite(input.sourceDurationSec)) {
    throw new Error(
      `Ghostface render blocked: cannot verify source duration for ${input.sourceUrl}. ` +
        "Duration must be known so the renderer cannot stretch short source material."
    );
  }
  if (input.sourceDurationSec + 0.25 < input.targetDurationSec) {
    throw new Error(
      `Ghostface render blocked: source is ${input.sourceDurationSec.toFixed(2)}s but target is ` +
        `${input.targetDurationSec.toFixed(2)}s. Choose a longer native-speed source instead of stretching.`
    );
  }
}

async function renderNativeItem(input: {
  item: GhostfacePreviewBatchItem;
  workspace: WorkspaceRow;
  creator: UserRow;
  waitTimeoutMs: number;
}): Promise<GhostfacePreviewResult> {
  let job: Stage3JobRecord | null = null;
  let channel: Channel | null = null;
  let chatId: string | null = null;
  try {
    const promptText = await readPromptTextForItem(input.item);
    channel = await resolveExistingGhostfaceChannel({
      item: input.item,
      workspaceId: input.workspace.id
    });
    const hydratedBody = await applyGhostfaceChannelRenderAssets({
      item: input.item,
      channel
    });
    const source = await ensureStage3SourceCached(hydratedBody.sourceUrl ?? "", {
      waitTimeoutMs: input.waitTimeoutMs
    });
    assertGhostfaceSourceDuration({
      channelKey: input.item.channelKey,
      sourceDurationSec: source.sourceDurationSec,
      targetDurationSec: hydratedBody.clipDurationSec ?? 6,
      sourceUrl: hydratedBody.sourceUrl ?? ""
    });
    const chat = await createOrGetChatBySource({
      rawUrl: hydratedBody.sourceUrl ?? "",
      channelIdRaw: channel.id,
      title: input.item.sourceTitle,
      eventText: `Ghostface preview source selected: ${hydratedBody.sourceUrl ?? ""}`
    });
    chatId = chat.id;
    await appendChatEvent(chat.id, {
      role: "assistant",
      type: "note",
      text: `Ghostface preview prepared: ${input.item.renderId}`,
      data: {
        renderId: input.item.renderId,
        channelKey: input.item.channelKey,
        sourceTitle: input.item.sourceTitle,
        sourceDescription: input.item.sourceDescription,
        sourceOriginChannel: input.item.sourceOriginChannel,
        topText: hydratedBody.topText ?? "",
        bottomText: hydratedBody.bottomText ?? "",
        sourceDurationSec: source.sourceDurationSec,
        promptTextLoaded: Boolean(promptText),
        publishAfterRender: false,
        ghostfaceGuards: {
          existingChannelRequired: true,
          avatarRequired: true,
          sourceStretchForbidden: true,
          sourceAudioEnabled: Boolean(asRecord(hydratedBody.renderPlan).sourceAudioEnabled ?? true)
        }
      }
    });

    const body: Stage3RenderRequestBody = {
      ...hydratedBody,
      workspaceId: input.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      publishAfterRender: false,
      snapshot: {
        ...asRecord(hydratedBody.snapshot),
        topText: hydratedBody.topText ?? "",
        bottomText: hydratedBody.bottomText ?? "",
        sourceOverlayText: hydratedBody.sourceOverlayText ?? "",
        sourceDurationSec: source.sourceDurationSec
      }
    };
    job = enqueueStage3Job({
      workspaceId: input.workspace.id,
      userId: input.creator.id,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify(body),
      dedupeKey: null,
      reuseCompleted: false
    });
    appendStage3JobEvent(job.id, "info", "Ghostface native preview batch render started.", {
      renderId: input.item.renderId,
      publishAfterRender: false
    });

    const rendered = await renderStage3Video(body, { waitTimeoutMs: input.waitTimeoutMs });
    try {
      const published = await publishStage3VideoArtifact("render", job.id, rendered.filePath);
      await fs.mkdir(path.dirname(input.item.previewPath), { recursive: true });
      await fs.copyFile(published.filePath, input.item.previewPath);
      const variationPath = input.item.previewPath.replace(/\.mp4$/, ".variation.json");
      await fs.copyFile(rendered.variationManifestPath, variationPath).catch(() => undefined);
      const completed = completeStage3Job(job.id, {
        resultJson: JSON.stringify({
          ok: true,
          source: "ghostface-native-preview-batch",
          renderId: input.item.renderId,
          previewPath: input.item.previewPath,
          variationManifestPath: variationPath
        }),
        artifact: {
          kind: "video",
          fileName: `${input.item.renderId}.mp4`,
          mimeType: "video/mp4",
          filePath: published.filePath,
          sizeBytes: published.sizeBytes
        }
      });
      await persistRenderExportCompletion(completed, {
        jobId: completed.id,
        artifactFileName: `${input.item.renderId}.mp4`,
        artifactFilePath: published.filePath,
        artifactMimeType: "video/mp4",
        artifactSizeBytes: published.sizeBytes,
        completedAt: completed.completedAt ?? new Date().toISOString()
      });
      const renderExport = getRenderExportByStage3JobId(job.id);
      return {
        render_id: input.item.renderId,
        channel_key: input.item.channelKey,
        status: "rendered",
        preview_path: input.item.previewPath,
        channel_id: channel.id,
        chat_id: chat.id,
        stage3_job_id: job.id,
        render_export_id: renderExport?.id ?? null,
        artifact_file_path: renderExport?.artifactFilePath ?? published.filePath,
        output_name: rendered.outputName,
        top_compacted: rendered.topCompacted,
        bottom_compacted: rendered.bottomCompacted,
        error: null
      };
    } finally {
      await fs.rm(rendered.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (job) {
      finishStage3Job(job.id, {
        status: "failed",
        errorCode: "ghostface_preview_batch_failed",
        errorMessage: summarizeStage3RenderError(error),
        recoverable: true
      });
    }
    return {
      render_id: input.item.renderId,
      channel_key: input.item.channelKey,
      status: "failed",
      preview_path: input.item.previewPath,
      channel_id: channel?.id ?? null,
      chat_id: chatId,
      stage3_job_id: job?.id ?? null,
      render_export_id: null,
      artifact_file_path: null,
      output_name: null,
      top_compacted: null,
      bottom_compacted: null,
      error: summarizeStage3RenderError(error)
    };
  }
}

export async function runGhostfacePreviewBatch(args: CliArgs): Promise<{
  results: GhostfacePreviewResult[];
  outputPath: string;
}> {
  const workspace = resolveWorkspace(args.workspaceId);
  const creator = resolveCreatorUser(workspace.id, args.creatorUserId);
  const items = await loadBatchItems(args.batchPath);
  const results: GhostfacePreviewResult[] = [];
  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  for (const item of items) {
    const result = await renderNativeItem({
      item,
      workspace,
      creator,
      waitTimeoutMs: args.waitTimeoutMs
    });
    results.push(result);
    await fs.writeFile(
      args.outputPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          clips_native: true,
          batch_path: args.batchPath,
          results
        },
        null,
        2
      ),
      "utf8"
    );
  }
  return { results, outputPath: args.outputPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { results, outputPath } = await runGhostfacePreviewBatch(args);
  console.log(JSON.stringify({ outputPath, results }, null, 2));
  if (results.some((item) => item.status !== "rendered")) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
