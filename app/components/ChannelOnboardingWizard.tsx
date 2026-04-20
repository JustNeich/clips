"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AvatarUploadButton } from "./AvatarUploadButton";
import type { Stage2HardConstraints } from "../../lib/stage2-channel-config";

type ChannelOnboardingWizardProps = {
  open: boolean;
  storageKey: string | null;
  workspaceStage2HardConstraints: Stage2HardConstraints;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    username: string;
    stage2HardConstraints: Stage2HardConstraints;
    avatarFile: File | null;
  }) => Promise<void>;
};

type PersistedDraft = {
  name: string;
  username: string;
};

function normalizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function ChannelOnboardingWizard({
  open,
  storageKey,
  workspaceStage2HardConstraints,
  onClose,
  onSubmit
}: ChannelOnboardingWizardProps) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (!storageKey || typeof window === "undefined") {
      setName("");
      setUsername("");
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setSubmitError(null);
      setIsSubmitting(false);
      return;
    }

    try {
      const persisted = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as PersistedDraft | null;
      setName(typeof persisted?.name === "string" ? persisted.name : "");
      setUsername(typeof persisted?.username === "string" ? persisted.username : "");
    } catch {
      setName("");
      setUsername("");
    } finally {
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setSubmitError(null);
      setIsSubmitting(false);
    }
  }, [mounted, storageKey]);

  useEffect(() => {
    if (!mounted || !storageKey || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          name,
          username
        } satisfies PersistedDraft)
      );
    } catch {
      // Best-effort draft persistence only.
    }
  }, [mounted, name, storageKey, username]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [avatarFile]);

  useEffect(() => {
    if (!open || !mounted) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mounted, onClose, open]);

  if (!mounted || !open) {
    return null;
  }

  const canSubmit = Boolean(name.trim() && normalizeUsername(username));

  return createPortal(
    <div className="modal-shell" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content channel-onboarding-modal">
        <div className="control-card control-card-priority">
          <div className="control-section-head">
            <div>
              <h3>Новый канал</h3>
              <p className="subtle-text">
                Создайте канал по простому identity flow. Stage 2 сразу унаследует workspace baseline:
                единый one-shot pipeline, caption provider, prompt и model.
              </p>
            </div>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>

        <section className="control-card control-card-subtle">
          <div className="compact-grid">
            <div className="compact-field">
              <label className="field-label">Название канала</label>
              <input
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="History Explained"
                disabled={isSubmitting}
              />
            </div>
            <div className="compact-field">
              <label className="field-label">Username</label>
              <input
                className="text-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="historyexplained13"
                disabled={isSubmitting}
              />
              <p className="subtle-text">
                Сохраним как <code>@{normalizeUsername(username) || "channel"}</code>.
              </p>
            </div>
          </div>

          <div className="compact-field">
            <label className="field-label">Аватар</label>
            <div className="control-actions">
              <AvatarUploadButton
                buttonLabel={avatarFile ? "Заменить аватар" : "Загрузить аватар"}
                buttonClassName="btn btn-ghost background-upload-btn"
                onAvatarReady={(file) => setAvatarFile(file)}
              />
              {avatarFile ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={isSubmitting}
                  onClick={() => setAvatarFile(null)}
                >
                  Убрать
                </button>
              ) : null}
            </div>
            {avatarPreviewUrl ? (
              <div className="channel-onboarding-avatar-preview">
                <Image
                  src={avatarPreviewUrl}
                  alt="Предпросмотр аватара"
                  width={88}
                  height={88}
                  unoptimized
                />
              </div>
            ) : null}
          </div>

          <div className="channel-onboarding-note-card">
            <strong>Что будет после создания</strong>
            <p className="subtle-text">
              Канал сразу получит workspace defaults для Stage 2. Отдельно можно будет подправить только hard constraints и render template в менеджере канала.
            </p>
          </div>

          {submitError ? <p className="subtle-text danger-text">{submitError}</p> : null}

          <div className="control-actions">
            <button type="button" className="btn btn-ghost" disabled={isSubmitting} onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit || isSubmitting}
              onClick={() => {
                if (!canSubmit || isSubmitting) {
                  return;
                }
                setSubmitError(null);
                setIsSubmitting(true);
                void onSubmit({
                  name: name.trim(),
                  username: normalizeUsername(username),
                  stage2HardConstraints: workspaceStage2HardConstraints,
                  avatarFile
                })
                  .then(() => {
                    if (storageKey && typeof window !== "undefined") {
                      window.localStorage.removeItem(storageKey);
                    }
                    setName("");
                    setUsername("");
                    setAvatarFile(null);
                    setAvatarPreviewUrl(null);
                  })
                  .catch((error) => {
                    setSubmitError(
                      error instanceof Error ? error.message : "Не удалось создать канал."
                    );
                  })
                  .finally(() => {
                    setIsSubmitting(false);
                  });
              }}
            >
              {isSubmitting ? "Создаём..." : "Создать канал"}
            </button>
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
