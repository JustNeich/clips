"use client";

import NextImage from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildPositionedAvatarUpload,
  resolveAvatarCropBounds
} from "./avatar-upload-support";

type AvatarUploadPreview = {
  file: File;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
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
  const [mounted, setMounted] = useState(false);
  const [editorState, setEditorState] = useState<AvatarUploadPreview | null>(null);
  const [positionX, setPositionX] = useState(0.5);
  const [positionY, setPositionY] = useState(0.5);
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

  const cropBounds = useMemo(() => {
    if (!editorState) {
      return null;
    }
    return resolveAvatarCropBounds({
      sourceWidth: editorState.naturalWidth,
      sourceHeight: editorState.naturalHeight,
      positionX,
      positionY
    });
  }, [editorState, positionX, positionY]);

  const resetEditor = () => {
    setEditorState(null);
    setPositionX(0.5);
    setPositionY(0.5);
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
      setPositionX(0.5);
      setPositionY(0.5);
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

  const handleApply = async () => {
    if (!editorState) {
      return;
    }
    setIsApplying(true);
    setEditorError(null);
    try {
      const nextFile = await buildPositionedAvatarUpload({
        file: editorState.file,
        positionX: cropBounds?.positionX ?? 0.5,
        positionY: cropBounds?.positionY ?? 0.5
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
            <div className="avatar-upload-overlay" role="presentation" onClick={() => !isApplying && resetEditor()}>
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
                  Выберите, какая часть изображения останется в квадратном аватаре после upload.
                </p>
                <div className="avatar-upload-preview-shell">
                  <div className="avatar-upload-preview">
                    <NextImage
                      src={editorState.previewUrl}
                      alt="Предпросмотр кадра аватара"
                      fill
                      unoptimized
                      sizes="280px"
                      style={{
                        objectFit: "cover",
                        objectPosition: `${(cropBounds.positionX * 100).toFixed(3)}% ${(cropBounds.positionY * 100).toFixed(3)}%`
                      }}
                    />
                  </div>
                </div>
                <div className="avatar-upload-slider-grid">
                  <label className="slider-field">
                    <div className="quick-edit-label-row">
                      <span className="field-label">Горизонталь</span>
                      <strong>{Math.round(cropBounds.positionX * 100)}%</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(cropBounds.positionX * 100)}
                      disabled={!cropBounds.canMoveX || isApplying}
                      onChange={(event) => setPositionX(Number(event.target.value) / 100)}
                    />
                  </label>
                  <label className="slider-field">
                    <div className="quick-edit-label-row">
                      <span className="field-label">Вертикаль</span>
                      <strong>{Math.round(cropBounds.positionY * 100)}%</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(cropBounds.positionY * 100)}
                      disabled={!cropBounds.canMoveY || isApplying}
                      onChange={(event) => setPositionY(Number(event.target.value) / 100)}
                    />
                  </label>
                </div>
                <div className="avatar-upload-meta">
                  <span className="badge muted">
                    {editorState.naturalWidth} x {editorState.naturalHeight}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setPositionX(0.5);
                      setPositionY(0.5);
                    }}
                    disabled={isApplying}
                  >
                    Центрировать
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
                  <button type="button" className="btn btn-primary" onClick={handleApply} disabled={isApplying}>
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
