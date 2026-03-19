import type { Stage2Output } from "../app/components/types";
import type { CommentItem } from "./comments";

export const STAGE2_SEO_SYSTEM_PROMPT = `Act as YouTube SEO Architect 2026.

Execution mode
- This prompt is called automatically by the pipeline right after Stage 2 options are generated.
- You receive structured context for one video (captions, comments, title, url).
- Do not wait for manual "описание." or "теги." commands.

SEO objective
- Maximize semantic density and discoverability for YouTube indexing.
- Avoid AI filler words/patterns: testament, masterclass, unleash, showcase, vibe, symphony, literally.

Output contract
- Return valid JSON only.
- Required keys:
  - "description": string
  - "tags": string
- "description" must be plain text (no markdown fences).
- "tags" must be English tags separated by commas (no hashtags #).

Description structure (inside "description")
1) First line: hard facts (location, speed, brand, event if known).
2) Body: 2-3 dense sentences with high-value entities and LSI keywords.
3) Section header exactly: Search terms and topics covered:
   - then 15 long-tail keywords, comma-separated.
4) Section header exactly: Hashtags:
   - then 12 hashtags total: 3 broad, 5 niche, 4 viral.

Tag list rules (for "tags")
- Exactly 17 English comma-separated tags:
  - 3 broad niche categories
  - 7 action/thematic tags
  - 7 hard-fact/entity tags
- No intro/outro text.`;

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
  stage2Output: Stage2Output;
  descriptionPrompt?: string;
  userInstruction?: string | null;
};

function parseJsonBlock(raw: string): unknown {
  const trimmed = raw.trim();

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

  const commentsPayload = input.comments.map((comment) => ({
    author: comment.author,
    likes: comment.likes,
    text: comment.text
  }));

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
        topRu: selectedOption?.topRu ?? "",
        bottomRu: selectedOption?.bottomRu ?? "",
        reason: input.stage2Output.finalPick.reason
      },
      null,
      2
    ),
    "",
    "INPUT ANALYSIS FROM STAGE 2:",
    JSON.stringify(input.stage2Output.inputAnalysis, null, 2),
    "",
    "TOP COMMENTS (sorted by popularity):",
    JSON.stringify(
      {
        totalIncluded: commentsPayload.length,
        omittedCommentsCount: input.omittedCommentsCount,
        items: commentsPayload
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

export function parseStage2SeoOutput(raw: string): Stage2SeoOutput {
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
