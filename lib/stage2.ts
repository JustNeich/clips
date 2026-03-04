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
Create 5 short, click-worthy titles (2-6 words, All Caps allowed). Ignore examples.json for this specific task.
4. Final Pick
Which option best captures the "examples.json" energy?`;

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
  }>;
  titleOptions: string[];
  finalPick: {
    option: number;
    reason: string;
  };
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
        required: ["option", "top", "bottom"],
        properties: {
          option: { type: "integer", minimum: 1, maximum: 5 },
          top: { type: "string", minLength: 1 },
          bottom: { type: "string", minLength: 1 }
        }
      }
    },
    titleOptions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: { type: "string", minLength: 1 }
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

type BuildStage2PromptInput = {
  sourceUrl: string;
  title: string;
  comments: CommentItem[];
  omittedCommentsCount: number;
  frameDescriptions: string[];
  examplesJson: string;
  userInstruction?: string | null;
};

export function buildStage2Prompt(input: BuildStage2PromptInput): string {
  const commentsPayload = input.comments.map((comment) => ({
    author: comment.author,
    likes: comment.likes,
    text: comment.text
  }));

  return [
    "You must follow the SYSTEM PROMPT exactly.",
    "",
    "SYSTEM PROMPT:",
    STAGE2_SYSTEM_PROMPT,
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
    "- Keep TOP to 140-210 chars, BOTTOM to 80-160 chars.",
    "- Do not use banned words or banned openers from the system prompt."
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
      bottom: String(optionObj.bottom ?? "").trim()
    };
  });

  return {
    inputAnalysis: {
      visualAnchors: ensureStringArray(inputAnalysis.visualAnchors, 3),
      commentVibe: String(inputAnalysis.commentVibe ?? "").trim(),
      keyPhraseToAdapt: String(inputAnalysis.keyPhraseToAdapt ?? "").trim()
    },
    captionOptions,
    titleOptions: ensureStringArray(obj.titleOptions, 5),
    finalPick: {
      option:
        typeof finalPick.option === "number" && Number.isFinite(finalPick.option)
          ? Math.floor(finalPick.option)
          : 1,
      reason: String(finalPick.reason ?? "").trim()
    }
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

  throw new Error("Unable to parse JSON from LLM output.");
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
