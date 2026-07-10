import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import sourcePolicyModule from "../lib/project-kings/source-rights-sensitive-policy";

const {
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} = sourcePolicyModule;

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_OUTPUT_ROOT = path.join(
  REPO_ROOT,
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1"
);
const FRAME_RATIOS = [0.06, 0.235, 0.41, 0.59, 0.765, 0.94] as const;
const DATASET_SCHEMA_VERSION = "project-kings-source-policy-dataset-v1" as const;
const ANNOTATION_SCHEMA_VERSION = "project-kings-source-policy-annotations-v1" as const;

type ProfileKey = "dark-joy-boy" | "light-kingdom" | "copscopes-x2e";
type SensitiveSignal = "absent" | "present" | "unknown";
type SensitiveSignals = Readonly<{
  graphicViolence: SensitiveSignal;
  unsupportedAllegation: SensitiveSignal;
  minorInSensitiveIncident: SensitiveSignal;
  realisticPoliticalOrPublicFigureDeepfake: SensitiveSignal;
}>;

type SourceCase = Readonly<{
  caseId: string;
  profileKey: ProfileKey;
  channelId: string;
  profileVersion: string;
  sourceUrl: string;
  mediaRelativePath: string;
}>;

type ReviewedAnnotation = Readonly<{
  caseId: string;
  signals: SensitiveSignals;
  reason: string;
}>;

const PROFILE_VERSION = "channel-production-profile-v1";
const SELECTED_CASES: readonly SourceCase[] = [
  ...[
    "BtDnmx6HRr_",
    "C-0YpsCAODv",
    "C9gLu79MklN",
    "CsYa4skNBjP",
    "Cw_QTMmA69_",
    "Cxb0DmpJ7oM",
    "DIUYX9QStl3",
    "DKM66d2tamf"
  ].map((sourceId) => ({
    caseId: `dark-instagram-${sourceId}`,
    profileKey: "dark-joy-boy" as const,
    channelId: "UCwO37rtHMhHX8caUr5Rc0Bw",
    profileVersion: PROFILE_VERSION,
    sourceUrl: `https://www.instagram.com/reel/${sourceId}/`,
    mediaRelativePath: `.data/project-kings/source-candidates/dark/instagram/${sourceId}.mp4`
  })),
  ...[
    "DW0w8RMjY3Y",
    "DW5s3qoDbHC",
    "DWjH5fWjBnt",
    "DWnxlyIDcoK",
    "DWwSVVOjMqO",
    "DXBhsJPjSgW",
    "DXHx529DVb0",
    "DXNBoz7jYmd",
    "DXOzkCdjMue",
    "DXUPExpjCs2"
  ].map((sourceId) => ({
    caseId: `cop-instagram-${sourceId}`,
    profileKey: "copscopes-x2e" as const,
    channelId: "UCJhBMXXQ5GrTbrhqjwT1leg",
    profileVersion: PROFILE_VERSION,
    sourceUrl: `https://www.instagram.com/reel/${sourceId}/`,
    mediaRelativePath: `.data/project-kings/source-candidates/cop/instagram/${sourceId}.mp4`
  })),
  ...[
    "1diIRo4sHtk",
    "6IlkA1MLVYA",
    "6QIdqyFoxFE",
    "BwIaEb5vGDo",
    "EYkw1ELHXq0",
    "J6tw2l128YE",
    "V-xIvJs0Jbo",
    "WkEyab1jINA",
    "XPKBwhDPxk0",
    "fj6CXk2KTIs",
    "n9kD935iROw",
    "oA7rziyGv8s"
  ].map((sourceId) => ({
    caseId: `light-youtube-${sourceId}`,
    profileKey: "light-kingdom" as const,
    channelId: "UC0LWZYpYuYAWK55WmvDqxbg",
    profileVersion: PROFILE_VERSION,
    sourceUrl: `https://www.youtube.com/shorts/${sourceId}`,
    mediaRelativePath: `.data/project-kings/source-candidates/light/ask-v3/${sourceId}.mp4`
  }))
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || "unknown";
}

function frozenPath(filePath: string): string {
  const relative = path.relative(REPO_ROOT, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join(path.posix.sep)
    : filePath;
}

async function toolVersion(command: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return firstLine(`${result.stdout}${result.stderr}`);
}

async function runBounded<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      await worker(values[index]!, index);
    }
  });
  await Promise.all(runners);
}

function parseArgs(): { outputRoot: string; annotationsPath: string | null } {
  let outputRoot = DEFAULT_OUTPUT_ROOT;
  let annotationsPath: string | null = null;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--output-root") {
      outputRoot = path.resolve(process.argv[++index] ?? "");
    } else if (argument === "--annotations") {
      annotationsPath = path.resolve(process.argv[++index] ?? "");
    } else {
      throw new Error(`Unknown argument ${argument}.`);
    }
  }
  return { outputRoot, annotationsPath };
}

function assertReviewedAnnotation(value: unknown, index: number): ReviewedAnnotation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`annotations[${index}] must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const caseId = typeof record.caseId === "string" ? record.caseId.trim() : "";
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!caseId || !reason) throw new Error(`annotations[${index}] requires caseId and reason.`);
  if (!record.signals || typeof record.signals !== "object" || Array.isArray(record.signals)) {
    throw new Error(`annotations[${index}].signals must be an object.`);
  }
  const signals = record.signals as Record<string, unknown>;
  const signal = (key: string): SensitiveSignal => {
    const current = signals[key];
    if (current !== "absent" && current !== "present" && current !== "unknown") {
      throw new Error(`annotations[${index}].signals.${key} is invalid.`);
    }
    return current;
  };
  return {
    caseId,
    signals: {
      graphicViolence: signal("graphicViolence"),
      unsupportedAllegation: signal("unsupportedAllegation"),
      minorInSensitiveIncident: signal("minorInSensitiveIncident"),
      realisticPoliticalOrPublicFigureDeepfake: signal(
        "realisticPoliticalOrPublicFigureDeepfake"
      )
    },
    reason
  };
}

async function readReviewedAnnotations(filePath: string): Promise<readonly ReviewedAnnotation[]> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("Reviewed annotations source must be an array.");
  const annotations = raw.map(assertReviewedAnnotation);
  if (annotations.length !== SELECTED_CASES.length) {
    throw new Error(`Reviewed annotations require ${SELECTED_CASES.length} cases.`);
  }
  const ids = annotations.map((entry) => entry.caseId);
  if (new Set(ids).size !== ids.length) throw new Error("Reviewed annotation IDs must be unique.");
  for (const selected of SELECTED_CASES) {
    if (!ids.includes(selected.caseId)) {
      throw new Error(`Reviewed annotations are missing ${selected.caseId}.`);
    }
  }
  return annotations;
}

async function main(): Promise<void> {
  const { outputRoot, annotationsPath } = parseArgs();
  if (SELECTED_CASES.length !== 30) throw new Error("Frozen selection must contain exactly 30 cases.");
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot, { recursive: false });

  const [ffmpegVersion, ffprobeVersion, tesseractVersion, whisperVersion] = await Promise.all([
    toolVersion("ffmpeg", ["-version"]),
    toolVersion("ffprobe", ["-version"]),
    toolVersion("tesseract", ["--version"]),
    toolVersion("/Users/neich/.local/bin/whisper", ["--help"]).then(() => "openai-whisper-cli"),
  ]);
  const datasetCases: Array<Record<string, unknown>> = new Array(SELECTED_CASES.length);

  await runBounded(SELECTED_CASES, 3, async (selected, index) => {
    const caseRoot = path.join(outputRoot, "cases", selected.caseId);
    const framesRoot = path.join(caseRoot, "frames");
    await fs.mkdir(framesRoot, { recursive: true });
    const mediaPath = path.join(REPO_ROOT, selected.mediaRelativePath);
    const contentSha256 = await sha256File(mediaPath);
    const probe = JSON.parse((await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", mediaPath],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
    )).stdout) as {
      format?: { duration?: string; format_name?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string }>;
    };
    const durationSec = Number(probe.format?.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error(`${selected.caseId} has no valid duration.`);
    }

    const frames: Array<Record<string, unknown>> = [];
    const ocrChunks: string[] = [];
    for (const [frameIndex, ratio] of FRAME_RATIOS.entries()) {
      const timestampSec = Math.max(0, Math.min(durationSec - 0.02, durationSec * ratio));
      const artifactId = `source-key-frame-${String(frameIndex + 1).padStart(2, "0")}`;
      const framePath = path.join(framesRoot, `${artifactId}.jpg`);
      const frameRelativePath = frozenPath(framePath);
      await execFileAsync(
        "ffmpeg",
        [
          "-nostdin", "-v", "error", "-ss", timestampSec.toFixed(3), "-i", mediaPath,
          "-frames:v", "1", "-vf", "scale=960:-2:force_original_aspect_ratio=decrease",
          "-q:v", "2", "-n", framePath
        ],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
      );
      const frameSha256 = await sha256File(framePath);
      frames.push({
        artifactId,
        relativePath: frameRelativePath,
        timestampMs: Math.round(timestampSec * 1_000),
        sha256: frameSha256
      });
      const ocr = await execFileAsync(
        "tesseract",
        [framePath, "stdout", "--psm", "11", "-l", "eng"],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
      );
      const normalizedOcr = ocr.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
      ocrChunks.push(
        normalizedOcr
          ? `[${artifactId} @ ${timestampSec.toFixed(3)}s]\n${normalizedOcr}`
          : `[${artifactId} @ ${timestampSec.toFixed(3)}s]\n<no_text_detected>`
      );
    }

    const ocrPath = path.join(caseRoot, "ocr.txt");
    const ocrRelativePath = frozenPath(ocrPath);
    const ocrText = [
      `status=${ocrChunks.every((entry) => entry.includes("<no_text_detected>")) ? "no_text_detected" : "text_detected"}`,
      `tool=${tesseractVersion}`,
      "language=eng",
      ...ocrChunks,
      ""
    ].join("\n");
    await fs.writeFile(ocrPath, ocrText, { encoding: "utf8", flag: "wx" });
    const ocrSha256 = await sha256File(ocrPath);

    const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "audio");
    const asrRawPath = path.join(caseRoot, "asr.raw.json");
    const asrRawRelativePath = frozenPath(asrRawPath);
    const asrPath = path.join(caseRoot, "asr.txt");
    const asrRelativePath = frozenPath(asrPath);
    let asrStatus: "no_audio" | "no_speech" | "speech_detected";
    let asrLanguage = "unknown";
    let asrTranscript = "";
    let asrSegments: Array<Record<string, unknown>> = [];
    if (audioStreams.length === 0) {
      asrStatus = "no_audio";
      await fs.writeFile(asrRawPath, `${JSON.stringify({ status: "no_audio", streams: [] }, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
    } else {
      const audioPath = path.join(caseRoot, "audio.wav");
      await execFileAsync(
        "ffmpeg",
        ["-nostdin", "-v", "error", "-i", mediaPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-n", audioPath],
        { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 }
      );
      const whisperRoot = path.join(caseRoot, "whisper");
      await fs.mkdir(whisperRoot, { recursive: true });
      await execFileAsync(
        "/Users/neich/.local/bin/whisper",
        [
          audioPath,
          "--model", "tiny",
          "--device", "cpu",
          "--output_dir", whisperRoot,
          "--output_format", "json",
          "--verbose", "False",
          "--fp16", "False",
          "--condition_on_previous_text", "False"
        ],
        { timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 }
      );
      const rawWhisperPath = path.join(whisperRoot, "audio.json");
      const rawWhisper = JSON.parse(await fs.readFile(rawWhisperPath, "utf8")) as {
        text?: string;
        language?: string;
        segments?: Array<Record<string, unknown>>;
      };
      asrLanguage = typeof rawWhisper.language === "string" ? rawWhisper.language : "unknown";
      asrTranscript = typeof rawWhisper.text === "string" ? rawWhisper.text.trim() : "";
      asrSegments = Array.isArray(rawWhisper.segments)
        ? rawWhisper.segments.map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: typeof segment.text === "string" ? segment.text.trim() : "",
            noSpeechProbability: segment.no_speech_prob,
            averageLogProbability: segment.avg_logprob
          }))
        : [];
      asrStatus = asrTranscript || asrSegments.some((entry) => entry.text)
        ? "speech_detected"
        : "no_speech";
      await fs.writeFile(
        asrRawPath,
        `${JSON.stringify({
          status: asrStatus,
          model: "tiny",
          language: asrLanguage,
          text: asrTranscript,
          segments: asrSegments
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" }
      );
      await fs.rm(audioPath, { force: true });
      await fs.rm(whisperRoot, { recursive: true, force: true });
    }
    const asrText = [
      `status=${asrStatus}`,
      `tool=${whisperVersion}`,
      "model=tiny",
      `language=${asrLanguage}`,
      `transcript=${asrTranscript || (asrStatus === "no_audio" ? "<no_audio>" : "<no_speech_detected>")}`,
      ...asrSegments.map((segment, segmentIndex) =>
        `segment_${String(segmentIndex + 1).padStart(2, "0")}=${JSON.stringify(segment)}`
      ),
      ""
    ].join("\n");
    await fs.writeFile(asrPath, asrText, { encoding: "utf8", flag: "wx" });
    const asrSha256 = await sha256File(asrPath);
    const asrRawSha256 = await sha256File(asrRawPath);

    const metadataPath = path.join(caseRoot, "source-metadata.json");
    const metadataRelativePath = frozenPath(metadataPath);
    const metadataPayload = {
      schemaVersion: "project-kings-source-policy-case-metadata-v1",
      caseId: selected.caseId,
      profileKey: selected.profileKey,
      sourceUrl: selected.sourceUrl,
      mediaRelativePath: selected.mediaRelativePath,
      contentSha256,
      durationSec,
      container: probe.format?.format_name ?? "unknown",
      audioStreams,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      extraction: {
        ffmpegVersion,
        ffprobeVersion,
        frameRatios: FRAME_RATIOS,
        orderedFrames: frames
      },
      ocr: { tool: tesseractVersion, relativePath: ocrRelativePath, sha256: ocrSha256 },
      asr: {
        tool: whisperVersion,
        model: "tiny",
        status: asrStatus,
        relativePath: asrRelativePath,
        sha256: asrSha256,
        rawRelativePath: asrRawRelativePath,
        rawSha256: asrRawSha256
      }
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadataPayload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    const metadataSha256 = await sha256File(metadataPath);
    const casePayload = {
      ...selected,
      contentSha256,
      durationSec,
      frameCount: frames.length,
      artifacts: {
        sourceMetadata: {
          artifactId: "source-policy-metadata",
          kind: "source_metadata",
          mediaType: "json",
          relativePath: metadataRelativePath,
          sha256: metadataSha256
        },
        orderedKeyFrames: frames,
        ocr: {
          artifactId: "source-policy-ocr",
          kind: "ocr",
          mediaType: "text",
          relativePath: ocrRelativePath,
          sha256: ocrSha256
        },
        asr: {
          artifactId: "source-policy-asr",
          kind: "transcript",
          mediaType: "text",
          relativePath: asrRelativePath,
          sha256: asrSha256,
          status: asrStatus,
          rawRelativePath: asrRawRelativePath,
          rawSha256: asrRawSha256
        }
      }
    };
    datasetCases[index] = {
      ...casePayload,
      caseBindingSha256: sha256Json(casePayload)
    };
    process.stdout.write(`${String(index + 1).padStart(2, "0")}/30 ${selected.caseId} ${asrStatus}\n`);
  });

  const datasetPayload = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    datasetId: "project-kings-source-policy-real-candidates",
    datasetVersion: "real-30-v1",
    createdAt: new Date().toISOString(),
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    frameCountPerCase: FRAME_RATIOS.length,
    sampleSize: datasetCases.length,
    selection: {
      darkJoyBoy: 8,
      copScopes: 10,
      lightKingdom: 12,
      sourceMediaRule: "exact downloaded MP4 bytes under .data/project-kings/source-candidates"
    },
    cases: datasetCases
  };
  const dataset = { ...datasetPayload, datasetSha256: sha256Json(datasetPayload) };
  const datasetPath = path.join(outputRoot, "dataset.json");
  await fs.writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });

  if (annotationsPath) {
    const reviewed = await readReviewedAnnotations(annotationsPath);
    const byId = new Map(reviewed.map((entry) => [entry.caseId, entry]));
    const annotations = datasetCases.map((datasetCase) => {
      const caseId = String(datasetCase.caseId);
      const annotation = byId.get(caseId)!;
      const annotationPayload = {
        caseId,
        datasetCaseBindingSha256: datasetCase.caseBindingSha256,
        signals: annotation.signals,
        reason: annotation.reason,
        reviewMethod: "direct ordered-frame review with exact OCR and Whisper-ASR evidence"
      };
      return { ...annotationPayload, annotationSha256: sha256Json(annotationPayload) };
    });
    const annotationPayload = {
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      annotationSetId: "project-kings-source-policy-real-30-v1",
      createdAt: new Date().toISOString(),
      datasetSha256: dataset.datasetSha256,
      annotatorKind: "implementation_agent_direct_visual_review",
      independentFromModelRoutesUnderTest: true,
      sampleSize: annotations.length,
      cases: annotations
    };
    const frozenAnnotations = {
      ...annotationPayload,
      annotationsSha256: sha256Json(annotationPayload)
    };
    await fs.writeFile(
      path.join(outputRoot, "annotations.json"),
      `${JSON.stringify(frozenAnnotations, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
  }

  process.stdout.write(`dataset=${path.relative(REPO_ROOT, datasetPath)} sha256=${dataset.datasetSha256}\n`);
}

await main();
