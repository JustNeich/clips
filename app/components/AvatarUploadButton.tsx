"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  buildPositionedAvatarUpload,
  createDefaultAvatarCropSelection,
  resolveAvatarCropBounds,
  resolveAvatarPreviewMetrics,
  resizeAvatarCropSelection,
  translateAvatarCropSelection,
  type AvatarCropSelection,
  type AvatarPreviewMetrics
} from "./avatar-upload-support";

type AvatarUploadPreview = {
  file: File;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
};

type AvatarCropInteraction = {
  mode: "move" | "resize";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  stageRect: DOMRect;
  previewMetrics: AvatarPreviewMetrics;
  selection: AvatarCropSelection;
};

export type AvatarUploadButtonProps = {
  buttonLabel: string;
  buttonClassName: string;
  disabled?: boolean;
  onAvatarReady: (file: File) => Promise<void> | void;
};

function getUiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function readAvatarUploadPreview(file: File): Promise<AvatarUploadPreview> {
  const previewUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.decoding = "async";
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Не удалось открыть изображение для предпросмотра."));
      nextImage.src = previewUrl;
    });
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    return {
      file,
      previewUrl,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

export function AvatarUploadButton({
  buttonLabel,
  buttonClassName,
  disabled = false,
  onAvatarReady
}: AvatarUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<AvatarCropInteraction | null>(null);
  const [mounted, setMounted] = useState(false);
  const [editorState, setEditorState] = useState<AvatarUploadPreview | null>(null);
  const [cropSelection, setCropSelection] = useState<AvatarCropSelection>(
    createDefaultAvatarCropSelection()
  );
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [isApplying, setIsApplying] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!editorState) {
      return;
    }
    return () => {
      URL.revokeObjectURL(editorState.previewUrl);
    };
  }, [editorState]);

  useEffect(() => {
    if (!editorState) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isApplying) {
        interactionRef.current = null;
        setEditorState(null);
        setEditorError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editorState, isApplying]);

  useEffect(() => {
    if (!editorState) {
      return;
    }
    const element = previewStageRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const nextWidth = element.clientWidth;
      const nextHeight = element.clientHeight;
      setStageSize((current) => {
        if (Math.abs(current.width - nextWidth) < 1 && Math.abs(current.height - nextHeight) < 1) {
          return current;
        }
        return {
          width: Math.max(0, nextWidth),
          height: Math.max(0, nextHeight)
        };
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => {
        window.removeEventListener("resize", updateSize);
      };
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [editorState]);

  useEffect(() => {
    if (!editorState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();

      if (interaction.mode === "move") {
        const scale = interaction.previewMetrics.scale;
        if (scale <= 0) {
          return;
        }
        setCropSelection(
          translateAvatarCropSelection({
            sourceWidth: editorState.naturalWidth,
            sourceHeight: editorState.naturalHeight,
            selection: interaction.selection,
            deltaSourceX: (event.clientX - interaction.startClientX) / scale,
            deltaSourceY: (event.clientY - interaction.startClientY) / scale
          })
        );
        return;
      }

      const scale = interaction.previewMetrics.scale;
      if (scale <= 0) {
        return;
      }
      const imageLeft = interaction.stageRect.left + interaction.previewMetrics.offsetX;
      const imageTop = interaction.stageRect.top + interaction.previewMetrics.offsetY;
      const centerClientX =
        imageLeft + interaction.selection.centerX * interaction.previewMetrics.imageWidth;
      const centerClientY =
        imageTop + interaction.selection.centerY * interaction.previewMetrics.imageHeight;
      const nextHalfSizePx = Math.max(
        18,
        Math.max(event.clientX - centerClientX, event.clientY - centerClientY)
      );
      const nextSourceSize = (nextHalfSizePx * 2) / scale;
      const shortestSide = Math.max(
        1,
        Math.min(editorState.naturalWidth, editorState.naturalHeight)
      );
      setCropSelection(
        resizeAvatarCropSelection({
          sourceWidth: editorState.naturalWidth,
          sourceHeight: editorState.naturalHeight,
          selection: interaction.selection,
          nextSize: nextSourceSize / shortestSide
        })
      );
    };

    const handlePointerFinish = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId !== event.pointerId) {
        return;
      }
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerFinish);
    window.addEventListener("pointercancel", handlePointerFinish);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerFinish);
      window.removeEventListener("pointercancel", handlePointerFinish);
    };
  }, [editorState]);

  const previewMetrics = useMemo(() => {
    if (!editorState) {
      return null;
    }
    return resolveAvatarPreviewMetrics({
      viewportWidth: stageSize.width,
      viewportHeight: stageSize.height,
      sourceWidth: editorState.naturalWidth,
      sourceHeight: editorState.naturalHeight
    });
  }, [editorState, stageSize.height, stageSize.width]);

  const cropBounds = useMemo(() => {
    if (!editorState) {
      return null;
    }
    return resolveAvatarCropBounds({
      sourceWidth: editorState.naturalWidth,
      sourceHeight: editorState.naturalHeight,
      centerX: cropSelection.centerX,
      centerY: cropSelection.centerY,
      size: cropSelection.size
    });
  }, [cropSelection.centerX, cropSelection.centerY, cropSelection.size, editorState]);

  const cropPreviewStyle = useMemo(() => {
    if (!previewMetrics || !cropBounds) {
      return undefined;
    }
    const left = previewMetrics.offsetX + cropBounds.sourceX * previewMetrics.scale;
    const top = previewMetrics.offsetY + cropBounds.sourceY * previewMetrics.scale;
    const size = cropBounds.sourceSize * previewMetrics.scale;
    return {
      left,
      top,
      width: size,
      height: size
    };
  }, [cropBounds, previewMetrics]);

  const resetEditor = () => {
    interactionRef.current = null;
    setEditorState(null);
    setCropSelection(createDefaultAvatarCropSelection());
    setStageSize({ width: 0, height: 0 });
    setEditorError(null);
    setIsApplying(false);
  };

  const handleFileSelection = async (file: File | null) => {
    if (!file) {
      return;
    }
    setEditorError(null);
    try {
      const preview = await readAvatarUploadPreview(file);
      setCropSelection(createDefaultAvatarCropSelection());
      setEditorState((current) => {
        if (current) {
          URL.revokeObjectURL(current.previewUrl);
        }
        return preview;
      });
    } catch {
      await Promise.resolve(onAvatarReady(file)).catch(() => undefined);
    }
  };

  const startInteraction = (
    mode: AvatarCropInteraction["mode"],
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (!editorState || !previewMetrics || !previewStageRef.current) {
      return;
    }
    if (previewMetrics.scale <= 0 || isApplying) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageRect: previewStageRef.current.getBoundingClientRect(),
      previewMetrics,
      selection: cropSelection
    };
  };

  const handleApply = async () => {
    if (!editorState || !cropBounds) {
      return;
    }
    setIsApplying(true);
    setEditorError(null);
    try {
      const nextFile = await buildPositionedAvatarUpload({
        file: editorState.file,
        centerX: cropBounds.centerX,
        centerY: cropBounds.centerY,
        size: cropBounds.size
      });
      await Promise.resolve(onAvatarReady(nextFile));
      resetEditor();
    } catch (error) {
      setEditorError(getUiErrorMessage(error, "Не удалось подготовить аватар."));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        disabled={disabled}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          void handleFileSelection(file);
        }}
      />
      {mounted && editorState && cropBounds
        ? createPortal(
            <div
              className="avatar-upload-overlay"
              role="presentation"
              onClick={() => !isApplying && resetEditor()}
            >
              <div
                className="avatar-upload-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Позиционирование аватара"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="avatar-upload-dialog-head">
                  <div>
                    <p className="kicker">Аватар</p>
                    <h3>Позиция кадра</h3>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={resetEditor}
                    disabled={isApplying}
                  >
                    Закрыть
                  </button>
                </div>
                <p className="subtle-text">
                  Перетаскивайте круг по изображению и тяните маркер справа снизу. Все, что попадет
                  внутрь круга, останется в аватаре после upload.
                </p>
                <div className="avatar-upload-preview-shell">
                  <div ref={previewStageRef} className="avatar-upload-stage">
                    {previewMetrics ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={editorState.previewUrl}
                        alt="Предпросмотр кадра аватара"
                        className="avatar-upload-stage-image"
                        draggable={false}
                        style={{
                          left: previewMetrics.offsetX,
                          top: previewMetrics.offsetY,
                          width: previewMetrics.imageWidth,
                          height: previewMetrics.imageHeight
                        }}
                      />
                    ) : null}
                    {cropPreviewStyle ? (
                      <div
                        className="avatar-upload-selection"
                        style={cropPreviewStyle}
                        onPointerDown={(event) => startInteraction("move", event)}
                      >
                        <div className="avatar-upload-selection-grid" aria-hidden="true" />
                        <button
                          type="button"
                          className="avatar-upload-selection-handle"
                          aria-label="Изменить размер кадра"
                          onPointerDown={(event) => startInteraction("resize", event)}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="avatar-upload-meta">
                  <div className="avatar-upload-meta-badges">
                    <span className="badge muted">
                      {editorState.naturalWidth} x {editorState.naturalHeight}
                    </span>
                    <span className="badge muted">
                      Кадр {Math.round(cropBounds.size * 100)}%
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setCropSelection(createDefaultAvatarCropSelection())}
                    disabled={isApplying}
                  >
                    Сбросить
                  </button>
                </div>
                {editorError ? <p className="subtle-text danger-text">{editorError}</p> : null}
                <div className="sticky-action-bar">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={resetEditor}
                    disabled={isApplying}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleApply}
                    disabled={isApplying}
                  >
                    {isApplying ? "Подготавливаем..." : "Использовать кадр"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
