import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prepareStage3Preview } from "../lib/stage3-preview-service";
import type { Stage3RenderPlan } from "../lib/stage3-agent";
import {
  buildMontageLearningCase,
  buildMontageLearningPlaybook,
  buildMontageLearningQualityReport,
  findMissingCausalReasoningForChangedActions,
  isCanonicalMontagePublication,
  type MontageLearningAnalysis,
  type MontageLearningCase,
  type MontageLearningChannel,
  type MontageLearningFlowDetail,
  type MontageLearningFrameManifest,
  type MontageLearningJsonRecord,
  type MontageLearningPublication
} from "../lib/montage-learning";

const execFileAsync = promisify(execFile);

type CliOptions = {
  appUrl: string;
  outputDir: string;
  limit: number;
  publicationFetchLimit: number;
  frameMode: "attempt" | "metadata";
  analysisMode: "heuristic" | "llm";
  statuses: string[];
};

type OwnerToolResponse = MontageLearningJsonRecord;

function usage(): string {
  return [
    "Usage: npm run montage-learning:export -- [options]",
    "",
    "Options:",
    "  --limit=20                    Number of final cases to export after filtering.",
    "  --publication-fetch-limit=80   Number of recent publication records to inspect.",
    "  --output-dir=.data/...         Output directory for dataset artifacts.",
    "  --app-url=https://...          Clips app URL. Defaults to CLIPS_APP_URL or localhost.",
    "  --frame-mode=attempt|metadata  attempt downloads frames with yt-dlp/ffmpeg; metadata skips downloads.",
    "  --analysis-mode=heuristic|llm  llm uses OPENAI_API_KEY for visual explanation/judge.",
    "  --statuses=published,scheduled,queued,paused",
    "",
    "Required environment:",
    "  CLIPS_MCP_TOKEN                Owner/control token with flow:read scope.",
    "",
    "Optional environment:",
    "  OPENAI_API_KEY                 Required only for --analysis-mode=llm.",
    "  MONTAGE_LEARNING_OPENAI_MODEL  Defaults to gpt-4.1-mini."
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaults: CliOptions = {
    appUrl: (process.env.CLIPS_APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    outputDir: path.join(process.cwd(), ".data", "montage-learning", timestamp),
    limit: 20,
    publicationFetchLimit: 80,
    frameMode: "attempt",
    analysisMode: "heuristic",
    statuses: ["published", "scheduled", "queued", "paused"]
  };
  const options = { ...defaults };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    const [key, value = ""] = arg.split("=", 2);
    if (key === "--limit") {
      options.limit = clampInteger(value, 1, 200, defaults.limit);
    } else if (key === "--publication-fetch-limit") {
      options.publicationFetchLimit = clampInteger(value, 1, 500, defaults.publicationFetchLimit);
    } else if (key === "--output-dir") {
      options.outputDir = path.resolve(value);
    } else if (key === "--app-url") {
      options.appUrl = value.replace(/\/+$/, "");
    } else if (key === "--frame-mode") {
      options.frameMode = value === "metadata" ? "metadata" : "attempt";
    } else if (key === "--analysis-mode") {
      options.analysisMode = value === "llm" ? "llm" : "heuristic";
    } else if (key === "--statuses") {
      options.statuses = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg.trim()) {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }
  return options;
}

function clampInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getMcpToken(): string {
  const token = process.env.CLIPS_MCP_TOKEN?.trim();
  if (!token) {
    throw new Error("CLIPS_MCP_TOKEN is required. The exporter is read-only, but it must use owner/control flow evidence.");
  }
  return token;
}

async function callOwnerTool<T extends OwnerToolResponse>(
  options: CliOptions,
  tool: string,
  input: MontageLearningJsonRecord = {}
): Promise<T> {
  const response = await fetch(`${options.appUrl}/api/admin/control`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getMcpToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ tool, input })
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as OwnerToolResponse) : {};
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(`${tool} failed: ${error}`);
  }
  return payload as T;
}

function isRecord(value: unknown): value is MontageLearningJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePublications(value: unknown): MontageLearningPublication[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is MontageLearningPublication => {
    return (
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.channelId === "string" &&
      typeof item.chatId === "string" &&
      typeof item.status === "string"
    );
  });
}

function normalizeChannels(value: unknown): MontageLearningChannel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is MontageLearningChannel => {
    return isRecord(item) && typeof item.id === "string";
  });
}

function sortPublicationsNewestFirst(
  left: MontageLearningPublication,
  right: MontageLearningPublication
): number {
  return publicationTime(right) - publicationTime(left);
}

function publicationTime(publication: MontageLearningPublication): number {
  const raw = publication.publishedAt ?? publication.updatedAt ?? publication.createdAt ?? "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupePublicationsByChat(publications: MontageLearningPublication[]): MontageLearningPublication[] {
  const seen = new Set<string>();
  const deduped: MontageLearningPublication[] = [];
  for (const publication of publications) {
    const key = `${publication.channelId}:${publication.chatId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(publication);
  }
  return deduped;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${escapeShell(command)} >/dev/null 2>&1`], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function escapeShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function captureFrameManifest(params: {
  caseDir: string;
  sourceUrl: string;
  channelId: string;
  workspaceId?: string | null;
  draftCase: MontageLearningCase;
  finalUrl: string | null;
  finalRenderExportId: string | null;
  finalRenderJobId: string | null;
  frameMode: CliOptions["frameMode"];
  appUrl: string;
}): Promise<MontageLearningFrameManifest> {
  if (params.frameMode === "metadata") {
    return {
      source: { requested: false, count: 0, files: [], status: "not_requested" },
      template_naive: { requested: false, count: 0, files: [], status: "not_requested" },
      final: { requested: false, count: 0, files: [], status: "not_requested" }
    };
  }
  const hasYtDlp = await commandExists("yt-dlp");
  const hasFfmpeg = await commandExists("ffmpeg");
  const hasFfprobe = await commandExists("ffprobe");
  if (!hasYtDlp || !hasFfmpeg || !hasFfprobe) {
    const missing = [
      hasYtDlp ? null : "yt-dlp",
      hasFfmpeg ? null : "ffmpeg",
      hasFfprobe ? null : "ffprobe"
    ].filter(Boolean).join(", ");
    return {
      source: { requested: true, count: 0, files: [], status: "unavailable", error: `missing tools: ${missing}` },
      template_naive: {
        requested: false,
        count: 0,
        files: [],
        status: "not_requested",
        error: "template_naive preview capture is not wired in this exporter mode"
      },
      final: { requested: true, count: 0, files: [], status: "unavailable", error: `missing tools: ${missing}` }
    };
  }

  const source = await captureFramesForUrl({
    url: params.sourceUrl,
    label: "source",
    outDir: path.join(params.caseDir, "source_frames")
  });
  const templateNaive = await captureTemplateNaiveFrames({
    caseDir: params.caseDir,
    sourceUrl: params.sourceUrl,
    channelId: params.channelId,
    workspaceId: params.workspaceId,
    draftCase: params.draftCase
  });
  const finalRenderExportCandidates = [
    params.finalRenderExportId,
    params.finalRenderJobId
  ].filter((value): value is string => Boolean(value?.trim()));
  const final = finalRenderExportCandidates.length > 0
    ? await captureFramesForRenderExports({
        appUrl: params.appUrl,
        renderExportIds: finalRenderExportCandidates,
        outDir: path.join(params.caseDir, "final_frames")
      })
    : params.finalUrl
      ? await captureFramesForUrl({
        url: params.finalUrl,
        label: "final",
        outDir: path.join(params.caseDir, "final_frames")
      })
      : { requested: true as const, count: 0, files: [], status: "unavailable" as const, error: "missing final render export/url" };
  return {
    source,
    template_naive: templateNaive,
    final
  };
}

async function captureFramesForRenderExports(params: {
  appUrl: string;
  renderExportIds: string[];
  outDir: string;
}): Promise<MontageLearningFrameManifest["final"]> {
  const ids = params.renderExportIds.map((item) => item.trim()).filter(Boolean);
  if (ids.length === 0) {
    return { requested: true, count: 0, files: [], status: "unavailable", error: "missing render export/job id" };
  }
  await fs.mkdir(params.outDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-montage-final-export-"));
  const mediaPath = path.join(tempDir, "final.mp4");
  const errors: string[] = [];
  try {
    for (const id of ids) {
      try {
        const response = await fetch(`${params.appUrl}/api/admin/render-exports/${encodeURIComponent(id)}`, {
          headers: {
            Authorization: `Bearer ${getMcpToken()}`,
            Accept: "video/mp4,application/octet-stream,*/*"
          }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length < 1024) {
          throw new Error("response was too small to be an mp4 artifact");
        }
        await fs.writeFile(mediaPath, body);
        return await captureFramesFromMediaPath({
          mediaPath,
          label: "final",
          outDir: params.outDir
        });
      } catch (error) {
        errors.push(`${id}: ${sanitizeError(error)}`);
      }
    }
    throw new Error(`render export download failed for all candidates: ${errors.join("; ")}`);
  } catch (error) {
    return {
      requested: true,
      count: 0,
      files: [],
      status: "unavailable",
      error: sanitizeError(error)
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function captureFramesForUrl(params: {
  url: string;
  label: "source" | "final";
  outDir: string;
}): Promise<MontageLearningFrameManifest["source"]> {
  if (!params.url.trim()) {
    return { requested: true, count: 0, files: [], status: "unavailable", error: "missing url" };
  }
  await fs.mkdir(params.outDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `clips-montage-${params.label}-`));
  const mediaPath = path.join(tempDir, `${params.label}.mp4`);
  try {
    await execFileAsync(
      "yt-dlp",
      [
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "--merge-output-format",
        "mp4",
        "-f",
        "bv*+ba/b",
        "-o",
        mediaPath,
        params.url
      ],
      { timeout: 240_000, maxBuffer: 1024 * 1024 * 8 }
    );
    if (!existsSync(mediaPath)) {
      throw new Error("download did not create an mp4 artifact");
    }
    const duration = await probeDuration(mediaPath);
    const times = sampleTimes(duration);
    const files: string[] = [];
    for (let index = 0; index < times.length; index += 1) {
      const filePath = path.join(params.outDir, `${String(index + 1).padStart(2, "0")}-${params.label}.png`);
      await execFileAsync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(times[index]),
          "-i",
          mediaPath,
          "-frames:v",
          "1",
          filePath
        ],
        { timeout: 60_000, maxBuffer: 1024 * 1024 * 4 }
      );
      files.push(filePath);
    }
    return { requested: true, count: files.length, files, status: "available" };
  } catch (error) {
    return {
      requested: true,
      count: 0,
      files: [],
      status: "unavailable",
      error: sanitizeError(error)
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function captureTemplateNaiveFrames(params: {
  caseDir: string;
  sourceUrl: string;
  channelId: string;
  workspaceId?: string | null;
  draftCase: MontageLearningCase;
}): Promise<MontageLearningFrameManifest["template_naive"]> {
  const outDir = path.join(params.caseDir, "template_naive_frames");
  await fs.mkdir(outDir, { recursive: true });
  try {
    const prepared = await prepareStage3Preview({
      sourceUrl: params.sourceUrl,
      channelId: params.channelId,
      workspaceId: params.workspaceId ?? undefined,
      clipStartSec: params.draftCase.final_render_plan_effective.clipStartSec,
      clipDurationSec:
        params.draftCase.final_render_plan_effective.clipDurationSec ??
        params.draftCase.final_render_plan_effective.targetDurationSec ??
        undefined,
      renderPlan: buildTemplateNaiveRenderPlan(params.draftCase)
    }, {
      waitTimeoutMs: 120_000
    });
    return await captureFramesFromMediaPath({
      mediaPath: prepared.filePath,
      label: "template-naive",
      outDir
    });
  } catch (error) {
    return {
      requested: true,
      count: 0,
      files: [],
      status: "unavailable",
      error: sanitizeError(error)
    };
  }
}

function buildTemplateNaiveRenderPlan(caseItem: MontageLearningCase): Partial<Stage3RenderPlan> {
  const raw = { ...caseItem.final_render_plan_raw };
  delete raw.sourceCrop;
  delete raw.segments;
  delete raw.cameraKeyframes;
  delete raw.cameraPositionKeyframes;
  delete raw.cameraScaleKeyframes;
  raw.focusX = 0.5;
  raw.videoZoom = 1;
  raw.videoFit = "cover";
  raw.videoScaleX = null;
  raw.videoScaleY = null;
  raw.mirrorEnabled = false;
  raw.cameraMotion = "disabled";
  raw.normalizeToTargetEnabled = false;
  raw.timingMode = "auto";
  if (caseItem.final_render_plan_effective.templateId) {
    raw.templateId = caseItem.final_render_plan_effective.templateId;
  }
  if (caseItem.final_render_plan_effective.targetDurationSec !== null) {
    raw.targetDurationSec = caseItem.final_render_plan_effective.targetDurationSec;
  }
  return raw as Partial<Stage3RenderPlan>;
}

async function probeDuration(mediaPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        mediaPath
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

async function captureFramesFromMediaPath(params: {
  mediaPath: string;
  label: "source" | "final" | "template-naive";
  outDir: string;
}): Promise<MontageLearningFrameManifest["source"]> {
  const duration = await probeDuration(params.mediaPath);
  const times = sampleTimes(duration);
  const files: string[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const filePath = path.join(params.outDir, `${String(index + 1).padStart(2, "0")}-${params.label}.png`);
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(times[index]),
        "-i",
        params.mediaPath,
        "-frames:v",
        "1",
        filePath
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 4 }
    );
    files.push(filePath);
  }
  return { requested: true, count: files.length, files, status: "available" };
}


function sampleTimes(duration: number | null): number[] {
  if (duration && duration > 3) {
    return [
      Math.max(0, duration * 0.12),
      Math.max(0, duration * 0.5),
      Math.max(0, duration * 0.88)
    ].map((value) => Number(value.toFixed(3)));
  }
  return [0, 1, 2];
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]").slice(0, 500);
}

async function maybeRunLlmAnalysis(caseItem: MontageLearningCase): Promise<MontageLearningAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ...caseItem.analysis,
      judge_verdict: {
        status: "NEEDS_LLM_REVIEW",
        provider: "llm",
        reasons: ["OPENAI_API_KEY is not set, so visual LLM analysis was not run."]
      }
    };
  }

  const prompt = [
    "You are building a montage-learning dataset for a future LLM video editor.",
    "Return strict JSON matching these top-level fields:",
    "case_id, channel_id, chat_id, source_url, final_render_plan_raw, final_render_plan_effective, visual_before_after_summary, editing_intent_labels, parameter_reasoning, causal_edits, tradeoffs, reusable_lessons, judge_verdict.",
    "Each causal_edits item must include: parameter_or_action, before_observation, problem_class, change_applied, after_observation, intent, tradeoff, reusable_rule, evidence_frames.",
    "Judge requirements: do not invent visual reasons; distinguish donor/provenance UI from source-native context; PASS only when source_raw, template_naive, and final_edited evidence supports each causal lesson.",
    "Case JSON:",
    JSON.stringify({
      case_id: caseItem.case_id,
      channel_id: caseItem.channel_id,
      chat_id: caseItem.chat_id,
      source_url: caseItem.source.source_url,
      final_render_plan_raw: caseItem.final_render_plan_raw,
      final_render_plan_effective: caseItem.final_render_plan_effective,
      params: caseItem.params,
      states: caseItem.states,
      frame_manifest: caseItem.frame_manifest
    }, null, 2)
  ].join("\n\n");
  const imageInputs = await buildOpenAiImageInputs([
    ...caseItem.source.sampled_source_frames.slice(0, 3),
    ...caseItem.states.template_naive.sampled_frames.slice(0, 3),
    ...caseItem.final.sampled_final_frames.slice(0, 3)
  ]);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.MONTAGE_LEARNING_OPENAI_MODEL?.trim() || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...imageInputs
          ]
        }
      ],
      temperature: 0.1
    })
  });
  const body = (await response.json()) as MontageLearningJsonRecord;
  if (!response.ok) {
    throw new Error(`OpenAI analysis failed: ${typeof body.error === "string" ? body.error : response.status}`);
  }
  const text = extractOpenAiOutputText(body);
  const parsed = JSON.parse(text) as Partial<MontageLearningAnalysis>;
  return normalizeLlmAnalysis(caseItem, parsed);
}

async function buildOpenAiImageInputs(files: string[]): Promise<Array<{ type: "input_image"; image_url: string }>> {
  const inputs: Array<{ type: "input_image"; image_url: string }> = [];
  for (const file of files) {
    try {
      const data = await fs.readFile(file);
      inputs.push({
        type: "input_image",
        image_url: `data:image/png;base64,${data.toString("base64")}`
      });
    } catch {
      // Missing frame files should not abort the whole export; the judge can see the manifest.
    }
  }
  return inputs;
}

function extractOpenAiOutputText(body: MontageLearningJsonRecord): string {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }
  const output = Array.isArray(body.output) ? body.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }
  return text;
}

function normalizeLlmAnalysis(
  caseItem: MontageLearningCase,
  parsed: Partial<MontageLearningAnalysis>
): MontageLearningAnalysis {
  const status = parsed.judge_verdict?.status === "PASS" ? "PASS" : parsed.judge_verdict?.status === "REJECT" ? "REJECT" : "NEEDS_VISUAL_REVIEW";
  return {
    case_id: caseItem.case_id,
    channel_id: caseItem.channel_id,
    chat_id: caseItem.chat_id,
    source_url: caseItem.source.source_url,
    final_render_plan_raw: caseItem.final_render_plan_raw,
    final_render_plan_effective: caseItem.final_render_plan_effective,
    visual_before_after_summary:
      typeof parsed.visual_before_after_summary === "string"
        ? parsed.visual_before_after_summary
        : caseItem.analysis.visual_before_after_summary,
    editing_intent_labels: Array.isArray(parsed.editing_intent_labels)
      ? parsed.editing_intent_labels.filter((item): item is string => typeof item === "string")
      : caseItem.analysis.editing_intent_labels,
    parameter_reasoning: isRecord(parsed.parameter_reasoning)
      ? Object.fromEntries(
          Object.entries(parsed.parameter_reasoning).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        )
      : caseItem.analysis.parameter_reasoning,
    causal_edits: normalizeLlmCausalEdits(caseItem, parsed.causal_edits),
    tradeoffs: Array.isArray(parsed.tradeoffs)
      ? parsed.tradeoffs.filter((item): item is string => typeof item === "string")
      : caseItem.analysis.tradeoffs,
    reusable_lessons: Array.isArray(parsed.reusable_lessons)
      ? parsed.reusable_lessons.filter((item): item is string => typeof item === "string")
      : caseItem.analysis.reusable_lessons,
    judge_verdict: {
      status,
      provider: "llm",
      reasons: Array.isArray(parsed.judge_verdict?.reasons)
        ? parsed.judge_verdict.reasons.filter((item): item is string => typeof item === "string")
        : [`LLM returned ${status}.`]
    }
  };
}

function normalizeProblemClass(value: unknown): string {
  const allowed = new Set([
    "donor_provenance",
    "source_context_preservation",
    "overzoom_risk",
    "action_off_center",
    "dead_canvas",
    "landscape_strip",
    "source_context_loss",
    "clip_window_choice",
    "template_fit",
    "source_readability",
    "unknown"
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeEvidenceFrames(
  caseItem: MontageLearningCase,
  value: unknown
): MontageLearningAnalysis["causal_edits"][number]["evidence_frames"] {
  const candidate = isRecord(value) ? value : {};
  return {
    source_raw: stringArray(candidate.source_raw).length
      ? stringArray(candidate.source_raw)
      : caseItem.states.source_raw.sampled_frames,
    template_naive: stringArray(candidate.template_naive).length
      ? stringArray(candidate.template_naive)
      : caseItem.states.template_naive.sampled_frames,
    final_edited: stringArray(candidate.final_edited).length
      ? stringArray(candidate.final_edited)
      : caseItem.states.final_edited.sampled_frames
  };
}

function normalizeLlmCausalEdits(
  caseItem: MontageLearningCase,
  value: unknown
): MontageLearningAnalysis["causal_edits"] {
  if (!Array.isArray(value)) {
    return caseItem.analysis.causal_edits;
  }
  return value
    .filter(isRecord)
    .map((item) => ({
      parameter_or_action: typeof item.parameter_or_action === "string" ? item.parameter_or_action : "unknown",
      before_observation: typeof item.before_observation === "string" ? item.before_observation : "",
      problem_class: normalizeProblemClass(item.problem_class) as MontageLearningAnalysis["causal_edits"][number]["problem_class"],
      change_applied: typeof item.change_applied === "string" ? item.change_applied : "",
      after_observation: typeof item.after_observation === "string" ? item.after_observation : "",
      intent: typeof item.intent === "string" ? item.intent : "",
      tradeoff: typeof item.tradeoff === "string" ? item.tradeoff : "",
      reusable_rule: typeof item.reusable_rule === "string" ? item.reusable_rule : "",
      evidence_frames: normalizeEvidenceFrames(caseItem, item.evidence_frames)
    }))
    .filter((item) =>
      item.parameter_or_action.trim() &&
      item.before_observation.trim() &&
      item.change_applied.trim() &&
      item.after_observation.trim() &&
      item.intent.trim() &&
      item.reusable_rule.trim()
    );
}

function applyAnalysis(caseItem: MontageLearningCase, analysis: MontageLearningAnalysis): MontageLearningCase {
  const exclusionReasons = caseItem.exclusion_reasons.filter((reason) =>
    reason !== "judge_not_passed" &&
    reason !== "causal_edits_missing" &&
    !reason.startsWith("missing_causal_reasoning:")
  );
  if (analysis.judge_verdict.status !== "PASS") {
    exclusionReasons.push("judge_not_passed");
  }
  if (analysis.causal_edits.length === 0) {
    exclusionReasons.push("causal_edits_missing");
  }
  for (const action of findMissingCausalReasoningForChangedActions(
    caseItem.final_render_plan_effective,
    analysis.causal_edits
  )) {
    exclusionReasons.push(`missing_causal_reasoning:${action}`);
  }
  const cleanTrainingCandidate = exclusionReasons.length === 0;
  const trainingSplit =
    analysis.judge_verdict.status === "REJECT" ||
    exclusionReasons.some((reason) => reason.startsWith("publication_status:") || reason.startsWith("stage3_job_status:failed"))
      ? "negative"
      : cleanTrainingCandidate
        ? "clean"
        : "candidate";
  return {
    ...caseItem,
    analysis,
    exclusion_reasons: exclusionReasons,
    clean_training_candidate: cleanTrainingCandidate,
    training_split: trainingSplit
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });

  const channelsResponse = await callOwnerTool<{ channels?: unknown[] }>(options, "clips_owner_list_channels", {
    includeArchived: false
  });
  const channels = normalizeChannels(channelsResponse.channels);
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  const publicationsResponse = await callOwnerTool<{ publications?: unknown[] }>(
    options,
    "clips_owner_list_publications",
    { limit: options.publicationFetchLimit }
  );
  const allowedStatuses = new Set(options.statuses);
  const publications = dedupePublicationsByChat(
    normalizePublications(publicationsResponse.publications)
      .filter((publication) => allowedStatuses.has(publication.status))
      .filter((publication) => isCanonicalMontagePublication(publication))
      .sort(sortPublicationsNewestFirst)
  ).slice(0, options.limit);

  const cases: MontageLearningCase[] = [];
  const errors: Array<{ publicationId: string; chatId: string; error: string }> = [];

  for (const publication of publications) {
    try {
      const flow = await callOwnerTool<MontageLearningFlowDetail>(options, "clips_owner_get_flow", {
        chatId: publication.chatId
      });
      const draftCase = buildMontageLearningCase({
        publication,
        flow,
        channel: channelsById.get(publication.channelId) ?? null
      });
      const caseDir = path.join(options.outputDir, "cases", draftCase.case_id);
      const frameManifest = await captureFrameManifest({
        caseDir,
        sourceUrl: draftCase.source.source_url,
        channelId: publication.channelId,
        workspaceId: publication.workspaceId,
        draftCase,
        finalUrl: draftCase.outcome.artifact_refs.youtube_video_url ?? null,
        finalRenderExportId: draftCase.final.render_export_id ?? null,
        finalRenderJobId: draftCase.final.stage3_job_id ?? null,
        appUrl: options.appUrl,
        frameMode: options.frameMode
      });
      let caseItem = buildMontageLearningCase({
        publication,
        flow,
        channel: channelsById.get(publication.channelId) ?? null,
        frameManifest
      });
      if (options.analysisMode === "llm") {
        caseItem = applyAnalysis(caseItem, await maybeRunLlmAnalysis(caseItem));
      }
      cases.push(caseItem);
      await writeJson(path.join(caseDir, "analysis.json"), caseItem.analysis);
      await writeJson(path.join(caseDir, "case.json"), caseItem);
    } catch (error) {
      errors.push({
        publicationId: publication.id,
        chatId: publication.chatId,
        error: sanitizeError(error)
      });
    }
  }

  const datasetJsonl = cases.map((item) => JSON.stringify(item)).join("\n");
  await writeText(path.join(options.outputDir, "dataset.jsonl"), datasetJsonl);
  await writeText(path.join(options.outputDir, "dataset.v2.jsonl"), datasetJsonl);
  await writeText(path.join(options.outputDir, "playbook.md"), buildMontageLearningPlaybook(cases));
  await writeText(path.join(options.outputDir, "playbook.v2.md"), buildMontageLearningPlaybook(cases));
  const qualityReport = {
    ...buildMontageLearningQualityReport(cases),
    errors,
    options: {
      appUrl: options.appUrl,
      limit: options.limit,
      publicationFetchLimit: options.publicationFetchLimit,
      frameMode: options.frameMode,
      analysisMode: options.analysisMode,
      statuses: options.statuses
    }
  };
  await writeJson(path.join(options.outputDir, "quality_report.json"), qualityReport);
  await writeJson(path.join(options.outputDir, "quality_report.v2.json"), qualityReport);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir: options.outputDir,
        cases: cases.length,
        cleanTrainingCases: cases.filter((item) => item.clean_training_candidate).length,
        errors: errors.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
});
