import {
  ChatDraft,
  ChatListItem,
  ChatRenderExportRef,
  ChatWorkflowStatus,
  CommentsPayload,
  Stage2Response,
  Stage3Version
} from "../app/components/types";
import { buildLegacyTimelineEntries, findLatestStage3AgentSessionRef } from "./stage3-legacy-bridge";

type ChatEventLike = {
  id: string;
  role: "user" | "assistant" | "system";
  type: "link" | "download" | "comments" | "stage2" | "error" | "note";
  text: string;
  data?: unknown;
  createdAt: string;
};

type ChatLike = {
  id: string;
  channelId: string;
  url: string;
  title: string;
  createdAt?: string;
  updatedAt: string;
  events: ChatEventLike[];
};

export type Stage1FetchState = {
  ready: boolean;
  commentsAvailable: boolean;
  commentsError: string | null;
};

function normalizeStage2TitleOptions(
  value: unknown
): Stage2Response["output"]["titleOptions"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .map((item, index) => {
      if (typeof item === "string") {
        const title = item.trim();
        if (!title) {
          return null;
        }
        return {
          option: index + 1,
          title,
          titleRu: title
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = String(record.title ?? "").trim();
      if (!title) {
        return null;
      }
      return {
        option:
          typeof record.option === "number" && Number.isFinite(record.option)
            ? Math.max(1, Math.floor(record.option))
            : index + 1,
        title,
        titleRu: String(record.titleRu ?? "").trim() || title
      };
    })
    .filter(
      (
        item
      ): item is {
        option: number;
        title: string;
        titleRu: string;
      } => Boolean(item)
    );

  return normalized.length === value.length ? normalized : null;
}

export function extractCommentsPayload(data: unknown): CommentsPayload | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Partial<CommentsPayload>;
  if (!Array.isArray(candidate.topComments) || !Array.isArray(candidate.allComments)) {
    return null;
  }

  return {
    title: String(candidate.title ?? "video"),
    totalComments: Number(candidate.totalComments ?? candidate.allComments.length ?? 0),
    topComments: candidate.topComments,
    allComments: candidate.allComments
  };
}

export function extractStage2Payload(data: unknown): Stage2Response | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  if (!("output" in candidate) || !candidate.output || typeof candidate.output !== "object") {
    return null;
  }

  const output = candidate.output as Record<string, unknown>;
  const titleOptions = normalizeStage2TitleOptions(output.titleOptions);
  if (!titleOptions) {
    return null;
  }

  return {
    ...(data as Stage2Response),
    output: {
      ...((data as Stage2Response).output ?? {}),
      titleOptions
    }
  };
}

export function extractStage1FetchState(chat: Pick<ChatLike, "events"> | null): Stage1FetchState {
  if (!chat) {
    return { ready: false, commentsAvailable: false, commentsError: null };
  }

  let ready = false;
  let commentsAvailable = false;
  let commentsError: string | null = null;

  for (const event of chat.events) {
    if (event.role === "assistant" && event.type === "comments" && extractCommentsPayload(event.data)) {
      ready = true;
      commentsAvailable = true;
      commentsError = null;
      continue;
    }

    if (
      event.role === "assistant" &&
      event.type === "note" &&
      event.data &&
      typeof event.data === "object" &&
      (event.data as Record<string, unknown>).stage1Ready === true
    ) {
      ready = true;
      commentsAvailable = Boolean((event.data as Record<string, unknown>).commentsAvailable);
      commentsError =
        typeof (event.data as Record<string, unknown>).commentsError === "string"
          ? String((event.data as Record<string, unknown>).commentsError)
          : null;
    }
  }

  return { ready, commentsAvailable, commentsError };
}

export function getMaxStepForChat(chat: Pick<ChatLike, "events"> | null): 1 | 2 | 3 {
  if (!chat) {
    return 1;
  }

  const hasStage2 = chat.events.some((event) => event.type === "stage2" && event.role === "assistant");
  const stage1 = extractStage1FetchState(chat);
  return hasStage2 ? 3 : stage1.ready ? 2 : 1;
}

export function findLatestStage2Event(
  chat: Pick<ChatLike, "events"> | null
): { id: string; createdAt: string; payload: Stage2Response } | null {
  if (!chat) {
    return null;
  }

  for (let index = chat.events.length - 1; index >= 0; index -= 1) {
    const event = chat.events[index];
    if (event.type !== "stage2" || event.role !== "assistant") {
      continue;
    }
    const payload = extractStage2Payload(event.data);
    if (!payload) {
      continue;
    }
    return {
      id: event.id,
      createdAt: event.createdAt,
      payload
    };
  }

  return null;
}

export function extractRenderExportRef(
  data: unknown,
  fallbackText?: string | null
): ChatRenderExportRef | null {
  if (data && typeof data === "object") {
    const candidate = data as Record<string, unknown>;
    if (candidate.kind === "stage3-render-export") {
      return {
        kind: "stage3-render-export",
        fileName:
          typeof candidate.fileName === "string" && candidate.fileName.trim()
            ? candidate.fileName.trim()
            : "video.mp4",
        renderTitle:
          typeof candidate.renderTitle === "string" && candidate.renderTitle.trim()
            ? candidate.renderTitle.trim()
            : null,
        clipStartSec:
          typeof candidate.clipStartSec === "number" && Number.isFinite(candidate.clipStartSec)
            ? candidate.clipStartSec
            : null,
        clipEndSec:
          typeof candidate.clipEndSec === "number" && Number.isFinite(candidate.clipEndSec)
            ? candidate.clipEndSec
            : null,
        focusY:
          typeof candidate.focusY === "number" && Number.isFinite(candidate.focusY) ? candidate.focusY : null,
        templateId:
          typeof candidate.templateId === "string" && candidate.templateId.trim()
            ? candidate.templateId.trim()
            : null,
        createdAt:
          typeof candidate.createdAt === "string" && candidate.createdAt.trim()
            ? candidate.createdAt.trim()
            : null
      };
    }
  }

  const text = String(fallbackText ?? "").trim();
  if (!text.startsWith("Stage 3 export finished:")) {
    return null;
  }

  const titleMatch = text.match(/\(title (.*?), clip /);
  const fileMatch = text.match(/^Stage 3 export finished:\s+(.+?)\s+\(title /);
  const clipMatch = text.match(/clip ([0-9.]+)-([0-9.]+)s/);
  const focusMatch = text.match(/focus ([0-9]+)%\)/);

  const renderTitle = titleMatch?.[1]?.trim() && titleMatch[1] !== "n/a" ? titleMatch[1].trim() : null;
  return {
    kind: "stage3-render-export",
    fileName: fileMatch?.[1]?.trim() || "video.mp4",
    renderTitle,
    clipStartSec: clipMatch?.[1] ? Number(clipMatch[1]) : null,
    clipEndSec: clipMatch?.[2] ? Number(clipMatch[2]) : null,
    focusY: focusMatch?.[1] ? Number(focusMatch[1]) / 100 : null,
    templateId: null,
    createdAt: null
  };
}

export function findLatestRenderExport(events: ChatEventLike[]): ChatRenderExportRef | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "note" || event.role !== "assistant") {
      continue;
    }
    const exportRef = extractRenderExportRef(event.data, event.text);
    if (exportRef) {
      return exportRef;
    }
  }

  return null;
}

function getLegacyVersions(chat: Pick<ChatLike, "events"> | null): Stage3Version[] {
  if (!chat) {
    return [];
  }

  return buildLegacyTimelineEntries(
    chat.events
      .filter((event) => event.type === "note" && event.role === "assistant")
      .map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        data: event.data
      }))
  );
}

function getLatestStage3Version(chat: Pick<ChatLike, "events"> | null): Stage3Version | null {
  const versions = getLegacyVersions(chat);
  return versions[versions.length - 1] ?? null;
}

export function getDefaultDraftState(chat: Pick<ChatLike, "events"> | null): {
  maxStep: 1 | 2 | 3;
  selectedCaptionOption: number | null;
  selectedTitleOption: number | null;
  topText: string | null;
  bottomText: string | null;
  clipStartSec: number | null;
  focusY: number | null;
  agentPrompt: string;
  selectedVersionId: string | null;
  passSelectionByVersion: Record<string, number>;
} {
  const maxStep = getMaxStepForChat(chat);
  const latestStage2 = findLatestStage2Event(chat);
  const latestVersion = getLatestStage3Version(chat);
  const selectedCaptionOption = latestStage2?.payload.output.finalPick.option ?? null;
  const selectedTitleOption = latestStage2?.payload.output.titleOptions[0]?.option ?? null;
  const recommendedIndex = latestVersion
    ? Math.max(0, Math.min(latestVersion.internalPasses.length - 1, latestVersion.recommendedPass - 1))
    : 0;

  return {
    maxStep,
    selectedCaptionOption,
    selectedTitleOption,
    topText: latestVersion?.final.topText ?? null,
    bottomText: latestVersion?.final.bottomText ?? null,
    clipStartSec: latestVersion?.final.clipStartSec ?? null,
    focusY: latestVersion?.final.focusY ?? null,
    agentPrompt: latestVersion?.prompt ?? "",
    selectedVersionId: latestVersion?.runId ?? null,
    passSelectionByVersion: latestVersion ? { [latestVersion.runId]: recommendedIndex } : {}
  };
}

export function normalizeChatDraft(value: unknown): ChatDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const threadId = typeof candidate.threadId === "string" ? candidate.threadId.trim() : "";
  const userId = typeof candidate.userId === "string" ? candidate.userId.trim() : "";
  const updatedAt = typeof candidate.updatedAt === "string" ? candidate.updatedAt.trim() : "";
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt.trim() : updatedAt;
  const lastOpenStepRaw = candidate.lastOpenStep;
  const lastOpenStep = lastOpenStepRaw === 1 || lastOpenStepRaw === 2 || lastOpenStepRaw === 3 ? lastOpenStepRaw : 1;
  const stage2Candidate = candidate.stage2 && typeof candidate.stage2 === "object"
    ? (candidate.stage2 as Record<string, unknown>)
    : {};
  const stage3Candidate = candidate.stage3 && typeof candidate.stage3 === "object"
    ? (candidate.stage3 as Record<string, unknown>)
    : {};

  if (!threadId || !userId || !updatedAt) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : "",
    threadId,
    userId,
    createdAt,
    updatedAt,
    lastOpenStep,
    stage2: {
      instruction:
        typeof stage2Candidate.instruction === "string" ? stage2Candidate.instruction : "",
      selectedCaptionOption:
        typeof stage2Candidate.selectedCaptionOption === "number" &&
        Number.isFinite(stage2Candidate.selectedCaptionOption)
          ? Math.max(1, Math.floor(stage2Candidate.selectedCaptionOption))
          : null,
      selectedTitleOption:
        typeof stage2Candidate.selectedTitleOption === "number" &&
        Number.isFinite(stage2Candidate.selectedTitleOption)
          ? Math.max(1, Math.floor(stage2Candidate.selectedTitleOption))
          : null
    },
    stage3: {
      topText:
        typeof stage3Candidate.topText === "string" && stage3Candidate.topText.trim()
          ? stage3Candidate.topText
          : null,
      bottomText:
        typeof stage3Candidate.bottomText === "string" && stage3Candidate.bottomText.trim()
          ? stage3Candidate.bottomText
          : null,
      clipStartSec:
        typeof stage3Candidate.clipStartSec === "number" && Number.isFinite(stage3Candidate.clipStartSec)
          ? stage3Candidate.clipStartSec
          : null,
      focusY:
        typeof stage3Candidate.focusY === "number" && Number.isFinite(stage3Candidate.focusY)
          ? stage3Candidate.focusY
          : null,
      renderPlan:
        stage3Candidate.renderPlan && typeof stage3Candidate.renderPlan === "object"
          ? (stage3Candidate.renderPlan as ChatDraft["stage3"]["renderPlan"])
          : null,
      agentPrompt:
        typeof stage3Candidate.agentPrompt === "string" ? stage3Candidate.agentPrompt : "",
      selectedVersionId:
        typeof stage3Candidate.selectedVersionId === "string" && stage3Candidate.selectedVersionId.trim()
          ? stage3Candidate.selectedVersionId.trim()
          : null,
      passSelectionByVersion:
        stage3Candidate.passSelectionByVersion &&
        typeof stage3Candidate.passSelectionByVersion === "object" &&
        !Array.isArray(stage3Candidate.passSelectionByVersion)
          ? Object.fromEntries(
              Object.entries(stage3Candidate.passSelectionByVersion as Record<string, unknown>)
                .filter(
                  (entry): entry is [string, number] =>
                    typeof entry[0] === "string" &&
                    entry[0].trim().length > 0 &&
                    typeof entry[1] === "number" &&
                    Number.isFinite(entry[1])
                )
                .map(([key, draftIndex]) => [key, Math.max(0, Math.floor(draftIndex))])
            )
          : {}
    }
  };
}

export function getPreferredStepForChat(
  chat: Pick<ChatLike, "events"> | null,
  draft: ChatDraft | null
): 1 | 2 | 3 {
  const maxStep = getMaxStepForChat(chat);
  const preferred = draft?.lastOpenStep ?? maxStep;
  return preferred <= maxStep ? preferred : maxStep;
}

function draftHasMeaningfulStage2Delta(
  draft: ChatDraft,
  defaults: ReturnType<typeof getDefaultDraftState>
): boolean {
  const instruction = draft.stage2.instruction.trim();
  if (instruction) {
    return true;
  }
  if (draft.stage2.selectedCaptionOption !== null && draft.stage2.selectedCaptionOption !== defaults.selectedCaptionOption) {
    return true;
  }
  if (draft.stage2.selectedTitleOption !== null && draft.stage2.selectedTitleOption !== defaults.selectedTitleOption) {
    return true;
  }
  return false;
}

function draftHasMeaningfulStage3Delta(
  draft: ChatDraft,
  defaults: ReturnType<typeof getDefaultDraftState>
): boolean {
  if (draft.stage3.topText !== null && draft.stage3.topText !== defaults.topText) {
    return true;
  }
  if (draft.stage3.bottomText !== null && draft.stage3.bottomText !== defaults.bottomText) {
    return true;
  }
  if (draft.stage3.clipStartSec !== null && draft.stage3.clipStartSec !== defaults.clipStartSec) {
    return true;
  }
  if (draft.stage3.focusY !== null && draft.stage3.focusY !== defaults.focusY) {
    return true;
  }
  if (draft.stage3.renderPlan !== null) {
    return true;
  }
  if (draft.stage3.agentPrompt.trim() && draft.stage3.agentPrompt !== defaults.agentPrompt) {
    return true;
  }
  if (draft.stage3.selectedVersionId !== null && draft.stage3.selectedVersionId !== defaults.selectedVersionId) {
    return true;
  }
  const defaultPassKeys = Object.keys(defaults.passSelectionByVersion);
  const draftPassKeys = Object.keys(draft.stage3.passSelectionByVersion);
  if (draftPassKeys.length !== defaultPassKeys.length) {
    return draftPassKeys.length > 0;
  }
  for (const key of draftPassKeys) {
    if (draft.stage3.passSelectionByVersion[key] !== defaults.passSelectionByVersion[key]) {
      return true;
    }
  }
  return false;
}

export function hasMeaningfulChatDraft(
  chat: Pick<ChatLike, "events"> | null,
  draft: ChatDraft | null
): boolean {
  if (!draft || !chat) {
    return false;
  }
  const defaults = getDefaultDraftState(chat);
  if (draft.lastOpenStep !== defaults.maxStep) {
    return true;
  }
  return (
    draftHasMeaningfulStage2Delta(draft, defaults) ||
    draftHasMeaningfulStage3Delta(draft, defaults)
  );
}

function getLatestErrorIndex(events: ChatEventLike[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.role === "assistant" && event.type === "error") {
      return index;
    }
  }
  return -1;
}

function getLatestSuccessIndex(events: ChatEventLike[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.role !== "assistant") {
      continue;
    }

    if (event.type === "stage2" || event.type === "comments") {
      return index;
    }

    if (event.type === "note") {
      if (extractRenderExportRef(event.data, event.text)) {
        return index;
      }
      const candidate = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : null;
      if (candidate?.stage1Ready === true) {
        return index;
      }
      if (candidate?.kind === "stage3-agent-session") {
        return index;
      }
    }
  }
  return -1;
}

export function buildChatListItem(chat: ChatLike, draft: ChatDraft | null): ChatListItem {
  const maxStep = getMaxStepForChat(chat);
  const preferredStep = getPreferredStepForChat(chat, draft);
  const latestRenderExport = findLatestRenderExport(chat.events);
  const stage3SessionRef = findLatestStage3AgentSessionRef(chat.events);
  const hasStage2 = chat.events.some((event) => event.role === "assistant" && event.type === "stage2");
  const meaningfulDraft = hasMeaningfulChatDraft(chat, draft);
  const latestErrorIndex = getLatestErrorIndex(chat.events);
  const latestSuccessIndex = getLatestSuccessIndex(chat.events);

  let status: ChatWorkflowStatus = "new";
  if (latestErrorIndex > latestSuccessIndex) {
    status = "error";
  } else if (stage3SessionRef?.status === "running") {
    status = "agentRunning";
  } else if (latestRenderExport) {
    status = "exported";
  } else if (hasStage2 && (meaningfulDraft || preferredStep < maxStep || preferredStep === 3)) {
    status = "editing";
  } else if (hasStage2) {
    status = "stage2Ready";
  } else if (maxStep === 2) {
    status = "sourceReady";
  }

  return {
    id: chat.id,
    channelId: chat.channelId,
    url: chat.url,
    title: chat.title,
    updatedAt: chat.updatedAt,
    status,
    maxStep,
    preferredStep,
    hasDraft: meaningfulDraft,
    exportTitle: latestRenderExport?.renderTitle ?? null
  };
}
