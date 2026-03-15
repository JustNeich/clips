"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toCanvas } from "html-to-image";
import {
  TemplateCalibrationBundle,
  TemplateCalibrationSession,
  TemplateCalibrationStatus,
  TemplateCompareMode,
  TemplateCompareScope,
  TemplateContentFixture,
  TemplateDiffReport
} from "./types";
import { Stage3TemplateRenderer } from "../../lib/stage3-template-renderer";
import {
  Stage3TemplateViewport,
  getTemplatePreviewViewportMetrics
} from "../../lib/stage3-template-viewport";
import {
  TEMPLATE_COMPARE_MODE_OPTIONS,
  TEMPLATE_COMPARE_SCOPE_OPTIONS,
  computeTemplateDiff
} from "../../lib/template-calibration-diff";
import {
  STAGE3_DESIGN_LAB_STATUS_LABELS,
  getStage3DesignLabPreset,
  listStage3DesignLabPresets
} from "../../lib/stage3-design-lab";
import { getTemplateById } from "../../lib/stage3-template";
import {
  resolveTemplateAvatarBorderColor
} from "../../lib/stage3-template-registry";
import { resolveTemplateBackdropNode } from "../../lib/stage3-template-runtime";
import { buildTemplateRenderSnapshot } from "../../lib/stage3-template-core";

type Stage3TemplateLabProps = {
  initialTemplateId?: string | null;
  initialMode?: TemplateCompareMode | null;
  initialBundles: TemplateCalibrationBundle[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

type LiveDiffState = {
  status: "idle" | "computing" | "ready" | "error";
  currentPngUrl: string | null;
  diffPngUrl: string | null;
  heatmapPngUrl: string | null;
  report: TemplateDiffReport | null;
  message: string | null;
};

type ReferenceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const STATUS_OPTIONS: TemplateCalibrationStatus[] = ["queued", "in-progress", "review", "approved"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getReferenceRect(session: TemplateCalibrationSession): ReferenceRect {
  const width = clamp(session.referenceCropWidth, 0.05, 1);
  const height = clamp(session.referenceCropHeight, 0.05, 1);
  return {
    x: clamp(session.referenceCropX, 0, Math.max(0, 1 - width)),
    y: clamp(session.referenceCropY, 0, Math.max(0, 1 - height)),
    width,
    height
  };
}

function suggestReferenceRectForFrame(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number
): ReferenceRect {
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
  const frameAspect = frameWidth / Math.max(1, frameHeight);
  if (Math.abs(sourceAspect - frameAspect) <= 0.0015) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (sourceAspect > frameAspect) {
    const width = clamp(frameAspect / sourceAspect, 0.05, 1);
    return {
      x: (1 - width) / 2,
      y: 0,
      width,
      height: 1
    };
  }
  const height = clamp(sourceAspect / frameAspect, 0.05, 1);
  return {
    x: 0,
    y: (1 - height) / 2,
    width: 1,
    height
  };
}

function buildInitialBundleMap(
  bundles: TemplateCalibrationBundle[],
  initialMode: TemplateCompareMode | null | undefined,
  initialTemplateId: string
): Record<string, TemplateCalibrationBundle> {
  const entries = bundles.map((bundle) => {
    if (bundle.templateId === initialTemplateId && initialMode) {
      return [
        bundle.templateId,
        {
          ...bundle,
          session: {
            ...bundle.session,
            compareMode: initialMode
          }
        }
      ] as const;
    }
    return [bundle.templateId, bundle] as const;
  });
  return Object.fromEntries(entries);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "еще не сохранено";
  }
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((response) => response.blob());
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

async function renderReferenceCanvas(params: {
  src: string;
  width: number;
  height: number;
  session: TemplateCalibrationSession;
}): Promise<HTMLCanvasElement> {
  const image = await loadImage(params.src);
  const canvas = document.createElement("canvas");
  canvas.width = params.width;
  canvas.height = params.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  const referenceRect = getReferenceRect(params.session);
  const sourceX = Math.min(image.naturalWidth - 1, Math.max(0, Math.round(referenceRect.x * image.naturalWidth)));
  const sourceY = Math.min(
    image.naturalHeight - 1,
    Math.max(0, Math.round(referenceRect.y * image.naturalHeight))
  );
  const sourceWidth = Math.max(
    1,
    Math.min(image.naturalWidth - sourceX, Math.round(referenceRect.width * image.naturalWidth))
  );
  const sourceHeight = Math.max(
    1,
    Math.min(image.naturalHeight - sourceY, Math.round(referenceRect.height * image.naturalHeight))
  );

  context.save();
  context.translate(
    params.width / 2 + params.session.referenceOffsetX,
    params.height / 2 + params.session.referenceOffsetY
  );
  context.scale(params.session.referenceScale, params.session.referenceScale);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    -params.width / 2,
    -params.height / 2,
    params.width,
    params.height
  );
  context.restore();
  return canvas;
}

async function renderMaskCanvas(src: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function StageBackground({
  templateId,
  backgroundAssetUrl
}: {
  templateId: string;
  backgroundAssetUrl: string | null;
}): React.JSX.Element {
  if (backgroundAssetUrl) {
    return (
      <img
        src={backgroundAssetUrl}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  }
  return resolveTemplateBackdropNode(templateId);
}

function StageMedia({
  mediaAssetUrl,
  label
}: {
  mediaAssetUrl: string | null;
  label: string;
}): React.JSX.Element {
  if (mediaAssetUrl) {
    return (
      <img
        src={mediaAssetUrl}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at 65% 22%, rgba(255,255,255,0.28), rgba(255,255,255,0) 16%), linear-gradient(180deg, rgba(219, 230, 249, 0.92), rgba(168, 184, 216, 0.96))",
        color: "rgba(13, 21, 34, 0.5)",
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase"
      }}
    >
      {label}
    </div>
  );
}

function ReferenceLayer({
  src,
  session
}: {
  src: string;
  session: TemplateCalibrationSession;
}): React.JSX.Element {
  const referenceRect = getReferenceRect(session);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        opacity: session.overlayOpacity,
        mixBlendMode: session.overlayBlendMode === "difference" ? "difference" : "normal",
        transform: `translate(${session.referenceOffsetX}px, ${session.referenceOffsetY}px) scale(${session.referenceScale})`,
        transformOrigin: "center center",
        pointerEvents: "none",
        userSelect: "none",
        background: "transparent"
      }}
    >
      <img
        src={src}
        alt="Reference"
        draggable={false}
        style={{
          position: "absolute",
          left: `${(-referenceRect.x / referenceRect.width) * 100}%`,
          top: `${(-referenceRect.y / referenceRect.height) * 100}%`,
          width: `${100 / referenceRect.width}%`,
          height: `${100 / referenceRect.height}%`,
          maxWidth: "none",
          maxHeight: "none",
          pointerEvents: "none",
          userSelect: "none",
          objectFit: "fill"
        }}
      />
    </div>
  );
}

function CompareScene({
  templateId,
  content,
  avatarAssetUrl,
  backgroundAssetUrl,
  mediaAssetUrl,
  showGuides,
  compareScope,
  showSafeArea,
  sceneRef
}: {
  templateId: string;
  content: TemplateContentFixture;
  avatarAssetUrl: string | null;
  backgroundAssetUrl: string | null;
  mediaAssetUrl: string | null;
  showGuides: boolean;
  compareScope: TemplateCompareScope;
  showSafeArea: boolean;
  sceneRef?: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const templateConfig = getTemplateById(templateId);
  const effectiveBackgroundAssetUrl = content.backgroundAsset ? backgroundAssetUrl : null;
  const effectiveMediaAssetUrl = content.mediaAsset ? mediaAssetUrl : null;
  const effectiveAvatarAssetUrl = content.avatarAsset ? avatarAssetUrl : null;
  const renderSnapshot = buildTemplateRenderSnapshot({ templateId, content });
  return (
    <Stage3TemplateViewport templateId={templateId} sceneRef={sceneRef} className="calibration-scene-root">
      <Stage3TemplateRenderer
        templateId={templateId}
        content={renderSnapshot.content}
        snapshot={renderSnapshot}
        runtime={{
          showGuides,
          showSafeArea,
          compareScope,
          backgroundNode: <StageBackground templateId={templateId} backgroundAssetUrl={effectiveBackgroundAssetUrl} />,
          mediaNode: <StageMedia mediaAssetUrl={effectiveMediaAssetUrl} label="Media" />,
          avatarNode: effectiveAvatarAssetUrl ? (
            <div
              style={{
                width: renderSnapshot.layout.avatar.width,
                height: renderSnapshot.layout.avatar.height,
                flex: "0 0 auto"
              }}
            >
              <img
                src={effectiveAvatarAssetUrl}
                alt=""
                style={{
                  width: renderSnapshot.layout.avatar.width,
                  height: renderSnapshot.layout.avatar.height,
                  borderRadius: 999,
                  border: `${templateConfig.author.avatarBorder}px solid ${resolveTemplateAvatarBorderColor(templateId)}`,
                  objectFit: "cover",
                  display: "block",
                  boxSizing: "border-box"
                }}
              />
            </div>
          ) : undefined,
          sceneDataId: templateId
        }}
      />
    </Stage3TemplateViewport>
  );
}

export function Stage3TemplateLab({
  initialTemplateId,
  initialMode,
  initialBundles
}: Stage3TemplateLabProps): React.JSX.Element {
  const presets = useMemo(() => listStage3DesignLabPresets(), []);
  const initialPreset = useMemo(() => getStage3DesignLabPreset(initialTemplateId), [initialTemplateId]);
  const [activeTemplateId, setActiveTemplateId] = useState(initialPreset.templateId);
  const [bundleMap, setBundleMap] = useState<Record<string, TemplateCalibrationBundle>>(() =>
    buildInitialBundleMap(initialBundles, initialMode, initialPreset.templateId)
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [liveDiff, setLiveDiff] = useState<LiveDiffState>({
    status: "idle",
    currentPngUrl: null,
    diffPngUrl: null,
    heatmapPngUrl: null,
    report: null,
    message: null
  });

  const persistTimerRef = useRef<number | null>(null);
  const saveResetTimerRef = useRef<number | null>(null);
  const captureSceneRef = useRef<HTMLDivElement | null>(null);
  const bundleMapRef = useRef(bundleMap);

  useEffect(() => {
    bundleMapRef.current = bundleMap;
  }, [bundleMap]);

  const activeBundle = bundleMap[activeTemplateId] ?? initialBundles[0];
  const activePreset = useMemo(() => getStage3DesignLabPreset(activeTemplateId), [activeTemplateId]);
  const activeReferenceRect = useMemo(() => getReferenceRect(activeBundle.session), [activeBundle.session]);
  const frame = getTemplateById(activeTemplateId).frame;
  const previewViewport = useMemo(() => getTemplatePreviewViewportMetrics(activeTemplateId), [activeTemplateId]);
  const displayScale = activeBundle.content.previewScale * activeBundle.session.zoom;
  const compareReady = Boolean(activeBundle.referenceImageUrl);
  const captureReady =
    liveDiff.status === "ready" &&
    Boolean(liveDiff.currentPngUrl) &&
    Boolean(liveDiff.diffPngUrl) &&
    Boolean(liveDiff.report);
  const compareValidityMessage =
    !activeBundle.referenceImageUrl
      ? "Загрузите reference.png, иначе diff не валиден."
      : activeBundle.session.compareScope === "full" && !activeBundle.mediaAssetUrl
        ? "Для full diff загрузите media fixture, иначе сравнение будет шумным."
        : null;

  const schedulePersist = useCallback((templateId: string, bundle: TemplateCalibrationBundle) => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    setSaveState("saving");
    setSaveMessage("Сохраняю calibration session...");
    persistTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/design/template-sessions/${templateId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: bundle.content,
            session: bundle.session,
            notes: bundle.notes
          })
        });
        if (!response.ok) {
          throw new Error("Failed to persist calibration session.");
        }
        const saved = (await response.json()) as TemplateCalibrationBundle;
        setBundleMap((prev) => ({ ...prev, [templateId]: saved }));
        setSaveState("saved");
        setSaveMessage(`Сохранено в repo-backed session · ${formatTimestamp(saved.report?.timestamp ?? null)}`);
        if (saveResetTimerRef.current !== null) {
          window.clearTimeout(saveResetTimerRef.current);
        }
        saveResetTimerRef.current = window.setTimeout(() => {
          setSaveState("idle");
          setSaveMessage(null);
        }, 1800);
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Не удалось сохранить calibration session.");
      }
    }, 260);
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      if (saveResetTimerRef.current !== null) {
        window.clearTimeout(saveResetTimerRef.current);
      }
    };
  }, []);

  const updateActiveBundle = useCallback(
    (updater: (bundle: TemplateCalibrationBundle) => TemplateCalibrationBundle) => {
      const current = bundleMapRef.current[activeTemplateId];
      if (!current) {
        return;
      }
      const next = updater(current);
      bundleMapRef.current = {
        ...bundleMapRef.current,
        [activeTemplateId]: next
      };
      setBundleMap(bundleMapRef.current);
      schedulePersist(activeTemplateId, next);
    },
    [activeTemplateId, schedulePersist]
  );

  const updateContent = useCallback(
    (patch: Partial<TemplateContentFixture>) => {
      updateActiveBundle((bundle) => ({
        ...bundle,
        content: {
          ...bundle.content,
          ...patch
        }
      }));
    },
    [updateActiveBundle]
  );

  const updateSession = useCallback(
    (patch: Partial<TemplateCalibrationSession>) => {
      updateActiveBundle((bundle) => ({
        ...bundle,
        session: {
          ...bundle.session,
          ...patch
        }
      }));
    },
    [updateActiveBundle]
  );

  const updateReferenceCrop = useCallback(
    (patch: Partial<ReferenceRect>) => {
      updateActiveBundle((bundle) => {
        const currentRect = getReferenceRect(bundle.session);
        const width = clamp(patch.width ?? currentRect.width, 0.05, 1);
        const height = clamp(patch.height ?? currentRect.height, 0.05, 1);
        const x = clamp(patch.x ?? currentRect.x, 0, Math.max(0, 1 - width));
        const y = clamp(patch.y ?? currentRect.y, 0, Math.max(0, 1 - height));
        return {
          ...bundle,
          session: {
            ...bundle.session,
            referenceCropX: x,
            referenceCropY: y,
            referenceCropWidth: width,
            referenceCropHeight: height
          }
        };
      });
    },
    [updateActiveBundle]
  );

  const autoNormalizeReference = useCallback(
    async (source?: File | string | null) => {
      const sourceUrl =
        source instanceof File ? URL.createObjectURL(source) : typeof source === "string" ? source : activeBundle.referenceImageUrl;
      if (!sourceUrl) {
        return;
      }
      try {
        const image = await loadImage(sourceUrl);
        updateReferenceCrop(
          suggestReferenceRectForFrame(image.naturalWidth, image.naturalHeight, frame.width, frame.height)
        );
      } finally {
        if (source instanceof File) {
          URL.revokeObjectURL(sourceUrl);
        }
      }
    },
    [activeBundle.referenceImageUrl, frame.height, frame.width, updateReferenceCrop]
  );

  const updateNotes = useCallback(
    (notes: string) => {
      updateActiveBundle((bundle) => ({
        ...bundle,
        notes
      }));
    },
    [updateActiveBundle]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("template", activeTemplateId);
    url.searchParams.set("mode", activeBundle.session.compareMode);
    window.history.replaceState(null, "", url.toString());
  }, [activeBundle.session.compareMode, activeTemplateId]);

  const uploadAsset = useCallback(
    async (kind: "reference" | "mask" | "media" | "background" | "avatar", file: File) => {
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("file", file);
      setSaveState("saving");
      setSaveMessage(`Загружаю ${kind}...`);
      const response = await fetch(`/api/design/template-sessions/${activeTemplateId}/asset`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Не удалось загрузить ${kind}.`);
      }
      const saved = (await response.json()) as TemplateCalibrationBundle;
      bundleMapRef.current = {
        ...bundleMapRef.current,
        [activeTemplateId]: saved
      };
      setBundleMap(bundleMapRef.current);
      setSaveState("saved");
      setSaveMessage(`${kind} сохранен в repo-backed session.`);
    },
    [activeTemplateId]
  );

  const handleAssetChange = useCallback(
    async (
      kind: "reference" | "mask" | "media" | "background" | "avatar",
      event: ChangeEvent<HTMLInputElement>
    ) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      try {
        await uploadAsset(kind, file);
        if (kind === "reference") {
          await autoNormalizeReference(file);
        }
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Не удалось загрузить asset.");
      } finally {
        event.target.value = "";
      }
    },
    [autoNormalizeReference, uploadAsset]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!compareReady) {
        setLiveDiff({
          status: "idle",
          currentPngUrl: null,
          diffPngUrl: null,
          heatmapPngUrl: null,
          report: null,
          message: compareValidityMessage
        });
        return;
      }
      if (compareValidityMessage) {
        setLiveDiff({
          status: "idle",
          currentPngUrl: null,
          diffPngUrl: null,
          heatmapPngUrl: null,
          report: null,
          message: compareValidityMessage
        });
        return;
      }
      const node = captureSceneRef.current;
      if (!node || !activeBundle.referenceImageUrl) {
        return;
      }
      setLiveDiff((prev) => ({ ...prev, status: "computing", message: null }));
      try {
        const currentCanvas = await toCanvas(node, {
          cacheBust: true,
          pixelRatio: 1,
          width: frame.width,
          height: frame.height,
          canvasWidth: frame.width,
          canvasHeight: frame.height,
          backgroundColor: "transparent"
        });
        const referenceCanvas = await renderReferenceCanvas({
          src: activeBundle.referenceImageUrl,
          width: frame.width,
          height: frame.height,
          session: activeBundle.session
        });
        const maskCanvas = activeBundle.maskImageUrl
          ? await renderMaskCanvas(activeBundle.maskImageUrl, frame.width, frame.height)
          : null;
        const currentContext = currentCanvas.getContext("2d");
        const referenceContext = referenceCanvas.getContext("2d");
        if (!currentContext || !referenceContext) {
          throw new Error("Canvas context is unavailable.");
        }
        const computation = computeTemplateDiff({
          templateId: activeTemplateId,
          content: activeBundle.content,
          scope: activeBundle.session.compareScope,
          threshold: activeBundle.session.acceptedMismatchThreshold,
          images: {
            current: currentContext.getImageData(0, 0, frame.width, frame.height),
            reference: referenceContext.getImageData(0, 0, frame.width, frame.height),
            mask: maskCanvas?.getContext("2d")?.getImageData(0, 0, frame.width, frame.height) ?? null
          }
        });
        if (cancelled) {
          return;
        }
        setLiveDiff({
          status: "ready",
          currentPngUrl: currentCanvas.toDataURL("image/png"),
          diffPngUrl: imageDataToDataUrl(computation.diffImageData),
          heatmapPngUrl: imageDataToDataUrl(computation.heatmapImageData),
          report: computation.report,
          message: null
        });
      } catch (error) {
        if (!cancelled) {
          setLiveDiff({
            status: "error",
            currentPngUrl: null,
            diffPngUrl: null,
            heatmapPngUrl: null,
            report: null,
            message: error instanceof Error ? error.message : "Не удалось посчитать diff."
          });
        }
      }
    };

    const timer = window.setTimeout(() => {
      void run();
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeBundle, activeTemplateId, compareReady, compareValidityMessage, frame.height, frame.width]);

  const captureSnapshot = useCallback(async () => {
    const currentPngUrl = liveDiff.currentPngUrl;
    const diffPngUrl = liveDiff.diffPngUrl;
    const report = liveDiff.report;
    if (!captureReady || !currentPngUrl || !diffPngUrl || !report) {
      return;
    }
    setSaveState("saving");
    setSaveMessage("Сохраняю current/diff/report...");
    try {
      const formData = new FormData();
      formData.set("current", new File([await dataUrlToBlob(currentPngUrl)], "current.png", { type: "image/png" }));
      formData.set("diff", new File([await dataUrlToBlob(diffPngUrl)], "diff.png", { type: "image/png" }));
      if (liveDiff.heatmapPngUrl) {
        formData.set(
          "heatmap",
          new File([await dataUrlToBlob(liveDiff.heatmapPngUrl)], "heatmap.png", { type: "image/png" })
        );
      }
      formData.set("report", JSON.stringify(report));
      const response = await fetch(`/api/design/template-sessions/${activeTemplateId}/artifacts`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error("Не удалось сохранить artifacts.");
      }
      const saved = (await response.json()) as TemplateCalibrationBundle;
      bundleMapRef.current = {
        ...bundleMapRef.current,
        [activeTemplateId]: saved
      };
      setBundleMap(bundleMapRef.current);
      setSaveState("saved");
      setSaveMessage(`Artifacts сохранены · mismatch ${formatPercent(saved.report?.mismatchPercent)}`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Не удалось сохранить artifacts.");
    }
  }, [activeTemplateId, captureReady, liveDiff]);

  const renderCompareViewport = () => {
    const transform = `translate(${activeBundle.session.panX}px, ${activeBundle.session.panY}px) scale(${displayScale})`;
    const centeredViewportStyle = {
      transform,
      width: previewViewport.width,
      height: previewViewport.height,
      marginLeft: -(previewViewport.width / 2),
      marginTop: -(previewViewport.height / 2)
    } as const;
    const scene = (
      <div className="calibration-scene-shell" style={centeredViewportStyle}>
        <CompareScene
          templateId={activeTemplateId}
          content={activeBundle.content}
          avatarAssetUrl={activeBundle.avatarAssetUrl}
          backgroundAssetUrl={activeBundle.backgroundAssetUrl}
          mediaAssetUrl={activeBundle.mediaAssetUrl}
          showGuides={showGuides}
          compareScope={activeBundle.session.compareScope}
          showSafeArea={showSafeArea}
        />
      </div>
    );

    if (activeBundle.session.compareMode === "side-by-side") {
      return (
        <div className="calibration-side-by-side">
          <div className="calibration-panel">{scene}</div>
          <div className="calibration-panel">
            {activeBundle.referenceImageUrl ? (
              <div className="calibration-reference-shell" style={centeredViewportStyle}>
                <div
                  style={{
                    position: "relative",
                    width: previewViewport.width,
                    height: previewViewport.height,
                    borderRadius: previewViewport.borderRadius,
                    overflow: "hidden"
                  }}
                >
                  <ReferenceLayer src={activeBundle.referenceImageUrl} session={activeBundle.session} />
                </div>
              </div>
            ) : (
              <div className="calibration-empty-state">Загрузите reference.png для side-by-side.</div>
            )}
          </div>
        </div>
      );
    }

    if (activeBundle.session.compareMode === "difference" || activeBundle.session.compareMode === "heatmap") {
      const compareImage =
        activeBundle.session.compareMode === "difference" ? liveDiff.diffPngUrl : liveDiff.heatmapPngUrl;
      return (
        <div className="calibration-single-panel">
          {compareImage ? (
            <Stage3TemplateViewport templateId={activeTemplateId}>
              <img src={compareImage} alt="Diff" className="calibration-diff-image" />
            </Stage3TemplateViewport>
          ) : (
            <div className="calibration-empty-state">{liveDiff.message ?? "Нет diff для отображения."}</div>
          )}
        </div>
      );
    }

    return (
      <div className="calibration-single-panel">
        {scene}
        {activeBundle.referenceImageUrl ? (
          activeBundle.session.compareMode === "split-swipe" ? (
            <>
              <div
                className="calibration-reference-clip"
                style={{
                  clipPath: `inset(0 ${100 - activeBundle.session.splitPosition * 100}% 0 0)`
                }}
              >
                <div className="calibration-scene-shell" style={centeredViewportStyle}>
                  <div
                    style={{
                      position: "relative",
                      width: previewViewport.width,
                      height: previewViewport.height,
                      borderRadius: previewViewport.borderRadius,
                      overflow: "hidden"
                    }}
                  >
                    <ReferenceLayer src={activeBundle.referenceImageUrl} session={activeBundle.session} />
                  </div>
                </div>
              </div>
              <div
                className="calibration-split-handle"
                style={{ left: `${activeBundle.session.splitPosition * 100}%` }}
              />
            </>
          ) : (
            <div className="calibration-scene-shell" style={centeredViewportStyle}>
              <div
                style={{
                  position: "relative",
                  width: previewViewport.width,
                  height: previewViewport.height,
                  borderRadius: previewViewport.borderRadius,
                  overflow: "hidden"
                }}
              >
                <ReferenceLayer src={activeBundle.referenceImageUrl} session={activeBundle.session} />
              </div>
            </div>
          )
        ) : null}
      </div>
    );
  };

  return (
    <main className="template-road-page" data-template-road-root={activeTemplateId}>
      <header className="template-road-header">
        <div>
          <p className="kicker">Stage 3 Template Calibration</p>
          <h1>Pixel-Perfect Workbench</h1>
          <p className="subtle-text">
            Один канонический renderer для lab, editor preview и Remotion. Overlay, diff и artifacts
            теперь строятся поверх одной и той же сцены.
          </p>
        </div>
        <div className="template-road-header-pills">
          <span className="meta-pill">Repo-backed session</span>
          <span className="meta-pill">{activeTemplateId}</span>
          <span className={`meta-pill ${saveState === "saved" ? "ok" : saveState === "error" ? "warn" : ""}`}>
            {saveState === "saving"
              ? "Saving..."
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Error"
                  : "Idle"}
          </span>
        </div>
      </header>

      <section className="template-road-grid">
        <aside className="template-road-sidebar">
          <section className="control-card template-road-card">
            <h3>Процесс</h3>
            <ol className="template-road-steps">
              <li>Выберите шаблон слева.</li>
              <li>Загрузите reference и exact content fixtures.</li>
              <li>Крутите overlay/diff до тех пор, пока mismatch не станет приемлемым.</li>
              <li>Нажмите Capture Snapshot, чтобы записать current/diff/report в репозиторий.</li>
            </ol>
            {saveMessage ? <p className="subtle-text">{saveMessage}</p> : null}
          </section>

          <section className="control-card template-road-card">
            <h3>Шаблоны</h3>
            <div className="template-road-template-list">
              {presets.map((preset) => {
                const bundle = bundleMap[preset.templateId];
                const isActive = activeTemplateId === preset.templateId;
                return (
                  <button
                    key={preset.templateId}
                    type="button"
                    className={`template-road-template-item ${isActive ? "active" : ""}`}
                    onClick={() => setActiveTemplateId(preset.templateId)}
                    data-template-road-template={preset.templateId}
                  >
                    <div>
                      <strong>{preset.label}</strong>
                      <p>{preset.note}</p>
                    </div>
                    <div className="template-road-template-meta">
                      <span className={`template-lab-template-status status-${bundle.session.status}`}>
                        {STAGE3_DESIGN_LAB_STATUS_LABELS[bundle.session.status]}
                      </span>
                      <span className="template-road-template-score">
                        {formatPercent(bundle.report?.mismatchPercent)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="control-card template-road-card">
            <h3>Контент</h3>
            <label className="field-label">
              Верхний текст
              <textarea
                className="text-input template-road-textarea"
                rows={6}
                value={activeBundle.content.topText}
                onChange={(event) => updateContent({ topText: event.target.value })}
              />
            </label>
            <label className="field-label">
              Нижний текст
              <textarea
                className="text-input template-road-textarea"
                rows={4}
                value={activeBundle.content.bottomText}
                onChange={(event) => updateContent({ bottomText: event.target.value })}
              />
            </label>
            <div className="template-road-field-grid">
              <label className="field-label">
                Канал
                <input
                  className="text-input"
                  value={activeBundle.content.channelName}
                  onChange={(event) => updateContent({ channelName: event.target.value })}
                />
              </label>
              <label className="field-label">
                Handle
                <input
                  className="text-input"
                  value={activeBundle.content.channelHandle}
                  onChange={(event) => updateContent({ channelHandle: event.target.value })}
                />
              </label>
            </div>
            <div className="template-road-field-grid">
              <label className="field-label">
                Top scale
                <input
                  type="range"
                  min="0.7"
                  max="1.9"
                  step="0.01"
                  value={activeBundle.content.topFontScale}
                  onChange={(event) => updateContent({ topFontScale: Number(event.target.value) })}
                />
              </label>
              <label className="field-label">
                Bottom scale
                <input
                  type="range"
                  min="0.7"
                  max="1.9"
                  step="0.01"
                  value={activeBundle.content.bottomFontScale}
                  onChange={(event) => updateContent({ bottomFontScale: Number(event.target.value) })}
                />
              </label>
            </div>
            <label className="field-label">
              Статус
              <div className="template-road-status-row">
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`template-lab-status-button ${activeBundle.session.status === status ? "active" : ""}`}
                    onClick={() => updateSession({ status })}
                  >
                    {STAGE3_DESIGN_LAB_STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            </label>
          </section>
        </aside>

        <section className="template-road-preview-column">
          <section className="control-card template-road-card template-road-preview-card">
            <div className="template-road-toolbar">
              <div className="template-road-toolbar-group">
                {TEMPLATE_COMPARE_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`btn btn-ghost ${activeBundle.session.compareMode === option.value ? "is-active" : ""}`}
                    onClick={() => updateSession({ compareMode: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="template-road-toolbar-group">
                <select
                  className="text-input"
                  value={activeBundle.session.compareScope}
                  onChange={(event) =>
                    updateSession({ compareScope: event.target.value as TemplateCompareScope })
                  }
                >
                  {TEMPLATE_COMPARE_SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={captureSnapshot}
                  data-template-road-capture
                  data-template-road-capture-state={captureReady ? "ready" : liveDiff.status}
                  disabled={!captureReady}
                  title={!captureReady ? compareValidityMessage ?? "Diff еще не готов." : undefined}
                >
                  Capture Snapshot
                </button>
              </div>
            </div>

            <div className="template-road-toolbar template-road-toolbar-secondary">
              <label className="template-road-inline-control">
                Overlay
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={activeBundle.session.overlayOpacity}
                  onChange={(event) =>
                    updateSession({ overlayOpacity: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Ref scale
                <input
                  type="range"
                  min="0.85"
                  max="1.15"
                  step="0.001"
                  value={activeBundle.session.referenceScale}
                  onChange={(event) =>
                    updateSession({ referenceScale: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Zoom
                <input
                  type="range"
                  min="0.6"
                  max="1.8"
                  step="0.01"
                  value={activeBundle.session.zoom}
                  onChange={(event) => updateSession({ zoom: Number(event.target.value) })}
                />
              </label>
              <label className="template-road-inline-control checkbox">
                <input type="checkbox" checked={showGuides} onChange={() => setShowGuides((prev) => !prev)} />
                Guides
              </label>
              <label className="template-road-inline-control checkbox">
                <input
                  type="checkbox"
                  checked={showSafeArea}
                  onChange={() => setShowSafeArea((prev) => !prev)}
                />
                Safe area
              </label>
            </div>

            <div className="template-road-toolbar template-road-toolbar-secondary">
              <label className="template-road-inline-control">
                X
                <input
                  type="range"
                  min="-120"
                  max="120"
                  step="1"
                  value={activeBundle.session.referenceOffsetX}
                  onChange={(event) =>
                    updateSession({ referenceOffsetX: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Y
                <input
                  type="range"
                  min="-120"
                  max="120"
                  step="1"
                  value={activeBundle.session.referenceOffsetY}
                  onChange={(event) =>
                    updateSession({ referenceOffsetY: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Crop X
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, 1 - activeReferenceRect.width)}
                  step="0.001"
                  value={activeReferenceRect.x}
                  disabled={!activeBundle.referenceImageUrl}
                  onChange={(event) =>
                    updateReferenceCrop({ x: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Crop Y
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, 1 - activeReferenceRect.height)}
                  step="0.001"
                  value={activeReferenceRect.y}
                  disabled={!activeBundle.referenceImageUrl}
                  onChange={(event) =>
                    updateReferenceCrop({ y: Number(event.target.value) })
                  }
                />
              </label>
            </div>

            <div className="template-road-toolbar template-road-toolbar-secondary">
              <label className="template-road-inline-control">
                Crop W
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.001"
                  value={activeReferenceRect.width}
                  disabled={!activeBundle.referenceImageUrl}
                  onChange={(event) =>
                    updateReferenceCrop({ width: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Crop H
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.001"
                  value={activeReferenceRect.height}
                  disabled={!activeBundle.referenceImageUrl}
                  onChange={(event) =>
                    updateReferenceCrop({ height: Number(event.target.value) })
                  }
                />
              </label>
              <label className="template-road-inline-control">
                Split
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.01"
                  value={activeBundle.session.splitPosition}
                  onChange={(event) =>
                    updateSession({ splitPosition: Number(event.target.value) })
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void autoNormalizeReference()}
                disabled={!activeBundle.referenceImageUrl}
              >
                Auto 9:16 crop
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  updateSession({
                    referenceOffsetX: 0,
                    referenceOffsetY: 0,
                    referenceScale: 1,
                    panX: 0,
                    panY: 0,
                    zoom: 1,
                    splitPosition: 0.5
                  })
                }
              >
                Reset alignment
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  updateReferenceCrop({
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                  })
                }
                disabled={!activeBundle.referenceImageUrl}
              >
                Reset bounds
              </button>
            </div>

            <div className="template-road-health-row">
              <span className={`meta-pill ${compareReady ? "ok" : "warn"}`}>
                {compareReady ? "Reference locked" : "Reference missing"}
              </span>
              <span className={`meta-pill ${compareReady ? "ok" : ""}`}>
                Crop {Math.round(activeReferenceRect.width * 100)}x{Math.round(activeReferenceRect.height * 100)}%
              </span>
              <span className={`meta-pill ${compareValidityMessage ? "warn" : "ok"}`}>
                {compareValidityMessage ? "Diff invalid" : "Diff valid"}
              </span>
              <span className="meta-pill" data-template-road-live-mismatch>
                Live mismatch {formatPercent(liveDiff.report?.mismatchPercent)}
              </span>
              <span className="meta-pill">
                Chrome mismatch {formatPercent(liveDiff.report?.chromeMismatchPercent)}
              </span>
            </div>

            {compareValidityMessage ? <p className="subtle-text">{compareValidityMessage}</p> : null}
            {activeBundle.referenceImageUrl ? (
              <p className="subtle-text">
                Reference bounds определяют, какая область загруженного файла становится каноническим кадром 1080x1920.
              </p>
            ) : null}

            <div className="template-road-preview-shell" data-template-road-preview>
              {renderCompareViewport()}
            </div>
          </section>

          <section className="control-card template-road-card">
            <h3>Notes</h3>
            <textarea
              className="text-input template-road-textarea template-road-notes"
              rows={7}
              value={activeBundle.notes}
              onChange={(event) => updateNotes(event.target.value)}
            />
          </section>
        </section>

        <aside className="template-road-reference-column">
          <section className="control-card template-road-card">
            <h3>Reference Session</h3>
            <p className="subtle-text">
              Эти assets пишутся прямо в <code>design/templates/{activeTemplateId}</code>.
            </p>
            <div className="template-road-upload-list">
              {([
                ["reference", "reference.png"],
                ["media", "media.png"],
                ["background", "background.png"],
                ["avatar", "avatar.png"],
                ["mask", "mask.png"]
              ] as const).map(([kind, label]) => (
                <label key={kind} className="field-label template-road-upload-item">
                  <span>{label}</span>
                  <input type="file" accept="image/*" onChange={(event) => void handleAssetChange(kind, event)} />
                </label>
              ))}
            </div>
          </section>

          <section className="control-card template-road-card">
            <h3>Последний report</h3>
            <div className="template-road-report-grid">
              <div>
                <span className="subtle-text">Статус</span>
                <strong>{activeBundle.report?.pass ? "PASS" : "REVIEW"}</strong>
              </div>
              <div>
                <span className="subtle-text">Mismatch</span>
                <strong>{formatPercent(activeBundle.report?.mismatchPercent)}</strong>
              </div>
              <div>
                <span className="subtle-text">Chrome</span>
                <strong>{formatPercent(activeBundle.report?.chromeMismatchPercent)}</strong>
              </div>
              <div>
                <span className="subtle-text">Снимок</span>
                <strong>{formatTimestamp(activeBundle.report?.timestamp ?? null)}</strong>
              </div>
            </div>
          </section>

          <section className="control-card template-road-card">
            <h3>Live Artifacts</h3>
            <div className="template-road-artifacts">
              {liveDiff.diffPngUrl ? (
                <img src={liveDiff.diffPngUrl} alt="Live diff" className="template-road-artifact-image" />
              ) : (
                <div className="calibration-empty-state">{liveDiff.message ?? "Diff появится здесь."}</div>
              )}
              {liveDiff.heatmapPngUrl ? (
                <img src={liveDiff.heatmapPngUrl} alt="Heatmap" className="template-road-artifact-image" />
              ) : null}
            </div>
          </section>

          <section className="control-card template-road-card">
            <h3>Saved Artifacts</h3>
            <div className="template-road-artifacts">
              {activeBundle.artifacts.diffPngUrl ? (
                <img
                  src={activeBundle.artifacts.diffPngUrl}
                  alt="Saved diff"
                  className="template-road-artifact-image"
                />
              ) : (
                <div className="calibration-empty-state">Capture Snapshot создаст diff.png и report.json.</div>
              )}
              {activeBundle.artifacts.heatmapPngUrl ? (
                <img
                  src={activeBundle.artifacts.heatmapPngUrl}
                  alt="Saved heatmap"
                  className="template-road-artifact-image"
                />
              ) : null}
            </div>
          </section>

          <section className="control-card template-road-card">
            <h3>Checklist</h3>
            <ul className="template-lab-checklist">
              {activePreset.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </section>

      <div className="calibration-capture-root" aria-hidden="true">
        <CompareScene
          templateId={activeTemplateId}
          content={activeBundle.content}
          avatarAssetUrl={activeBundle.avatarAssetUrl}
          backgroundAssetUrl={activeBundle.backgroundAssetUrl}
          mediaAssetUrl={activeBundle.mediaAssetUrl}
          showGuides={false}
          compareScope={activeBundle.session.compareScope}
          showSafeArea={false}
          sceneRef={captureSceneRef}
        />
      </div>
    </main>
  );
}
