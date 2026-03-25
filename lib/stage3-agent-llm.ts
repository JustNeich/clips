import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Stage3AudioMode,
  Stage3Operation,
  Stage3PlannerSnapshotDigest,
  Stage3RenderPlan,
  Stage3StateSnapshot,
  Stage3TimingMode
} from "../app/components/types";
import { runCodexExec } from "./codex-runner";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import { STAGE3_TEXT_SCALE_UI_MAX, STAGE3_TEXT_SCALE_UI_MIN, clampStage3TextScaleUi } from "./stage3-text-fit";

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["operations", "summary"],
  properties: {
    summary: { type: "string", minLength: 1 },
    intent: {
      type: "object",
      additionalProperties: false,
      properties: {
        zoomRequested: { type: "boolean" },
        zoomValue: { type: ["number", "null"] },
        actionOnly: { type: "boolean" },
        segmentsRequested: { type: "integer" },
        timingMode: { type: ["string", "null"], enum: ["auto", "compress", "stretch", null] },
        audioMode: { type: ["string", "null"], enum: ["source_only", "source_plus_music", null] }
      }
    },
    operations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op"],
        properties: {
          op: {
            type: "string",
            enum: [
              "set_segments",
              "append_segment",
              "clear_segments",
              "set_timing_mode",
              "set_audio_mode",
              "set_slowmo",
              "set_clip_start",
              "set_focus_y",
              "set_video_zoom",
              "set_top_font_scale",
              "set_bottom_font_scale",
              "set_music_gain",
              "set_text_policy",
              "rewrite_top_text",
              "rewrite_bottom_text"
            ]
          },
          segments: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["startSec", "endSec", "label"],
              properties: {
                startSec: { type: "number" },
                endSec: { type: ["number", "null"] },
                label: { type: "string" },
                speed: { type: "number" }
              }
            }
          },
          segment: {
            type: "object",
            additionalProperties: false,
            required: ["startSec", "endSec", "label"],
            properties: {
              startSec: { type: "number" },
              endSec: { type: ["number", "null"] },
              label: { type: "string" },
              speed: { type: "number" }
            }
          },
          timingMode: { type: "string", enum: ["auto", "compress", "stretch"] },
          audioMode: { type: "string", enum: ["source_only", "source_plus_music"] },
          smoothSlowMo: { type: "boolean" },
          clipStartSec: { type: "number" },
          focusY: { type: "number" },
          videoZoom: { type: "number" },
          topFontScale: { type: "number" },
          bottomFontScale: { type: "number" },
          musicGain: { type: "number" },
          textPolicy: { type: "string", enum: ["strict_fit", "preserve_words", "aggressive_compact"] },
          topText: { type: "string" },
          bottomText: { type: "string" }
        }
      }
    }
  }
} as const;

type PlannerIntent = {
  zoomRequested: boolean;
  zoomValue: number | null;
  actionOnly: boolean;
  segmentsRequested: number;
  timingMode: Stage3TimingMode | null;
  audioMode: Stage3AudioMode | null;
};

type PlannerOutput = {
  summary: string;
  intent: PlannerIntent;
  operations: Stage3Operation[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseJsonBlock(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }
  throw new Error("Не удалось разобрать JSON планировщика.");
}

function normalizeSegment(
  value: unknown
): {
  startSec: number;
  endSec: number | null;
  label: string;
  speed: Stage3RenderPlan["segments"][number]["speed"];
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as { startSec?: unknown; endSec?: unknown; label?: unknown; speed?: unknown };
  const startSec = typeof candidate.startSec === "number" && Number.isFinite(candidate.startSec) ? candidate.startSec : null;
  if (startSec === null) {
    return null;
  }
  const endSec =
    candidate.endSec === null
      ? null
      : typeof candidate.endSec === "number" && Number.isFinite(candidate.endSec)
        ? candidate.endSec
        : null;
  const label =
    typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : `${startSec.toFixed(2)}-${endSec === null ? "end" : endSec.toFixed(2)}`;
  const speed =
    typeof candidate.speed === "number" && [1, 1.5, 2, 2.5, 3, 4, 5].includes(candidate.speed)
      ? (candidate.speed as Stage3RenderPlan["segments"][number]["speed"])
      : 1;
  return { startSec, endSec, label, speed };
}

function normalizeOperations(value: unknown): Stage3Operation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const operations: Stage3Operation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const op = typeof raw.op === "string" ? raw.op : "";
    switch (op) {
      case "set_segments": {
        const segments = Array.isArray(raw.segments)
          ? raw.segments.map(normalizeSegment).filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
          : [];
        operations.push({ op: "set_segments", segments });
        break;
      }
      case "append_segment": {
        const segment = normalizeSegment(raw.segment);
        if (segment) {
          operations.push({ op: "append_segment", segment });
        }
        break;
      }
      case "clear_segments":
        operations.push({ op: "clear_segments" });
        break;
      case "set_timing_mode": {
        const timingMode =
          raw.timingMode === "auto" || raw.timingMode === "compress" || raw.timingMode === "stretch"
            ? raw.timingMode
            : null;
        if (timingMode) {
          operations.push({ op: "set_timing_mode", timingMode });
        }
        break;
      }
      case "set_audio_mode": {
        const audioMode =
          raw.audioMode === "source_only" || raw.audioMode === "source_plus_music"
            ? raw.audioMode
            : null;
        if (audioMode) {
          operations.push({ op: "set_audio_mode", audioMode });
        }
        break;
      }
      case "set_slowmo":
        operations.push({ op: "set_slowmo", smoothSlowMo: Boolean(raw.smoothSlowMo) });
        break;
      case "set_clip_start":
        if (typeof raw.clipStartSec === "number" && Number.isFinite(raw.clipStartSec)) {
          operations.push({ op: "set_clip_start", clipStartSec: Math.max(0, raw.clipStartSec) });
        }
        break;
      case "set_focus_y":
        if (typeof raw.focusY === "number" && Number.isFinite(raw.focusY)) {
          operations.push({ op: "set_focus_y", focusY: clamp(raw.focusY, 0.12, 0.88) });
        }
        break;
      case "set_video_zoom":
        if (typeof raw.videoZoom === "number" && Number.isFinite(raw.videoZoom)) {
          operations.push({
            op: "set_video_zoom",
            videoZoom: clamp(raw.videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM)
          });
        }
        break;
      case "set_top_font_scale":
        if (typeof raw.topFontScale === "number" && Number.isFinite(raw.topFontScale)) {
          operations.push({ op: "set_top_font_scale", topFontScale: clampStage3TextScaleUi(raw.topFontScale) });
        }
        break;
      case "set_bottom_font_scale":
        if (typeof raw.bottomFontScale === "number" && Number.isFinite(raw.bottomFontScale)) {
          operations.push({
            op: "set_bottom_font_scale",
            bottomFontScale: clampStage3TextScaleUi(raw.bottomFontScale)
          });
        }
        break;
      case "set_music_gain":
        if (typeof raw.musicGain === "number" && Number.isFinite(raw.musicGain)) {
          operations.push({ op: "set_music_gain", musicGain: clamp(raw.musicGain, 0, 1) });
        }
        break;
      case "set_text_policy":
        if (
          raw.textPolicy === "strict_fit" ||
          raw.textPolicy === "preserve_words" ||
          raw.textPolicy === "aggressive_compact"
        ) {
          operations.push({ op: "set_text_policy", textPolicy: raw.textPolicy });
        }
        break;
      case "rewrite_top_text":
        if (typeof raw.topText === "string" && raw.topText.trim()) {
          operations.push({ op: "rewrite_top_text", topText: raw.topText.trim() });
        }
        break;
      case "rewrite_bottom_text":
        if (typeof raw.bottomText === "string" && raw.bottomText.trim()) {
          operations.push({ op: "rewrite_bottom_text", bottomText: raw.bottomText.trim() });
        }
        break;
      default:
        break;
    }
  }
  return operations;
}

function normalizeIntent(value: unknown): PlannerIntent {
  if (!value || typeof value !== "object") {
    return {
      zoomRequested: false,
      zoomValue: null,
      actionOnly: false,
      segmentsRequested: 0,
      timingMode: null,
      audioMode: null
    };
  }
  const intent = value as Record<string, unknown>;
  const zoomValueRaw =
    typeof intent.zoomValue === "number" && Number.isFinite(intent.zoomValue) ? intent.zoomValue : null;
  return {
    zoomRequested: Boolean(intent.zoomRequested),
    zoomValue:
      zoomValueRaw === null
        ? null
        : clamp(zoomValueRaw, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM),
    actionOnly: Boolean(intent.actionOnly),
    segmentsRequested:
      typeof intent.segmentsRequested === "number" && Number.isFinite(intent.segmentsRequested)
        ? Math.max(0, Math.floor(intent.segmentsRequested))
        : 0,
    timingMode:
      intent.timingMode === "auto" || intent.timingMode === "compress" || intent.timingMode === "stretch"
        ? intent.timingMode
        : null,
    audioMode:
      intent.audioMode === "source_only" || intent.audioMode === "source_plus_music"
        ? intent.audioMode
        : null
  };
}

function truncatePlannerText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildStage3PlannerSnapshotDigest(snapshot: Stage3StateSnapshot): Stage3PlannerSnapshotDigest {
  return {
    sourceDurationSec: snapshot.sourceDurationSec,
    topText: truncatePlannerText(snapshot.topText, 220),
    bottomText: truncatePlannerText(snapshot.bottomText, 220),
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    focusY: snapshot.focusY,
    textFit: {
      topCompacted: snapshot.textFit.topCompacted,
      bottomCompacted: snapshot.textFit.bottomCompacted,
      topFontPx: snapshot.textFit.topFontPx,
      bottomFontPx: snapshot.textFit.bottomFontPx,
      topOverflow: snapshot.textFit.topFontPx <= 0,
      bottomOverflow: snapshot.textFit.bottomFontPx <= 0
    },
    renderPlan: {
      timingMode: snapshot.renderPlan.timingMode,
      audioMode: snapshot.renderPlan.audioMode,
      videoZoom: snapshot.renderPlan.videoZoom,
      topFontScale: snapshot.renderPlan.topFontScale,
      bottomFontScale: snapshot.renderPlan.bottomFontScale,
      textPolicy: snapshot.renderPlan.textPolicy,
      smoothSlowMo: snapshot.renderPlan.smoothSlowMo,
      segmentCount: snapshot.renderPlan.segments.length,
      segments: snapshot.renderPlan.segments.slice(0, 6).map((segment) => ({
        startSec: segment.startSec,
        endSec: segment.endSec,
        speed: segment.speed,
        label: segment.label
      }))
    }
  };
}

export async function planStage3OperationsWithCodex(input: {
  codexHome: string;
  prompt: string;
  snapshot: Stage3StateSnapshot;
  sourceDurationSec: number | null;
  passIndex: number;
  maxPasses: number;
  scoreBefore: number;
  lastPassSummary?: string | null;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  imagePaths?: string[];
  visualDiagnostics?: string | null;
}): Promise<PlannerOutput> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-planner-"));
  try {
    const schemaPath = path.join(tmpDir, "stage3.plan.schema.json");
    const outputPath = path.join(tmpDir, "stage3.plan.output.json");
    await fs.writeFile(schemaPath, JSON.stringify(PLANNER_SCHEMA, null, 2), "utf-8");

    const prompt = [
      "You are Stage 3 video redactor planner.",
      "Return JSON only according to schema.",
      "Your goal is to improve edit quality and obey user request.",
      "Use only allowed ops. If no change is needed, return empty operations array.",
      "",
      "Hard constraints:",
      "- Target duration remains exactly 6.0s.",
      "- focusY must stay within 0.12..0.88.",
      `- videoZoom must stay within ${STAGE3_MIN_VIDEO_ZOOM.toFixed(1)}..${STAGE3_MAX_VIDEO_ZOOM.toFixed(1)}.`,
      `- topFontScale and bottomFontScale must stay within ${STAGE3_TEXT_SCALE_UI_MIN.toFixed(2)}..${STAGE3_TEXT_SCALE_UI_MAX.toFixed(2)}.`,
      "- Keep text readable; avoid overflow.",
      "- Prefer minimal operations with high impact.",
      "",
      `Pass ${input.passIndex}/${input.maxPasses}. Current quality score: ${input.scoreBefore.toFixed(2)}`,
      input.lastPassSummary ? `Previous pass summary: ${input.lastPassSummary}` : "Previous pass summary: n/a",
      input.visualDiagnostics?.trim()
        ? `Current visual diagnostics: ${input.visualDiagnostics.trim()}`
        : "Current visual diagnostics: n/a",
      "",
      "Current snapshot digest JSON:",
      JSON.stringify(buildStage3PlannerSnapshotDigest(input.snapshot), null, 2),
      "",
      "User instruction:",
      input.prompt.trim() || "No extra instruction",
      "",
      "Output must include a short summary and operations array."
    ].join("\n");

    await runCodexExec({
      prompt,
      imagePaths: input.imagePaths ?? [],
      outputSchemaPath: schemaPath,
      outputMessagePath: outputPath,
      cwd: process.cwd(),
      codexHome: input.codexHome,
      timeoutMs: input.timeoutMs,
      model: input.model,
      reasoningEffort: input.reasoningEffort
    });

    const raw = await fs.readFile(outputPath, "utf-8");
    const parsed = parseJsonBlock(raw);
    const obj = parsed as Record<string, unknown>;
    const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary.trim() : "Planner pass.";
    const operations = normalizeOperations(obj.operations);
    const intent = normalizeIntent(obj.intent);

    return { summary, operations, intent };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
