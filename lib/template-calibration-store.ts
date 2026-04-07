import "server-only";

import path from "node:path";
import { promises as fs } from "node:fs";
import {
  TemplateCalibrationArtifacts,
  TemplateCalibrationBundle,
  TemplateCalibrationSession,
  TemplateCalibrationStatus,
  TemplateCompareMode,
  TemplateCompareScope,
  TemplateContentFixture,
  TemplateDiffReport
} from "../app/components/types";
import {
  Stage3DesignLabPreset,
  getStage3DesignLabPreset,
  listStage3DesignLabPresets
} from "./stage3-design-lab";
import { getTemplateFigmaSpec } from "./stage3-template-spec";
import { clampStage3TextScaleUi } from "./stage3-text-fit";
import {
  buildTemplateHighlightSpansFromPhrases,
  createEmptyTemplateCaptionHighlights,
  normalizeTemplateCaptionHighlights
} from "./template-highlights";

const DESIGN_TEMPLATES_ROOT = path.join(process.cwd(), "design", "templates");
const ARTIFACTS_DIR_NAME = "artifacts";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];

type TemplateAssetKind = "reference" | "mask" | "media" | "background" | "avatar";

const ASSET_BASE_NAMES: Record<TemplateAssetKind, string> = {
  reference: "reference",
  mask: "mask",
  media: "media",
  background: "background",
  avatar: "avatar"
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeTemplateId(templateId: string): string {
  return templateId.replace(/[^a-z0-9_-]+/gi, "");
}

function buildDefaultContent(preset: Stage3DesignLabPreset): TemplateContentFixture {
  return {
    topText: preset.topText,
    bottomText: preset.bottomText,
    channelName: preset.channelName,
    channelHandle: preset.channelHandle,
    highlights: createEmptyTemplateCaptionHighlights(),
    topHighlightPhrases: undefined,
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: preset.defaultPreviewScale,
    mediaAsset: "media.png",
    backgroundAsset: "background.png",
    avatarAsset: "avatar.png"
  };
}

function buildDefaultSession(preset: Stage3DesignLabPreset): TemplateCalibrationSession {
  return {
    templateId: preset.templateId,
    status: preset.initialStatus,
    compareMode: "overlay",
    compareScope: "chrome-only",
    overlayOpacity: 0.48,
    overlayBlendMode: "normal",
    referenceOffsetX: 0,
    referenceOffsetY: 0,
    referenceScale: 1,
    referenceCropX: 0,
    referenceCropY: 0,
    referenceCropWidth: 1,
    referenceCropHeight: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    splitPosition: 0.5,
    acceptedMismatchThreshold: preset.initialStatus === "approved" ? 0.045 : 0.085
  };
}

function normalizeUnitRect(input: {
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
  fallback: Pick<
    TemplateCalibrationSession,
    "referenceCropX" | "referenceCropY" | "referenceCropWidth" | "referenceCropHeight"
  >;
}): Pick<
  TemplateCalibrationSession,
  "referenceCropX" | "referenceCropY" | "referenceCropWidth" | "referenceCropHeight"
> {
  const rawWidth =
    typeof input.width === "number" && Number.isFinite(input.width)
      ? clamp(input.width, 0.05, 1)
      : input.fallback.referenceCropWidth;
  const rawHeight =
    typeof input.height === "number" && Number.isFinite(input.height)
      ? clamp(input.height, 0.05, 1)
      : input.fallback.referenceCropHeight;
  const maxX = Math.max(0, 1 - rawWidth);
  const maxY = Math.max(0, 1 - rawHeight);
  const x =
    typeof input.x === "number" && Number.isFinite(input.x)
      ? clamp(input.x, 0, maxX)
      : clamp(input.fallback.referenceCropX, 0, maxX);
  const y =
    typeof input.y === "number" && Number.isFinite(input.y)
      ? clamp(input.y, 0, maxY)
      : clamp(input.fallback.referenceCropY, 0, maxY);

  return {
    referenceCropX: x,
    referenceCropY: y,
    referenceCropWidth: rawWidth,
    referenceCropHeight: rawHeight
  };
}

function normalizeStatus(value: unknown, fallback: TemplateCalibrationStatus): TemplateCalibrationStatus {
  return value === "queued" || value === "in-progress" || value === "review" || value === "approved"
    ? value
    : fallback;
}

function normalizeCompareMode(value: unknown): TemplateCompareMode {
  return value === "side-by-side" ||
    value === "overlay" ||
    value === "difference" ||
    value === "split-swipe" ||
    value === "heatmap"
    ? value
    : "overlay";
}

function normalizeCompareScope(value: unknown): TemplateCompareScope {
  return value === "full" ||
    value === "chrome-only" ||
    value === "top-only" ||
    value === "media-only" ||
    value === "bottom-only" ||
    value === "author-only"
    ? value
    : "chrome-only";
}

function normalizeContentFixture(raw: unknown, preset: Stage3DesignLabPreset): TemplateContentFixture {
  const defaults = buildDefaultContent(preset);
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const candidate = raw as Record<string, unknown>;
  const topText = typeof candidate.topText === "string" ? candidate.topText : defaults.topText;
  const bottomText = typeof candidate.bottomText === "string" ? candidate.bottomText : defaults.bottomText;
  const topHighlightPhrases = Array.isArray(candidate.topHighlightPhrases)
    ? candidate.topHighlightPhrases.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : defaults.topHighlightPhrases;
  const highlights = normalizeTemplateCaptionHighlights(candidate.highlights, {
    top: topText,
    bottom: bottomText
  });
  if (highlights.top.length === 0 && highlights.bottom.length === 0 && (topHighlightPhrases?.length ?? 0) > 0) {
    highlights.top = buildTemplateHighlightSpansFromPhrases({
      text: topText,
      annotations: topHighlightPhrases!.map((phrase) => ({
        phrase,
        slotId: "slot1" as const
      }))
    });
  }
  return {
    topText,
    bottomText,
    channelName: typeof candidate.channelName === "string" ? candidate.channelName : defaults.channelName,
    channelHandle: typeof candidate.channelHandle === "string" ? candidate.channelHandle : defaults.channelHandle,
    highlights,
    topHighlightPhrases,
    topFontScale:
      typeof candidate.topFontScale === "number" && Number.isFinite(candidate.topFontScale)
        ? clampStage3TextScaleUi(candidate.topFontScale)
        : defaults.topFontScale,
    bottomFontScale:
      typeof candidate.bottomFontScale === "number" && Number.isFinite(candidate.bottomFontScale)
        ? clampStage3TextScaleUi(candidate.bottomFontScale)
        : defaults.bottomFontScale,
    previewScale:
      typeof candidate.previewScale === "number" && Number.isFinite(candidate.previewScale)
        ? clamp(candidate.previewScale, 0.18, 0.8)
        : defaults.previewScale,
    mediaAsset:
      candidate.mediaAsset === null
        ? null
        : typeof candidate.mediaAsset === "string"
          ? candidate.mediaAsset
          : defaults.mediaAsset,
    backgroundAsset:
      candidate.backgroundAsset === null
        ? null
        : typeof candidate.backgroundAsset === "string"
          ? candidate.backgroundAsset
          : defaults.backgroundAsset,
    avatarAsset:
      candidate.avatarAsset === null
        ? null
        : typeof candidate.avatarAsset === "string"
          ? candidate.avatarAsset
          : defaults.avatarAsset
  };
}

function normalizeSession(raw: unknown, preset: Stage3DesignLabPreset): TemplateCalibrationSession {
  const defaults = buildDefaultSession(preset);
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const candidate = raw as Record<string, unknown>;
  const referenceRect = normalizeUnitRect({
    x: candidate.referenceCropX,
    y: candidate.referenceCropY,
    width: candidate.referenceCropWidth,
    height: candidate.referenceCropHeight,
    fallback: defaults
  });
  const rawSplitPosition =
    typeof candidate.splitPosition === "number" && Number.isFinite(candidate.splitPosition)
      ? candidate.splitPosition
      : defaults.splitPosition;
  const normalizedSplitPosition = rawSplitPosition > 1 ? rawSplitPosition / 100 : rawSplitPosition;
  return {
    templateId: preset.templateId,
    status: normalizeStatus(candidate.status, defaults.status),
    compareMode: normalizeCompareMode(candidate.compareMode),
    compareScope: normalizeCompareScope(candidate.compareScope),
    overlayOpacity:
      typeof candidate.overlayOpacity === "number" && Number.isFinite(candidate.overlayOpacity)
        ? clamp(candidate.overlayOpacity, 0, 1)
        : defaults.overlayOpacity,
    overlayBlendMode:
      candidate.overlayBlendMode === "difference" || candidate.overlayBlendMode === "normal"
        ? candidate.overlayBlendMode
        : defaults.overlayBlendMode,
    referenceOffsetX:
      typeof candidate.referenceOffsetX === "number" && Number.isFinite(candidate.referenceOffsetX)
        ? candidate.referenceOffsetX
        : defaults.referenceOffsetX,
    referenceOffsetY:
      typeof candidate.referenceOffsetY === "number" && Number.isFinite(candidate.referenceOffsetY)
        ? candidate.referenceOffsetY
        : defaults.referenceOffsetY,
    referenceScale:
      typeof candidate.referenceScale === "number" && Number.isFinite(candidate.referenceScale)
        ? clamp(candidate.referenceScale, 0.5, 1.6)
        : defaults.referenceScale,
    ...referenceRect,
    zoom:
      typeof candidate.zoom === "number" && Number.isFinite(candidate.zoom)
        ? clamp(candidate.zoom, 0.5, 3)
        : defaults.zoom,
    panX:
      typeof candidate.panX === "number" && Number.isFinite(candidate.panX) ? candidate.panX : defaults.panX,
    panY:
      typeof candidate.panY === "number" && Number.isFinite(candidate.panY) ? candidate.panY : defaults.panY,
    splitPosition:
      clamp(normalizedSplitPosition, 0.05, 0.95),
    acceptedMismatchThreshold:
      typeof candidate.acceptedMismatchThreshold === "number" && Number.isFinite(candidate.acceptedMismatchThreshold)
        ? clamp(candidate.acceptedMismatchThreshold, 0.001, 1)
        : defaults.acceptedMismatchThreshold
  };
}

function getTemplateDir(templateId: string): string {
  return path.join(DESIGN_TEMPLATES_ROOT, sanitizeTemplateId(templateId));
}

function getArtifactsDir(templateId: string): string {
  return path.join(getTemplateDir(templateId), ARTIFACTS_DIR_NAME);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDirNames(dirPath: string): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(dirPath));
  } catch {
    return new Set();
  }
}

async function ensureTemplateDirs(templateId: string): Promise<void> {
  await fs.mkdir(getTemplateDir(templateId), { recursive: true });
  await fs.mkdir(getArtifactsDir(templateId), { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function resolveAssetPath(
  templateId: string,
  kind: TemplateAssetKind,
  knownEntries?: ReadonlySet<string>
): Promise<string | null> {
  const templateDir = getTemplateDir(templateId);
  const baseName = ASSET_BASE_NAMES[kind];
  const entries = knownEntries ?? (await readDirNames(templateDir));
  for (const extension of IMAGE_EXTENSIONS) {
    const fileName = `${baseName}${extension}`;
    if (entries.has(fileName)) {
      return path.join(templateDir, fileName);
    }
  }
  return null;
}

async function resolveArtifactPath(
  templateId: string,
  fileName: string,
  knownEntries?: ReadonlySet<string>
): Promise<string | null> {
  const artifactsDir = getArtifactsDir(templateId);
  const entries = knownEntries ?? (await readDirNames(artifactsDir));
  return entries.has(fileName) ? path.join(artifactsDir, fileName) : null;
}

async function fileVersion(filePath: string | null): Promise<string | null> {
  if (!filePath) {
    return null;
  }
  try {
    const stat = await fs.stat(filePath);
    return String(Math.floor(stat.mtimeMs));
  } catch {
    return null;
  }
}

function buildAssetUrl(templateId: string, assetName: string, version: string | null): string {
  const base = `/api/design/template-sessions/${encodeURIComponent(templateId)}/asset/${encodeURIComponent(assetName)}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

async function readArtifacts(templateId: string): Promise<{
  artifacts: TemplateCalibrationArtifacts;
  report: TemplateDiffReport | null;
}> {
  const artifactEntries = await readDirNames(getArtifactsDir(templateId));
  const currentPath = await resolveArtifactPath(templateId, "current.png", artifactEntries);
  const diffPath = await resolveArtifactPath(templateId, "diff.png", artifactEntries);
  const heatmapPath = await resolveArtifactPath(templateId, "heatmap.png", artifactEntries);
  const reportPath = await resolveArtifactPath(templateId, "report.json", artifactEntries);

  return {
    artifacts: {
      currentPngUrl: currentPath
        ? buildAssetUrl(templateId, "artifacts/current.png", await fileVersion(currentPath))
        : null,
      diffPngUrl: diffPath
        ? buildAssetUrl(templateId, "artifacts/diff.png", await fileVersion(diffPath))
        : null,
      heatmapPngUrl: heatmapPath
        ? buildAssetUrl(templateId, "artifacts/heatmap.png", await fileVersion(heatmapPath))
        : null
    },
    report: reportPath ? await readJsonFile<TemplateDiffReport>(reportPath) : null
  };
}

export async function ensureTemplateCalibrationSeed(templateId: string): Promise<void> {
  const preset = getStage3DesignLabPreset(templateId);
  const templateDir = getTemplateDir(preset.templateId);
  await ensureTemplateDirs(preset.templateId);

  const contentPath = path.join(templateDir, "content.json");
  const sessionPath = path.join(templateDir, "session.json");
  const notesPath = path.join(templateDir, "notes.md");
  const figmaSpecPath = path.join(templateDir, "figma-spec.json");

  if (!(await pathExists(contentPath))) {
    await fs.writeFile(contentPath, `${JSON.stringify(buildDefaultContent(preset), null, 2)}\n`);
  }
  if (!(await pathExists(sessionPath))) {
    await fs.writeFile(sessionPath, `${JSON.stringify(buildDefaultSession(preset), null, 2)}\n`);
  }
  if (!(await pathExists(notesPath))) {
    await fs.writeFile(notesPath, `# ${preset.label}\n\n${preset.note}\n`);
  }
  if (!(await pathExists(figmaSpecPath))) {
    await fs.writeFile(figmaSpecPath, `${JSON.stringify(getTemplateFigmaSpec(preset.templateId), null, 2)}\n`);
  }
}

export async function readTemplateCalibrationBundle(templateId: string): Promise<TemplateCalibrationBundle> {
  const preset = getStage3DesignLabPreset(templateId);
  await ensureTemplateCalibrationSeed(preset.templateId);
  const templateDir = getTemplateDir(preset.templateId);
  const templateEntries = await readDirNames(templateDir);
  const [contentRaw, sessionRaw, notes, referencePath, maskPath, mediaPath, backgroundPath, avatarPath, artifactState] =
    await Promise.all([
      readJsonFile<unknown>(path.join(templateDir, "content.json")),
      readJsonFile<unknown>(path.join(templateDir, "session.json")),
      readTextFile(path.join(templateDir, "notes.md")),
      resolveAssetPath(preset.templateId, "reference", templateEntries),
      resolveAssetPath(preset.templateId, "mask", templateEntries),
      resolveAssetPath(preset.templateId, "media", templateEntries),
      resolveAssetPath(preset.templateId, "background", templateEntries),
      resolveAssetPath(preset.templateId, "avatar", templateEntries),
      readArtifacts(preset.templateId)
    ]);

  return {
    templateId: preset.templateId,
    content: normalizeContentFixture(contentRaw, preset),
    session: normalizeSession(sessionRaw, preset),
    notes,
    referenceImageUrl: referencePath
      ? buildAssetUrl(preset.templateId, path.basename(referencePath), await fileVersion(referencePath))
      : null,
    maskImageUrl: maskPath ? buildAssetUrl(preset.templateId, path.basename(maskPath), await fileVersion(maskPath)) : null,
    mediaAssetUrl: mediaPath ? buildAssetUrl(preset.templateId, path.basename(mediaPath), await fileVersion(mediaPath)) : null,
    backgroundAssetUrl: backgroundPath
      ? buildAssetUrl(preset.templateId, path.basename(backgroundPath), await fileVersion(backgroundPath))
      : null,
    avatarAssetUrl: avatarPath ? buildAssetUrl(preset.templateId, path.basename(avatarPath), await fileVersion(avatarPath)) : null,
    artifacts: artifactState.artifacts,
    report: artifactState.report
  };
}

export async function listTemplateCalibrationBundles(): Promise<TemplateCalibrationBundle[]> {
  const presets = listStage3DesignLabPresets();
  return Promise.all(presets.map((preset) => readTemplateCalibrationBundle(preset.templateId)));
}

export async function saveTemplateCalibrationData(input: {
  templateId: string;
  content?: TemplateContentFixture;
  session?: TemplateCalibrationSession;
  notes?: string;
}): Promise<TemplateCalibrationBundle> {
  const preset = getStage3DesignLabPreset(input.templateId);
  const templateDir = getTemplateDir(preset.templateId);
  await ensureTemplateCalibrationSeed(preset.templateId);

  if (input.content) {
    await fs.writeFile(
      path.join(templateDir, "content.json"),
      `${JSON.stringify(normalizeContentFixture(input.content, preset), null, 2)}\n`
    );
  }
  if (input.session) {
    await fs.writeFile(
      path.join(templateDir, "session.json"),
      `${JSON.stringify(normalizeSession(input.session, preset), null, 2)}\n`
    );
  }
  if (typeof input.notes === "string") {
    await fs.writeFile(path.join(templateDir, "notes.md"), input.notes);
  }

  return readTemplateCalibrationBundle(preset.templateId);
}

export async function saveTemplateCalibrationImage(params: {
  templateId: string;
  kind: TemplateAssetKind;
  bytes: Uint8Array;
}): Promise<TemplateCalibrationBundle> {
  const preset = getStage3DesignLabPreset(params.templateId);
  await ensureTemplateCalibrationSeed(preset.templateId);
  const templateDir = getTemplateDir(preset.templateId);

  for (const extension of IMAGE_EXTENSIONS) {
    await fs.rm(path.join(templateDir, `${ASSET_BASE_NAMES[params.kind]}${extension}`), { force: true }).catch(() => undefined);
  }
  await fs.writeFile(path.join(templateDir, `${ASSET_BASE_NAMES[params.kind]}.png`), params.bytes);
  return readTemplateCalibrationBundle(preset.templateId);
}

export async function saveTemplateCalibrationArtifacts(params: {
  templateId: string;
  currentPng: Uint8Array;
  diffPng: Uint8Array;
  heatmapPng?: Uint8Array | null;
  report: TemplateDiffReport;
}): Promise<TemplateCalibrationBundle> {
  const preset = getStage3DesignLabPreset(params.templateId);
  const artifactsDir = getArtifactsDir(preset.templateId);
  await ensureTemplateCalibrationSeed(preset.templateId);
  await fs.writeFile(path.join(artifactsDir, "current.png"), params.currentPng);
  await fs.writeFile(path.join(artifactsDir, "diff.png"), params.diffPng);
  if (params.heatmapPng && params.heatmapPng.length > 0) {
    await fs.writeFile(path.join(artifactsDir, "heatmap.png"), params.heatmapPng);
  } else {
    await fs.rm(path.join(artifactsDir, "heatmap.png"), { force: true }).catch(() => undefined);
  }
  await fs.writeFile(path.join(artifactsDir, "report.json"), `${JSON.stringify(params.report, null, 2)}\n`);
  return readTemplateCalibrationBundle(preset.templateId);
}

export async function readTemplateCalibrationAsset(params: {
  templateId: string;
  assetPath: string;
}): Promise<{ filePath: string; contentType: string } | null> {
  const templateId = sanitizeTemplateId(params.templateId);
  const assetPath = params.assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.join(getTemplateDir(templateId), assetPath);
  const templateDir = getTemplateDir(templateId);
  if (!resolved.startsWith(templateDir)) {
    return null;
  }
  if (!(await pathExists(resolved))) {
    return null;
  }
  const lower = resolved.toLowerCase();
  const contentType = lower.endsWith(".json")
    ? "application/json; charset=utf-8"
    : lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : lower.endsWith(".webp")
          ? "image/webp"
          : lower.endsWith(".avif")
            ? "image/avif"
            : "application/octet-stream";
  return { filePath: resolved, contentType };
}
