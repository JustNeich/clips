import { CommentItem } from "./comments";

export const STAGE2_SYSTEM_PROMPT = `SYSTEM PROMPT v6 — Viral Shorts Overlays (Visually Anchored & Human-Like)
Role
You are a witty, observant narrator for viral Shorts/Reels targeting a US audience. You write text overlays that feel like they were written by a sharp observer or a blue-collar veteran, not a marketing AI.
INPUT PROCESSING STRATEGY (Must be done first)
You will receive two types of inputs: (1) The Video and (2) User Comments. Process them in this strict order to guarantee synchronization and humor.
1. VIDEO SOURCE ANALYSIS (The "Truth" Anchor)
Goal: Fix synchronization issues. The text must match what the viewer sees right now.
The "Paused Frame" Rule: If a user paused the video while reading your TOP caption, would they see exactly what you described?
Specific Nouns: Do not say "a tool"; say "a Dewalt" or "an impact driver." Do not say "nature"; say "the river" or "mud."
Action-First: Describe the physical movement visible on screen (e.g., "wiping grease on pants," "kicking the tire"), not just the abstract concept.
2. COMMENT SECTION MINING (The "Vibe" Source)
Goal: Eliminate AI-sounding text by mimicking human reactions.
Extract the Sentiment: How is the crowd reacting? Are they laughing at him or with him? Is it respect or sarcasm? Use this exact emotion for the BOTTOM caption.
Steal the Slang (Adaptively): Look for recurring phrases or jokes in the comments.
Example: If comments say "That's a permanent Loctite," adapt it: "That bolt isn't stuck, it's welded by time."
Find Hidden Details: If comments point out a background detail (e.g., "the dog in the back"), use it to make the caption feel observant.
STYLE FINGERPRINT (Learned from examples.json)
Replicate the corpus style exactly.
Voice: Conversational, present-tense, "blue-collar" wisdom, slightly cynical but good-natured.
Grammar: Heavy use of contractions (it’s, that’s, don’t). Use sentence fragments if they pack a punch.
Structure:
"That's not [X], that's [Y]."
"You can tell he’s [Action]..."
"This guy..." (Start directly with the subject).
⛔️ NEGATIVE CONSTRAINTS (The "Anti-AI" List)
NEVER use these words or patterns:
Banned Words: testament, showcase, unleash, masterclass, symphony, tapestry, vibe, literally, seamless, elevate, realm.
Banned Openers: "In this video we see...", "Here is a..." (Just say: "This mechanic...").
No Padding: Do not add filler adjectives just to reach a character count.
No Emojis: Do not use emojis in the overlay text.
LENGTH RULES (Natural Flow)
TOP (Context): 140–210 characters. Focus on setting the scene with visual facts.
BOTTOM (Reaction): 80–160 characters. Punchy, readable, relatable.
Formatting: Strictly single line per section (no manual line breaks).
DELIVERABLES FORMAT
Return your response in this exact structure:
1. Input Analysis (Internal Monologue)
Visual Anchors: [List 3 specific visible objects/actions you will anchor to]
Comment Vibe: [Summary of top sentiment: e.g., "Sarcastic respect," "Mocking the failure"]
Key Phrase to Adapt: [One good line/idea found in comments to re-use]
2. Five Caption Options
Drafted based on Analysis + examples.json style.
Option 1
TOP — [Text]
BOTTOM — [Text]
Option 2
TOP — [Text]
BOTTOM — [Text]
Option 3
TOP — [Text]
BOTTOM — [Text]
Option 4
TOP — [Text]
BOTTOM — [Text]
Option 5
TOP — [Text]
BOTTOM — [Text]
3. Five Title Options
Create 5 short, click-worthy titles (2-6 words, All Caps allowed) and include a Russian translation for each title. Ignore examples.json for this specific task.
4. Final Pick
Which option best captures the "examples.json" energy?`;

export const STAGE2_DESCRIPTION_SYSTEM_PROMPT = `Act as YouTube SEO Architect 2026.

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

export type Stage2Output = {
  inputAnalysis: {
    visualAnchors: string[];
    commentVibe: string;
    keyPhraseToAdapt: string;
  };
  captionOptions: Array<{
    option: number;
    top: string;
    bottom: string;
    topRu: string;
    bottomRu: string;
  }>;
  titleOptions: Array<{
    option: number;
    title: string;
    titleRu: string;
  }>;
  finalPick: {
    option: number;
    reason: string;
  };
};

export type Stage2SeoOutput = {
  description: string;
  tags: string;
};

export const STAGE2_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["inputAnalysis", "captionOptions", "titleOptions", "finalPick"],
  properties: {
    inputAnalysis: {
      type: "object",
      additionalProperties: false,
      required: ["visualAnchors", "commentVibe", "keyPhraseToAdapt"],
      properties: {
        visualAnchors: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string", minLength: 1 }
        },
        commentVibe: { type: "string", minLength: 1 },
        keyPhraseToAdapt: { type: "string", minLength: 1 }
      }
    },
    captionOptions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["option", "top", "bottom", "topRu", "bottomRu"],
        properties: {
          option: { type: "integer", minimum: 1, maximum: 5 },
          top: { type: "string", minLength: 1 },
          bottom: { type: "string", minLength: 1 },
          topRu: { type: "string", minLength: 1 },
          bottomRu: { type: "string", minLength: 1 }
        }
      }
    },
    titleOptions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["option", "title", "titleRu"],
        properties: {
          option: { type: "integer", minimum: 1, maximum: 5 },
          title: { type: "string", minLength: 1 },
          titleRu: { type: "string", minLength: 1 }
        }
      }
    },
    finalPick: {
      type: "object",
      additionalProperties: false,
      required: ["option", "reason"],
      properties: {
        option: { type: "integer", minimum: 1, maximum: 5 },
        reason: { type: "string", minLength: 1 }
      }
    }
  }
} as const;

export const STAGE2_SEO_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "tags"],
  properties: {
    description: { type: "string", minLength: 1 },
    tags: { type: "string", minLength: 1 }
  }
} as const;

type BuildStage2PromptInput = {
  sourceUrl: string;
  title: string;
  comments: CommentItem[];
  omittedCommentsCount: number;
  frameDescriptions: string[];
  examplesJson: string;
  systemPrompt?: string;
  userInstruction?: string | null;
};

type BuildStage2SeoPromptInput = {
  sourceUrl: string;
  title: string;
  comments: CommentItem[];
  omittedCommentsCount: number;
  stage2Output: Stage2Output;
  descriptionPrompt?: string;
  userInstruction?: string | null;
};

export function buildStage2Prompt(input: BuildStage2PromptInput): string {
  const systemPrompt = input.systemPrompt?.trim() || STAGE2_SYSTEM_PROMPT;
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
    "TASK CONTEXT:",
    `Source URL: ${input.sourceUrl}`,
    `Video title: ${input.title}`,
    `Attached images are extracted from the downloaded video and represent moments across the clip.`,
    `Frame labels: ${input.frameDescriptions.join(", ")}`,
    "",
    "COMMENTS (sorted by popularity):",
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
    "STYLE EXAMPLES FROM examples.json:",
    input.examplesJson,
    "",
    "USER REGENERATION INSTRUCTION:",
    input.userInstruction?.trim()
      ? input.userInstruction.trim()
      : "No extra user instruction provided.",
    "",
    "USER INSTRUCTION PRIORITY RULE:",
    "- If user instruction conflicts with SYSTEM PROMPT constraints, keep SYSTEM PROMPT constraints.",
    "- Otherwise adapt output using user instruction.",
    "",
    "OUTPUT RULES:",
    "- Return valid JSON only.",
    "- Obey the JSON schema exactly (no extra keys).",
    "- Each caption option must include Russian translation fields: topRu and bottomRu.",
    "- Each title option must include Russian translation field titleRu.",
    "- Keep TOP to 140-210 chars, BOTTOM to 80-160 chars.",
    "- Do not use banned words or banned openers from the system prompt."
  ].join("\n");
}

export function buildStage2SeoPrompt(input: BuildStage2SeoPromptInput): string {
  const systemPrompt = input.descriptionPrompt?.trim() || STAGE2_DESCRIPTION_SYSTEM_PROMPT;
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

function ensureStringArray(value: unknown, exactLength?: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid LLM output: expected array.");
  }

  const array = value.map((item) => String(item ?? "").trim());
  if (array.some((item) => !item)) {
    throw new Error("Invalid LLM output: empty string in array.");
  }

  if (exactLength !== undefined && array.length !== exactLength) {
    throw new Error(`Invalid LLM output: expected ${exactLength} items.`);
  }

  return array;
}

function parseTitleOptions(
  value: unknown
): Array<{ option: number; title: string; titleRu: string }> {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new Error("LLM output must contain exactly 5 title options.");
  }

  return value.map((item, index) => {
    if (typeof item === "string") {
      const title = item.trim();
      if (!title) {
        throw new Error("LLM output contains empty title option.");
      }
      return {
        option: index + 1,
        title,
        titleRu: title
      };
    }

    if (!item || typeof item !== "object") {
      throw new Error("LLM output contains invalid title option.");
    }

    const titleObj = item as Record<string, unknown>;
    const title = String(titleObj.title ?? "").trim();
    const titleRu = String(titleObj.titleRu ?? "").trim() || title;
    const option =
      typeof titleObj.option === "number" && Number.isFinite(titleObj.option)
        ? Math.floor(titleObj.option)
        : index + 1;

    if (!title) {
      throw new Error("LLM output contains empty title option.");
    }

    return {
      option,
      title,
      titleRu
    };
  });
}

export function parseStage2Output(raw: string): Stage2Output {
  const candidate = parseJsonBlock(raw);
  if (!candidate || typeof candidate !== "object") {
    throw new Error("LLM output is not a JSON object.");
  }

  const obj = candidate as Record<string, unknown>;
  const inputAnalysis = obj.inputAnalysis as Record<string, unknown> | undefined;
  const finalPick = obj.finalPick as Record<string, unknown> | undefined;
  const captionOptionsRaw = obj.captionOptions;

  if (!inputAnalysis || typeof inputAnalysis !== "object") {
    throw new Error("LLM output is missing inputAnalysis.");
  }
  if (!finalPick || typeof finalPick !== "object") {
    throw new Error("LLM output is missing finalPick.");
  }
  if (!Array.isArray(captionOptionsRaw) || captionOptionsRaw.length !== 5) {
    throw new Error("LLM output must contain exactly 5 caption options.");
  }

  const captionOptions = captionOptionsRaw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error("LLM output contains invalid caption option.");
    }
    const optionObj = item as Record<string, unknown>;
    return {
      option:
        typeof optionObj.option === "number" && Number.isFinite(optionObj.option)
          ? Math.floor(optionObj.option)
          : index + 1,
      top: String(optionObj.top ?? "").trim(),
      bottom: String(optionObj.bottom ?? "").trim(),
      topRu: String(optionObj.topRu ?? "").trim() || String(optionObj.top ?? "").trim(),
      bottomRu:
        String(optionObj.bottomRu ?? "").trim() || String(optionObj.bottom ?? "").trim()
    };
  });

  return {
    inputAnalysis: {
      visualAnchors: ensureStringArray(inputAnalysis.visualAnchors, 3),
      commentVibe: String(inputAnalysis.commentVibe ?? "").trim(),
      keyPhraseToAdapt: String(inputAnalysis.keyPhraseToAdapt ?? "").trim()
    },
    captionOptions,
    titleOptions: parseTitleOptions(obj.titleOptions),
    finalPick: {
      option:
        typeof finalPick.option === "number" && Number.isFinite(finalPick.option)
          ? Math.floor(finalPick.option)
          : 1,
      reason: String(finalPick.reason ?? "").trim()
    }
  };
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

export type Stage2ValidationWarning = {
  field: string;
  message: string;
};

export function validateStage2Output(output: Stage2Output): Stage2ValidationWarning[] {
  const warnings: Stage2ValidationWarning[] = [];

  for (const option of output.captionOptions) {
    const topLength = option.top.length;
    const bottomLength = option.bottom.length;

    if (topLength < 140 || topLength > 210) {
      warnings.push({
        field: `captionOptions.option${option.option}.top`,
        message: `TOP length is ${topLength}, expected 140-210.`
      });
    }
    if (bottomLength < 80 || bottomLength > 160) {
      warnings.push({
        field: `captionOptions.option${option.option}.bottom`,
        message: `BOTTOM length is ${bottomLength}, expected 80-160.`
      });
    }
  }

  return warnings;
}
