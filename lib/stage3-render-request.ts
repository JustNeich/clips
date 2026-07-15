import { createHash } from "node:crypto";

export type Stage3RenderRequestDedupeInput = {
  requiredWorkerId?: string;
  requestId?: string;
  sourceUrl?: string;
  channelId?: string;
  chatId?: string;
  publishAfterRender?: boolean;
  renderTitle?: string;
  templateId?: string;
  topText?: string;
  bottomText?: string;
  sourceOverlayText?: string;
  clipStartSec?: number;
  clipDurationSec?: number;
  focusY?: number;
  agentPrompt?: string;
  renderPlan?: unknown;
  snapshot?: unknown;
};

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => typeof record[key] !== "undefined")
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return "null";
}

function buildContentFingerprint(body: Stage3RenderRequestDedupeInput): string | null {
  const sourceUrl = cleanString(body.sourceUrl);
  const chatId = cleanString(body.chatId);
  const hasRenderContent = Boolean(
    sourceUrl ||
      chatId ||
      cleanString(body.topText) ||
      cleanString(body.bottomText) ||
      cleanString(body.sourceOverlayText) ||
      body.renderPlan ||
      body.snapshot
  );
  if (!hasRenderContent) {
    return null;
  }
  const payload = {
    requiredWorkerId: cleanString(body.requiredWorkerId),
    sourceUrl,
    chatId,
    channelId: cleanString(body.channelId),
    publishAfterRender: body.publishAfterRender === true,
    renderTitle: cleanString(body.renderTitle),
    templateId: cleanString(body.templateId),
    topText: cleanString(body.topText),
    bottomText: cleanString(body.bottomText),
    sourceOverlayText: cleanString(body.sourceOverlayText),
    clipStartSec: cleanNumber(body.clipStartSec),
    clipDurationSec: cleanNumber(body.clipDurationSec),
    focusY: cleanNumber(body.focusY),
    agentPrompt: cleanString(body.agentPrompt),
    renderPlan: body.renderPlan ?? null,
    snapshot: body.snapshot ?? null
  };
  return createHash("sha256").update(stableSerialize(payload)).digest("hex").slice(0, 32);
}

export function buildStage3RenderRequestDedupeKey(
  body: Stage3RenderRequestDedupeInput,
  scope?: { workspaceId?: string | null; userId?: string | null }
): string | null {
  const workspaceId = scope?.workspaceId?.trim() ?? "";
  const userId = scope?.userId?.trim() ?? "";
  const contentFingerprint = buildContentFingerprint(body);
  if (contentFingerprint) {
    return `render-content:${workspaceId || "global"}:${userId || "global"}:${contentFingerprint}`;
  }
  const requestId = body.requestId?.trim() ?? "";
  if (!requestId) {
    return null;
  }
  if (!workspaceId || !userId) {
    return `render-request:global:${requestId}`;
  }
  return `render-request:${workspaceId}:${userId}:${requestId}`;
}
