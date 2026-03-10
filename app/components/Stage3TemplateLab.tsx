"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  SCIENCE_CARD,
  TURBO_FACE,
  TURBO_FACE_TEMPLATE_ID,
  getTemplateComputed
} from "../../lib/stage3-template";
import {
  STAGE3_DESIGN_LAB_STATUS_LABELS,
  Stage3DesignLabPreset,
  Stage3DesignLabStatus,
  getStage3DesignLabPreset,
  listStage3DesignLabPresets
} from "../../lib/stage3-design-lab";

const STORAGE_KEY = "clips-stage3-template-lab";

type Stage3TemplateLabDraft = {
  topText: string;
  bottomText: string;
  channelName: string;
  channelHandle: string;
  topFontScale: number;
  bottomFontScale: number;
  previewScale: number;
  referenceUrl: string;
  iterationNotes: string;
  status: Stage3DesignLabStatus;
};

type Stage3TemplateLabState = {
  activeTemplateId: string;
  drafts: Record<string, Stage3TemplateLabDraft>;
};

type Stage3TemplateLabProps = {
  initialTemplateId?: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildDraftFromPreset(preset: Stage3DesignLabPreset): Stage3TemplateLabDraft {
  return {
    topText: preset.topText,
    bottomText: preset.bottomText,
    channelName: preset.channelName,
    channelHandle: preset.channelHandle,
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: preset.defaultPreviewScale,
    referenceUrl: "",
    iterationNotes: "",
    status: preset.initialStatus
  };
}

function normalizeDraft(
  value: unknown,
  preset: Stage3DesignLabPreset
): Stage3TemplateLabDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return {
    ...buildDraftFromPreset(preset),
    topText: typeof candidate.topText === "string" ? candidate.topText : preset.topText,
    bottomText: typeof candidate.bottomText === "string" ? candidate.bottomText : preset.bottomText,
    channelName: typeof candidate.channelName === "string" ? candidate.channelName : preset.channelName,
    channelHandle: typeof candidate.channelHandle === "string" ? candidate.channelHandle : preset.channelHandle,
    topFontScale:
      typeof candidate.topFontScale === "number" && Number.isFinite(candidate.topFontScale)
        ? clamp(candidate.topFontScale, 0.7, 1.6)
        : 1,
    bottomFontScale:
      typeof candidate.bottomFontScale === "number" && Number.isFinite(candidate.bottomFontScale)
        ? clamp(candidate.bottomFontScale, 0.7, 1.6)
        : 1,
    previewScale:
      typeof candidate.previewScale === "number" && Number.isFinite(candidate.previewScale)
        ? clamp(candidate.previewScale, 0.18, 0.62)
        : preset.defaultPreviewScale,
    referenceUrl: typeof candidate.referenceUrl === "string" ? candidate.referenceUrl : "",
    iterationNotes: typeof candidate.iterationNotes === "string" ? candidate.iterationNotes : "",
    status:
      candidate.status === "queued" ||
      candidate.status === "in-progress" ||
      candidate.status === "review" ||
      candidate.status === "approved"
        ? candidate.status
        : preset.initialStatus
  };
}

function normalizeStoredState(
  value: unknown,
  presets: Stage3DesignLabPreset[],
  initialTemplateId: string
): Stage3TemplateLabState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const rawDrafts =
    candidate.drafts && typeof candidate.drafts === "object"
      ? (candidate.drafts as Record<string, unknown>)
      : {};

  const drafts = Object.fromEntries(
    presets.map((preset) => {
      const normalized = normalizeDraft(rawDrafts[preset.templateId], preset);
      return [preset.templateId, normalized ?? buildDraftFromPreset(preset)];
    })
  ) as Record<string, Stage3TemplateLabDraft>;

  const activeTemplateId =
    typeof candidate.activeTemplateId === "string" && drafts[candidate.activeTemplateId]
      ? candidate.activeTemplateId
      : initialTemplateId;

  return {
    activeTemplateId,
    drafts
  };
}

function renderScienceCanvas(draft: Stage3TemplateLabDraft, templateId: string) {
  const computed = getTemplateComputed(templateId, draft.topText, draft.bottomText, {
    topFontScale: draft.topFontScale,
    bottomFontScale: draft.bottomFontScale
  });
  const scaledWidth = SCIENCE_CARD.frame.width * draft.previewScale;
  const scaledHeight = SCIENCE_CARD.frame.height * draft.previewScale;

  return (
    <div className="template-lab-frame">
      <div className="template-lab-bg template-lab-bg-science" />
      <div className="template-lab-bg-glow template-lab-bg-glow-science" />
      <div
        className="template-lab-canvas-shell"
        style={{
          width: scaledWidth,
          height: scaledHeight
        }}
      >
        <div
          className="template-lab-canvas"
          style={{
            width: SCIENCE_CARD.frame.width,
            height: SCIENCE_CARD.frame.height,
            transform: `scale(${draft.previewScale})`
          }}
        >
          <section
            className="template-lab-science-card"
            style={{
              left: SCIENCE_CARD.card.x,
              top: SCIENCE_CARD.card.y,
              width: SCIENCE_CARD.card.width,
              height: SCIENCE_CARD.card.height,
              borderRadius: SCIENCE_CARD.card.radius
            }}
          >
            <div
              className="template-lab-science-top"
              style={{
                height: computed.topBlockHeight,
                padding: `${SCIENCE_CARD.slot.topPaddingTop ?? SCIENCE_CARD.slot.topPaddingY}px ${SCIENCE_CARD.slot.topPaddingX}px ${
                  SCIENCE_CARD.slot.topPaddingBottom ?? SCIENCE_CARD.slot.topPaddingY
                }px`
              }}
            >
              <p
                style={{
                  fontSize: computed.topFont,
                  lineHeight: computed.topLineHeight
                }}
              >
                {computed.top}
              </p>
            </div>

            <div
              className="template-lab-science-media"
              style={{
                top: computed.topBlockHeight,
                height: computed.videoHeight
              }}
            >
              <div className="template-lab-science-media-bg" />
              <div className="template-lab-science-media-core" />
            </div>

            <div
              className="template-lab-science-bottom"
              style={{
                top: SCIENCE_CARD.card.height - computed.bottomBlockHeight,
                height: computed.bottomBlockHeight
              }}
            >
              <div className="template-lab-science-author">
                <div className="template-lab-avatar template-lab-avatar-science">{draft.channelName.slice(0, 2)}</div>
                <div className="template-lab-author-copy">
                  <div className="template-lab-author-row">
                    <strong>{draft.channelName}</strong>
                    <span className="template-lab-check template-lab-check-science">✓</span>
                  </div>
                  <span>{draft.channelHandle}</span>
                </div>
              </div>
              <div
                className="template-lab-science-quote"
                style={{
                  paddingTop: SCIENCE_CARD.slot.bottomTextPaddingTop ?? SCIENCE_CARD.slot.bottomTextPaddingY,
                  paddingBottom: SCIENCE_CARD.slot.bottomTextPaddingBottom ?? SCIENCE_CARD.slot.bottomTextPaddingY,
                  paddingLeft: SCIENCE_CARD.slot.bottomTextPaddingLeft ?? SCIENCE_CARD.slot.bottomTextPaddingX,
                  paddingRight: SCIENCE_CARD.slot.bottomTextPaddingRight ?? SCIENCE_CARD.slot.bottomTextPaddingX
                }}
              >
                <p
                  style={{
                    fontSize: computed.bottomFont,
                    lineHeight: computed.bottomLineHeight
                  }}
                >
                  {computed.bottom}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function renderTurboCanvas(draft: Stage3TemplateLabDraft, templateId: string) {
  const computed = getTemplateComputed(templateId, draft.topText, draft.bottomText, {
    topFontScale: draft.topFontScale,
    bottomFontScale: draft.bottomFontScale
  });
  const shellHeight = TURBO_FACE.frame.height - TURBO_FACE.top.y - TURBO_FACE.bottom.bottom;
  const scaledWidth = TURBO_FACE.frame.width * draft.previewScale;
  const scaledHeight = TURBO_FACE.frame.height * draft.previewScale;

  return (
    <div className="template-lab-frame">
      <div className="template-lab-bg template-lab-bg-turbo" />
      <div className="template-lab-bg-glow template-lab-bg-glow-turbo" />
      <div className="template-lab-stage-floor" />
      <div
        className="template-lab-canvas-shell"
        style={{
          width: scaledWidth,
          height: scaledHeight
        }}
      >
        <div
          className="template-lab-canvas"
          style={{
            width: TURBO_FACE.frame.width,
            height: TURBO_FACE.frame.height,
            transform: `scale(${draft.previewScale})`
          }}
        >
          <div
            className="template-lab-turbo-shell"
            style={{
              left: TURBO_FACE.top.x,
              top: TURBO_FACE.top.y,
              width: TURBO_FACE.top.width,
              height: shellHeight
            }}
          />

          <section
            className="template-lab-turbo-top"
            style={{
              left: TURBO_FACE.top.x,
              top: TURBO_FACE.top.y,
              width: TURBO_FACE.top.width,
              height: computed.topBlockHeight,
              padding: `${TURBO_FACE.top.paddingY}px ${TURBO_FACE.top.paddingX}px`
            }}
          >
            <p
              style={{
                fontSize: computed.topFont,
                lineHeight: computed.topLineHeight
              }}
            >
              {computed.top}
            </p>
          </section>

          <section
            className="template-lab-turbo-media"
            style={{
              left: computed.videoX,
              top: computed.videoY,
              width: computed.videoWidth,
              height: computed.videoHeight
            }}
          >
            <div className="template-lab-turbo-media-bg" />
            <div className="template-lab-turbo-media-core" />
          </section>

          <section
            className="template-lab-turbo-bottom"
            style={{
              left: TURBO_FACE.bottom.x,
              top: TURBO_FACE.frame.height - TURBO_FACE.bottom.bottom - computed.bottomBlockHeight,
              width: TURBO_FACE.bottom.width,
              height: computed.bottomBlockHeight
            }}
          >
            <div
              className="template-lab-turbo-author"
              style={{
                padding: `${TURBO_FACE.bottom.paddingY}px ${TURBO_FACE.bottom.paddingX}px`
              }}
            >
              <div className="template-lab-avatar template-lab-avatar-turbo">{draft.channelName.slice(0, 2)}</div>
              <div className="template-lab-author-copy">
                <div className="template-lab-author-row">
                  <strong>{draft.channelName}</strong>
                  <span className="template-lab-check template-lab-check-turbo">✓</span>
                </div>
                <span>{draft.channelHandle}</span>
              </div>
            </div>
            <div
              className="template-lab-turbo-quote"
              style={{
                padding: `8px ${TURBO_FACE.bottom.paddingX}px ${TURBO_FACE.bottom.paddingY}px`
              }}
            >
              <p
                style={{
                  fontSize: computed.bottomFont,
                  lineHeight: computed.bottomLineHeight
                }}
              >
                {computed.bottom}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function Stage3TemplateLab({ initialTemplateId }: Stage3TemplateLabProps) {
  const presets = useMemo(() => listStage3DesignLabPresets(), []);
  const initialPreset = useMemo(() => getStage3DesignLabPreset(initialTemplateId), [initialTemplateId]);
  const [labState, setLabState] = useState<Stage3TemplateLabState>(() => ({
    activeTemplateId: initialPreset.templateId,
    drafts: {
      [initialPreset.templateId]: buildDraftFromPreset(initialPreset)
    }
  }));
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = normalizeStoredState(
        JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
        presets,
        initialPreset.templateId
      );
      if (!stored) {
        setLabState({
          activeTemplateId: initialPreset.templateId,
          drafts: Object.fromEntries(
            presets.map((preset) => [preset.templateId, buildDraftFromPreset(preset)])
          ) as Record<string, Stage3TemplateLabDraft>
        });
        return;
      }
      setLabState(stored);
    } catch {
      setLabState({
        activeTemplateId: initialPreset.templateId,
        drafts: Object.fromEntries(
          presets.map((preset) => [preset.templateId, buildDraftFromPreset(preset)])
        ) as Record<string, Stage3TemplateLabDraft>
      });
    }
  }, [initialPreset, presets]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(labState));
    const url = new URL(window.location.href);
    url.searchParams.set("template", labState.activeTemplateId);
    window.history.replaceState({}, "", url.toString());
  }, [labState]);

  useEffect(() => {
    return () => {
      if (referenceImageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(referenceImageUrl);
      }
    };
  }, [referenceImageUrl]);

  useEffect(() => {
    if (!copiedLink) {
      return;
    }
    const timeout = window.setTimeout(() => setCopiedLink(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copiedLink]);

  const activePreset = useMemo(
    () => getStage3DesignLabPreset(labState.activeTemplateId),
    [labState.activeTemplateId]
  );
  const activeDraft = labState.drafts[activePreset.templateId] ?? buildDraftFromPreset(activePreset);
  const referenceSrc = referenceImageUrl || activeDraft.referenceUrl.trim() || null;
  const isTurbo = activePreset.templateId === TURBO_FACE_TEMPLATE_ID;

  const progress = useMemo(() => {
    const counts: Record<Stage3DesignLabStatus, number> = {
      queued: 0,
      "in-progress": 0,
      review: 0,
      approved: 0
    };

    for (const preset of presets) {
      const status = labState.drafts[preset.templateId]?.status ?? preset.initialStatus;
      counts[status] += 1;
    }

    return counts;
  }, [labState.drafts, presets]);

  const updateActiveDraft = (updater: (draft: Stage3TemplateLabDraft) => Stage3TemplateLabDraft) => {
    setLabState((current) => ({
      ...current,
      drafts: {
        ...current.drafts,
        [current.activeTemplateId]: updater(current.drafts[current.activeTemplateId] ?? buildDraftFromPreset(activePreset))
      }
    }));
  };

  const onSelectPreset = (templateId: string) => {
    const preset = getStage3DesignLabPreset(templateId);
    setLabState((current) => ({
      activeTemplateId: preset.templateId,
      drafts: current.drafts[preset.templateId]
        ? current.drafts
        : {
            ...current.drafts,
            [preset.templateId]: buildDraftFromPreset(preset)
          }
    }));
  };

  const onResetTemplate = () => {
    const preset = getStage3DesignLabPreset(labState.activeTemplateId);
    updateActiveDraft(() => buildDraftFromPreset(preset));
    setReferenceImageUrl((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  };

  const onCopyDirectLink = async () => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
  };

  const onReferenceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    setReferenceImageUrl((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
  };

  return (
    <main className="template-lab-page">
      <header className="template-lab-header">
        <div>
          <p className="kicker">Stage 3 Template Lab</p>
          <h1>Итерационная лаборатория шаблонов</h1>
          <p className="subtle-text">
            Оставь эту страницу открытой. Я могу параллельно работать через Playwright, а ты сразу видеть live-изменения
            после каждого сохранения.
          </p>
        </div>
        <div className="template-lab-status">
          <span className="meta-pill ok">Live Preview</span>
          <span className={`meta-pill ${activeDraft.status === "approved" ? "ok" : activeDraft.status === "review" ? "warn" : ""}`}>
            {STAGE3_DESIGN_LAB_STATUS_LABELS[activeDraft.status]}
          </span>
          <span className="meta-pill mono">{labState.activeTemplateId}</span>
        </div>
      </header>

      <section className="template-lab-grid">
        <aside className="template-lab-sidebar">
          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Процесс</h3>
                <p className="subtle-text">Один route для всей библиотеки. Подходит для поэтапной сборки 10+ шаблонов.</p>
              </div>
            </div>
            <div className="template-lab-summary-strip">
              <div className="template-lab-summary-item">
                <strong>{presets.length}</strong>
                <span>всего шаблонов в lab</span>
              </div>
              <div className="template-lab-summary-item">
                <strong>{progress["in-progress"]}</strong>
                <span>в активной доработке</span>
              </div>
              <div className="template-lab-summary-item">
                <strong>{progress.approved}</strong>
                <span>уже прошли pass</span>
              </div>
            </div>
            <ol className="executor-guide-list">
              <li>Выберите нужный шаблон.</li>
              <li>Подгрузите референс или вставьте ссылку на изображение.</li>
              <li>Оставьте route открытым, пока я делаю проход через Playwright.</li>
              <li>После каждого сохранения live preview обновится автоматически.</li>
            </ol>
          </section>

          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Шаблоны</h3>
                <p className="subtle-text">У каждого шаблона свой draft, статус и заметки. Переключение их больше не сбрасывает.</p>
              </div>
            </div>
            <div className="template-lab-template-list">
              {presets.map((preset) => {
                const draft = labState.drafts[preset.templateId] ?? buildDraftFromPreset(preset);
                return (
                  <button
                    key={preset.templateId}
                    type="button"
                    className={`template-lab-template-item ${labState.activeTemplateId === preset.templateId ? "active" : ""}`}
                    onClick={() => onSelectPreset(preset.templateId)}
                  >
                    <div className="template-lab-template-meta">
                      <strong>{preset.label}</strong>
                      <span className={`template-lab-template-status status-${draft.status}`}>
                        {STAGE3_DESIGN_LAB_STATUS_LABELS[draft.status]}
                      </span>
                    </div>
                    <span>{preset.note}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Контент</h3>
                <p className="subtle-text">Можно быстро менять copy, автора и масштабы, не заходя в основной editor.</p>
              </div>
            </div>
            <label className="field-label">Название канала</label>
            <input
              className="text-input"
              value={activeDraft.channelName}
              onChange={(event) => updateActiveDraft((current) => ({ ...current, channelName: event.target.value }))}
            />
            <label className="field-label">Handle</label>
            <input
              className="text-input"
              value={activeDraft.channelHandle}
              onChange={(event) => updateActiveDraft((current) => ({ ...current, channelHandle: event.target.value }))}
            />
            <label className="field-label">Верхний текст</label>
            <textarea
              className="text-input template-lab-textarea"
              value={activeDraft.topText}
              onChange={(event) => updateActiveDraft((current) => ({ ...current, topText: event.target.value }))}
            />
            <label className="field-label">Нижний текст</label>
            <textarea
              className="text-input template-lab-textarea template-lab-textarea-compact"
              value={activeDraft.bottomText}
              onChange={(event) => updateActiveDraft((current) => ({ ...current, bottomText: event.target.value }))}
            />
          </section>

          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Тонкая настройка</h3>
                <p className="subtle-text">Подкручивается прямо в lab, чтобы быстрее проводить визуальные проходы.</p>
              </div>
            </div>
            <label className="field-label">Масштаб preview {Math.round(activeDraft.previewScale * 100)}%</label>
            <input
              className="range-input"
              type="range"
              min={0.18}
              max={0.62}
              step={0.01}
              value={activeDraft.previewScale}
              onChange={(event) =>
                updateActiveDraft((current) => ({
                  ...current,
                  previewScale: clamp(Number.parseFloat(event.target.value), 0.18, 0.62)
                }))
              }
            />
            <label className="field-label">Верхний текст {activeDraft.topFontScale.toFixed(2)}x</label>
            <input
              className="range-input"
              type="range"
              min={0.7}
              max={1.6}
              step={0.01}
              value={activeDraft.topFontScale}
              onChange={(event) =>
                updateActiveDraft((current) => ({
                  ...current,
                  topFontScale: clamp(Number.parseFloat(event.target.value), 0.7, 1.6)
                }))
              }
            />
            <label className="field-label">Нижний текст {activeDraft.bottomFontScale.toFixed(2)}x</label>
            <input
              className="range-input"
              type="range"
              min={0.7}
              max={1.6}
              step={0.01}
              value={activeDraft.bottomFontScale}
              onChange={(event) =>
                updateActiveDraft((current) => ({
                  ...current,
                  bottomFontScale: clamp(Number.parseFloat(event.target.value), 0.7, 1.6)
                }))
              }
            />
            <div className="template-lab-status-picker">
              {(["queued", "in-progress", "review", "approved"] as Stage3DesignLabStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`template-lab-status-button ${activeDraft.status === status ? "active" : ""}`}
                  onClick={() => updateActiveDraft((current) => ({ ...current, status }))}
                >
                  {STAGE3_DESIGN_LAB_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="template-lab-preview-column">
          <section className="control-card template-lab-card template-lab-preview-card">
            <div className="control-section-head">
              <div>
                <h3>Live Preview</h3>
                <p className="subtle-text">{activePreset.note}</p>
              </div>
              <span className={`meta-pill ${isTurbo ? "warn" : "ok"}`}>{activePreset.label}</span>
            </div>
            <div className="template-lab-preview-toolbar">
              <span className="meta-pill mono">{labState.activeTemplateId}</span>
              <div className="template-lab-actions">
                <button type="button" className="secondary-button" onClick={onResetTemplate}>
                  Сбросить шаблон
                </button>
                <button type="button" className="secondary-button" onClick={onCopyDirectLink}>
                  {copiedLink ? "Ссылка скопирована" : "Скопировать ссылку"}
                </button>
              </div>
            </div>
            <div className="template-lab-preview-shell">
              {isTurbo
                ? renderTurboCanvas(activeDraft, activePreset.templateId)
                : renderScienceCanvas(activeDraft, activePreset.templateId)}
            </div>
          </section>

          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Заметки по проходу</h3>
                <p className="subtle-text">Здесь можно фиксировать, что уже добили и что нужно дожать в следующем pass.</p>
              </div>
            </div>
            <textarea
              className="text-input template-lab-textarea template-lab-notes"
              placeholder="Например: сделать верхний блок тяжелее, уменьшить gap между media и bottom card, усилить branded feel..."
              value={activeDraft.iterationNotes}
              onChange={(event) => updateActiveDraft((current) => ({ ...current, iterationNotes: event.target.value }))}
            />
          </section>
        </section>

        <aside className="template-lab-reference-column">
          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Reference</h3>
                <p className="subtle-text">
                  Загрузи изображение сюда или вставь URL. Так мы получим side-by-side режим для точной доводки.
                </p>
              </div>
            </div>
            <label className="field-label">URL изображения</label>
            <input
              className="text-input"
              placeholder="https://..."
              value={activeDraft.referenceUrl}
              onChange={(event) => {
                setReferenceImageUrl((current) => {
                  if (current?.startsWith("blob:")) {
                    URL.revokeObjectURL(current);
                  }
                  return null;
                });
                updateActiveDraft((current) => ({ ...current, referenceUrl: event.target.value }));
              }}
            />
            <label className="field-label">Или загрузить файл</label>
            <input className="text-input" type="file" accept="image/*" onChange={onReferenceFileChange} />

            {referenceSrc ? (
              <div className="template-lab-reference-frame">
                <img src={referenceSrc} alt="Reference" className="template-lab-reference-image" />
              </div>
            ) : (
              <div className="template-lab-reference-empty">
                Сюда можно положить референс.
                <br />
                Пока его нет, route все равно уже полезен как постоянная live-лаборатория.
              </div>
            )}
          </section>

          <section className="control-card template-lab-card">
            <div className="control-section-head">
              <div>
                <h3>Design targets</h3>
                <p className="subtle-text">Короткий чеклист, чтобы проходы шли по одним и тем же критериям, а не “на глаз”.</p>
              </div>
            </div>
            <ul className="template-lab-checklist">
              {activePreset.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </section>
    </main>
  );
}
