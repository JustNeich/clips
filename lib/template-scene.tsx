import React, { CSSProperties } from "react";
import type {
  TemplateCompareScope,
  TemplateContentFixture
} from "./template-calibration-types";
import {
  SCIENCE_CARD,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  HEDGES_OF_HONOR_TEMPLATE_ID,
  isClassicScienceCardTemplateId,
  STAGE3_TEMPLATE_ID,
  Stage3TemplateConfig,
  getTemplateById,
  getTemplateComputed,
  resolveScaledMaxLines
} from "./stage3-template";
import {
  TemplateLayoutModel,
  TemplateRenderSnapshot,
  buildTemplateLayoutModel,
  buildTemplateRenderSnapshot,
  resolveTemplateChromeMetrics
} from "./stage3-template-core";
import {
  buildTemplateHighlightSpansFromPhrases,
  normalizeTemplateHighlightSpans,
  type TemplateHighlightSlotId,
  type TemplateHighlightSpan
} from "./template-highlights";
import { Stage3VerifiedBadge } from "./stage3-verified-badge";

export type TemplateSceneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TemplateSceneRegions = {
  shell: TemplateSceneRect;
  card: TemplateSceneRect;
  top: TemplateSceneRect;
  media: TemplateSceneRect;
  bottom: TemplateSceneRect;
  author: TemplateSceneRect;
  avatar: TemplateSceneRect;
  bottomText: TemplateSceneRect;
};

export type TemplateSceneGuide = {
  key: string;
  label: string;
  rect: TemplateSceneRect;
};

export type TemplateSceneLayout = ReturnType<typeof getTemplateSceneLayout>;

export type TemplateSceneProps = {
  templateId: string;
  content: TemplateContentFixture;
  snapshot?: TemplateRenderSnapshot;
  templateConfigOverride?: Stage3TemplateConfig;
  onComputedChange?: (computed: ReturnType<typeof getTemplateComputed>) => void;
  backgroundNode?: React.ReactNode;
  mediaNode?: React.ReactNode;
  avatarNode?: React.ReactNode;
  verificationBadgeNode?: React.ReactNode;
  overlayNode?: React.ReactNode;
  showGuides?: boolean;
  showSafeArea?: boolean;
  compareScope?: TemplateCompareScope;
  className?: string;
  style?: CSSProperties;
  sceneDataId?: string;
  computedOverride?: ReturnType<typeof getTemplateComputed>;
  sceneReady?: boolean;
  sceneRef?: React.Ref<HTMLDivElement>;
};

function avatarInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) {
    return "SS";
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "SS";
}

function getBottomTextPaddingTop(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): number {
  return templateConfig.slot.bottomTextPaddingTop ?? templateConfig.slot.bottomTextPaddingY;
}

function getBottomTextPaddingBottom(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): number {
  return templateConfig.slot.bottomTextPaddingBottom ?? templateConfig.slot.bottomTextPaddingY;
}

function getBottomTextPaddingLeft(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): number {
  return templateConfig.slot.bottomTextPaddingLeft ?? templateConfig.slot.bottomTextPaddingX;
}

function getBottomTextPaddingRight(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): number {
  return templateConfig.slot.bottomTextPaddingRight ?? templateConfig.slot.bottomTextPaddingX;
}

function getTopPaddingTop(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): number {
  return templateConfig.slot.topPaddingTop ?? templateConfig.slot.topPaddingY;
}

function getTopPaddingBottom(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): number {
  return templateConfig.slot.topPaddingBottom ?? templateConfig.slot.topPaddingY;
}

function resolveDefaultTopFontFamily(templateId: string): string {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return '"Arial Rounded MT Bold",".SF NS Rounded","SF Pro Rounded","Helvetica Rounded","Arial",sans-serif';
  }
  return '"Inter","Helvetica Neue",Helvetica,sans-serif';
}

function resolveDefaultBodyFontFamily(templateId: string): string {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return '".SF NS Rounded","SF Pro Rounded","Helvetica Rounded","Arial Rounded MT Bold","Arial",sans-serif';
  }
  return '"Inter","Helvetica Neue",Helvetica,sans-serif';
}

const DEFAULT_TEMPLATE_PALETTE = {
  cardFill: "#ffffff",
  topSectionFill: "#ffffff",
  bottomSectionFill: "#ffffff",
  topTextColor: "#0b1018",
  bottomTextColor: "#0b1018",
  authorNameColor: "#0c1018",
  authorHandleColor: "#10131a",
  checkBadgeColor: "#bf5cf4",
  borderColor: "#0a1119",
  accentColor: "#0b1018"
};

function resolvePalette(templateConfig: Stage3TemplateConfig = SCIENCE_CARD): Stage3TemplateConfig["palette"] {
  return { ...DEFAULT_TEMPLATE_PALETTE, ...(templateConfig.palette ?? {}) };
}

function renderHighlightedText(
  text: string,
  highlights: TemplateHighlightSpan[],
  slotColors: Record<TemplateHighlightSlotId, string>
): React.ReactNode {
  if (!highlights.length || !text.trim()) {
    return text;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  highlights.forEach((highlight, index) => {
    const start = Math.max(0, Math.min(text.length, highlight.start));
    const end = Math.max(start, Math.min(text.length, highlight.end));
    if (start > cursor) {
      parts.push(
        <React.Fragment key={`plain-${cursor}-${start}`}>{text.slice(cursor, start)}</React.Fragment>
      );
    }
    const color = slotColors[highlight.slotId];
    const segment = text.slice(start, end);
    parts.push(
      color ? (
        <span key={`hl-${highlight.slotId}-${index}`} style={{ color }}>
          {segment}
        </span>
      ) : (
        <React.Fragment key={`plain-${highlight.slotId}-${index}`}>{segment}</React.Fragment>
      )
    );
    cursor = end;
  });
  if (cursor < text.length) {
    parts.push(<React.Fragment key={`plain-tail-${cursor}`}>{text.slice(cursor)}</React.Fragment>);
  }
  return parts;
}

function resolveBlockHighlights(
  block: keyof TemplateContentFixture["highlights"],
  templateConfig: Stage3TemplateConfig,
  content: TemplateContentFixture,
  text: string
): TemplateHighlightSpan[] {
  if (!templateConfig.highlights.enabled) {
    return [];
  }
  if (block === "top" && !templateConfig.highlights.topEnabled) {
    return [];
  }
  if (block === "bottom" && !templateConfig.highlights.bottomEnabled) {
    return [];
  }
  const enabledSlotIds = new Set(
    templateConfig.highlights.slots.filter((slot) => slot.enabled).map((slot) => slot.slotId)
  );
  const normalized = normalizeTemplateHighlightSpans(content.highlights[block], text).filter((item) =>
    enabledSlotIds.has(item.slotId)
  );
  if (normalized.length > 0 || block !== "top" || !Array.isArray(content.topHighlightPhrases)) {
    return normalized;
  }
  return buildTemplateHighlightSpansFromPhrases({
    text,
    annotations: content.topHighlightPhrases.map((phrase) => ({
      phrase,
      slotId: "slot1" as const
    }))
  }).filter((item) => enabledSlotIds.has(item.slotId));
}

type ScienceShellVisuals = {
  shellBackdropNode?: React.ReactNode;
  shellFrameNode?: React.ReactNode;
  shellStyle?: CSSProperties;
  topStyle?: CSSProperties;
  topNode?: React.ReactNode;
  mediaStyle?: CSSProperties;
  mediaNode?: React.ReactNode;
  bottomStyle?: CSSProperties;
  authorStyle?: CSSProperties;
  authorNode?: React.ReactNode;
  bottomTextWrapStyle?: CSSProperties;
  bottomTextNode?: React.ReactNode;
  bottomTextStyle?: CSSProperties;
};

function resolveScienceShellVisuals(
  templateId: string,
  templateConfig: Stage3TemplateConfig,
  palette: ReturnType<typeof resolvePalette>,
  regions: TemplateSceneRegions
): ScienceShellVisuals {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID) {
    return {
      topStyle: {
        background: palette.topSectionFill,
        borderBottom: "1px solid rgba(141, 147, 152, 0.42)"
      },
      bottomStyle: {
        background: palette.bottomSectionFill,
        borderTop: "1px solid rgba(141, 147, 152, 0.36)"
      },
      authorStyle: {
        background: "#ffffff",
        borderBottom: "1px solid rgba(141, 147, 152, 0.22)"
      }
    };
  }

  return {};
}

export function TemplateBackdrop({
  templateId,
  assetUrl
}: {
  templateId: string;
  assetUrl?: string;
}): React.JSX.Element {
  if (assetUrl) {
    return (
      <img
        src={assetUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block"
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(circle at 48% 6%, rgba(160, 199, 252, 0.86), rgba(52, 104, 186, 0.72) 36%, rgba(8, 18, 44, 0.95) 100%)"
      }}
    />
  );
}

function getSceneGuides(regions: TemplateSceneRegions): TemplateSceneGuide[] {
  return [
    { key: "shell", label: "Shell", rect: regions.shell },
    { key: "top", label: "Top", rect: regions.top },
    { key: "media", label: "Media", rect: regions.media },
    { key: "bottom", label: "Bottom", rect: regions.bottom },
    { key: "author", label: "Author", rect: regions.author }
  ];
}

function shouldShowGuide(scope: TemplateCompareScope | undefined, key: TemplateSceneGuide["key"]): boolean {
  if (!scope || scope === "full" || scope === "chrome-only") {
    return true;
  }
  if (scope === "top-only") {
    return key === "top";
  }
  if (scope === "media-only") {
    return key === "media";
  }
  if (scope === "bottom-only") {
    return key === "bottom";
  }
  if (scope === "author-only") {
    return key === "author";
  }
  return true;
}

export function getTemplateSceneLayout(
  templateId: string,
  content: TemplateContentFixture,
  computedOverride?: ReturnType<typeof getTemplateComputed>,
  snapshot?: TemplateRenderSnapshot,
  templateConfigOverride?: Stage3TemplateConfig
) {
  const renderSnapshot =
    snapshot ??
    buildTemplateRenderSnapshot({
      templateId,
      content,
      templateConfigOverride
    });
  const computed = computedOverride ?? renderSnapshot.computed;
  const templateConfig = templateConfigOverride ?? getTemplateById(templateId);
  const layoutModel: TemplateLayoutModel = snapshot
    ? renderSnapshot.layout
    : buildTemplateLayoutModel(templateId, computed, templateConfig);

  return {
    isTurbo: false,
    frame: layoutModel.frame,
    computed,
    regions: {
      shell: layoutModel.shell,
      card: layoutModel.card,
      top: layoutModel.top,
      media: layoutModel.media,
      bottom: layoutModel.bottom,
      author: layoutModel.author,
      avatar: layoutModel.avatar,
      bottomText: layoutModel.bottomText
    }
  };
}

function renderDefaultAvatar(
  templateId: string,
  templateConfig: Stage3TemplateConfig,
  channelName: string,
  sizeOverride?: number
): React.JSX.Element {
  const usesClassicScienceCardChrome = isClassicScienceCardTemplateId(templateId);
  const isScienceCardV7 = templateId === SCIENCE_CARD_V7_TEMPLATE_ID;
  const isHedgesOfHonor = templateId === HEDGES_OF_HONOR_TEMPLATE_ID;
  const author = templateConfig.author;
  const avatarSize = sizeOverride ?? author.avatarSize;
  const palette = resolvePalette(templateConfig);
  const avatarFontFamily =
    templateConfig.typography.authorName.fontFamily ??
    templateConfig.typography.bottom.fontFamily ??
    resolveDefaultBodyFontFamily(templateId || STAGE3_TEMPLATE_ID);
  let borderColor = "rgba(7, 13, 23, 0.25)";
  if (isScienceCardV7 || isHedgesOfHonor) {
    borderColor = "rgba(255,255,255,0)";
  }

  let background = `radial-gradient(circle at 30% 30%, ${palette.topSectionFill}, ${palette.cardFill} 70%, #20506f)`;
  if (isScienceCardV7 || isHedgesOfHonor) {
    background = `
      radial-gradient(circle at 50% 34%, rgba(241, 211, 185, 0.98) 0 18%, rgba(241, 211, 185, 0) 19%),
      radial-gradient(circle at 49% 62%, rgba(28, 34, 46, 0.92) 0 26%, rgba(28, 34, 46, 0) 27%),
      radial-gradient(circle at 48% 24%, rgba(56, 38, 30, 0.96) 0 28%, rgba(56, 38, 30, 0) 29%),
      linear-gradient(180deg, rgba(44, 50, 63, 0.96), rgba(13, 16, 23, 0.99))
    `;
  }
  return (
    <div
      style={{
        width: avatarSize,
        height: avatarSize,
        borderRadius: 999,
        border: `${author.avatarBorder}px solid ${borderColor}`,
        background: usesClassicScienceCardChrome ? "#d9d9d9" : background,
        color: "rgba(255,255,255,0.95)",
        display: "grid",
        placeItems: "center",
        fontFamily: avatarFontFamily,
        fontWeight: 800,
        fontSize: Math.round(avatarSize * 0.32),
        letterSpacing: "0.02em",
        boxSizing: "border-box",
        flex: "0 0 auto"
      }}
    >
      {usesClassicScienceCardChrome || isScienceCardV7 || isHedgesOfHonor
        ? null
        : avatarInitials(channelName)}
    </div>
  );
}

function renderVerificationBadge(
  templateConfig: Stage3TemplateConfig,
  palette: ReturnType<typeof resolvePalette>,
  overrideNode?: React.ReactNode,
  sizeOverride?: number
) {
  if (overrideNode) {
    return overrideNode;
  }

  const badgeSize = sizeOverride ?? templateConfig.author.checkSize;

  if (templateConfig.author.checkAssetPath) {
    return (
      <img
        src={templateConfig.author.checkAssetPath}
        alt=""
        style={{
          width: badgeSize,
          height: badgeSize,
          display: "block",
          flex: "0 0 auto"
        }}
      />
    );
  }

  return (
    <Stage3VerifiedBadge color={palette.checkBadgeColor} size={badgeSize} />
  );
}

function TemplateSceneGuides({
  guides,
  compareScope
}: {
  guides: TemplateSceneGuide[];
  compareScope?: TemplateCompareScope;
}): React.JSX.Element {
  const shellGuide = guides.find((guide) => guide.key === "shell");
  return (
    <>
      {guides
        .filter((guide) => shouldShowGuide(compareScope, guide.key))
        .map((guide) => (
          <div
            key={guide.key}
            style={{
              position: "absolute",
              left: guide.rect.x,
              top: guide.rect.y,
              width: guide.rect.width,
              height: guide.rect.height,
              border: `1px dashed ${
                guide.key === "media"
                  ? "rgba(117, 191, 255, 0.62)"
                  : guide.key === "author"
                    ? "rgba(87, 238, 175, 0.58)"
                    : "rgba(255, 193, 83, 0.52)"
              }`,
              boxSizing: "border-box",
              pointerEvents: "none"
            }}
          >
            <span
              style={{
                position: "absolute",
                top: -18,
                left: 0,
                fontSize: 11,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(245, 248, 255, 0.9)",
                background: "rgba(6, 12, 22, 0.74)",
                padding: "2px 6px",
                borderRadius: 999
              }}
            >
              {guide.label}
            </span>
          </div>
        ))}
      {shellGuide ? (
        <div
          style={{
            position: "absolute",
            left: shellGuide.rect.x,
            top: shellGuide.rect.y,
            width: shellGuide.rect.width,
            height: shellGuide.rect.height,
            border: "1px solid rgba(255,255,255,0.18)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ) : null}
    </>
  );
}

export function TemplateScene({
  templateId,
  content,
  snapshot,
  templateConfigOverride,
  backgroundNode,
  mediaNode,
  avatarNode,
  verificationBadgeNode,
  overlayNode,
  showGuides = false,
  showSafeArea = false,
  compareScope,
  className,
  style,
  sceneDataId,
  computedOverride,
  sceneReady = true,
  sceneRef
}: TemplateSceneProps): React.JSX.Element {
  const resolvedTemplateId = templateId || STAGE3_TEMPLATE_ID;
  const renderSnapshot =
    snapshot ??
    buildTemplateRenderSnapshot({
      templateId: resolvedTemplateId,
      content,
      templateConfigOverride
    });
  const effectiveContent = renderSnapshot.content;
  const layout = getTemplateSceneLayout(
    resolvedTemplateId,
    effectiveContent,
    computedOverride,
    renderSnapshot,
    templateConfigOverride
  );
  const { regions, frame, computed } = layout;
  const templateConfig = templateConfigOverride ?? getTemplateById(resolvedTemplateId);
  const usesClassicScienceCardChrome = isClassicScienceCardTemplateId(resolvedTemplateId);
  const chromeMetrics = resolveTemplateChromeMetrics(resolvedTemplateId, templateConfig, renderSnapshot.spec);
  const palette = resolvePalette(templateConfig);
  const cardSpec = renderSnapshot.spec.card;
  const cardRect = regions.card;
  const usesSkyframeTypography =
    resolvedTemplateId === SCIENCE_CARD_V7_TEMPLATE_ID ||
    resolvedTemplateId === HEDGES_OF_HONOR_TEMPLATE_ID;
  const usesOverlayCardChrome = usesSkyframeTypography;
  const cardRadius = usesClassicScienceCardChrome ? chromeMetrics.cardRadius : templateConfig.card.radius;
  const cardBorderWidth = usesClassicScienceCardChrome
    ? chromeMetrics.cardBorderWidth
    : templateConfig.card.borderWidth;
  const cardBorderColor = templateConfig.card.borderColor || palette.borderColor || cardSpec.borderColor;
  const cardFill = templateConfig.card.fill || palette.cardFill || cardSpec.fill;
  const cardShadow = templateConfig.card.shadow ?? cardSpec.shadow;
  const overlayCardInsetShadow =
    resolvedTemplateId === HEDGES_OF_HONOR_TEMPLATE_ID
      ? "inset 0 0 0 1px rgba(10, 14, 20, 0.1), inset 0 0 18px rgba(17, 25, 34, 0.05), inset 0 4px 10px rgba(17, 25, 34, 0.08), inset 0 -7px 14px rgba(17, 25, 34, 0.1)"
      : usesOverlayCardChrome
        ? "inset 0 1px 0 rgba(255,255,255,0.34), inset 0 10px 18px rgba(17, 25, 34, 0.038), inset 0 -12px 18px rgba(17, 25, 34, 0.058)"
        : null;
  const scienceShellVisuals: ScienceShellVisuals =
    usesClassicScienceCardChrome
      ? {}
      : resolveScienceShellVisuals(resolvedTemplateId, templateConfig, palette, regions);
  const topText = computed.top || "Верхний текст появится здесь.";
  const bottomText = computed.bottom || "Нижний текст появится здесь.";
  const topHighlights = resolveBlockHighlights("top", templateConfig, effectiveContent, topText);
  const bottomHighlights = resolveBlockHighlights("bottom", templateConfig, effectiveContent, bottomText);
  const highlightColors = Object.fromEntries(
    templateConfig.highlights.slots.map((slot) => [slot.slotId, slot.color])
  ) as Record<TemplateHighlightSlotId, string>;
  const authorName = effectiveContent.channelName || templateConfig.author.name;
  const authorHandle = effectiveContent.channelHandle || templateConfig.author.handle;
  const authorGap = templateConfig.author.gap ?? 11;
  const authorCopyGap = templateConfig.author.copyGap ?? 1;
  const authorNameCheckGap = templateConfig.author.nameCheckGap ?? 8;
  const authorAvatarSize = templateConfig.author.avatarSize;
  const authorCheckSize = templateConfig.author.checkSize;
  const authorNameFontSize = templateConfig.typography.authorName.font;
  const authorHandleFontSize = templateConfig.typography.authorHandle.font;
  const topTextWeight = templateConfig.typography.top.weight ?? 800;
  const topTextLetterSpacing = templateConfig.typography.top.letterSpacing ?? "-0.015em";
  const topTextFontFamily =
    templateConfig.typography.top.fontFamily ?? resolveDefaultTopFontFamily(resolvedTemplateId);
  const bottomTextFontFamily =
    templateConfig.typography.bottom.fontFamily ?? resolveDefaultBodyFontFamily(resolvedTemplateId);
  const authorNameFontFamily = templateConfig.typography.authorName.fontFamily ?? bottomTextFontFamily;
  const authorHandleFontFamily = templateConfig.typography.authorHandle.fontFamily ?? bottomTextFontFamily;
  const bottomTextWeight = templateConfig.typography.bottom.weight ?? 500;
  const bottomTextLetterSpacing = templateConfig.typography.bottom.letterSpacing ?? "-0.005em";
  const bottomTextFontStyle = templateConfig.typography.bottom.fontStyle ?? "normal";
  const authorNameWeight = templateConfig.typography.authorName.weight ?? (usesClassicScienceCardChrome ? 800 : 700);
  const authorNameLetterSpacing =
    templateConfig.typography.authorName.letterSpacing ?? (usesClassicScienceCardChrome ? "-0.03em" : "-0.01em");
  const authorHandleWeight = templateConfig.typography.authorHandle.weight ?? (usesClassicScienceCardChrome ? 300 : 600);
  const authorHandleLetterSpacing = templateConfig.typography.authorHandle.letterSpacing ?? "-0.02em";
  const topMaxLines = resolveScaledMaxLines(
    templateConfig.typography.top.maxLines,
    effectiveContent.topFontScale ?? 1,
    "top"
  );
  const bottomMaxLines = resolveScaledMaxLines(
    templateConfig.typography.bottom.maxLines,
    effectiveContent.bottomFontScale ?? 1,
    "bottom"
  );

  const topPaddingTop = usesClassicScienceCardChrome ? chromeMetrics.topPaddingTop : getTopPaddingTop(templateConfig);
  const topPaddingBottom = usesClassicScienceCardChrome ? chromeMetrics.topPaddingBottom : getTopPaddingBottom(templateConfig);
  const topPaddingX = usesClassicScienceCardChrome ? chromeMetrics.topPaddingX : templateConfig.slot.topPaddingX;
  const scienceCardChromeOutset = usesClassicScienceCardChrome ? Math.max(1, Math.round(cardBorderWidth / 2)) : 0;
  const scienceCardOuterRadius = cardRadius + scienceCardChromeOutset;

  return (
    <div
      ref={sceneRef}
      className={className}
      data-template-scene={sceneDataId ?? resolvedTemplateId}
      data-template-scene-ready={sceneReady ? "1" : "0"}
      style={{
        position: "relative",
        width: frame.width,
        height: frame.height,
        overflow: "hidden",
        ...style
      }}
    >
      {backgroundNode}
      {overlayNode}

      {showSafeArea ? (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x,
            top: regions.shell.y,
            width: regions.shell.width,
            height: regions.shell.height,
            border: "1px dashed rgba(255,255,255,0.12)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ) : null}

      {usesClassicScienceCardChrome ? (
        <>
          {!backgroundNode ? (
            <div
              style={{
                position: "absolute",
                left: regions.shell.x,
                top: regions.shell.y,
                width: regions.shell.width,
                height: regions.shell.height,
                boxSizing: "border-box",
                borderRadius: renderSnapshot.spec.shell.radius,
                background: renderSnapshot.spec.shell.background,
                border: renderSnapshot.spec.shell.border,
                overflow: "hidden"
              }}
            />
          ) : null}
          <div
              style={{
                position: "absolute",
                left: cardRect.x - scienceCardChromeOutset,
                top: cardRect.y - scienceCardChromeOutset,
                width: cardRect.width + scienceCardChromeOutset * 2,
                height: cardRect.height + scienceCardChromeOutset * 2,
                borderRadius: scienceCardOuterRadius,
                background: cardBorderColor,
                boxShadow: cardShadow,
              overflow: "hidden"
            }}
          >
            <div
              style={{
                position: "absolute",
                left: scienceCardChromeOutset,
                top: scienceCardChromeOutset,
                width: cardRect.width,
                height: cardRect.height,
                borderRadius: cardRadius,
                background: cardFill,
                overflow: "hidden"
              }}
            />
            <section
              style={{
                position: "absolute",
                left: scienceCardChromeOutset,
                top: scienceCardChromeOutset,
                width: cardRect.width,
                height: regions.top.height,
                boxSizing: "border-box",
                backgroundColor: palette.topSectionFill,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                textAlign: "center",
                borderTopLeftRadius: cardRadius,
                borderTopRightRadius: cardRadius,
                padding: `${topPaddingTop}px ${topPaddingX}px ${topPaddingBottom}px`,
                overflow: "hidden"
              }}
            >
              <p
                data-template-slot="top-text"
                style={{
                  margin: 0,
                  width: "100%",
                  color: palette.topTextColor,
                  fontFamily: topTextFontFamily,
                  fontWeight: topTextWeight,
                  letterSpacing: topTextLetterSpacing,
                  fontSize: computed.topFont,
                  lineHeight: computed.topLineHeight,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: topMaxLines,
                  overflow: "hidden"
                }}
              >
                {topText}
              </p>
            </section>

            <section
              style={{
                position: "absolute",
                left: scienceCardChromeOutset,
                top: scienceCardChromeOutset + (regions.media.y - cardRect.y),
                width: cardRect.width,
                height: regions.media.height,
                overflow: "hidden",
                backgroundColor: "#545454"
              }}
            >
              {mediaNode}
            </section>

            <section
              style={{
                position: "absolute",
                left: scienceCardChromeOutset,
                top: scienceCardChromeOutset + (regions.bottom.y - cardRect.y),
                width: cardRect.width,
                height: regions.bottom.height,
                boxSizing: "border-box",
                backgroundColor: palette.bottomSectionFill,
                display: "grid",
                gridTemplateRows: `${regions.author.height}px minmax(0, 1fr)`,
                borderBottomLeftRadius: cardRadius,
                borderBottomRightRadius: cardRadius,
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  padding: `${templateConfig.slot.bottomMetaPaddingY}px ${templateConfig.slot.bottomMetaPaddingX}px`,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: authorGap,
                  backgroundColor: palette.bottomSectionFill
                }}
              >
                {avatarNode ?? renderDefaultAvatar(resolvedTemplateId, templateConfig, authorName, authorAvatarSize)}
                <div style={{ minWidth: 0, display: "grid", gap: authorCopyGap }}>
                  <div style={{ display: "flex", alignItems: "center", gap: authorNameCheckGap }}>
                    <span
                      style={{
                        color: palette.authorNameColor,
                        fontWeight: authorNameWeight,
                        fontFamily: authorNameFontFamily,
                        letterSpacing: authorNameLetterSpacing,
                        fontSize: authorNameFontSize,
                        lineHeight: templateConfig.typography.authorName.lineHeight,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {authorName}
                    </span>
                    {renderVerificationBadge(templateConfig, palette, verificationBadgeNode, authorCheckSize)}
                  </div>
                  <span
                    style={{
                      color: palette.authorHandleColor,
                      fontFamily: authorHandleFontFamily,
                      fontSize: authorHandleFontSize,
                      lineHeight: templateConfig.typography.authorHandle.lineHeight,
                      letterSpacing: authorHandleLetterSpacing,
                      fontWeight: authorHandleWeight
                    }}
                  >
                    {authorHandle}
                  </span>
                </div>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  padding: `${getBottomTextPaddingTop(templateConfig)}px ${getBottomTextPaddingRight(templateConfig)}px ${getBottomTextPaddingBottom(
                    templateConfig
                  )}px ${getBottomTextPaddingLeft(templateConfig)}px`,
                  boxSizing: "border-box",
                  backgroundColor: palette.bottomSectionFill
                }}
              >
                <p
                  data-template-slot="bottom-text"
                  style={{
                    margin: 0,
                    color: palette.bottomTextColor,
                    fontFamily: bottomTextFontFamily,
                    fontWeight: bottomTextWeight,
                    fontStyle: bottomTextFontStyle,
                    letterSpacing: bottomTextLetterSpacing,
                    fontSize: computed.bottomFont,
                    lineHeight: computed.bottomLineHeight,
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: bottomMaxLines,
                    overflow: "hidden"
                  }}
                >
                  {bottomText}
                </p>
              </div>
            </section>
          </div>
        </>
      ) : (
        <>
          {scienceShellVisuals.shellBackdropNode}
          <div
              style={{
                position: "absolute",
                left: cardRect.x,
                top: cardRect.y,
                width: cardRect.width,
                height: cardRect.height,
                borderRadius: cardRadius,
                background: cardFill,
                boxShadow:
                !usesOverlayCardChrome && cardShadow
                  ? cardShadow
                  : "none",
              overflow: "hidden",
              boxSizing: "border-box",
              ...scienceShellVisuals.shellStyle
            }}
          />
          {!usesOverlayCardChrome ? (
            <div
              style={{
                position: "absolute",
                left: cardRect.x,
                top: cardRect.y,
                width: cardRect.width,
                height: cardRect.height,
                borderRadius: cardRadius,
                border: `${cardBorderWidth}px solid ${cardBorderColor}`,
                background: cardFill,
                boxShadow: cardShadow ?? "none",
                overflow: "hidden",
                boxSizing: "border-box",
                ...scienceShellVisuals.shellStyle
              }}
            />
          ) : null}
          {scienceShellVisuals.shellFrameNode}
          <section
            style={{
              position: "absolute",
              left: regions.top.x,
              top: regions.top.y,
              width: regions.top.width,
              height: regions.top.height,
              borderRadius: `${cardRadius}px ${cardRadius}px 0 0`,
              background: palette.topSectionFill,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              textAlign: "center",
              padding: `${getTopPaddingTop(templateConfig)}px ${templateConfig.slot.topPaddingX}px ${getTopPaddingBottom(
                templateConfig
              )}px`,
              boxSizing: "border-box",
              overflow: "hidden",
              ...scienceShellVisuals.topStyle
            }}
          >
            {scienceShellVisuals.topNode}
            <p
              data-template-slot="top-text"
              style={{
                margin: 0,
                width: "100%",
                color: palette.topTextColor,
                fontFamily: topTextFontFamily,
                fontWeight: topTextWeight,
                letterSpacing: topTextLetterSpacing,
                fontSize: computed.topFont,
                lineHeight: computed.topLineHeight,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: topMaxLines,
                overflow: "hidden"
              }}
            >
              {topHighlights.length > 0 ? renderHighlightedText(topText, topHighlights, highlightColors) : topText}
            </p>
          </section>

          <section
            style={{
              position: "absolute",
              left: regions.media.x,
              top: regions.media.y,
              width: regions.media.width,
              height: regions.media.height,
              overflow: "hidden",
              ...scienceShellVisuals.mediaStyle
            }}
          >
            {mediaNode}
            {scienceShellVisuals.mediaNode}
          </section>

          <section
            style={{
              position: "absolute",
              left: regions.bottom.x,
              top: regions.bottom.y,
              width: regions.bottom.width,
              height: regions.bottom.height,
              borderRadius: `0 0 ${cardRadius}px ${cardRadius}px`,
              background: palette.bottomSectionFill,
              display: "grid",
              gridTemplateRows: `${regions.author.height}px minmax(0, 1fr)`,
              overflow: "hidden",
              ...scienceShellVisuals.bottomStyle
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                padding: `${templateConfig.slot.bottomMetaPaddingY}px ${templateConfig.slot.bottomMetaPaddingX}px`,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: authorGap,
                background: palette.bottomSectionFill,
                position: "relative",
                ...scienceShellVisuals.authorStyle
              }}
            >
              {scienceShellVisuals.authorNode}
              {avatarNode ?? renderDefaultAvatar(resolvedTemplateId, templateConfig, authorName, authorAvatarSize)}
              <div style={{ minWidth: 0, display: "grid", gap: authorCopyGap }}>
                <div style={{ display: "flex", alignItems: "center", gap: authorNameCheckGap }}>
                  <span
                    style={{
                      color: palette.authorNameColor,
                      fontWeight: authorNameWeight,
                      fontFamily: authorNameFontFamily,
                      letterSpacing: authorNameLetterSpacing,
                      fontSize: authorNameFontSize,
                      lineHeight: templateConfig.typography.authorName.lineHeight,
                      whiteSpace: "nowrap"
                    }}
                  >
                    {authorName}
                  </span>
                  {renderVerificationBadge(templateConfig, palette, verificationBadgeNode, authorCheckSize)}
                </div>
                <span
                  style={{
                    color: palette.authorHandleColor,
                    fontFamily: authorHandleFontFamily,
                    fontSize: authorHandleFontSize,
                    lineHeight: templateConfig.typography.authorHandle.lineHeight,
                    letterSpacing: authorHandleLetterSpacing,
                    fontWeight: authorHandleWeight
                  }}
                >
                  {authorHandle}
                </span>
              </div>
            </div>
            <div
              style={{
                width: "100%",
                height: "100%",
                padding: `${getBottomTextPaddingTop(templateConfig)}px ${getBottomTextPaddingRight(templateConfig)}px ${getBottomTextPaddingBottom(
                  templateConfig
                )}px ${getBottomTextPaddingLeft(templateConfig)}px`,
                boxSizing: "border-box",
                background: palette.bottomSectionFill,
                position: "relative",
                ...scienceShellVisuals.bottomTextWrapStyle
              }}
            >
              {scienceShellVisuals.bottomTextNode}
              <p
                data-template-slot="bottom-text"
                style={{
                  margin: 0,
                  color: palette.bottomTextColor,
                  fontFamily: bottomTextFontFamily,
                  fontWeight: bottomTextWeight,
                  fontStyle: bottomTextFontStyle,
                  letterSpacing: bottomTextLetterSpacing,
                  fontSize: computed.bottomFont,
                  lineHeight: computed.bottomLineHeight,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: bottomMaxLines,
                  overflow: "hidden",
                  position: "relative",
                  ...scienceShellVisuals.bottomTextStyle
                }}
              >
                {bottomHighlights.length > 0
                  ? renderHighlightedText(bottomText, bottomHighlights, highlightColors)
                  : bottomText}
              </p>
            </div>
          </section>
          {usesOverlayCardChrome ? (
            <>
              <div
                style={{
                  position: "absolute",
                  left: cardRect.x,
                  top: cardRect.y,
                  width: cardRect.width,
                  height: cardRect.height,
                  borderRadius: cardRadius,
                  boxSizing: "border-box",
                  boxShadow: overlayCardInsetShadow ?? "none",
                  pointerEvents: "none"
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: cardRect.x,
                  top: cardRect.y,
                  width: cardRect.width,
                  height: cardRect.height,
                  borderRadius: cardRadius,
                  border: `${cardBorderWidth}px solid ${cardBorderColor}`,
                  boxSizing: "border-box",
                  boxShadow: cardShadow ?? "none",
                  pointerEvents: "none"
                }}
              />
            </>
          ) : null}
        </>
      )}

      {showGuides ? <TemplateSceneGuides guides={getSceneGuides(regions)} compareScope={compareScope} /> : null}
    </div>
  );
}
