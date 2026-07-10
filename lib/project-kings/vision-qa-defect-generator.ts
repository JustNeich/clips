import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  verifyVisionQaCorpusSourceAuditEvidence,
  type VisionQaCorpusSourceAuditEvidence
} from "./vision-qa-corpus-builder";

const execFileAsync = promisify(execFile);

export const VISION_QA_DEFECT_RECIPE_VERSION =
  "project-kings-vision-qa-defect-recipe-v1" as const;

export const VISION_QA_CONTROLLED_DEFECTS = [
  "corrupt_mux",
  "flash_frame",
  "wrong_template",
  "lost_audio",
  "wrong_resolution",
  "donor_ui",
  "cta",
  "handle",
  "watermark",
  "foreign_captions",
  "banned_word",
  "unsafe_crop",
  "main_event_lost"
] as const;

export type VisionQaControlledDefect = typeof VISION_QA_CONTROLLED_DEFECTS[number];

export type EligibleVisionQaCleanBase = Readonly<{
  sourceAuditEvidenceSha256: string;
  campaignManifestSha256: string;
  runId: string;
  productionItemId: string;
  productionItemState: "final_approved";
  artifactPath: string;
  artifactSha256: string;
  deterministicFinalPassBound: true;
  visionFinalPassBound: true;
  derivedFinalPass: true;
}>;

export type VisionQaDefectProbe = Readonly<{
  probeKind:
    | "decode_failure"
    | "flash_pixel"
    | "marker_pixel"
    | "audio_absent"
    | "resolution_mismatch"
    | "geometry_transform";
  status: "verified" | "requires_vision";
  injectionObserved: boolean;
  requiresVisionConfirmation: boolean;
  evidence: Readonly<Record<string, unknown>>;
  evidenceSha256: string;
}>;

export type VisionQaDefectRecipeManifest = Readonly<{
  schemaVersion: typeof VISION_QA_DEFECT_RECIPE_VERSION;
  recipeId: string;
  recipeSha256: string;
  campaignManifestSha256: string;
  base: Readonly<{
    sourceAuditEvidenceSha256: string;
    runId: string;
    productionItemId: string;
    artifactSha256: string;
  }>;
  defect: VisionQaControlledDefect;
  parameters: Readonly<Record<string, unknown>>;
  toolchain: Readonly<{
    ffmpegVersion: string;
    ffprobeVersion: string;
    fontSha256: string | null;
  }>;
  blindArtifact: Readonly<{
    opaqueArtifactId: string;
    relativePath: string;
    sha256: string;
    sizeBytes: number;
  }>;
  probe: VisionQaDefectProbe;
  createdAt: string;
  manifestSha256: string;
}>;

export type GenerateVisionQaDefectVariantInput = Readonly<{
  base: EligibleVisionQaCleanBase;
  defect: VisionQaControlledDefect;
  outputRoot: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  fontPath?: string | null;
  bannedWord?: string | null;
  createdAt?: string;
}>;

type MediaProbe = {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  hasAudio: boolean;
};

type DefectPlan = {
  parameters: Record<string, unknown>;
  videoFilter: string | null;
  bitmapOverlay: Readonly<{
    text: string;
    panelRgb: [number, number, number];
    stripeRgb: [number, number, number];
    yRatio: number;
  }> | null;
  removeAudio: boolean;
  markerColor: [number, number, number] | null;
  markerPoint: { x: number; y: number; timestampSec: number } | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string | Uint8Array | unknown): string {
  const payload = typeof value === "string" || value instanceof Uint8Array
    ? value
    : stableJson(value);
  return createHash("sha256").update(payload).digest("hex");
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

function assertSha(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be lowercase SHA-256.`);
}

function assertEligibleBase(base: EligibleVisionQaCleanBase): void {
  assertSha(base.sourceAuditEvidenceSha256, "sourceAuditEvidenceSha256");
  assertSha(base.campaignManifestSha256, "campaignManifestSha256");
  assertSha(base.artifactSha256, "artifactSha256");
  if (!base.runId.trim() || !base.productionItemId.trim() || !path.isAbsolute(base.artifactPath)) {
    throw new Error("Eligible clean base identity and absolute artifact path are required.");
  }
  if (
    base.productionItemState !== "final_approved" ||
    base.deterministicFinalPassBound !== true ||
    base.visionFinalPassBound !== true ||
    base.derivedFinalPass !== true
  ) {
    throw new Error("Defect generation requires an exact final_approved base with derived deterministic + Vision PASS.");
  }
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Unknown error"))
    .replace(/\s+/g, " ").trim().slice(0, 1_000);
}

async function toolVersion(command: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, ["-version"], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  const firstLine = `${stdout}\n${stderr}`.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (!firstLine) throw new Error(`Cannot read ${command} version.`);
  return firstLine.slice(0, 500);
}

async function mediaProbe(ffprobePath: string, filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath
  ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string | number };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(parsed.format?.duration);
  return {
    width: Number.isInteger(video?.width) ? Number(video?.width) : null,
    height: Number.isInteger(video?.height) ? Number(video?.height) : null,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio"))
  };
}

export function buildVisionQaDefectPlan(input: {
  defect: VisionQaControlledDefect;
  fontPath?: string | null;
  bannedWord?: string | null;
}): DefectPlan {
  if (!VISION_QA_CONTROLLED_DEFECTS.includes(input.defect)) throw new Error("Unsupported controlled defect.");
  const overlay = (
    text: string,
    panelRgb: [number, number, number],
    stripeRgb: [number, number, number],
    markerRgb: [number, number, number],
    yRatio = 0
  ): DefectPlan => ({
    parameters: { text, panelRgb, stripeRgb, yRatio, renderer: "builtin-5x7-v1" },
    videoFilter: null,
    bitmapOverlay: { text, panelRgb, stripeRgb, yRatio },
    removeAudio: false,
    markerColor: markerRgb,
    markerPoint: { x: 8, y: 2, timestampSec: 0.1 }
  });
  switch (input.defect) {
    case "corrupt_mux":
      return {
        parameters: { retainedBytes: 128 }, videoFilter: null, bitmapOverlay: null, removeAudio: false,
        markerColor: null, markerPoint: null
      };
    case "flash_frame":
      return {
        parameters: { startSec: 0.45, endSec: 0.65, color: "white" },
        videoFilter: "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,0.45,0.65)'",
        bitmapOverlay: null,
        removeAudio: false,
        markerColor: [255, 255, 255],
        markerPoint: { x: 540, y: 960, timestampSec: 0.52 }
      };
    case "wrong_template":
      return overlay("DAILY CLIPS", [0, 0, 0], [255, 0, 255], [255, 0, 255]);
    case "lost_audio":
      return { parameters: { audioMode: "removed" }, videoFilter: null, bitmapOverlay: null, removeAudio: true, markerColor: null, markerPoint: null };
    case "wrong_resolution":
      return {
        parameters: { width: 720, height: 1280 }, videoFilter: "scale=720:1280:flags=lanczos",
        bitmapOverlay: null, removeAudio: false, markerColor: null, markerPoint: null
      };
    case "donor_ui":
      return overlay("INSTAGRAM", [16, 16, 16], [255, 0, 0], [255, 0, 0]);
    case "cta":
      return overlay("FOLLOW FOR MORE", [16, 16, 16], [0, 255, 0], [0, 255, 0], 0.82);
    case "handle":
      return overlay("@DONOR_ACCOUNT", [16, 16, 16], [0, 0, 255], [0, 0, 255]);
    case "watermark":
      return overlay("DONOR TV", [48, 48, 48], [255, 255, 0], [255, 255, 0], 0.45);
    case "foreign_captions":
      return overlay("NO TE LO PIERDAS", [16, 16, 16], [0, 255, 255], [0, 255, 255], 0.75);
    case "banned_word": {
      const bannedWord = input.bannedWord?.trim();
      if (!bannedWord || bannedWord.length > 80) throw new Error("banned_word requires a bounded bannedWord.");
      return overlay(bannedWord.toUpperCase(), [16, 16, 16], [255, 165, 0], [255, 165, 0], 0.34);
    }
    case "unsafe_crop":
      return {
        parameters: { sourceX: 0, retainedWidthRatio: 0.45, semanticConfirmation: "required" },
        videoFilter: "crop=trunc(iw*0.45/2)*2:ih:0:0,scale=1080:1920:flags=lanczos",
        bitmapOverlay: null, removeAudio: false, markerColor: null, markerPoint: null
      };
    case "main_event_lost":
      return {
        parameters: { sourceXRatio: 0.65, retainedWidthRatio: 0.35, semanticConfirmation: "required" },
        videoFilter: "crop=trunc(iw*0.35/2)*2:ih:trunc(iw*0.65/2)*2:0,scale=1080:1920:flags=lanczos",
        bitmapOverlay: null, removeAudio: false, markerColor: null, markerPoint: null
      };
  }
}

const BITMAP_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  " ": "00000/00000/00000/00000/00000/00000/00000",
  "?": "01110/10001/00001/00010/00100/00000/00100",
  "@": "01110/10001/10111/10101/10111/10000/01110",
  "_": "00000/00000/00000/00000/00000/00000/11111",
  "-": "00000/00000/00000/11111/00000/00000/00000",
  "0": "01110/10001/10011/10101/11001/10001/01110",
  "1": "00100/01100/00100/00100/00100/00100/01110",
  "2": "01110/10001/00001/00010/00100/01000/11111",
  "3": "11110/00001/00001/01110/00001/00001/11110",
  "4": "00010/00110/01010/10010/11111/00010/00010",
  "5": "11111/10000/10000/11110/00001/00001/11110",
  "6": "01110/10000/10000/11110/10001/10001/01110",
  "7": "11111/00001/00010/00100/01000/01000/01000",
  "8": "01110/10001/10001/01110/10001/10001/01110",
  "9": "01110/10001/10001/01111/00001/00001/01110",
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01111/10000/10000/10000/10000/10000/01111",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01111/10000/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "01110/00100/00100/00100/00100/00100/01110",
  J: "00111/00010/00010/00010/10010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111"
});

const BITMAP_FONT_SHA256 = sha256(BITMAP_GLYPHS);

async function writeBitmapOverlay(input: {
  filePath: string;
  frameWidth: number;
  frameHeight: number;
  overlay: NonNullable<DefectPlan["bitmapOverlay"]>;
}): Promise<{ y: number; height: number; fontSha256: string }> {
  const width = input.frameWidth;
  const height = Math.max(48, Math.min(input.frameHeight, Math.round(input.frameHeight * 0.09)));
  const y = Math.max(0, Math.round((input.frameHeight - height) * input.overlay.yRatio));
  const text = input.overlay.text.toUpperCase();
  const scaleByHeight = Math.max(1, Math.floor((height - 16) / 7));
  const scaleByWidth = Math.max(1, Math.floor((width - 16) / Math.max(1, text.length * 6)));
  const scale = Math.max(1, Math.min(scaleByHeight, scaleByWidth));
  const textWidth = Math.max(0, text.length * 6 * scale - scale);
  if (textWidth > width - 8) throw new Error("Bitmap overlay text does not fit the source frame.");
  const bytes = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < bytes.length; offset += 3) {
    bytes[offset] = input.overlay.panelRgb[0];
    bytes[offset + 1] = input.overlay.panelRgb[1];
    bytes[offset + 2] = input.overlay.panelRgb[2];
  }
  for (let row = 0; row < Math.min(4, height); row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 3;
      bytes[offset] = input.overlay.stripeRgb[0];
      bytes[offset + 1] = input.overlay.stripeRgb[1];
      bytes[offset + 2] = input.overlay.stripeRgb[2];
    }
  }
  const originX = Math.max(4, Math.floor((width - textWidth) / 2));
  const originY = Math.max(6, Math.floor((height - 7 * scale) / 2));
  for (const [characterIndex, character] of [...text].entries()) {
    const rows = (BITMAP_GLYPHS[character] ?? BITMAP_GLYPHS["?"]!).split("/");
    for (const [glyphY, row] of rows.entries()) {
      for (const [glyphX, pixel] of [...row].entries()) {
        if (pixel !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = originX + characterIndex * 6 * scale + glyphX * scale + dx;
            const targetY = originY + glyphY * scale + dy;
            if (x < 0 || x >= width || targetY < 0 || targetY >= height) continue;
            const offset = (targetY * width + x) * 3;
            bytes[offset] = 255;
            bytes[offset + 1] = 255;
            bytes[offset + 2] = 255;
          }
        }
      }
    }
  }
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  await fs.writeFile(input.filePath, Buffer.concat([header, bytes]), { flag: "wx" });
  return { y, height, fontSha256: BITMAP_FONT_SHA256 };
}

function recipePayload(input: {
  base: EligibleVisionQaCleanBase;
  defect: VisionQaControlledDefect;
  parameters: Record<string, unknown>;
  toolchain: VisionQaDefectRecipeManifest["toolchain"];
}): Record<string, unknown> {
  return {
    schemaVersion: VISION_QA_DEFECT_RECIPE_VERSION,
    campaignManifestSha256: input.base.campaignManifestSha256,
    base: {
      sourceAuditEvidenceSha256: input.base.sourceAuditEvidenceSha256,
      runId: input.base.runId,
      productionItemId: input.base.productionItemId,
      artifactSha256: input.base.artifactSha256
    },
    defect: input.defect,
    parameters: input.parameters,
    toolchain: input.toolchain
  };
}

function probeWithHash(input: Omit<VisionQaDefectProbe, "evidenceSha256">): VisionQaDefectProbe {
  return { ...input, evidenceSha256: sha256(input.evidence) };
}

async function fullDecodeFails(ffmpegPath: string, filePath: string): Promise<{ failed: boolean; error: string | null }> {
  try {
    await execFileAsync(ffmpegPath, [
      "-nostdin", "-v", "error", "-xerror", "-i", filePath, "-map", "0:v:0", "-f", "null", "-"
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return { failed: false, error: null };
  } catch (error) {
    return { failed: true, error: normalizeError(error) };
  }
}

async function samplePixel(input: {
  ffmpegPath: string;
  filePath: string;
  tempRoot: string;
  x: number;
  y: number;
  timestampSec: number;
}): Promise<[number, number, number]> {
  const outputPath = path.join(input.tempRoot, `${randomUUID()}.rgb`);
  await execFileAsync(input.ffmpegPath, [
    "-nostdin", "-v", "error", "-ss", input.timestampSec.toFixed(3), "-i", input.filePath,
    "-frames:v", "1", "-vf", `crop=1:1:${input.x}:${input.y},format=rgb24`, "-f", "rawvideo", outputPath
  ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const bytes = await fs.readFile(outputPath);
  await fs.rm(outputPath, { force: true });
  if (bytes.length < 3) throw new Error("Pixel probe returned no RGB sample.");
  return [bytes[0]!, bytes[1]!, bytes[2]!];
}

function colorDistance(left: [number, number, number], right: [number, number, number]): number {
  return Math.sqrt(left.reduce((total, value, index) => total + (value - right[index]!) ** 2, 0));
}

async function probeInjection(input: {
  defect: VisionQaControlledDefect;
  plan: DefectPlan;
  outputPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  tempRoot: string;
  baseProbe: MediaProbe;
}): Promise<VisionQaDefectProbe> {
  if (input.defect === "corrupt_mux") {
    const result = await fullDecodeFails(input.ffmpegPath, input.outputPath);
    return probeWithHash({
      probeKind: "decode_failure", status: result.failed ? "verified" : "requires_vision",
      injectionObserved: result.failed, requiresVisionConfirmation: false,
      evidence: { decodeFailed: result.failed, normalizedError: result.error }
    });
  }
  const variantProbe = await mediaProbe(input.ffprobePath, input.outputPath);
  if (input.defect === "lost_audio") {
    const observed = input.baseProbe.hasAudio && !variantProbe.hasAudio;
    return probeWithHash({
      probeKind: "audio_absent", status: observed ? "verified" : "requires_vision",
      injectionObserved: observed, requiresVisionConfirmation: false,
      evidence: { baseHasAudio: input.baseProbe.hasAudio, variantHasAudio: variantProbe.hasAudio }
    });
  }
  if (input.defect === "wrong_resolution") {
    const observed = variantProbe.width === 720 && variantProbe.height === 1280 &&
      (input.baseProbe.width !== 720 || input.baseProbe.height !== 1280);
    return probeWithHash({
      probeKind: "resolution_mismatch", status: observed ? "verified" : "requires_vision",
      injectionObserved: observed, requiresVisionConfirmation: false,
      evidence: {
        base: { width: input.baseProbe.width, height: input.baseProbe.height },
        variant: { width: variantProbe.width, height: variantProbe.height },
        expectedVariant: { width: 720, height: 1280 }
      }
    });
  }
  if (input.plan.markerColor && input.plan.markerPoint) {
    const sampled = await samplePixel({
      ffmpegPath: input.ffmpegPath,
      filePath: input.outputPath,
      tempRoot: input.tempRoot,
      ...input.plan.markerPoint
    });
    const distance = colorDistance(sampled, input.plan.markerColor);
    const observed = distance <= (input.defect === "flash_frame" ? 80 : 120);
    return probeWithHash({
      probeKind: input.defect === "flash_frame" ? "flash_pixel" : "marker_pixel",
      status: observed ? "verified" : "requires_vision",
      injectionObserved: observed,
      requiresVisionConfirmation: input.defect !== "flash_frame",
      evidence: { sampledRgb: sampled, expectedRgb: input.plan.markerColor, colorDistance: distance }
    });
  }
  const decode = await fullDecodeFails(input.ffmpegPath, input.outputPath);
  return probeWithHash({
    probeKind: "geometry_transform",
    status: "requires_vision",
    injectionObserved: !decode.failed,
    requiresVisionConfirmation: true,
    evidence: {
      filterApplied: input.plan.videoFilter,
      variantDecodes: !decode.failed,
      decodeError: decode.error,
      note: "Geometry transformation is deterministic; loss of the semantic main event requires blind Vision confirmation."
    }
  });
}

async function atomicExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o444
  });
}

export function verifyVisionQaDefectRecipeManifest(manifest: VisionQaDefectRecipeManifest): void {
  assertSha(manifest.recipeSha256, "recipeSha256");
  assertSha(manifest.base.sourceAuditEvidenceSha256, "base.sourceAuditEvidenceSha256");
  assertSha(manifest.manifestSha256, "manifestSha256");
  assertSha(manifest.blindArtifact.sha256, "blindArtifact.sha256");
  assertSha(manifest.probe.evidenceSha256, "probe.evidenceSha256");
  if (manifest.schemaVersion !== VISION_QA_DEFECT_RECIPE_VERSION) throw new Error("Unsupported defect recipe manifest.");
  if (!VISION_QA_CONTROLLED_DEFECTS.includes(manifest.defect)) throw new Error("Unsupported controlled defect in manifest.");
  if (manifest.probe.evidenceSha256 !== sha256(manifest.probe.evidence)) {
    throw new Error("Defect probe evidence hash mismatch.");
  }
  const expectedRecipeSha256 = sha256(recipePayload({
    base: {
      sourceAuditEvidenceSha256: manifest.base.sourceAuditEvidenceSha256,
      campaignManifestSha256: manifest.campaignManifestSha256,
      runId: manifest.base.runId,
      productionItemId: manifest.base.productionItemId,
      productionItemState: "final_approved",
      artifactPath: "/hash-only",
      artifactSha256: manifest.base.artifactSha256,
      deterministicFinalPassBound: true,
      visionFinalPassBound: true,
      derivedFinalPass: true
    },
    defect: manifest.defect,
    parameters: { ...manifest.parameters },
    toolchain: manifest.toolchain
  }));
  if (expectedRecipeSha256 !== manifest.recipeSha256 || manifest.recipeId !== manifest.recipeSha256.slice(0, 24)) {
    throw new Error("Defect recipe identity hash mismatch.");
  }
  const { manifestSha256, ...withoutManifestHash } = manifest;
  if (sha256(withoutManifestHash) !== manifestSha256) throw new Error("Defect recipe manifest hash mismatch.");
  if (/corrupt_mux|flash_frame|wrong_template|lost_audio|wrong_resolution|donor_ui|cta|handle|watermark|foreign_captions|banned_word|unsafe_crop|main_event_lost/.test(
    manifest.blindArtifact.relativePath
  )) {
    throw new Error("Blind artifact path leaks its defect recipe.");
  }
}

export function selectEligibleVisionQaCleanBasesFromAudit(input: {
  repoRoot: string;
  evidence: VisionQaCorpusSourceAuditEvidence;
  productionItemIds?: readonly string[] | null;
}): EligibleVisionQaCleanBase[] {
  verifyVisionQaCorpusSourceAuditEvidence(input.evidence);
  const requested = input.productionItemIds?.length
    ? new Set(input.productionItemIds.map((value) => value.trim()).filter(Boolean))
    : null;
  if (requested && requested.size !== input.productionItemIds!.length) {
    throw new Error("Requested clean-base production item IDs must be unique and non-empty.");
  }
  const expectedRunManifests = new Map(
    input.evidence.campaign.runs.map((run) => [run.runId, run.productionManifestSha256])
  );
  const finalHashCounts = new Map<string, number>();
  for (const artifact of input.evidence.artifacts) {
    if (artifact.productionItemState === "final_approved" && artifact.sha256) {
      finalHashCounts.set(artifact.sha256, (finalHashCounts.get(artifact.sha256) ?? 0) + 1);
    }
  }
  const selected = input.evidence.artifacts.flatMap((artifact): EligibleVisionQaCleanBase[] => {
    if (requested && !requested.has(artifact.productionItemId)) return [];
    if (
      artifact.productionItemState !== "final_approved" || !artifact.relativePath || !artifact.sha256 ||
      !artifact.decodeComplete || artifact.databaseMatchCount !== 1 || !artifact.completedRenderExport ||
      !artifact.exactDatabaseSize || !artifact.exactFinalArtifactSha256 || !artifact.layoutAwareSourceCropBound ||
      !artifact.deterministicFinalPassBound || !artifact.visionFinalPassBound || !artifact.derivedFinalPass ||
      !artifact.explicitApprovalBound || finalHashCounts.get(artifact.sha256) !== 1 ||
      expectedRunManifests.get(artifact.runId) !== artifact.runManifestSha256
    ) return [];
    if (path.isAbsolute(artifact.relativePath) || artifact.relativePath.split(/[\\/]+/).includes("..")) {
      throw new Error(`Eligible clean base ${artifact.productionItemId} escaped the repository artifact root.`);
    }
    return [{
      sourceAuditEvidenceSha256: input.evidence.evidenceSha256,
      campaignManifestSha256: input.evidence.campaign.manifestSha256,
      runId: artifact.runId,
      productionItemId: artifact.productionItemId,
      productionItemState: "final_approved",
      artifactPath: path.resolve(input.repoRoot, artifact.relativePath),
      artifactSha256: artifact.sha256,
      deterministicFinalPassBound: true,
      visionFinalPassBound: true,
      derivedFinalPass: true
    }];
  });
  if (requested) {
    const found = new Set(selected.map((base) => base.productionItemId));
    const missing = [...requested].filter((productionItemId) => !found.has(productionItemId));
    if (missing.length) throw new Error(`Requested clean bases are not eligible in the sealed audit: ${missing.join(", ")}.`);
  }
  if (selected.length < 1) throw new Error("Sealed source audit contains no eligible clean bases for defect generation.");
  return selected;
}

export async function generateVisionQaDefectVariant(
  input: GenerateVisionQaDefectVariantInput
): Promise<VisionQaDefectRecipeManifest> {
  assertEligibleBase(input.base);
  const ffmpegPath = input.ffmpegPath ?? "ffmpeg";
  const ffprobePath = input.ffprobePath ?? "ffprobe";
  const actualBaseSha256 = await sha256File(input.base.artifactPath).catch(() => null);
  if (actualBaseSha256 !== input.base.artifactSha256) throw new Error("Clean base artifact hash changed before mutation.");
  const baseProbe = await mediaProbe(ffprobePath, input.base.artifactPath);
  if (!baseProbe.width || !baseProbe.height || !baseProbe.durationSec) throw new Error("Clean base is not a positive-duration video.");
  if (input.defect === "lost_audio" && !baseProbe.hasAudio) throw new Error("lost_audio requires a clean base with audio.");
  if (input.defect === "flash_frame" && baseProbe.durationSec < 0.8) throw new Error("flash_frame requires at least 0.8 seconds.");
  const plan = buildVisionQaDefectPlan(input);
  if (input.defect === "flash_frame" && plan.markerPoint) {
    plan.markerPoint = {
      ...plan.markerPoint,
      x: Math.max(0, Math.floor(baseProbe.width / 2)),
      y: Math.max(0, Math.floor(baseProbe.height / 2))
    };
  }
  if (plan.bitmapOverlay && plan.markerPoint) {
    const panelHeight = Math.max(48, Math.min(baseProbe.height, Math.round(baseProbe.height * 0.09)));
    const panelY = Math.max(0, Math.round((baseProbe.height - panelHeight) * plan.bitmapOverlay.yRatio));
    plan.markerPoint = { ...plan.markerPoint, y: panelY + 2 };
    plan.parameters = {
      ...plan.parameters,
      resolvedPanelY: panelY,
      resolvedPanelHeight: panelHeight,
      bitmapFontSha256: BITMAP_FONT_SHA256
    };
  }
  const fontSha256 = plan.bitmapOverlay ? BITMAP_FONT_SHA256 : null;
  const toolchain = {
    ffmpegVersion: await toolVersion(ffmpegPath),
    ffprobeVersion: await toolVersion(ffprobePath),
    fontSha256
  };
  const payload = recipePayload({ base: input.base, defect: input.defect, parameters: plan.parameters, toolchain });
  const recipeSha256 = sha256(payload);
  const recipeId = recipeSha256.slice(0, 24);
  const opaqueArtifactId = sha256(`blind-artifact:${recipeSha256}`).slice(0, 32);
  const outputRoot = path.resolve(input.outputRoot);
  const blindRoot = path.join(outputRoot, "blind-artifacts");
  const recipeRoot = path.join(outputRoot, "sealed-recipes");
  const tempRoot = path.join(outputRoot, ".work");
  await Promise.all([
    fs.mkdir(blindRoot, { recursive: true }),
    fs.mkdir(recipeRoot, { recursive: true }),
    fs.mkdir(tempRoot, { recursive: true })
  ]);
  const outputPath = path.join(blindRoot, `${opaqueArtifactId}.mp4`);
  const recipePath = path.join(recipeRoot, `${recipeSha256}.json`);
  const existing = await fs.readFile(recipePath, "utf8").then(JSON.parse).catch(() => null) as VisionQaDefectRecipeManifest | null;
  if (existing) {
    verifyVisionQaDefectRecipeManifest(existing);
    if ((await sha256File(outputPath).catch(() => null)) !== existing.blindArtifact.sha256) {
      throw new Error("Existing blind defect artifact changed after its recipe was sealed.");
    }
    return existing;
  }
  if (await fs.stat(outputPath).catch(() => null)) throw new Error("Opaque output exists without its sealed recipe manifest.");

  const temporaryOutput = path.join(tempRoot, `${randomUUID()}.mp4`);
  const bitmapOverlayPath = plan.bitmapOverlay ? path.join(tempRoot, `${randomUUID()}.ppm`) : null;
  try {
    if (input.defect === "corrupt_mux") {
      const bytes = await fs.readFile(input.base.artifactPath);
      await fs.writeFile(temporaryOutput, bytes.subarray(0, Math.min(128, bytes.length)), { flag: "wx" });
    } else {
      if (plan.bitmapOverlay && bitmapOverlayPath) {
        await writeBitmapOverlay({
          filePath: bitmapOverlayPath,
          frameWidth: baseProbe.width,
          frameHeight: baseProbe.height,
          overlay: plan.bitmapOverlay
        });
      }
      const args = ["-nostdin", "-v", "error", "-i", input.base.artifactPath];
      if (plan.bitmapOverlay && bitmapOverlayPath) {
        args.push("-loop", "1", "-framerate", "25", "-i", bitmapOverlayPath);
        args.push(
          "-filter_complex",
          `[0:v][1:v]overlay=0:${plan.markerPoint!.y - 2}:shortest=1[v]`,
          "-map", "[v]"
        );
      } else {
        args.push("-map", "0:v:0");
      }
      if (!plan.removeAudio) args.push("-map", "0:a?");
      if (plan.videoFilter) args.push("-vf", plan.videoFilter);
      args.push(
        "-map_metadata", "-1", "-threads", "1", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "18", "-pix_fmt", "yuv420p"
      );
      if (plan.removeAudio) args.push("-an");
      else args.push("-c:a", "aac", "-b:a", "128k");
      if (plan.bitmapOverlay) args.push("-shortest");
      args.push("-movflags", "+faststart", temporaryOutput);
      await execFileAsync(ffmpegPath, args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    }
    const probe = await probeInjection({
      defect: input.defect,
      plan,
      outputPath: temporaryOutput,
      ffmpegPath,
      ffprobePath,
      tempRoot,
      baseProbe
    });
    if (!probe.injectionObserved) throw new Error(`Deterministic injection probe failed for ${input.defect}.`);
    const artifactSha256 = await sha256File(temporaryOutput);
    const sizeBytes = (await fs.stat(temporaryOutput)).size;
    await fs.rename(temporaryOutput, outputPath);
    await fs.chmod(outputPath, 0o444);
    const createdAt = input.createdAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("createdAt must be an ISO timestamp.");
    const withoutManifestHash = {
      schemaVersion: VISION_QA_DEFECT_RECIPE_VERSION,
      recipeId,
      recipeSha256,
      campaignManifestSha256: input.base.campaignManifestSha256,
      base: {
        sourceAuditEvidenceSha256: input.base.sourceAuditEvidenceSha256,
        runId: input.base.runId,
        productionItemId: input.base.productionItemId,
        artifactSha256: input.base.artifactSha256
      },
      defect: input.defect,
      parameters: plan.parameters,
      toolchain,
      blindArtifact: {
        opaqueArtifactId,
        relativePath: path.relative(outputRoot, outputPath),
        sha256: artifactSha256,
        sizeBytes
      },
      probe,
      createdAt
    } as const;
    const manifest: VisionQaDefectRecipeManifest = {
      ...withoutManifestHash,
      manifestSha256: sha256(withoutManifestHash)
    };
    verifyVisionQaDefectRecipeManifest(manifest);
    await atomicExclusiveJson(recipePath, manifest);
    return manifest;
  } catch (error) {
    await fs.rm(temporaryOutput, { force: true }).catch(() => undefined);
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (bitmapOverlayPath) await fs.rm(bitmapOverlayPath, { force: true }).catch(() => undefined);
  }
}
