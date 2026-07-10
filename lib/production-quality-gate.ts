import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  detectStage3BlankFlashFrames,
  parseStage3SignalStats
} from "./stage3-video-flash-guard";
import { PROJECT_KINGS_PRODUCTION_QUALITY_POLICY } from "./project-kings/production-quality-policy";

const execFileAsync = promisify(execFile);

export type ProductionArtifactBinding = {
  channelId: string;
  sourceSha256: string;
  previewSha256: string;
  templateSha256: string;
  settingsSha256: string;
};

export type ProductionDefectSeverity = "critical" | "major" | "minor";

export type ProductionDefectCode =
  | "artifact_hash_mismatch"
  | "source_hash_mismatch"
  | "preview_approval_stale"
  | "wrong_channel"
  | "wrong_template"
  | "corrupt_mp4"
  | "wrong_container"
  | "wrong_video_codec"
  | "wrong_resolution"
  | "wrong_duration"
  | "missing_audio"
  | "flash_frame"
  | "concept_mismatch"
  | "duplicate_video"
  | "duplicate_event"
  | "missing_hook"
  | "missing_action"
  | "missing_payoff"
  | "donor_ui"
  | "cta"
  | "handle"
  | "watermark"
  | "foreign_captions"
  | "main_event_lost"
  | "unsafe_crop"
  | "factual_claim_unverified"
  | "banned_word"
  | "vision_deterministic_disagreement";

export type ProductionQualityDefect = {
  code: ProductionDefectCode;
  severity: ProductionDefectSeverity;
  message: string;
  frameIndexes?: number[];
};

export type FinalMp4Probe = {
  artifactSha256: string;
  fullyDecodable: boolean;
  decodeError: string | null;
  container: string | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  audioStreamCount: number;
  flashFrameIndexes: number[];
};

export type FinalMp4Expectations = {
  artifactSha256?: string | null;
  width: number;
  height: number;
  durationSec: number;
  durationToleranceSec?: number;
  videoCodec?: string;
  requireAudio?: boolean;
};

export type ProductionVisionVerdict = {
  decision: "PASS" | "FAIL";
  channelId: string;
  templateSha256: string;
  conceptMatch: boolean;
  duplicateVideo: boolean;
  duplicateEvent: boolean;
  hookPresent: boolean;
  actionPresent: boolean;
  payoffPresent: boolean;
  donorUiVisible: boolean;
  ctaVisible: boolean;
  handleVisible: boolean;
  watermarkVisible: boolean;
  foreignCaptionsVisible: boolean;
  mainEventPreserved: boolean;
  cropSafe: boolean;
  factualClaimsVerified: boolean;
  bannedWordsPresent: boolean;
  defects: ProductionQualityDefect[];
};

export type ProductionQualityGateVerdict = {
  decision: "PASS" | "FAIL";
  artifactSha256: string;
  approvalBindingSha256: string;
  defects: ProductionQualityDefect[];
  deterministicDefects: ProductionQualityDefect[];
  visionDefects: ProductionQualityDefect[];
  deterministicPass: boolean;
  visionPass: boolean;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function buildProductionArtifactBindingSha256(binding: ProductionArtifactBinding): string {
  return sha256Text(JSON.stringify(canonicalize(binding)));
}

function normalizeProbeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function probeFinalProductionMp4(
  filePath: string,
  options: {
    ffprobePath?: string;
    ffmpegPath?: string;
    timeoutMs?: number;
  } = {}
): Promise<FinalMp4Probe> {
  const ffprobePath = options.ffprobePath ?? "ffprobe";
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const timeoutMs = options.timeoutMs ?? 3 * 60_000;
  const artifactSha256 = await sha256File(filePath);

  let probe: {
    format?: { format_name?: string; duration?: string | number };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string | number;
    }>;
  } = {};
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
    );
    probe = JSON.parse(stdout) as typeof probe;
  } catch (error) {
    return {
      artifactSha256,
      fullyDecodable: false,
      decodeError: error instanceof Error ? error.message : String(error),
      container: null,
      videoCodec: null,
      width: null,
      height: null,
      durationSec: null,
      audioStreamCount: 0,
      flashFrameIndexes: []
    };
  }

  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audioStreamCount = probe.streams?.filter((stream) => stream.codec_type === "audio").length ?? 0;
  let fullyDecodable = true;
  let decodeError: string | null = null;
  try {
    await execFileAsync(
      ffmpegPath,
      ["-v", "error", "-i", filePath, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
    );
  } catch (error) {
    fullyDecodable = false;
    decodeError = error instanceof Error ? error.message : String(error);
  }

  let flashFrameIndexes: number[] = [];
  if (fullyDecodable) {
    try {
      const { stdout } = await execFileAsync(
        ffmpegPath,
        [
          "-v",
          "error",
          "-i",
          filePath,
          "-vf",
          "scale=96:-2:flags=bilinear,signalstats,metadata=mode=print:file=-",
          "-an",
          "-f",
          "null",
          "-"
        ],
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }
      );
      const frames = parseStage3SignalStats(stdout);
      if (!frames.length) {
        fullyDecodable = false;
        decodeError = "Flash scan returned no frames.";
      } else {
        flashFrameIndexes = detectStage3BlankFlashFrames({ fullFrameStats: frames });
      }
    } catch (error) {
      fullyDecodable = false;
      decodeError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    artifactSha256,
    fullyDecodable,
    decodeError,
    container: probe.format?.format_name ?? null,
    videoCodec: video?.codec_name ?? null,
    width: normalizeProbeNumber(video?.width),
    height: normalizeProbeNumber(video?.height),
    durationSec: normalizeProbeNumber(probe.format?.duration ?? video?.duration),
    audioStreamCount,
    flashFrameIndexes
  };
}

function pushDefect(
  defects: ProductionQualityDefect[],
  code: ProductionDefectCode,
  severity: ProductionDefectSeverity,
  message: string,
  frameIndexes?: number[]
): void {
  defects.push({ code, severity, message, ...(frameIndexes?.length ? { frameIndexes } : {}) });
}

export function evaluateFinalProductionMp4(
  probe: FinalMp4Probe,
  expectations: FinalMp4Expectations
): ProductionQualityDefect[] {
  const defects: ProductionQualityDefect[] = [];
  if (expectations.artifactSha256 && probe.artifactSha256 !== expectations.artifactSha256) {
    pushDefect(defects, "artifact_hash_mismatch", "critical", "Final artifact hash differs from the approved artifact.");
  }
  if (!probe.fullyDecodable) {
    pushDefect(defects, "corrupt_mp4", "critical", probe.decodeError || "Final MP4 does not fully decode.");
  }
  if (
    !probe.container?.split(",").some((entry) =>
      PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.deterministicFinalArtifact.allowedContainers.includes(
        entry as "mp4" | "mov"
      )
    )
  ) {
    pushDefect(defects, "wrong_container", "critical", `Expected MP4/MOV container, got ${probe.container ?? "unknown"}.`);
  }
  const expectedCodec =
    expectations.videoCodec ??
    PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.deterministicFinalArtifact.videoCodec;
  if (probe.videoCodec !== expectedCodec) {
    pushDefect(defects, "wrong_video_codec", "critical", `Expected ${expectedCodec}, got ${probe.videoCodec ?? "unknown"}.`);
  }
  if (probe.width !== expectations.width || probe.height !== expectations.height) {
    pushDefect(
      defects,
      "wrong_resolution",
      "critical",
      `Expected ${expectations.width}x${expectations.height}, got ${probe.width ?? "?"}x${probe.height ?? "?"}.`
    );
  }
  const tolerance =
    expectations.durationToleranceSec ??
    PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.deterministicFinalArtifact.durationToleranceSec;
  if (
    probe.durationSec === null ||
    Math.abs(probe.durationSec - expectations.durationSec) > tolerance
  ) {
    pushDefect(
      defects,
      "wrong_duration",
      "major",
      `Expected ${expectations.durationSec}s ±${tolerance}s, got ${probe.durationSec ?? "unknown"}s.`
    );
  }
  if (
    (expectations.requireAudio ??
      PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.deterministicFinalArtifact.audioRequired) &&
    probe.audioStreamCount < 1
  ) {
    pushDefect(defects, "missing_audio", "critical", "Final MP4 has no audio stream.");
  }
  if (probe.flashFrameIndexes.length) {
    pushDefect(
      defects,
      "flash_frame",
      "critical",
      "Blank flash frames were detected in the final MP4.",
      probe.flashFrameIndexes
    );
  }
  return defects;
}

function deriveVisionDefects(
  vision: ProductionVisionVerdict,
  expected: Pick<ProductionArtifactBinding, "channelId" | "templateSha256">
): ProductionQualityDefect[] {
  const defects = [...vision.defects];
  if (vision.channelId !== expected.channelId) {
    pushDefect(defects, "wrong_channel", "critical", "Vision QA saw a different channel identity.");
  }
  if (vision.templateSha256 !== expected.templateSha256) {
    pushDefect(defects, "wrong_template", "critical", "Vision QA saw a different template snapshot.");
  }
  if (!vision.conceptMatch) pushDefect(defects, "concept_mismatch", "critical", "Source does not match the channel concept.");
  if (vision.duplicateVideo) pushDefect(defects, "duplicate_video", "major", "The same video was already used.");
  if (vision.duplicateEvent) pushDefect(defects, "duplicate_event", "major", "The same event was already used.");
  if (!vision.hookPresent) pushDefect(defects, "missing_hook", "major", "Hook is missing.");
  if (!vision.actionPresent) pushDefect(defects, "missing_action", "major", "Action is missing.");
  if (!vision.payoffPresent) pushDefect(defects, "missing_payoff", "major", "Payoff is missing.");
  if (vision.donorUiVisible) pushDefect(defects, "donor_ui", "critical", "Donor UI is visible.");
  if (vision.ctaVisible) pushDefect(defects, "cta", "critical", "Donor CTA is visible.");
  if (vision.handleVisible) pushDefect(defects, "handle", "critical", "Donor handle is visible.");
  if (vision.watermarkVisible) pushDefect(defects, "watermark", "critical", "Donor watermark is visible.");
  if (vision.foreignCaptionsVisible) pushDefect(defects, "foreign_captions", "critical", "Foreign captions are visible.");
  if (!vision.mainEventPreserved) pushDefect(defects, "main_event_lost", "critical", "The main event is lost.");
  if (!vision.cropSafe) pushDefect(defects, "unsafe_crop", "critical", "Crop removes important action.");
  if (!vision.factualClaimsVerified) pushDefect(defects, "factual_claim_unverified", "critical", "A factual claim is unverified.");
  if (vision.bannedWordsPresent) pushDefect(defects, "banned_word", "major", "Banned words are present.");
  return defects;
}

function uniqueDefects(defects: ProductionQualityDefect[]): ProductionQualityDefect[] {
  const seen = new Set<string>();
  return defects.filter((defect) => {
    const key = `${defect.code}:${defect.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evaluateProductionQualityGate(input: {
  binding: ProductionArtifactBinding;
  recordedApprovalBindingSha256: string;
  finalProbe: FinalMp4Probe;
  finalExpectations: FinalMp4Expectations;
  vision: ProductionVisionVerdict;
  deterministicDefects?: ProductionQualityDefect[];
}): ProductionQualityGateVerdict {
  const expectedBinding = buildProductionArtifactBindingSha256(input.binding);
  const deterministicDefects = [
    ...evaluateFinalProductionMp4(input.finalProbe, input.finalExpectations),
    ...(input.deterministicDefects ?? [])
  ];
  if (input.recordedApprovalBindingSha256 !== expectedBinding) {
    pushDefect(
      deterministicDefects,
      "preview_approval_stale",
      "critical",
      "Approval does not bind the exact source, preview, template and settings hashes."
    );
  }
  const visionDefects = deriveVisionDefects(input.vision, input.binding);
  const deterministicPass = deterministicDefects.length === 0;
  const visionPass = input.vision.decision === "PASS" && visionDefects.length === 0;
  const defects = uniqueDefects([...deterministicDefects, ...visionDefects]);
  if (deterministicPass !== visionPass) {
    pushDefect(
      defects,
      "vision_deterministic_disagreement",
      "critical",
      "Deterministic checks and independent Vision QA disagree; fail closed."
    );
  }
  return {
    decision: deterministicPass && visionPass ? "PASS" : "FAIL",
    artifactSha256: input.finalProbe.artifactSha256,
    approvalBindingSha256: expectedBinding,
    defects: uniqueDefects(defects),
    deterministicDefects: uniqueDefects(deterministicDefects),
    visionDefects: uniqueDefects(visionDefects),
    deterministicPass,
    visionPass
  };
}

export type ProductionRevisionDecision =
  | { action: "deterministic_repair"; resumeState: "brief_ready"; reason: string }
  | { action: "targeted_regenerate"; resumeState: "brief_ready"; reason: string }
  | { action: "targeted_visual_revision"; resumeState: "preview_ready"; reason: string }
  | { action: "replace_source"; reason: string }
  | { action: "quarantine_source"; reason: string };

const TEXT_DEFECTS = new Set<ProductionDefectCode>([
  "factual_claim_unverified",
  "banned_word",
  "missing_hook",
  "missing_action",
  "missing_payoff"
]);

const UNSAFE_SOURCE_DEFECTS = new Set<ProductionDefectCode>([
  "concept_mismatch",
  "donor_ui",
  "cta",
  "handle",
  "watermark",
  "foreign_captions"
]);

export function decideProductionRevision(input: {
  defects: ProductionQualityDefect[];
  totalAttempts: number;
  textAttempts: number;
  visualAttempts: number;
}): ProductionRevisionDecision {
  const codes = new Set(input.defects.map((defect) => defect.code));
  if ([...codes].some((code) => UNSAFE_SOURCE_DEFECTS.has(code))) {
    return { action: "quarantine_source", reason: "Unsafe source-level defect cannot pass through revision." };
  }
  if (
    input.totalAttempts >=
    PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.revisions.maximumTotalAttempts
  ) {
    return { action: "replace_source", reason: "Absolute five-attempt limit reached." };
  }
  if ([...codes].some((code) => TEXT_DEFECTS.has(code))) {
    if (input.textAttempts === 0) {
      return { action: "deterministic_repair", resumeState: "brief_ready", reason: "Repair deterministic text defect." };
    }
    if (input.textAttempts === 1) {
      return { action: "targeted_regenerate", resumeState: "brief_ready", reason: "One targeted text regeneration is allowed." };
    }
    return { action: "replace_source", reason: "Text repair budget exhausted." };
  }
  if (
    input.visualAttempts <
    PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.revisions.maximumVisualRevisions
  ) {
    return {
      action: "targeted_visual_revision",
      resumeState: "preview_ready",
      reason: "Apply a targeted visual revision tied to the structured defect."
    };
  }
  return { action: "replace_source", reason: "Three targeted visual revisions failed." };
}
