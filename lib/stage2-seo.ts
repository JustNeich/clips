import type { Stage2Output } from "../app/components/types";
import type { CommentItem } from "./comments";
import { STAGE2_DEFAULT_STAGE_PROMPTS } from "./stage2-prompt-specs";

export const STAGE2_SEO_SYSTEM_PROMPT = STAGE2_DEFAULT_STAGE_PROMPTS.seo;

export type Stage2SeoOutput = {
  description: string;
  tags: string;
};

export const STAGE2_SEO_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "tags"],
  properties: {
    description: { type: "string", minLength: 1 },
    tags: { type: "string", minLength: 1 }
  }
} as const;

type BuildStage2SeoPromptInput = {
  sourceUrl: string;
  title: string;
  comments: CommentItem[];
  omittedCommentsCount: number;
  stage2Output: Pick<Stage2Output, "inputAnalysis" | "captionOptions" | "finalPick">;
  descriptionPrompt?: string;
  userInstruction?: string | null;
};

const MAX_SEO_COMMENT_COUNT = 24;
const MAX_SEO_COMMENT_CHARS = 200;
const MAX_SEO_COMMENTS_PAYLOAD_CHARS = 6_000;
const MAX_SEO_VISUAL_ANCHORS = 4;

function normalizeSeoText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateSeoText(value: string, maxLength: number): string {
  const normalized = normalizeSeoText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function prepareCommentsForSeoPrompt(
  comments: CommentItem[]
): { included: Array<{ likes: number; text: string }>; omittedCount: number } {
  const included: Array<{ likes: number; text: string }> = [];
  const seen = new Set<string>();
  let payloadChars = 0;

  for (const comment of comments) {
    if (included.length >= MAX_SEO_COMMENT_COUNT) {
      break;
    }
    const text = truncateSeoText(comment.text, MAX_SEO_COMMENT_CHARS);
    if (!text) {
      continue;
    }
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    const compact = {
      likes: comment.likes,
      text
    };
    const encoded = JSON.stringify(compact);
    if (payloadChars + encoded.length > MAX_SEO_COMMENTS_PAYLOAD_CHARS) {
      break;
    }
    seen.add(dedupeKey);
    payloadChars += encoded.length;
    included.push(compact);
  }

  return {
    included,
    omittedCount: Math.max(0, comments.length - included.length)
  };
}

function parseJsonBlock(raw: unknown): unknown {
  if (raw && typeof raw === "object") {
    return raw;
  }

  const trimmed = String(raw ?? "").trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  throw new Error("Не удалось разобрать JSON из ответа LLM.");
}

export function buildStage2SeoPrompt(input: BuildStage2SeoPromptInput): string {
  const systemPrompt = input.descriptionPrompt?.trim() || STAGE2_SEO_SYSTEM_PROMPT;
  const selectedOption =
    input.stage2Output.captionOptions.find(
      (option) => option.option === input.stage2Output.finalPick.option
    ) ?? input.stage2Output.captionOptions[0];

  const commentsPayload = prepareCommentsForSeoPrompt(input.comments);
  const compactInputAnalysis = {
    visualAnchors: input.stage2Output.inputAnalysis.visualAnchors
      .map((anchor) => truncateSeoText(anchor, 120))
      .filter(Boolean)
      .slice(0, MAX_SEO_VISUAL_ANCHORS),
    commentVibe: truncateSeoText(input.stage2Output.inputAnalysis.commentVibe, 220),
    keyPhraseToAdapt: truncateSeoText(input.stage2Output.inputAnalysis.keyPhraseToAdapt, 80)
  };

  return [
    "You must follow the SYSTEM PROMPT exactly.",
    "",
    "SYSTEM PROMPT:",
    systemPrompt,
    "",
    "PIPELINE CONTEXT:",
    `Source URL: ${input.sourceUrl}`,
    `Video title: ${input.title}`,
    "",
    "SELECTED CAPTION (final pick from Stage 2):",
    JSON.stringify(
      {
        option: selectedOption?.option ?? input.stage2Output.finalPick.option,
        top: selectedOption?.top ?? "",
        bottom: selectedOption?.bottom ?? "",
      },
      null,
      2
    ),
    "",
    "INPUT ANALYSIS FROM STAGE 2:",
    JSON.stringify(compactInputAnalysis, null, 2),
    "",
    "TOP COMMENTS (sorted by popularity):",
    JSON.stringify(
      {
        totalIncluded: commentsPayload.included.length,
        omittedCommentsCount: input.omittedCommentsCount + commentsPayload.omittedCount,
        items: commentsPayload.included
      },
      null,
      2
    ),
    "",
    "OPTIONAL USER STAGE 2 INSTRUCTION:",
    input.userInstruction?.trim()
      ? input.userInstruction.trim()
      : "No extra user instruction provided.",
    "",
    "TASK FOR THIS CALL:",
    "- Generate SEO description and tag list from this context.",
    "- Return JSON only and obey schema strictly.",
    '- description: plain text block with "Search terms and topics covered:" and "Hashtags:" sections.',
    "- tags: English comma-separated tags without #."
  ].join("\n");
}

export function parseStage2SeoOutput(raw: unknown): Stage2SeoOutput {
  const candidate = parseJsonBlock(raw);
  if (!candidate || typeof candidate !== "object") {
    throw new Error("LLM SEO output is not a JSON object.");
  }
  const obj = candidate as Record<string, unknown>;
  const description = String(obj.description ?? "").trim();
  const tags = String(obj.tags ?? "").trim();

  if (!description) {
    throw new Error("LLM SEO output is missing description.");
  }
  if (!tags) {
    throw new Error("LLM SEO output is missing tags.");
  }

  return {
    description,
    tags
  };
}
