"use client";

import Image from "next/image";
import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStage3DesignLabPreset } from "../../lib/stage3-design-lab";
import { Stage3TemplateRenderer } from "../../lib/stage3-template-renderer";
import {
  STAGE3_TEMPLATE_ID,
  type Stage3TemplateConfig,
  getTemplateById,
  getTemplateComputed
} from "../../lib/stage3-template";
import { listTemplateVariants } from "../../lib/stage3-template-registry";
import { resolveTemplateBackdropNode } from "../../lib/stage3-template-runtime";
import {
  Stage3TemplateViewport,
  getTemplatePreviewViewportMetrics
} from "../../lib/stage3-template-viewport";
import { clampStage3TextScaleUi } from "../../lib/stage3-text-fit";
import type { TemplateContentFixture } from "../../lib/template-calibration-types";
import type {
  ManagedTemplate,
  ManagedTemplateShadowLayer,
  ManagedTemplateSummary,
  ManagedTemplateVersion
} from "../../lib/managed-template-types";
import { publishManagedTemplateSync } from "../../lib/managed-template-sync";

type TemplateStyleEditorProps = {
  initialTemplateId?: string | null;
};

type ManagedTemplateListCapabilities = {
  canCreate: boolean;
  visibilityScope: "all" | "own";
};

type ManagedTemplateListResponse = {
  templates?: ManagedTemplateSummary[];
  capabilities?: Partial<ManagedTemplateListCapabilities>;
};

type ComputedSnapshot = ReturnType<typeof getTemplateComputed>;
type SaveState = "idle" | "saving" | "saved" | "error";
type UploadState = "idle" | "uploading" | "error";

type FontOption = {
  label: string;
  value: string;
};

type SliderControlProps = {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  formatValue?: (value: number) => string;
  nudgeStep?: number;
  onChange: (value: number) => void;
};

type ColorControlProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
};

type SelectControlProps = {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
};

type BadgeOption = {
  label: string;
  value: string;
  previewSrc?: string;
};

type ManagedTemplateAssetUploadResponse = {
  asset?: {
    id: string;
    url: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    createdAt: string;
  };
  error?: string;
};

type SectionLink = {
  id: string;
  label: string;
};

const TEMPLATE_VARIANTS = listTemplateVariants();
const TEMPLATE_IDS = new Set(TEMPLATE_VARIANTS.map((variant) => variant.id));

const TOP_FONT_OPTIONS: FontOption[] = [
  {
    label: "Редакционный гротеск",
    value: '"Söhne","Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  },
  {
    label: "Чистый системный",
    value: '"SF Pro Text","Inter","Aptos",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  },
  {
    label: "Резкий нео-гротеск",
    value: '"Helvetica Neue","Avenir Next","Segoe UI",Arial,sans-serif'
  },
  {
    label: "Геометрический постер",
    value: '"Futura","Avenir Next","Century Gothic","Montserrat",sans-serif'
  },
  {
    label: "Франклин редакционный",
    value: '"Franklin Gothic Medium","Arial Narrow","Helvetica Neue",Arial,sans-serif'
  },
  {
    label: "Мягкий округлый",
    value:
      '"Arial Rounded MT Bold",".SF NS Rounded","SF Pro Rounded","Avenir Next","Trebuchet MS",sans-serif'
  },
  {
    label: "Гуманистический гротеск",
    value: '"Optima","Gill Sans","Trebuchet MS","Segoe UI",sans-serif'
  },
  {
    label: "Газетная антиква",
    value: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif'
  },
  {
    label: "Контрастная антиква",
    value: '"Baskerville","Times New Roman",Times,serif'
  },
  {
    label: "Плакатная антиква",
    value: '"Didot","Bodoni 72","Times New Roman",serif'
  }
];

const BODY_FONT_OPTIONS: FontOption[] = [
  {
    label: "Нейтральный гротеск",
    value: '"Söhne","Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  },
  {
    label: "Чистый системный",
    value: '"SF Pro Text","Inter","Aptos",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  },
  {
    label: "Мягкий округлый",
    value:
      '".SF NS Rounded","SF Pro Rounded","Helvetica Rounded","Arial Rounded MT Bold","Trebuchet MS",sans-serif'
  },
  {
    label: "Гуманистический гротеск",
    value: '"Optima","Gill Sans","Trebuchet MS","Segoe UI",sans-serif'
  },
  {
    label: "Технический моно",
    value: '"SFMono-Regular","Roboto Mono","Menlo","Monaco","Courier New",monospace'
  },
  {
    label: "Современная антиква",
    value: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif'
  },
  {
    label: "Журнальная антиква",
    value: '"Baskerville","Times New Roman",Times,serif'
  },
  {
    label: "Книжная антиква",
    value: '"Charter","Cambria","Georgia","Times New Roman",serif'
  },
  {
    label: "Наборная классика",
    value: '"Palatino Linotype","Book Antiqua","URW Palladio L",serif'
  },
  {
    label: "Американская машинка",
    value: '"American Typewriter","Courier New","Georgia",serif'
  }
];

const BADGE_OPTIONS: BadgeOption[] = [
  {
    label: "Цветная галочка",
    value: ""
  },
  {
    label: "Science Card",
    value: "/stage3-template-badges/science-card-v1-check.png",
    previewSrc: "/stage3-template-badges/science-card-v1-check.png"
  },
  {
    label: "Twitter синяя",
    value: "/stage3-template-badges/twitter-verified-badge.png",
    previewSrc: "/stage3-template-badges/twitter-verified-badge.png"
  },
  {
    label: "Золотая glow",
    value: "/stage3-template-badges/gold-glow-badge.png",
    previewSrc: "/stage3-template-badges/gold-glow-badge.png"
  },
  {
    label: "Розовая glow",
    value: "/stage3-template-badges/pink-glow-badge.png",
    previewSrc: "/stage3-template-badges/pink-glow-badge.png"
  },
  {
    label: "American News",
    value: "/stage3-template-badges/american-news-badge.svg",
    previewSrc: "/stage3-template-badges/american-news-badge.svg"
  },
  {
    label: "Hedges of Honor",
    value: "/stage3-template-badges/honor-verified-badge.svg",
    previewSrc: "/stage3-template-badges/honor-verified-badge.svg"
  }
];

const MAX_VISIBLE_TEMPLATE_VERSIONS = 6;
const DEFAULT_OPEN_SECTION_IDS = new Set<string>([
  "template-road-style-library",
  "template-road-style-base",
  "template-road-style-card",
  "template-road-style-shadow",
  "template-road-style-color",
  "template-road-style-type"
]);

const SECTION_LINKS: SectionLink[] = [
  { id: "template-road-style-library", label: "Шаблон" },
  { id: "template-road-style-history", label: "История" },
  { id: "template-road-style-base", label: "Основа" },
  { id: "template-road-style-content", label: "Демо-текст" },
  { id: "template-road-style-card", label: "Карточка" },
  { id: "template-road-style-shadow", label: "Тень" },
  { id: "template-road-style-color", label: "Цвета" },
  { id: "template-road-style-type", label: "Шрифты" },
  { id: "template-road-style-spacing", label: "Отступы" },
  { id: "template-road-style-details", label: "Детали" }
];

function clampPreviewScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.34;
  }
  return Math.max(0.22, Math.min(0.5, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  const precision = step < 1 ? Math.ceil(Math.abs(Math.log10(step))) + 2 : 0;
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(precision));
}

function resolveTemplateId(value: string | null | undefined): string {
  const candidate = value?.trim();
  if (!candidate) {
    return STAGE3_TEMPLATE_ID;
  }
  return TEMPLATE_IDS.has(candidate) ? candidate : STAGE3_TEMPLATE_ID;
}

function cloneTemplateConfig(config: Stage3TemplateConfig): Stage3TemplateConfig {
  return {
    frame: { ...config.frame },
    card: { ...config.card },
    slot: { ...config.slot },
    author: { ...config.author },
    typography: {
      top: { ...config.typography.top },
      bottom: { ...config.typography.bottom },
      authorName: { ...config.typography.authorName },
      authorHandle: { ...config.typography.authorHandle }
    },
    palette: { ...config.palette }
  };
}

function createDefaultContent(templateId: string): TemplateContentFixture {
  const preset = getStage3DesignLabPreset(templateId);
  return {
    topText: preset.topText,
    bottomText: preset.bottomText,
    channelName: preset.channelName,
    channelHandle: preset.channelHandle,
    topHighlightPhrases: [],
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: clampPreviewScale(preset.defaultPreviewScale),
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };
}

function buildDefaultTemplateName(templateId: string): string {
  return `${getStage3DesignLabPreset(templateId).label}`;
}

function resolveDefaultTopFontValue(templateId: string): string {
  if (templateId === "science-card-v7" || templateId === "hedges-of-honor-v1") {
    return TOP_FONT_OPTIONS[1].value;
  }
  return TOP_FONT_OPTIONS[0].value;
}

function resolveDefaultBodyFontValue(templateId: string): string {
  if (templateId === "science-card-v7" || templateId === "hedges-of-honor-v1") {
    return BODY_FONT_OPTIONS[1].value;
  }
  return BODY_FONT_OPTIONS[0].value;
}

function formatShadow(value: string | undefined): string {
  if (!value?.trim()) {
    return "Без тени";
  }
  const layers = splitShadowLayers(value).length;
  if (layers === 1) {
    return "1 слой тени";
  }
  if (layers >= 2 && layers <= 4) {
    return `${layers} слоя тени`;
  }
  return `${layers} слоёв тени`;
}

function formatPxValue(value: number): string {
  return `${Math.round(value)} px`;
}

function formatScaleValue(value: number): string {
  return `${value.toFixed(2)}x`;
}

function formatOpacityValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSaveState(state: SaveState): string {
  switch (state) {
    case "saving":
      return "Сохраняем";
    case "saved":
      return "Сохранено";
    case "error":
      return "Ошибка";
    default:
      return "Готово";
  }
}

function normalizeColorPickerValue(value: string): string {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value) ? value : "#000000";
}

function normalizeHexColor(value: string): string {
  const raw = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    return "#000000";
  }
  if (raw.length === 3 || raw.length === 4) {
    const rgb = raw
      .slice(0, 3)
      .split("")
      .map((part) => `${part}${part}`)
      .join("")
      .toLowerCase();
    return `#${rgb}`;
  }
  if (raw.length >= 6) {
    return `#${raw.slice(0, 6).toLowerCase()}`;
  }
  return "#000000";
}

function rgbNumberToHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function hexToRgba(color: string, opacity: number): string {
  const normalized = normalizeHexColor(color).replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1).toFixed(2)})`;
}

function parseColorToken(token: string | undefined): { color: string; opacity: number } {
  const value = token?.trim() ?? "";
  if (!value) {
    return { color: "#000000", opacity: 0.24 };
  }

  if (/^#([0-9a-fA-F]{3,8})$/.test(value)) {
    const raw = value.replace(/^#/, "");
    if (raw.length === 4 || raw.length === 8) {
      const alphaHex =
        raw.length === 4 ? `${raw[3]}${raw[3]}` : raw.slice(6, 8);
      return {
        color: normalizeHexColor(value),
        opacity: Number.parseInt(alphaHex, 16) / 255
      };
    }
    return { color: normalizeHexColor(value), opacity: 1 };
  }

  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const red = Number(parts[0] ?? 0);
    const green = Number(parts[1] ?? 0);
    const blue = Number(parts[2] ?? 0);
    const alpha = parts[3] !== undefined ? Number(parts[3]) : 1;
    return {
      color: `#${rgbNumberToHex(red)}${rgbNumberToHex(green)}${rgbNumberToHex(blue)}`,
      opacity: Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1
    };
  }

  return { color: "#000000", opacity: 1 };
}

function splitShadowLayers(value: string): string[] {
  const layers: string[] = [];
  let current = "";
  let depth = 0;

  for (const character of value) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (character === "," && depth === 0) {
      if (current.trim()) {
        layers.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    layers.push(current.trim());
  }

  return layers;
}

function parsePxToken(token: string | undefined, fallback: number): number {
  if (!token) {
    return fallback;
  }
  const parsed = Number.parseFloat(token.replace("px", ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createShadowLayer(input?: Partial<ManagedTemplateShadowLayer>): ManagedTemplateShadowLayer {
  return {
    id: input?.id ?? `shadow-${Math.random().toString(36).slice(2, 10)}`,
    offsetX: input?.offsetX ?? 0,
    offsetY: input?.offsetY ?? 14,
    blur: input?.blur ?? 32,
    spread: input?.spread ?? 0,
    opacity: input?.opacity ?? 0.24,
    color: input?.color ?? "#000000",
    inset: input?.inset ?? false
  };
}

function parseShadowLayer(value: string): ManagedTemplateShadowLayer | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const inset = trimmed.startsWith("inset ");
  const withoutInset = inset ? trimmed.slice(6).trim() : trimmed;
  const colorMatch = withoutInset.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/);
  const colorToken = colorMatch?.[1];
  const metrics = (colorMatch ? withoutInset.slice(0, colorMatch.index) : withoutInset)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return createShadowLayer({
    offsetX: parsePxToken(metrics[0], 0),
    offsetY: parsePxToken(metrics[1], 14),
    blur: parsePxToken(metrics[2], 32),
    spread: parsePxToken(metrics[3], 0),
    inset,
    ...parseColorToken(colorToken)
  });
}

function parseShadowLayersFromValue(value: string | undefined): ManagedTemplateShadowLayer[] {
  if (!value?.trim()) {
    return [];
  }
  return splitShadowLayers(value)
    .map((layer) => parseShadowLayer(layer))
    .filter((layer): layer is ManagedTemplateShadowLayer => layer !== null);
}

function serializeShadowLayers(layers: ManagedTemplateShadowLayer[]): string {
  return layers
    .map((layer) => {
      const parts = [
        `${Math.round(layer.offsetX)}px`,
        `${Math.round(layer.offsetY)}px`,
        `${Math.round(layer.blur)}px`,
        `${Math.round(layer.spread)}px`,
        hexToRgba(layer.color, layer.opacity)
      ];
      return `${layer.inset ? "inset " : ""}${parts.join(" ")}`.trim();
    })
    .join(", ");
}

function getTemplateSignature(input: {
  name: string;
  description: string;
  baseTemplateId: string;
  content: TemplateContentFixture;
  templateConfig: Stage3TemplateConfig;
  shadowLayers: ManagedTemplateShadowLayer[];
}): string {
  return JSON.stringify(input);
}

function upsertTemplateList(
  current: ManagedTemplateSummary[],
  nextTemplate: ManagedTemplateSummary
): ManagedTemplateSummary[] {
  const withoutCurrent = current.filter((template) => template.id !== nextTemplate.id);
  return [nextTemplate, ...withoutCurrent].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function toManagedTemplateSummary(template: ManagedTemplate): ManagedTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    baseTemplateId: template.baseTemplateId,
    workspaceId: template.workspaceId,
    creatorUserId: template.creatorUserId,
    creatorDisplayName: template.creatorDisplayName,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    versionsCount: template.versions.length
  };
}

function areTemplateSummaryListsEqual(
  left: ManagedTemplateSummary[],
  right: ManagedTemplateSummary[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((template, index) => {
    const next = right[index];
    return (
      next &&
      template.id === next.id &&
      template.name === next.name &&
      template.description === next.description &&
      template.baseTemplateId === next.baseTemplateId &&
      template.workspaceId === next.workspaceId &&
      template.creatorUserId === next.creatorUserId &&
      template.creatorDisplayName === next.creatorDisplayName &&
      template.createdAt === next.createdAt &&
      template.updatedAt === next.updatedAt &&
      template.versionsCount === next.versionsCount
    );
  });
}

function areTemplateVersionsEqual(
  left: ManagedTemplateVersion[],
  right: ManagedTemplateVersion[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((version, index) => {
    const next = right[index];
    return (
      next &&
      version.id === next.id &&
      version.label === next.label &&
      version.createdAt === next.createdAt
    );
  });
}

function buildManagedTemplateEditorState(managedTemplate: ManagedTemplate): {
  templateConfig: Stage3TemplateConfig;
  shadowLayers: ManagedTemplateShadowLayer[];
  signature: string;
} {
  const nextTemplateConfig = cloneTemplateConfig(managedTemplate.templateConfig);
  const nextShadowLayers =
    managedTemplate.shadowLayers.length > 0
      ? managedTemplate.shadowLayers.map((layer) => ({ ...layer }))
      : parseShadowLayersFromValue(nextTemplateConfig.card.shadow);
  const nextSignature = getTemplateSignature({
    name: managedTemplate.name,
    description: managedTemplate.description,
    baseTemplateId: managedTemplate.baseTemplateId,
    content: managedTemplate.content,
    templateConfig: nextTemplateConfig,
    shadowLayers: nextShadowLayers
  });

  return {
    templateConfig: nextTemplateConfig,
    shadowLayers: nextShadowLayers,
    signature: nextSignature
  };
}

function SliderControl({
  label,
  hint,
  min,
  max,
  step,
  value,
  formatValue,
  nudgeStep,
  onChange
}: SliderControlProps) {
  const stepAmount = nudgeStep ?? step;
  const inputValue = Number.isFinite(value) ? value : min;
  const handleNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.target.value);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    onChange(clamp(snapToStep(nextValue, step), min, max));
  };

  return (
    <label className="template-road-editor-field template-road-editor-range-field">
      <div className="template-road-editor-range-head">
        <div className="template-road-editor-range-labels">
          <span className="field-label">{label}</span>
          <span className="template-road-editor-value mono">
            {formatValue ? formatValue(value) : value}
          </span>
        </div>
        <input
          className="text-input mono template-road-editor-number-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={inputValue}
          onChange={handleNumberChange}
        />
      </div>
      <div className="template-road-editor-range-row">
        <button
          type="button"
          className="btn btn-ghost template-road-editor-stepper"
          aria-label={`Уменьшить: ${label}`}
          onClick={(event) => {
            event.preventDefault();
            onChange(clamp(snapToStep(value - stepAmount, step), min, max));
          }}
        >
          -
        </button>
        <input
          className="template-road-editor-range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button
          type="button"
          className="btn btn-ghost template-road-editor-stepper"
          aria-label={`Увеличить: ${label}`}
          onClick={(event) => {
            event.preventDefault();
            onChange(clamp(snapToStep(value + stepAmount, step), min, max));
          }}
        >
          +
        </button>
      </div>
      {hint ? <span className="template-road-editor-field-hint">{hint}</span> : null}
    </label>
  );
}

function ColorControl({ label, hint, value, onChange }: ColorControlProps) {
  return (
    <label className="template-road-editor-field">
      <span className="field-label">{label}</span>
      <div className="template-road-editor-color-row">
        <input
          className="template-road-editor-color-input"
          type="color"
          value={normalizeColorPickerValue(value)}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className="text-input mono"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {hint ? <span className="template-road-editor-field-hint">{hint}</span> : null}
    </label>
  );
}

function SelectControl({ label, hint, value, options, onChange }: SelectControlProps) {
  const resolvedOptions = options.some((option) => option.value === value)
    ? options
    : [{ label: "Свой набор", value }, ...options];
  return (
    <label className="template-road-editor-field">
      <span className="field-label">{label}</span>
      <select
        className="text-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {resolvedOptions.map((option) => (
          <option key={option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="template-road-editor-field-hint">{hint}</span> : null}
    </label>
  );
}

function BadgeOptionPicker({
  label,
  hint,
  value,
  options,
  fallbackColor,
  onChange
}: {
  label: string;
  hint?: string;
  value: string;
  options: BadgeOption[];
  fallbackColor: string;
  onChange: (value: string) => void;
}) {
  const resolvedOptions = options.some((option) => option.value === value)
    ? options
    : [{ label: "Свой бейдж", value, previewSrc: value || undefined }, ...options];

  return (
    <div className="template-road-editor-field">
      <span className="field-label">{label}</span>
      <div className="template-road-editor-badge-options">
        {resolvedOptions.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={`${option.label}-${option.value || "fallback"}`}
              type="button"
              className={`template-road-editor-badge-option ${isActive ? "is-active" : ""}`}
              onClick={() => onChange(option.value)}
            >
              <span className="template-road-editor-badge-preview">
                {option.previewSrc ? (
                  <Image src={option.previewSrc} alt="" width={52} height={52} unoptimized />
                ) : (
                  <span
                    className="template-road-editor-badge-preview-fallback"
                    style={{ background: fallbackColor }}
                  >
                    ✓
                  </span>
                )}
              </span>
              <span className="template-road-editor-badge-label">{option.label}</span>
            </button>
          );
        })}
      </div>
      {hint ? <span className="template-road-editor-field-hint">{hint}</span> : null}
    </div>
  );
}

function EditorSection({
  id,
  eyebrow,
  title,
  description,
  isOpen,
  onToggle,
  meta,
  children
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`control-card template-road-editor-card ${isOpen ? "is-open" : "is-collapsed"}`}>
      <button
        type="button"
        className="template-road-editor-section-toggle"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <div className="template-road-editor-section-head">
          <p className="kicker">{eyebrow}</p>
          <h2 className="template-road-editor-section-title">{title}</h2>
          <p className="subtle-text template-road-editor-section-copy">{description}</p>
        </div>
        <span className="template-road-editor-section-chevron" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      {meta ? <div className="template-road-editor-section-meta">{meta}</div> : null}
      {isOpen ? children : null}
    </section>
  );
}

function EditorMediaPlaceholder({
  accentColor,
  baseColor,
  label
}: {
  accentColor: string;
  baseColor: string;
  label: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: `linear-gradient(145deg, ${accentColor} 0%, ${baseColor} 52%, #0f1722 100%)`
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "12% 10% auto auto",
          width: "46%",
          height: "46%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.35), rgba(255,255,255,0))",
          filter: "blur(2px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          bottom: "9%",
          height: "32%",
          borderRadius: 34,
          border: "1px solid rgba(255,255,255,0.24)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
          backdropFilter: "blur(10px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          top: "9%",
          width: "34%",
          height: "5px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.58)"
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          top: "16%",
          width: "48%",
          height: "5px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.34)"
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 24,
          bottom: 22,
          padding: "8px 12px",
          borderRadius: 999,
          background: "rgba(7, 10, 15, 0.55)",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "rgba(255,255,255,0.9)",
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase"
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function TemplateStyleEditor({
  initialTemplateId = null
}: TemplateStyleEditorProps): React.JSX.Element {
  const initialResolvedTemplateId = resolveTemplateId(initialTemplateId);
  const initialTemplateAccessScope =
    initialTemplateId?.trim() && TEMPLATE_IDS.has(initialTemplateId.trim()) ? "all" : "own";
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId?.trim() || null);
  const [baseTemplateId, setBaseTemplateId] = useState(initialResolvedTemplateId);
  const [content, setContent] = useState<TemplateContentFixture>(() =>
    createDefaultContent(initialResolvedTemplateId)
  );
  const [templateConfig, setTemplateConfig] = useState<Stage3TemplateConfig>(() =>
    cloneTemplateConfig(getTemplateById(initialResolvedTemplateId))
  );
  const [shadowLayers, setShadowLayers] = useState<ManagedTemplateShadowLayer[]>(() =>
    parseShadowLayersFromValue(getTemplateById(initialResolvedTemplateId).card.shadow)
  );
  const [computed, setComputed] = useState<ComputedSnapshot | null>(null);
  const [templates, setTemplates] = useState<ManagedTemplateSummary[]>([]);
  const [templateCapabilities, setTemplateCapabilities] = useState<ManagedTemplateListCapabilities>({
    canCreate: true,
    visibilityScope: initialTemplateAccessScope
  });
  const [versions, setVersions] = useState<ManagedTemplateVersion[]>([]);
  const [templateName, setTemplateName] = useState(buildDefaultTemplateName(initialResolvedTemplateId));
  const [templateDescription, setTemplateDescription] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    SECTION_LINKS.reduce<Record<string, boolean>>((accumulator, section) => {
      accumulator[section.id] = DEFAULT_OPEN_SECTION_IDS.has(section.id);
      return accumulator;
    }, {})
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [backgroundUploadState, setBackgroundUploadState] = useState<UploadState>("idle");
  const [backgroundUploadMessage, setBackgroundUploadMessage] = useState<string>("");
  const [lastSavedSignature, setLastSavedSignature] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [canvasStageSize, setCanvasStageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });
  const autosaveTimerRef = useRef<number | null>(null);
  const loadingTemplateRef = useRef(false);
  const hydrationReadyRef = useRef(false);
  const isMountedRef = useRef(true);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const backgroundFileInputRef = useRef<HTMLInputElement | null>(null);
  const loadTemplateRequestIdRef = useRef(0);
  const persistRequestIdRef = useRef(0);
  const persistQueueRef = useRef<Promise<ManagedTemplate | null>>(Promise.resolve(null));
  const autosaveFeedbackRevisionRef = useRef(0);
  const activeTemplateIdRef = useRef<string | null>(initialTemplateId?.trim() || null);
  const latestEditorSignatureRef = useRef<string>("");

  const activeTemplate = useMemo(
    () => TEMPLATE_VARIANTS.find((variant) => variant.id === baseTemplateId) ?? TEMPLATE_VARIANTS[0],
    [baseTemplateId]
  );
  const activeTemplatePreset = useMemo(() => getStage3DesignLabPreset(baseTemplateId), [baseTemplateId]);
  const activeTemplateSummary = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates]
  );
  const canCreateTemplates = templateCapabilities.canCreate;
  const emptyLibraryMessage = canCreateTemplates
    ? "У тебя пока нет своих шаблонов. Создай первый, и он сразу появится в настройках канала и в Stage 3."
    : "У тебя пока нет доступных шаблонов для редактирования.";
  const visibleVersions = useMemo(
    () => (showAllVersions ? versions : versions.slice(0, MAX_VISIBLE_TEMPLATE_VERSIONS)),
    [showAllVersions, versions]
  );
  const viewportMetrics = useMemo(
    () => getTemplatePreviewViewportMetrics(baseTemplateId),
    [baseTemplateId]
  );
  const requestedCanvasScale = clampPreviewScale(content.previewScale);
  const effectiveCanvasScale = useMemo(() => {
    if (canvasStageSize.width <= 0 || canvasStageSize.height <= 0) {
      return requestedCanvasScale;
    }
    const fitWidthScale = canvasStageSize.width / viewportMetrics.width;
    const fitHeightScale = canvasStageSize.height / viewportMetrics.height;
    const fitScale = Math.min(fitWidthScale, fitHeightScale);
    if (!Number.isFinite(fitScale) || fitScale <= 0) {
      return requestedCanvasScale;
    }
    return Math.max(0.1, Math.min(requestedCanvasScale, fitScale));
  }, [canvasStageSize.height, canvasStageSize.width, requestedCanvasScale, viewportMetrics.height, viewportMetrics.width]);
  const scaledViewportWidth = Math.round(viewportMetrics.width * effectiveCanvasScale);
  const scaledViewportHeight = Math.round(viewportMetrics.height * effectiveCanvasScale);
  const highlightValue = (content.topHighlightPhrases ?? []).join(" | ");
  const accentColor = templateConfig.palette.accentColor ?? templateConfig.palette.topTextColor;
  const shadowCss = useMemo(() => serializeShadowLayers(shadowLayers), [shadowLayers]);
  const editorSignature = useMemo(
    () =>
      getTemplateSignature({
        name: templateName,
        description: templateDescription,
        baseTemplateId,
        content,
        templateConfig,
        shadowLayers
      }),
    [baseTemplateId, content, shadowLayers, templateConfig, templateDescription, templateName]
  );
  activeTemplateIdRef.current = templateId;
  latestEditorSignatureRef.current = editorSignature;
  const isDirty = lastSavedSignature !== null ? editorSignature !== lastSavedSignature : true;
  const editorUrl = templateId ? `/design/template-road?template=${templateId}` : null;
  const renderUrl = templateId ? `/design/science-card?template=${templateId}` : null;
  const currentTopFontFamily =
    templateConfig.typography.top.fontFamily ?? resolveDefaultTopFontValue(baseTemplateId);
  const currentBottomFontFamily =
    templateConfig.typography.bottom.fontFamily ?? resolveDefaultBodyFontValue(baseTemplateId);
  const currentBadgeAssetPath = templateConfig.author.checkAssetPath ?? "";
  const currentBadgeOption = BADGE_OPTIONS.find((option) => option.value === currentBadgeAssetPath);
  const topFontSelectOptions = useMemo(
    () =>
      TOP_FONT_OPTIONS.some((option) => option.value === currentTopFontFamily)
        ? TOP_FONT_OPTIONS
        : [{ label: "Свой набор", value: currentTopFontFamily }, ...TOP_FONT_OPTIONS],
    [currentTopFontFamily]
  );
  const bottomFontSelectOptions = useMemo(
    () =>
      BODY_FONT_OPTIONS.some((option) => option.value === currentBottomFontFamily)
        ? BODY_FONT_OPTIONS
        : [{ label: "Свой набор", value: currentBottomFontFamily }, ...BODY_FONT_OPTIONS],
    [currentBottomFontFamily]
  );

  const clearPendingAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const cancelPendingAutosaveCycle = useCallback(() => {
    autosaveFeedbackRevisionRef.current += 1;
    clearPendingAutosaveTimer();
  }, [clearPendingAutosaveTimer]);

  const applyManagedTemplate = useCallback((managedTemplate: ManagedTemplate) => {
    loadTemplateRequestIdRef.current += 1;
    cancelPendingAutosaveCycle();
    const nextState = buildManagedTemplateEditorState(managedTemplate);

    loadingTemplateRef.current = true;
    setTemplateId(managedTemplate.id);
    setBaseTemplateId(managedTemplate.baseTemplateId);
    setContent({ ...managedTemplate.content });
    setTemplateConfig(nextState.templateConfig);
    setShadowLayers(nextState.shadowLayers);
    setVersions(managedTemplate.versions);
    setTemplateName(managedTemplate.name);
    setTemplateDescription(managedTemplate.description);
    setUpdatedAt(managedTemplate.updatedAt);
    setLastSavedSignature(nextState.signature);
    setComputed(null);
    setBackgroundUploadState("idle");
    setBackgroundUploadMessage("");
    setSaveState("idle");
    setSaveMessage("Изменения синхронизируются автоматически.");
    window.setTimeout(() => {
      loadingTemplateRef.current = false;
      hydrationReadyRef.current = true;
    }, 0);
  }, [cancelPendingAutosaveCycle]);

  const applyDraftTemplate = useCallback(
    (nextBaseTemplateId: string, message = emptyLibraryMessage) => {
      loadTemplateRequestIdRef.current += 1;
      cancelPendingAutosaveCycle();
      const resolvedTemplateId = resolveTemplateId(nextBaseTemplateId);
      const nextConfig = cloneTemplateConfig(getTemplateById(resolvedTemplateId));

      loadingTemplateRef.current = true;
      setTemplateId(null);
      setBaseTemplateId(resolvedTemplateId);
      setContent(createDefaultContent(resolvedTemplateId));
      setTemplateConfig(nextConfig);
      setShadowLayers(parseShadowLayersFromValue(nextConfig.card.shadow));
      setVersions([]);
      setTemplateName(buildDefaultTemplateName(resolvedTemplateId));
      setTemplateDescription("");
      setUpdatedAt(null);
      setLastSavedSignature(null);
      setComputed(null);
      setSaveState("idle");
      setSaveMessage(message);
      window.setTimeout(() => {
        loadingTemplateRef.current = false;
        hydrationReadyRef.current = true;
      }, 0);
    },
    [cancelPendingAutosaveCycle, emptyLibraryMessage]
  );

  const fetchTemplateList = useCallback(async (): Promise<{
    templates: ManagedTemplateSummary[];
    capabilities: ManagedTemplateListCapabilities;
  }> => {
    const response = await fetch("/api/design/templates", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load templates: ${response.status}`);
    }
    const payload = (await response.json()) as ManagedTemplateListResponse;
    const nextTemplates = Array.isArray(payload.templates) ? payload.templates : [];
    const nextCapabilities: ManagedTemplateListCapabilities = {
      canCreate: payload.capabilities?.canCreate !== false,
      visibilityScope: payload.capabilities?.visibilityScope === "all" ? "all" : "own"
    };
    setTemplates((current) =>
      areTemplateSummaryListsEqual(current, nextTemplates) ? current : nextTemplates
    );
    setTemplateCapabilities((current) =>
      current.canCreate === nextCapabilities.canCreate &&
      current.visibilityScope === nextCapabilities.visibilityScope
        ? current
        : nextCapabilities
    );
    return {
      templates: nextTemplates,
      capabilities: nextCapabilities
    };
  }, []);

  const loadTemplate = useCallback(
    async (
      nextTemplateId: string | null | undefined,
      options?: {
        fallbackTemplates?: ManagedTemplateSummary[];
        fallbackToFirst?: boolean;
      }
    ) => {
      const requestId = loadTemplateRequestIdRef.current + 1;
      loadTemplateRequestIdRef.current = requestId;
      const candidate = nextTemplateId?.trim();
      const availableTemplates = options?.fallbackTemplates ?? templates;
      const targetTemplateId = candidate || availableTemplates[0]?.id || null;
      if (!targetTemplateId) {
        applyDraftTemplate(baseTemplateId);
        return;
      }
      const response = await fetch(`/api/design/templates/${encodeURIComponent(targetTemplateId)}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        if (
          options?.fallbackToFirst &&
          availableTemplates.length > 0 &&
          availableTemplates[0].id !== targetTemplateId
        ) {
          await loadTemplate(availableTemplates[0].id, {
            fallbackTemplates: availableTemplates,
            fallbackToFirst: false
          });
        } else if (requestId === loadTemplateRequestIdRef.current && availableTemplates.length === 0) {
          applyDraftTemplate(candidate ?? baseTemplateId);
        } else if (requestId === loadTemplateRequestIdRef.current) {
          setSaveState("error");
          setSaveMessage("Не удалось открыть выбранный шаблон.");
        }
        return;
      }
      const payload = (await response.json()) as { template?: ManagedTemplate };
      if (payload.template && requestId === loadTemplateRequestIdRef.current) {
        applyManagedTemplate(payload.template);
      }
    },
    [applyDraftTemplate, applyManagedTemplate, baseTemplateId, templates]
  );

  useEffect(() => {
    setTemplateConfig((current) => {
      const currentShadow = current.card.shadow ?? "";
      if (currentShadow === shadowCss) {
        return current;
      }
      return {
        ...current,
        card: {
          ...current.card,
          shadow: shadowCss || undefined
        }
      };
    });
  }, [shadowCss]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelPendingAutosaveCycle();
    };
  }, [cancelPendingAutosaveCycle]);

  useEffect(() => {
    const element = canvasStageRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const styles = window.getComputedStyle(element);
      const width =
        element.clientWidth -
        Number.parseFloat(styles.paddingLeft || "0") -
        Number.parseFloat(styles.paddingRight || "0");
      const height =
        element.clientHeight -
        Number.parseFloat(styles.paddingTop || "0") -
        Number.parseFloat(styles.paddingBottom || "0");

      setCanvasStageSize((current) => {
        if (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1) {
          return current;
        }
        return {
          width: Math.max(0, width),
          height: Math.max(0, height)
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
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    const nextTemplateId = templateId?.trim() || null;
    const currentTemplateId = url.searchParams.get("template");
    if ((currentTemplateId || null) === nextTemplateId) {
      return;
    }
    if (nextTemplateId) {
      url.searchParams.set("template", nextTemplateId);
    } else {
      url.searchParams.delete("template");
    }
    window.history.replaceState(null, "", url.toString());
  }, [templateId]);

  const syncPersistedTemplate = useCallback(
    (
      savedTemplate: ManagedTemplate,
      request: {
        requestId: number;
        requestTemplateId: string;
        requestSignature: string;
      }
    ) => {
      if (
        request.requestId !== persistRequestIdRef.current ||
        activeTemplateIdRef.current !== request.requestTemplateId ||
        savedTemplate.id !== request.requestTemplateId
      ) {
        return;
      }

      const nextState = buildManagedTemplateEditorState(savedTemplate);
      const editorDriftedSinceRequest =
        latestEditorSignatureRef.current !== request.requestSignature;
      const shouldHydrateEditor =
        !editorDriftedSinceRequest && nextState.signature !== request.requestSignature;

      if (shouldHydrateEditor) {
        applyManagedTemplate(savedTemplate);
        return;
      }

      setVersions((current) =>
        areTemplateVersionsEqual(current, savedTemplate.versions) ? current : savedTemplate.versions
      );
      setUpdatedAt((current) => (current === savedTemplate.updatedAt ? current : savedTemplate.updatedAt));
      setLastSavedSignature(nextState.signature);
    },
    [applyManagedTemplate]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrapTemplates() {
      try {
        const { templates: nextTemplates, capabilities } = await fetchTemplateList();
        if (cancelled) {
          return;
        }

        if (nextTemplates.length === 0) {
          applyDraftTemplate(
            initialResolvedTemplateId,
            capabilities.canCreate
              ? "У тебя пока нет своих шаблонов. Создай первый, и он сразу появится в настройках канала и в Stage 3."
              : "У тебя пока нет доступных шаблонов для редактирования."
          );
          return;
        }

        const requestedTemplateId = initialTemplateId?.trim() || null;
        const preferredTemplateId = nextTemplates.some((template) => template.id === requestedTemplateId)
          ? requestedTemplateId
          : nextTemplates[0]?.id ?? null;
        await loadTemplate(preferredTemplateId, {
          fallbackTemplates: nextTemplates,
          fallbackToFirst: true
        });
      } catch {
        if (!cancelled) {
          setSaveState("error");
          setSaveMessage("Библиотека шаблонов сейчас недоступна.");
        }
      }
    }

    void bootstrapTemplates();

    return () => {
      cancelled = true;
    };
  }, [applyDraftTemplate, fetchTemplateList, initialResolvedTemplateId, initialTemplateId, loadTemplate]);

  useEffect(() => {
    function handleWindowFocus() {
      void (async () => {
        try {
          const { templates: nextTemplates } = await fetchTemplateList();
          const currentTemplateId = templateId?.trim() || null;
          if (!currentTemplateId) {
            return;
          }
          const templateStillExists = nextTemplates.some((template) => template.id === currentTemplateId);
          if (!templateStillExists) {
            if (!activeTemplateSummary) {
              return;
            }
            const fallbackStamp =
              updatedAt ??
              activeTemplateSummary?.updatedAt ??
              new Date().toISOString();
            setTemplates((current) =>
              current.some((template) => template.id === currentTemplateId)
                ? current
                : upsertTemplateList(current, {
                    id: currentTemplateId,
                    name: templateName.trim() || buildDefaultTemplateName(baseTemplateId),
                    description: templateDescription.trim(),
                    baseTemplateId,
                    workspaceId: activeTemplateSummary.workspaceId,
                    creatorUserId: activeTemplateSummary.creatorUserId,
                    creatorDisplayName: activeTemplateSummary.creatorDisplayName,
                    createdAt: activeTemplateSummary?.createdAt ?? fallbackStamp,
                    updatedAt: fallbackStamp,
                    versionsCount: versions.length
                  })
            );
            setSaveState("error");
            setSaveMessage(
              "Текущий шаблон временно пропал из библиотеки. Оставляю его открытым, чтобы не потерять правки."
            );
          }
        } catch {
          // Keep the current editor state if the library refresh fails.
        }
      })();
    }

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [
    activeTemplateSummary,
    baseTemplateId,
    fetchTemplateList,
    templateDescription,
    templateId,
    templateName,
    updatedAt,
    versions.length
  ]);

  useEffect(() => {
    if (versions.length <= MAX_VISIBLE_TEMPLATE_VERSIONS && showAllVersions) {
      setShowAllVersions(false);
    }
  }, [showAllVersions, versions.length]);

  const persistCurrentTemplate = useCallback(async (): Promise<ManagedTemplate | null> => {
    if (!templateId) {
      return null;
    }
    const requestTemplateId = templateId;
    const requestSignature = editorSignature;
    const requestId = persistRequestIdRef.current + 1;
    persistRequestIdRef.current = requestId;

    const payload = {
      name: templateName.trim() || buildDefaultTemplateName(baseTemplateId),
      description: templateDescription.trim(),
      baseTemplateId,
      content,
      templateConfig: {
        ...templateConfig,
        card: {
          ...templateConfig.card,
          shadow: shadowCss || undefined
        }
      },
      shadowLayers
    };

    const runPersist = async (): Promise<ManagedTemplate | null> => {
      const response = await fetch(`/api/design/templates/${encodeURIComponent(requestTemplateId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`);
      }
      const result = (await response.json()) as { template?: ManagedTemplate };
      if (!result.template) {
        throw new Error("Template response is empty.");
      }
      const savedTemplate = result.template;
      if (isMountedRef.current) {
        syncPersistedTemplate(savedTemplate, {
          requestId,
          requestTemplateId,
          requestSignature
        });
        if (requestId === persistRequestIdRef.current) {
          setTemplates((current) => upsertTemplateList(current, toManagedTemplateSummary(savedTemplate)));
        }
      }
      publishManagedTemplateSync({
        templateId: savedTemplate.id,
        updatedAt: savedTemplate.updatedAt,
        reason: "saved"
      });
      return savedTemplate;
    };

    const queuedPersist = persistQueueRef.current
      .catch(() => null)
      .then(runPersist);
    persistQueueRef.current = queuedPersist.then(
      () => null,
      () => null
    );
    return queuedPersist;
  }, [
    baseTemplateId,
    content,
    editorSignature,
    persistQueueRef,
    shadowCss,
    shadowLayers,
    syncPersistedTemplate,
    templateConfig,
    templateDescription,
    templateId,
    templateName
  ]);

  useEffect(() => {
    if (!templateId || !hydrationReadyRef.current || loadingTemplateRef.current) {
      return;
    }
    if (!isDirty) {
      return;
    }

    clearPendingAutosaveTimer();

    setSaveState("saving");
    setSaveMessage("Синхронизируем шаблон с Stage 3…");
    const autosaveRevision = autosaveFeedbackRevisionRef.current + 1;
    autosaveFeedbackRevisionRef.current = autosaveRevision;
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistCurrentTemplate()
        .then((result) => {
          if (
            !result ||
            !isMountedRef.current ||
            autosaveFeedbackRevisionRef.current !== autosaveRevision
          ) {
            return;
          }
          setSaveState("saved");
          setSaveMessage("Шаблон синхронизирован. Stage 3 подхватит его автоматически.");
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            autosaveFeedbackRevisionRef.current !== autosaveRevision
          ) {
            return;
          }
          setSaveState("error");
          setSaveMessage("Не удалось синхронизировать шаблон.");
        });
    }, 450);

    return () => {
      clearPendingAutosaveTimer();
    };
  }, [
    clearPendingAutosaveTimer,
    editorSignature,
    isDirty,
    persistCurrentTemplate,
    templateId
  ]);

  function jumpToSection(sectionId: string) {
    if (typeof window === "undefined") {
      return;
    }
    setOpenSections((current) => ({
      ...current,
      [sectionId]: true
    }));
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }

  function toggleSection(sectionId: string) {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }));
  }

  function resetStyle() {
    const baseConfig = cloneTemplateConfig(getTemplateById(baseTemplateId));
    setTemplateConfig(baseConfig);
    setShadowLayers(parseShadowLayersFromValue(baseConfig.card.shadow));
  }

  function resetContent() {
    setContent(createDefaultContent(baseTemplateId));
    setComputed(null);
    setBackgroundUploadState("idle");
    setBackgroundUploadMessage("");
  }

  function updateContent<K extends keyof TemplateContentFixture>(
    key: K,
    value: TemplateContentFixture[K]
  ) {
    setContent((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateCard<K extends keyof Stage3TemplateConfig["card"]>(
    key: K,
    value: Stage3TemplateConfig["card"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      card: {
        ...current.card,
        [key]: value
      }
    }));
  }

  function updateSlot<K extends keyof Stage3TemplateConfig["slot"]>(
    key: K,
    value: Stage3TemplateConfig["slot"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      slot: {
        ...current.slot,
        [key]: value
      }
    }));
  }

  function updateAuthor<K extends keyof Stage3TemplateConfig["author"]>(
    key: K,
    value: Stage3TemplateConfig["author"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      author: {
        ...current.author,
        [key]: value
      }
    }));
  }

  function updatePalette<K extends keyof Stage3TemplateConfig["palette"]>(
    key: K,
    value: Stage3TemplateConfig["palette"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      palette: {
        ...current.palette,
        [key]: value
      }
    }));
  }

  function updateTopTypography<K extends keyof Stage3TemplateConfig["typography"]["top"]>(
    key: K,
    value: Stage3TemplateConfig["typography"]["top"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      typography: {
        ...current.typography,
        top: {
          ...current.typography.top,
          [key]: value
        }
      }
    }));
  }

  function updateBottomTypography<K extends keyof Stage3TemplateConfig["typography"]["bottom"]>(
    key: K,
    value: Stage3TemplateConfig["typography"]["bottom"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      typography: {
        ...current.typography,
        bottom: {
          ...current.typography.bottom,
          [key]: value
        }
      }
    }));
  }

  function updateAuthorNameTypography<K extends keyof Stage3TemplateConfig["typography"]["authorName"]>(
    key: K,
    value: Stage3TemplateConfig["typography"]["authorName"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      typography: {
        ...current.typography,
        authorName: {
          ...current.typography.authorName,
          [key]: value
        }
      }
    }));
  }

  function updateAuthorHandleTypography<K extends keyof Stage3TemplateConfig["typography"]["authorHandle"]>(
    key: K,
    value: Stage3TemplateConfig["typography"]["authorHandle"][K]
  ) {
    setTemplateConfig((current) => ({
      ...current,
      typography: {
        ...current.typography,
        authorHandle: {
          ...current.typography.authorHandle,
          [key]: value
        }
      }
    }));
  }

  function updateShadowLayer<K extends keyof ManagedTemplateShadowLayer>(
    layerId: string,
    key: K,
    value: ManagedTemplateShadowLayer[K]
  ) {
    setShadowLayers((current) =>
      current.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              [key]: value
            }
          : layer
      )
    );
  }

  function addShadowLayer() {
    setShadowLayers((current) => [...current, createShadowLayer()]);
  }

  function duplicateShadowLayer(layerId: string) {
    setShadowLayers((current) => {
      const index = current.findIndex((layer) => layer.id === layerId);
      if (index === -1) {
        return current;
      }
      const next = [...current];
      next.splice(index + 1, 0, createShadowLayer(current[index]));
      return next;
    });
  }

  function removeShadowLayer(layerId: string) {
    setShadowLayers((current) => current.filter((layer) => layer.id !== layerId));
  }

  function handleHighlightChange(event: ChangeEvent<HTMLInputElement>) {
    const parts = event.target.value
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    updateContent("topHighlightPhrases", parts);
  }

  async function handleBackgroundFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setBackgroundUploadState("uploading");
    setBackgroundUploadMessage(`Загружаю фон «${file.name}»...`);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/design/template-assets", {
        method: "POST",
        body: formData
      });
      const payload = (await response
        .json()
        .catch(() => null)) as ManagedTemplateAssetUploadResponse | null;
      if (!response.ok || !payload?.asset?.url) {
        throw new Error(payload?.error || `Upload failed: ${response.status}`);
      }

      updateContent("backgroundAsset", payload.asset.url);
      setBackgroundUploadState("idle");
      setBackgroundUploadMessage(`Фон «${payload.asset.originalName}» подключён к шаблону.`);
    } catch (error) {
      setBackgroundUploadState("error");
      setBackgroundUploadMessage(
        error instanceof Error && error.message
          ? error.message
          : "Не удалось загрузить фон."
      );
    }
  }

  async function handleCreateTemplate() {
    if (!canCreateTemplates) {
      setSaveState("error");
      setSaveMessage("У тебя нет прав на создание шаблонов.");
      return;
    }
    cancelPendingAutosaveCycle();
    const resolvedDraftName = templateName.trim() || buildDefaultTemplateName(baseTemplateId);
    const payload = {
      name: templateId ? `${resolvedDraftName} копия` : resolvedDraftName,
      description: templateDescription.trim(),
      baseTemplateId,
      content,
      templateConfig: {
        ...templateConfig,
        card: {
          ...templateConfig.card,
          shadow: shadowCss || undefined
        }
      },
      shadowLayers
    };

    setSaveState("saving");
    setSaveMessage("Создаю новый шаблон...");

    try {
      const response = await fetch("/api/design/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Create failed: ${response.status}`);
      }

      const { template } = (await response.json()) as { template?: ManagedTemplate };
      if (!template) {
        throw new Error("Template response is empty.");
      }
      applyManagedTemplate(template);
      setTemplates((current) => upsertTemplateList(current, toManagedTemplateSummary(template)));
      setSaveState("saved");
      setSaveMessage("Новый шаблон создан и сразу доступен во всём приложении.");
      publishManagedTemplateSync({
        templateId: template.id,
        updatedAt: template.updatedAt,
        reason: "created"
      });
    } catch {
      setSaveState("error");
      setSaveMessage("Не удалось создать шаблон.");
    }
  }

  async function handleCreateVersion() {
    if (!templateId) {
      return;
    }
    cancelPendingAutosaveCycle();

    setSaveState("saving");
    setSaveMessage("Сохраняю версию...");

    try {
      await persistCurrentTemplate();
      const response = await fetch(`/api/design/templates/${encodeURIComponent(templateId)}/versions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          label: `Версия ${new Date().toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })}`
        })
      });
      if (!response.ok) {
        throw new Error(`Version failed: ${response.status}`);
      }
      const { template } = (await response.json()) as { template?: ManagedTemplate };
      if (!template) {
        throw new Error("Template response is empty.");
      }
      applyManagedTemplate(template);
      setTemplates((current) => upsertTemplateList(current, toManagedTemplateSummary(template)));
      setSaveState("saved");
      setSaveMessage("Версия сохранена. К ней можно откатиться позже.");
      publishManagedTemplateSync({
        templateId: template.id,
        updatedAt: template.updatedAt,
        reason: "versioned"
      });
    } catch {
      setSaveState("error");
      setSaveMessage("Не удалось сохранить версию.");
    }
  }

  async function handleRestoreVersion(versionId: string) {
    if (!templateId) {
      return;
    }
    cancelPendingAutosaveCycle();

    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm("Откатить шаблон к выбранной версии? Перед откатом мы автоматически сохраним текущее состояние.");
    if (!confirmed) {
      return;
    }

    setSaveState("saving");
    setSaveMessage("Откатываю шаблон...");

    try {
      await persistCurrentTemplate();
      const response = await fetch(
        `/api/design/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/restore`,
        {
          method: "POST"
        }
      );
      if (!response.ok) {
        throw new Error(`Restore failed: ${response.status}`);
      }
      const { template } = (await response.json()) as { template?: ManagedTemplate };
      if (!template) {
        throw new Error("Template response is empty.");
      }
      applyManagedTemplate(template);
      setTemplates((current) => upsertTemplateList(current, toManagedTemplateSummary(template)));
      setSaveState("saved");
      setSaveMessage("Шаблон откатан к выбранной версии.");
      publishManagedTemplateSync({
        templateId: template.id,
        updatedAt: template.updatedAt,
        reason: "restored"
      });
    } catch {
      setSaveState("error");
      setSaveMessage("Не удалось откатить шаблон.");
    }
  }

  async function handleDeleteTemplate() {
    if (!templateId) {
      return;
    }
    cancelPendingAutosaveCycle();

    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`Удалить шаблон "${templateName}"?`);
    if (!confirmed) {
      return;
    }

    setSaveState("saving");
    setSaveMessage("Удаляю шаблон...");

    try {
      const response = await fetch(`/api/design/templates/${encodeURIComponent(templateId)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }
      const payload = (await response.json()) as {
        deletedId?: string;
        fallbackTemplateId?: string | null;
      };
      const { templates: nextTemplates } = await fetchTemplateList();
      const fallbackTemplateId =
        typeof payload.fallbackTemplateId === "string" && payload.fallbackTemplateId.trim()
          ? payload.fallbackTemplateId
          : nextTemplates[0]?.id ?? null;
      const canOpenFallbackTemplate = nextTemplates.some((template) => template.id === fallbackTemplateId);
      if (fallbackTemplateId && canOpenFallbackTemplate) {
        await loadTemplate(fallbackTemplateId, {
          fallbackTemplates: nextTemplates,
          fallbackToFirst: true
        });
      } else {
        applyDraftTemplate(
          STAGE3_TEMPLATE_ID,
          "Шаблон удалён. Сейчас доступных шаблонов нет, можно сразу создать новый."
        );
      }
      setSaveState("saved");
      setSaveMessage(
        fallbackTemplateId && canOpenFallbackTemplate
          ? "Шаблон удалён."
          : "Шаблон удалён. Сейчас в библиотеке пусто, можно сразу создать новый."
      );
      publishManagedTemplateSync({
        templateId,
        updatedAt: new Date().toISOString(),
        reason: "deleted"
      });
    } catch {
      setSaveState("error");
      setSaveMessage("Не удалось удалить шаблон.");
    }
  }

  return (
    <main className="template-road-editor-page" data-show-hints={showHints ? "1" : "0"}>
      <section className="template-road-editor-canvas-column">
        <div className="template-road-editor-canvas-sticky">
          <div className="template-road-editor-canvas-head">
            <div className="template-road-editor-canvas-copy">
              <p className="kicker">Редактор шаблона</p>
              <h1 className="template-road-editor-canvas-title">
                {templateName}
              </h1>
              <p className="subtle-text template-road-editor-canvas-text">
                Живой холст слева, компактный инспектор справа. Правки сохраняются автоматически и сразу уходят в Stage 3.
              </p>
            </div>
            <div className="template-road-editor-pill-row">
              <span className="meta-pill">Холст {viewportMetrics.width}x{viewportMetrics.height}</span>
              <span className="meta-pill">
                {computed
                  ? `Автоподбор ${computed.topFont}px / ${computed.bottomFont}px`
                  : "Автоподбор текста"}
              </span>
              <span className="meta-pill">{formatShadow(templateConfig.card.shadow)}</span>
              <span className={`meta-pill ${isDirty ? "is-accent" : ""}`}>
                {isDirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
              </span>
            </div>
          </div>

          <div className="template-road-editor-canvas-shell">
            <div className="template-road-editor-canvas-stage" ref={canvasStageRef}>
              <div
                className="template-road-editor-canvas-frame"
                style={{
                  width: scaledViewportWidth,
                  height: scaledViewportHeight
                }}
              >
                <div
                  style={{
                    width: viewportMetrics.width,
                    height: viewportMetrics.height,
                    transform: `scale(${effectiveCanvasScale})`,
                    transformOrigin: "top left"
                  }}
                >
                  <Stage3TemplateViewport templateId={baseTemplateId}>
                    <Stage3TemplateRenderer
                      templateId={baseTemplateId}
                      content={content}
                      templateConfigOverride={templateConfig}
                      onComputedChange={setComputed}
                      runtime={{
                        backgroundNode: resolveTemplateBackdropNode(
                          baseTemplateId,
                          content.backgroundAsset ?? undefined
                        ),
                        mediaNode: (
                          <EditorMediaPlaceholder
                            accentColor={accentColor}
                            baseColor={templateConfig.palette.bottomSectionFill}
                            label={activeTemplate.label}
                          />
                        ),
                        sceneDataId: `template-road-style-editor-${templateId ?? baseTemplateId}`
                      }}
                    />
                  </Stage3TemplateViewport>
                </div>
              </div>
            </div>
          </div>

          <div className="template-road-editor-summary-grid compact-single">
            <div className="control-card template-road-editor-summary-card">
              <p className="kicker">Живые метрики</p>
              <div className="template-road-editor-summary-stats">
                <span>
                  Верхний текст:{" "}
                  {computed ? `${computed.topFont}px / ${computed.topLines} строк` : "считаем"}
                </span>
                <span>
                  Нижний текст:{" "}
                  {computed ? `${computed.bottomFont}px / ${computed.bottomLines} строк` : "считаем"}
                </span>
                <span>
                  Карточка: {templateConfig.card.radius}px скругление /{" "}
                  {templateConfig.card.borderWidth}px обводка
                </span>
                <span>Основа: {activeTemplate.label}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="template-road-editor-controls-column">
        <div className="template-road-editor-controls-scroll">
          <header className="template-road-editor-header">
            <div>
              <p className="kicker">Инспектор</p>
              <h2 className="template-road-editor-header-title">
                Компактный контроль стиля
              </h2>
            </div>
            <p className="subtle-text template-road-editor-header-copy">
              Автосохранение включено. Ручное действие нужно только для контрольных точек в истории.
            </p>
            <div className="template-road-editor-header-actions">
              <button type="button" className="btn btn-secondary" onClick={resetStyle}>
                Сбросить оформление
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetContent}>
                Сбросить демо-текст
              </button>
              <button
                type="button"
                className={`btn btn-ghost ${showHints ? "is-active" : ""}`}
                onClick={() => setShowHints((current) => !current)}
              >
                {showHints ? "Скрыть подсказки" : "Показать подсказки"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleCreateTemplate()}
                disabled={saveState === "saving" || !canCreateTemplates}
              >
                Новый шаблон
              </button>
            </div>
          </header>

          <section className="control-card template-road-editor-command-bar">
            <div className="template-road-editor-command-copy">
              <p className="kicker">Рабочие действия</p>
              <h3 className="template-road-editor-command-title">
                {templateId ? templateName : "Шаблон ещё не выбран"}
              </h3>
            </div>
            <div className="template-road-editor-meta-strip">
              <span className="meta-pill">Статус: {formatSaveState(saveState)}</span>
              <span className="meta-pill">{saveMessage || "Можно продолжать редактирование"}</span>
            </div>
            <div className="template-road-editor-header-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleCreateVersion()}
                disabled={saveState === "saving" || !templateId}
              >
                Сохранить версию
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleDeleteTemplate()}
                disabled={!templateId || saveState === "saving"}
              >
                Удалить шаблон
              </button>
            </div>
          </section>

          <section className="control-card template-road-editor-nav-card">
            <div className="template-road-editor-section-head">
              <p className="kicker">Быстрые переходы</p>
              <h3 className="template-road-editor-command-title">
                Открывай нужный блок
              </h3>
            </div>
            <div className="template-road-editor-quick-nav">
              {SECTION_LINKS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="btn btn-ghost template-road-editor-nav-chip"
                  onClick={() => jumpToSection(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </section>

          <EditorSection
            id="template-road-style-library"
            eyebrow="Шаблон"
            title="Текущий шаблон"
            description="Один шаблон живёт сразу в редакторе, настройках канала и Stage 3."
            isOpen={Boolean(openSections["template-road-style-library"])}
            onToggle={() => toggleSection("template-road-style-library")}
            meta={
              <>
                {templateId ? <span className="meta-pill mono">ID: {templateId}</span> : null}
                <span className="meta-pill">Основа: {activeTemplate.label}</span>
                <span className="meta-pill">
                  {templateCapabilities.visibilityScope === "all"
                    ? "Видны все шаблоны"
                    : "Видны только мои шаблоны"}
                </span>
                {updatedAt ? (
                  <span className="meta-pill">
                    Обновлён: {new Date(updatedAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </span>
                ) : null}
              </>
            }
          >
            <div className="template-road-editor-grid two-up">
              {templates.length > 0 ? (
                <label className="template-road-editor-field">
                  <span className="field-label">Открыть шаблон</span>
                  <select
                    className="text-input"
                    value={templateId ?? templates[0]?.id ?? ""}
                    onChange={(event) => void loadTemplate(event.target.value)}
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <span className="template-road-editor-field-hint">
                    После выбора весь редактор переключится на этот шаблон.
                  </span>
                </label>
              ) : (
                <div className="template-road-editor-field">
                  <span className="field-label">Библиотека шаблонов</span>
                  <div className="template-road-editor-shadow-empty">
                    <p className="subtle-text">{emptyLibraryMessage}</p>
                    {canCreateTemplates ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleCreateTemplate()}
                        disabled={saveState === "saving"}
                      >
                        Создать первый шаблон
                      </button>
                    ) : null}
                  </div>
                  <span className="template-road-editor-field-hint">
                    После создания шаблон сразу появится здесь и в настройках канала.
                  </span>
                </div>
              )}
              <label className="template-road-editor-field">
                <span className="field-label">Название шаблона</span>
                <input
                  className="text-input"
                  type="text"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Короткое понятное имя. Именно его ты увидишь в настройках канала.
                </span>
              </label>
            </div>
            <label className="template-road-editor-field">
              <span className="field-label">Примечание</span>
              <textarea
                className="text-area template-road-editor-textarea"
                rows={3}
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
              />
              <span className="template-road-editor-field-hint">
                Например: где этот шаблон использовать и чем он отличается от остальных.
              </span>
            </label>
            {templateId ? (
              <details className="template-road-editor-service-drawer">
                <summary>Служебные ссылки</summary>
                <div className="template-road-editor-library-links">
                  <a className="template-road-editor-link" href={editorUrl ?? "#"}>
                    Открыть этот шаблон в редакторе
                  </a>
                  <a className="template-road-editor-link" href={renderUrl ?? "#"}>
                    Открыть шаблон в `/design/science-card`
                  </a>
                  <span className="subtle-text mono">
                    API: /api/design/templates/{templateId}
                  </span>
                </div>
              </details>
            ) : null}
          </EditorSection>

          <EditorSection
            id="template-road-style-history"
            eyebrow="История"
            title="Версии шаблона"
            description="Автосохранение обновляет живой шаблон сразу. Здесь только контрольные точки."
            isOpen={Boolean(openSections["template-road-style-history"])}
            onToggle={() => toggleSection("template-road-style-history")}
            meta={
              <>
                <span className="meta-pill">Версий: {versions.length}</span>
                <span className="meta-pill">Храним максимум: 24</span>
              </>
            }
          >
            <div className="template-road-editor-meta-strip">
              <span className="meta-pill">
                Обновлён: {updatedAt ? new Date(updatedAt).toLocaleString("ru-RU") : "ещё не знаем"}
              </span>
              {activeTemplateSummary ? (
                <span className="meta-pill">Основа: {activeTemplate.label}</span>
              ) : null}
            </div>
            {!templateId ? (
              <p className="subtle-text">
                Сначала создай шаблон. После этого здесь появятся контрольные точки, к которым можно
                откатиться.
              </p>
            ) : versions.length === 0 ? (
              <p className="subtle-text">
                Пока нет сохранённых версий. Рабочее состояние уже живёт в шаблоне, но откатываться
                пока не к чему.
              </p>
            ) : (
              <div className="template-road-editor-shadow-list">
                {visibleVersions.map((version) => (
                  <div key={version.id} className="template-road-editor-shadow-card">
                    <div className="template-road-editor-shadow-card-head">
                      <div>
                        <strong>{version.label}</strong>
                        <p className="template-road-editor-shadow-snippet mono">
                          {new Date(version.createdAt).toLocaleString("ru-RU")}
                        </p>
                      </div>
                      <div className="template-road-editor-shadow-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void handleRestoreVersion(version.id)}
                          disabled={saveState === "saving"}
                        >
                          Откатиться к версии
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {versions.length > MAX_VISIBLE_TEMPLATE_VERSIONS ? (
                  <button
                    type="button"
                    className="btn btn-ghost template-road-editor-history-toggle"
                    onClick={() => setShowAllVersions((current) => !current)}
                  >
                    {showAllVersions
                      ? "Свернуть историю"
                      : `Показать ещё ${versions.length - MAX_VISIBLE_TEMPLATE_VERSIONS} версий`}
                  </button>
                ) : null}
              </div>
            )}
          </EditorSection>

          <EditorSection
            id="template-road-style-base"
            eyebrow="Основа"
            title="Базовая компоновка"
            description="Здесь выбирается база сцены. Геометрия карточки и кадра остаётся фиксированной."
            isOpen={Boolean(openSections["template-road-style-base"])}
            onToggle={() => toggleSection("template-road-style-base")}
            meta={
              <>
                <span className="meta-pill">Кадр: 1080x1920</span>
                <span className="meta-pill">Основа: {activeTemplate.label}</span>
              </>
            }
          >
            <div className="template-road-editor-grid two-up">
              <label className="template-road-editor-field">
                <span className="field-label">Основа макета</span>
                <select
                  className="text-input"
                  value={baseTemplateId}
                  onChange={(event) => setBaseTemplateId(event.target.value)}
                >
                  {TEMPLATE_VARIANTS.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.label}
                    </option>
                  ))}
                </select>
                <span className="template-road-editor-field-hint">
                  Это исходная геометрия и композиция, поверх которой строится стиль.
                </span>
              </label>
              <SliderControl
                label="Масштаб холста"
                hint="Меняет только удобство просмотра слева. Сам шаблон не масштабируется."
                min={0.22}
                max={0.5}
                step={0.01}
                nudgeStep={0.02}
                value={requestedCanvasScale}
                formatValue={formatScaleValue}
                onChange={(value) => updateContent("previewScale", clampPreviewScale(value))}
              />
            </div>
            <div className="template-road-editor-meta-strip">
              <span className="meta-pill">Позиция карточки зафиксирована</span>
              <span className="meta-pill">Кадр всегда 1080x1920</span>
              <span className="meta-pill">Основа: {activeTemplate.label}</span>
            </div>
          </EditorSection>

          <EditorSection
            id="template-road-style-content"
            eyebrow="Демо-контент"
            title="Текст для предпросмотра"
            description="Тестовый контент помогает быстро оценивать читаемость и баланс карточки."
            isOpen={Boolean(openSections["template-road-style-content"])}
            onToggle={() => toggleSection("template-road-style-content")}
            meta={
              <>
                <span className="meta-pill">Верх: {content.topText.length} символов</span>
                <span className="meta-pill">Низ: {content.bottomText.length} символов</span>
              </>
            }
          >
            <div className="template-road-editor-grid">
              <label className="template-road-editor-field">
                <span className="field-label">Верхний текст</span>
                <textarea
                  className="text-area template-road-editor-textarea"
                  rows={5}
                  value={content.topText}
                  onChange={(event) => updateContent("topText", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Основной крупный текст верхнего блока.
                </span>
              </label>
              <label className="template-road-editor-field">
                <span className="field-label">Нижний текст</span>
                <textarea
                  className="text-area template-road-editor-textarea"
                  rows={4}
                  value={content.bottomText}
                  onChange={(event) => updateContent("bottomText", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Дополнительный текст нижнего блока.
                </span>
              </label>
            </div>
            <div className="template-road-editor-grid two-up">
              <label className="template-road-editor-field">
                <span className="field-label">Название канала</span>
                <input
                  className="text-input"
                  type="text"
                  value={content.channelName}
                  onChange={(event) => updateContent("channelName", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Появляется в строке автора внизу карточки.
                </span>
              </label>
              <label className="template-road-editor-field">
                <span className="field-label">Хэндл / ник</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={content.channelHandle}
                  onChange={(event) => updateContent("channelHandle", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Обычно это короткий ник или `@handle`.
                </span>
              </label>
            </div>
            <div className="template-road-editor-field">
              <span className="field-label">Фон холста</span>
              <div className="template-road-editor-upload-card">
                <div
                  className={`template-road-editor-upload-preview ${
                    content.backgroundAsset ? "has-image" : "is-empty"
                  }`}
                  style={
                    content.backgroundAsset
                      ? { backgroundImage: `url(${content.backgroundAsset})` }
                      : undefined
                  }
                >
                  {!content.backgroundAsset ? <span>Сейчас используется встроенный фон</span> : null}
                </div>
                <div className="template-road-editor-upload-body">
                  <div className="template-road-editor-upload-copy">
                    <strong>
                      {content.backgroundAsset
                        ? "Пользовательский фон уже подключён"
                        : "Можно загрузить свою картинку для фона"}
                    </strong>
                    <p className="subtle-text">
                      Подходит для проверки читаемости карточки на реальном фоне. Поддерживаются JPG,
                      PNG, WebP, GIF, AVIF и SVG до 20 MB.
                    </p>
                  </div>
                  <div className="template-road-editor-upload-actions">
                    <input
                      ref={backgroundFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml"
                      hidden
                      onChange={handleBackgroundFileChange}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => backgroundFileInputRef.current?.click()}
                      disabled={backgroundUploadState === "uploading"}
                    >
                      {backgroundUploadState === "uploading" ? "Загружаем..." : "Загрузить фон"}
                    </button>
                    {content.backgroundAsset ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          updateContent("backgroundAsset", null);
                          setBackgroundUploadState("idle");
                          setBackgroundUploadMessage("Пользовательский фон убран. Возвращаемся к встроенному.");
                        }}
                      >
                        Убрать фон
                      </button>
                    ) : null}
                  </div>
                  <span
                    className={`template-road-editor-upload-note ${
                      backgroundUploadState === "error" ? "is-error" : ""
                    }`}
                  >
                    {backgroundUploadMessage ||
                      "Фон сохраняется внутри шаблона и сразу используется в превью редактора."}
                  </span>
                </div>
              </div>
            </div>
            <div className="template-road-editor-grid two-up">
              <SliderControl
                label="Крупность верхнего текста"
                hint="Лёгкая ручная коррекция поверх автоматического подбора."
                min={0.8}
                max={1.6}
                step={0.01}
                nudgeStep={0.02}
                value={content.topFontScale}
                formatValue={formatScaleValue}
                onChange={(value) => updateContent("topFontScale", clampStage3TextScaleUi(value))}
              />
              <SliderControl
                label="Крупность нижнего текста"
                hint="Полезно, если нижний блок кажется слишком тяжёлым или слишком пустым."
                min={0.8}
                max={1.6}
                step={0.01}
                nudgeStep={0.02}
                value={content.bottomFontScale}
                formatValue={formatScaleValue}
                onChange={(value) =>
                  updateContent("bottomFontScale", clampStage3TextScaleUi(value))
                }
              />
            </div>
            <label className="template-road-editor-field">
              <span className="field-label">Фразы для выделения</span>
              <input
                className="text-input"
                type="text"
                placeholder="слово одно | слово два"
                value={highlightValue}
                onChange={handleHighlightChange}
              />
              <span className="template-road-editor-field-hint">
                Перечисляй фразы через `|`, если хочешь проверить акцентный цвет на важных словах.
              </span>
            </label>
          </EditorSection>

          <EditorSection
            id="template-road-style-card"
            eyebrow="Карточка"
            title="Силуэт и оболочка"
            description="Обводка, фон и скругление карточки без изменения её расположения."
            isOpen={Boolean(openSections["template-road-style-card"])}
            onToggle={() => toggleSection("template-road-style-card")}
            meta={
              <>
                <span className="meta-pill">Скругление: {templateConfig.card.radius}px</span>
                <span className="meta-pill">Обводка: {templateConfig.card.borderWidth}px</span>
              </>
            }
          >
            <div className="template-road-editor-grid two-up">
              <SliderControl
                label="Скругление углов"
                hint="Чем больше значение, тем мягче выглядит форма карточки."
                min={0}
                max={52}
                step={1}
                value={templateConfig.card.radius}
                formatValue={formatPxValue}
                onChange={(value) => updateCard("radius", value)}
              />
              <SliderControl
                label="Толщина обводки"
                hint="Полезно, когда нужно сделать карточку более графичной или отделить от фона."
                min={0}
                max={24}
                step={1}
                value={templateConfig.card.borderWidth}
                formatValue={formatPxValue}
                onChange={(value) => updateCard("borderWidth", value)}
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <ColorControl
                label="Фон карточки"
                hint="Основной цвет или оттенок, на котором держится весь стиль."
                value={templateConfig.card.fill}
                onChange={(value) => updateCard("fill", value)}
              />
              <ColorControl
                label="Цвет обводки"
                hint="Если обводка не нужна, можно оставить толщину 0."
                value={templateConfig.card.borderColor}
                onChange={(value) => updateCard("borderColor", value)}
              />
            </div>
          </EditorSection>

          <EditorSection
            id="template-road-style-shadow"
            eyebrow="Тень"
            title="Генератор тени"
            description="Собирай тень слоями и сразу проверяй результат на карточке."
            isOpen={Boolean(openSections["template-road-style-shadow"])}
            onToggle={() => toggleSection("template-road-style-shadow")}
            meta={
              <>
                <span className="meta-pill">Слоёв: {shadowLayers.length}</span>
                <span className="meta-pill">{formatShadow(shadowCss)}</span>
              </>
            }
          >
            <div className="template-road-editor-shadow-head">
              <button type="button" className="btn btn-secondary" onClick={addShadowLayer}>
                Добавить слой тени
              </button>
            </div>
            {shadowLayers.length === 0 ? (
              <div className="template-road-editor-shadow-empty">
                <p className="subtle-text">
                  Пока тени нет. Добавь первый слой, чтобы начать собирать мягкую или графичную
                  глубину.
                </p>
              </div>
            ) : (
              <div className="template-road-editor-shadow-list">
                {shadowLayers.map((layer, index) => (
                  <div key={layer.id} className="template-road-editor-shadow-card">
                    <div className="template-road-editor-shadow-card-head">
                      <div>
                        <p className="kicker">Слой {index + 1}</p>
                        <p className="template-road-editor-shadow-snippet mono">
                          {serializeShadowLayers([layer])}
                        </p>
                      </div>
                      <div className="template-road-editor-shadow-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => duplicateShadowLayer(layer.id)}
                        >
                          Дублировать
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => removeShadowLayer(layer.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                    <div className="template-road-editor-grid three-up">
                      <SliderControl
                        label="Смещение по горизонтали"
                        hint="Плюс уводит тень вправо, минус влево."
                        min={-80}
                        max={80}
                        step={1}
                        value={layer.offsetX}
                        formatValue={formatPxValue}
                        onChange={(value) => updateShadowLayer(layer.id, "offsetX", value)}
                      />
                      <SliderControl
                        label="Смещение по вертикали"
                        hint="Плюс уводит тень вниз, минус вверх."
                        min={-80}
                        max={120}
                        step={1}
                        value={layer.offsetY}
                        formatValue={formatPxValue}
                        onChange={(value) => updateShadowLayer(layer.id, "offsetY", value)}
                      />
                      <SliderControl
                        label="Размытие"
                        hint="Чем больше размытие, тем мягче и глубже выглядит тень."
                        min={0}
                        max={120}
                        step={1}
                        value={layer.blur}
                        formatValue={formatPxValue}
                        onChange={(value) => updateShadowLayer(layer.id, "blur", value)}
                      />
                    </div>
                    <div className="template-road-editor-grid three-up">
                      <SliderControl
                        label="Расширение"
                        hint="Расширяет или сжимает пятно тени до размытия."
                        min={-40}
                        max={40}
                        step={1}
                        value={layer.spread}
                        formatValue={formatPxValue}
                        onChange={(value) => updateShadowLayer(layer.id, "spread", value)}
                      />
                      <SliderControl
                        label="Прозрачность"
                        hint="Насколько заметна тень. 100% очень плотная, 0% полностью невидима."
                        min={0}
                        max={1}
                        step={0.01}
                        value={Number(layer.opacity.toFixed(2))}
                        formatValue={formatOpacityValue}
                        onChange={(value) => updateShadowLayer(layer.id, "opacity", value)}
                      />
                      <div className="template-road-editor-field template-road-editor-checkbox-field">
                        <span className="field-label">Тип тени</span>
                        <label className="template-road-editor-checkbox-row">
                          <input
                            type="checkbox"
                            checked={layer.inset}
                            onChange={(event) =>
                              updateShadowLayer(layer.id, "inset", event.target.checked)
                            }
                          />
                          <span>{layer.inset ? "Внутренняя тень" : "Наружная тень"}</span>
                        </label>
                        <span className="template-road-editor-field-hint">
                          Наружная тень работает как глубина, внутренняя как вдавленный эффект.
                        </span>
                      </div>
                    </div>
                    <ColorControl
                      label="Цвет слоя"
                      hint="Обычно это чёрный или тёмный оттенок, но никто не мешает сделать цветную тень."
                      value={layer.color}
                      onChange={(value) => updateShadowLayer(layer.id, "color", value)}
                    />
                  </div>
                ))}
              </div>
            )}
            <label className="template-road-editor-field">
              <span className="field-label">Итоговый CSS</span>
              <textarea
                className="text-area template-road-editor-textarea mono"
                rows={4}
                value={shadowCss}
                readOnly
              />
              <span className="template-road-editor-field-hint">
                Это уже готовое значение `box-shadow`, которое сохранится в стиль.
              </span>
            </label>
          </EditorSection>

          <EditorSection
            id="template-road-style-color"
            eyebrow="Цвета"
            title="Палитра карточки"
            description="Цвета верхнего и нижнего блока, текста, автора и акцентных элементов."
            isOpen={Boolean(openSections["template-road-style-color"])}
            onToggle={() => toggleSection("template-road-style-color")}
            meta={
              <>
                <span className="meta-pill">Акцент: {accentColor}</span>
                <span className="meta-pill">Фон карточки: {templateConfig.card.fill}</span>
              </>
            }
          >
            <div className="template-road-editor-grid two-up">
              <ColorControl
                label="Фон верхнего блока"
                hint="Основной цвет секции с крупным заголовком."
                value={templateConfig.palette.topSectionFill}
                onChange={(value) => updatePalette("topSectionFill", value)}
              />
              <ColorControl
                label="Фон нижнего блока"
                hint="Фон для дополнительного текста и строки автора."
                value={templateConfig.palette.bottomSectionFill}
                onChange={(value) => updatePalette("bottomSectionFill", value)}
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <ColorControl
                label="Цвет верхнего текста"
                hint="Обычно это самый контрастный текст на карточке."
                value={templateConfig.palette.topTextColor}
                onChange={(value) => updatePalette("topTextColor", value)}
              />
              <ColorControl
                label="Цвет нижнего текста"
                hint="Тон нижнего блока можно сделать мягче, чем у заголовка."
                value={templateConfig.palette.bottomTextColor}
                onChange={(value) => updatePalette("bottomTextColor", value)}
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <ColorControl
                label="Цвет имени автора"
                hint="Цвет названия канала или автора в нижней строке."
                value={templateConfig.palette.authorNameColor}
                onChange={(value) => updatePalette("authorNameColor", value)}
              />
              <ColorControl
                label="Цвет ника автора"
                hint="Обычно немного мягче имени, чтобы не спорить с ним по важности."
                value={templateConfig.palette.authorHandleColor}
                onChange={(value) => updatePalette("authorHandleColor", value)}
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <ColorControl
                label="Цвет бейджа"
                hint="Цвет галочки, маркера или маленького статусного элемента."
                value={templateConfig.palette.checkBadgeColor}
                onChange={(value) => updatePalette("checkBadgeColor", value)}
              />
              <ColorControl
                label="Цвет выделений"
                hint="Используется для акцентных слов и визуальных подсветок."
                value={accentColor}
                onChange={(value) => updatePalette("accentColor", value)}
              />
            </div>
          </EditorSection>

          <EditorSection
            id="template-road-style-type"
            eyebrow="Шрифты"
            title="Типографика и характер"
            description="Главный блок стилизации: шрифтовой характер, вес и плотность текста."
            isOpen={Boolean(openSections["template-road-style-type"])}
            onToggle={() => toggleSection("template-road-style-type")}
            meta={
              <>
                <span className="meta-pill">Верх: {currentTopFontFamily.split(",")[0]}</span>
                <span className="meta-pill">Низ: {currentBottomFontFamily.split(",")[0]}</span>
              </>
            }
          >
            <div className="template-road-editor-grid two-up">
              <SelectControl
                label="Шрифт верхнего текста"
                hint="Главный голос карточки. Часто именно он задаёт стиль шаблона."
                value={currentTopFontFamily}
                options={topFontSelectOptions}
                onChange={(value) => updateTopTypography("fontFamily", value)}
              />
              <SelectControl
                label="Шрифт нижнего текста"
                hint="Можно поддержать верхний текст или, наоборот, дать более спокойный контраст."
                value={currentBottomFontFamily}
                options={bottomFontSelectOptions}
                onChange={(value) => updateBottomTypography("fontFamily", value)}
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <label className="template-road-editor-field">
                <span className="field-label">Свой стек шрифтов сверху</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={currentTopFontFamily}
                  onChange={(event) => updateTopTypography("fontFamily", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Можно вставить любой CSS `font-family` стек, если пресетов мало.
                </span>
              </label>
              <label className="template-road-editor-field">
                <span className="field-label">Свой стек шрифтов снизу</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={currentBottomFontFamily}
                  onChange={(event) => updateBottomTypography("fontFamily", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Полезно, если хочешь быстро проверить редкий стек без отдельного импорта.
                </span>
              </label>
            </div>
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Насыщенность верхнего текста"
                hint="Больше вес, больше визуальное давление и драматизм."
                min={400}
                max={900}
                step={50}
                nudgeStep={100}
                value={templateConfig.typography.top.weight ?? 800}
                onChange={(value) => updateTopTypography("weight", value)}
              />
              <SliderControl
                label="Насыщенность нижнего текста"
                hint="Помогает сделать низ либо спокойнее, либо плотнее."
                min={300}
                max={900}
                step={50}
                nudgeStep={100}
                value={templateConfig.typography.bottom.weight ?? 500}
                onChange={(value) => updateBottomTypography("weight", value)}
              />
              <SelectControl
                label="Стиль нижнего текста"
                hint="Курсив добавляет журнальный или редакционный характер."
                value={templateConfig.typography.bottom.fontStyle ?? "normal"}
                options={[
                  { label: "Обычный", value: "normal" },
                  { label: "Курсив", value: "italic" }
                ]}
                onChange={(value) =>
                  updateBottomTypography("fontStyle", value as "normal" | "italic")
                }
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <label className="template-road-editor-field">
                <span className="field-label">Интервал между буквами сверху</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={templateConfig.typography.top.letterSpacing ?? "-0.015em"}
                  onChange={(event) => updateTopTypography("letterSpacing", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Например: `-0.02em` для плотного набора или `0.02em` для более воздушного.
                </span>
              </label>
              <label className="template-road-editor-field">
                <span className="field-label">Интервал между буквами снизу</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={templateConfig.typography.bottom.letterSpacing ?? "-0.005em"}
                  onChange={(event) => updateBottomTypography("letterSpacing", event.target.value)}
                />
                <span className="template-road-editor-field-hint">
                  Хороший инструмент, чтобы нижний блок выглядел спокойнее или строже.
                </span>
              </label>
            </div>
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Размер имени автора"
                hint="Делает название канала заметнее или деликатнее."
                min={24}
                max={52}
                step={1}
                value={templateConfig.typography.authorName.font}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthorNameTypography("font", value)}
              />
              <SliderControl
                label="Размер ника автора"
                hint="Обычно чуть меньше имени, чтобы сохранить иерархию."
                min={20}
                max={44}
                step={1}
                value={templateConfig.typography.authorHandle.font}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthorHandleTypography("font", value)}
              />
              <SliderControl
                label="Насыщенность имени автора"
                hint="Если строка автора выглядит слишком слабой, прибавь вес здесь."
                min={300}
                max={900}
                step={50}
                nudgeStep={100}
                value={templateConfig.typography.authorName.weight ?? 700}
                onChange={(value) => updateAuthorNameTypography("weight", value)}
              />
            </div>
          </EditorSection>

          <EditorSection
            id="template-road-style-spacing"
            eyebrow="Отступы"
            title="Внутренний ритм"
            description="Тонкая настройка плотности и воздуха между элементами."
            isOpen={Boolean(openSections["template-road-style-spacing"])}
            onToggle={() => toggleSection("template-road-style-spacing")}
            meta={
              <>
                <span className="meta-pill">Автор: gap {templateConfig.author.gap ?? 11}px</span>
                <span className="meta-pill">
                  Верхние поля: {templateConfig.slot.topPaddingX}px /{" "}
                  {templateConfig.slot.topPaddingTop ?? templateConfig.slot.topPaddingY}px
                </span>
              </>
            }
          >
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Поля верхнего текста по бокам"
                hint="Горизонтальные поля внутри верхнего блока."
                min={0}
                max={48}
                step={1}
                value={templateConfig.slot.topPaddingX}
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("topPaddingX", value)}
              />
              <SliderControl
                label="Отступ сверху у верхнего текста"
                hint="Воздух над заголовком."
                min={0}
                max={48}
                step={1}
                value={templateConfig.slot.topPaddingTop ?? templateConfig.slot.topPaddingY}
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("topPaddingTop", value)}
              />
              <SliderControl
                label="Отступ снизу у верхнего текста"
                hint="Воздух под заголовком перед границей секции."
                min={0}
                max={48}
                step={1}
                value={templateConfig.slot.topPaddingBottom ?? templateConfig.slot.topPaddingY}
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("topPaddingBottom", value)}
              />
            </div>
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Поля строки автора по бокам"
                hint="Горизонтальные отступы у нижней строки с автором."
                min={0}
                max={48}
                step={1}
                value={templateConfig.slot.bottomMetaPaddingX}
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("bottomMetaPaddingX", value)}
              />
              <SliderControl
                label="Отступ слева у нижнего текста"
                hint="Сколько воздуха слева у абзаца нижнего блока."
                min={0}
                max={64}
                step={1}
                value={
                  templateConfig.slot.bottomTextPaddingLeft ?? templateConfig.slot.bottomTextPaddingX
                }
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("bottomTextPaddingLeft", value)}
              />
              <SliderControl
                label="Отступ справа у нижнего текста"
                hint="Балансирует нижний текст относительно правого края."
                min={0}
                max={64}
                step={1}
                value={
                  templateConfig.slot.bottomTextPaddingRight ?? templateConfig.slot.bottomTextPaddingX
                }
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("bottomTextPaddingRight", value)}
              />
            </div>
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Отступ сверху у нижнего текста"
                hint="Воздух над абзацем нижнего блока."
                min={0}
                max={36}
                step={1}
                value={
                  templateConfig.slot.bottomTextPaddingTop ?? templateConfig.slot.bottomTextPaddingY
                }
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("bottomTextPaddingTop", value)}
              />
              <SliderControl
                label="Отступ снизу у нижнего текста"
                hint="Воздух между нижним текстом и строкой автора."
                min={0}
                max={36}
                step={1}
                value={
                  templateConfig.slot.bottomTextPaddingBottom ??
                  templateConfig.slot.bottomTextPaddingY
                }
                formatValue={formatPxValue}
                onChange={(value) => updateSlot("bottomTextPaddingBottom", value)}
              />
              <SliderControl
                label="Расстояние между аватаром и текстом"
                hint="Сдвигает строку автора между более плотным и более расслабленным состоянием."
                min={0}
                max={24}
                step={1}
                value={templateConfig.author.gap ?? 11}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthor("gap", value)}
              />
            </div>
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Расстояние между именем и ником"
                hint="Вертикальный зазор внутри текстовой части строки автора."
                min={0}
                max={16}
                step={1}
                value={templateConfig.author.copyGap ?? 1}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthor("copyGap", value)}
              />
              <SliderControl
                label="Расстояние между именем и бейджем"
                hint="Сколько места оставить между названием канала и галочкой."
                min={0}
                max={18}
                step={1}
                value={templateConfig.author.nameCheckGap ?? 8}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthor("nameCheckGap", value)}
              />
              <SliderControl
                label="Толщина обводки аватара"
                hint="Помогает отделить аватар от фона или сделать его более собранным."
                min={0}
                max={6}
                step={1}
                value={templateConfig.author.avatarBorder}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthor("avatarBorder", value)}
              />
            </div>
          </EditorSection>

          <EditorSection
            id="template-road-style-details"
            eyebrow="Детали"
            title="Мелкие элементы"
            description="Финальная полировка автора, аватара и статусных элементов."
            isOpen={Boolean(openSections["template-road-style-details"])}
            onToggle={() => toggleSection("template-road-style-details")}
            meta={
              <>
                <span className="meta-pill">Аватар: {templateConfig.author.avatarSize}px</span>
                <span className="meta-pill">Бейдж: {templateConfig.author.checkSize}px</span>
                <span className="meta-pill">
                  {currentBadgeOption?.label ?? (currentBadgeAssetPath ? "Свой бейдж" : "Цветная галочка")}
                </span>
              </>
            }
          >
            <BadgeOptionPicker
              label="Вариант галочки"
              hint="Можно выбрать один из встроенных бейджей. Выбор сразу применяется в превью и в итоговом рендере."
              value={currentBadgeAssetPath}
              options={BADGE_OPTIONS}
              fallbackColor={templateConfig.palette.checkBadgeColor}
              onChange={(value) => updateAuthor("checkAssetPath", value || undefined)}
            />
            <div className="template-road-editor-grid three-up">
              <SliderControl
                label="Размер аватара"
                hint="Крупнее делает строку автора заметнее, меньше — деликатнее."
                min={72}
                max={126}
                step={1}
                value={templateConfig.author.avatarSize}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthor("avatarSize", value)}
              />
              <SliderControl
                label="Размер бейджа"
                hint="Размер галочки или статусного маркера рядом с именем."
                min={34}
                max={72}
                step={1}
                value={templateConfig.author.checkSize}
                formatValue={formatPxValue}
                onChange={(value) => updateAuthor("checkSize", value)}
              />
              <SliderControl
                label="Насыщенность ника автора"
                hint="Если ник теряется, можно слегка поднять вес."
                min={300}
                max={900}
                step={50}
                nudgeStep={100}
                value={templateConfig.typography.authorHandle.weight ?? 600}
                onChange={(value) => updateAuthorHandleTypography("weight", value)}
              />
            </div>
            <div className="template-road-editor-grid two-up">
              <label className="template-road-editor-field">
                <span className="field-label">Интервал между буквами имени</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={templateConfig.typography.authorName.letterSpacing ?? "-0.03em"}
                  onChange={(event) =>
                    updateAuthorNameTypography("letterSpacing", event.target.value)
                  }
                />
                <span className="template-road-editor-field-hint">
                  Пригодится, если имя автора кажется слишком плотным или слишком разреженным.
                </span>
              </label>
              <label className="template-road-editor-field">
                <span className="field-label">Интервал между буквами ника</span>
                <input
                  className="text-input mono"
                  type="text"
                  value={templateConfig.typography.authorHandle.letterSpacing ?? "-0.02em"}
                  onChange={(event) =>
                    updateAuthorHandleTypography("letterSpacing", event.target.value)
                  }
                />
                <span className="template-road-editor-field-hint">
                  Тонкая настройка для более аккуратного и читаемого ника автора.
                </span>
              </label>
            </div>
          </EditorSection>
        </div>
      </aside>
    </main>
  );
}
