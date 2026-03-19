import type { JSX } from "react";
import Script from "next/script";
import { Stage3TemplateRenderer } from "../../../lib/stage3-template-renderer";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID,
  SCIENCE_CARD_V6_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  getTemplateById
} from "../../../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../../../lib/stage3-template-core";
import {
  resolveTemplateAvatarBorderColorNode,
  resolveTemplateBackdropNode
} from "../../../lib/stage3-template-runtime";
import { clampStage3TextScaleUi } from "../../../lib/stage3-text-fit";
import {
  Stage3TemplateViewport,
  getTemplatePreviewViewportMetrics
} from "../../../lib/stage3-template-viewport";

const DEFAULT_TOP_TEXT =
  "Between the tight close-up and that wider shot with the round mic, he doesn’t look fired up at all. That’s what makes it land harder. He’s dressed like a gentleman and talking like a foreman.";
const DEFAULT_BOTTOM_TEXT =
  "\"Now it’s awake.\" That little rooster tail out back tells you everything, the rear wheels finally clocked in and quit letting the front suffer alone.";
const SKYFRAME_TOP_TEXT =
  "This sailor is performing a mandatory abandon ship drill from the bow of hull to prove he can handle the height and keep his form tight before the unit heads back to sea.";
const SKYFRAME_BOTTOM_TEXT =
  "You have to cover your nose and cross your arms or that water will hit you like a brick. It is a confidence builder that every new recruit has to pass to be ready.";

type ScienceCardDesignPageProps = {
  searchParams?: Promise<{
    template?: string;
    top?: string;
    bottom?: string;
    scale?: string;
    topScale?: string;
    bottomScale?: string;
    name?: string;
    handle?: string;
    media?: string;
    background?: string;
    avatar?: string;
    highlights?: string;
    badgeColor?: string;
    badgeTextColor?: string;
    badgeGlyph?: string;
    badgeAsset?: string;
    export?: string;
  }>;
};

const SUPPORTED_TEMPLATE_IDS = new Set([
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID,
  SCIENCE_CARD_V6_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID
]);

function normalizeScale(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.34;
  }
  return Math.max(0.2, Math.min(0.75, parsed));
}

function normalizeFontScale(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return clampStage3TextScaleUi(parsed);
}

function normalizeExportScale(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(0.25, Math.min(1, parsed));
}

function resolveTemplateId(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) {
    return SCIENCE_CARD_TEMPLATE_ID;
  }
  return SUPPORTED_TEMPLATE_IDS.has(candidate) ? candidate : SCIENCE_CARD_TEMPLATE_ID;
}

function resolveDefaultTexts(templateId: string): { topText: string; bottomText: string } {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID) {
    return {
      topText: SKYFRAME_TOP_TEXT,
      bottomText: SKYFRAME_BOTTOM_TEXT
    };
  }
  return {
    topText: DEFAULT_TOP_TEXT,
    bottomText: DEFAULT_BOTTOM_TEXT
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate ? candidate : undefined;
}

function parseHighlightPhrases(value: string | undefined): string[] | undefined {
  const candidate = normalizeOptionalText(value);
  if (!candidate) {
    return undefined;
  }
  const parts = candidate
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function renderRuntimeImage(src: string, alt: string): JSX.Element {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden"
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block"
        }}
      />
    </div>
  );
}

function renderRuntimeBadge({
  assetUrl,
  backgroundColor,
  textColor,
  glyph,
  size
}: {
  assetUrl?: string;
  backgroundColor?: string;
  textColor?: string;
  glyph?: string;
  size: number;
}): JSX.Element | undefined {
  if (assetUrl) {
    return (
      <img
        src={assetUrl}
        alt=""
        style={{
          width: size,
          height: size,
          display: "block",
          flex: "0 0 auto"
        }}
      />
    );
  }

  if (!backgroundColor) {
    return undefined;
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: backgroundColor,
        color: textColor ?? "#ffffff",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        flex: "0 0 auto"
      }}
    >
      {glyph ?? "✓"}
    </span>
  );
}

function renderMediaPlaceholder(templateId: string) {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID) {
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "linear-gradient(180deg, #9dc1ef 0%, #a9c8f0 56%, #9ebfe8 100%)"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -24,
            top: 0,
            width: 432,
            height: "100%",
            background: "linear-gradient(180deg, #f7f7f4 0%, #ecece8 100%)",
            clipPath: "polygon(0 0, 80% 0, 56% 100%, 0 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 278,
            top: 0,
            width: 6,
            height: "100%",
            background: "rgba(117, 130, 145, 0.26)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 80,
            background: "linear-gradient(180deg, rgba(122, 158, 201, 0), rgba(122, 158, 201, 0.16))"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 86,
            top: 230,
            color: "#111319",
            fontFamily: '"Arial Black","Arial",sans-serif',
            fontSize: 118,
            letterSpacing: "-0.05em",
            transform: "rotate(-1deg)"
          }}
        >
          ISF
        </div>
        <div
          style={{
            position: "absolute",
            left: 278,
            top: 334,
            width: 6,
            height: 214,
            background:
              "repeating-linear-gradient(180deg, #4c5561 0 14px, rgba(76,85,97,0) 14px 26px)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 156,
            top: 0,
            width: 196,
            height: 18,
            background: "#5e6670"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 350,
            top: 0,
            width: 228,
            height: 10,
            background: "#d5d7d8"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 558,
            top: 14,
            width: 174,
            height: 4,
            background: "#dfe2e4"
          }}
        />
        {[
          [198, 0],
          [218, 4],
          [240, 3],
          [264, 5],
          [288, 4],
          [314, 2],
          [340, 5],
          [364, 4],
          [388, 3]
        ].map(([left, top], index) => (
          <div
            key={`${left}-${top}-${index}`}
            style={{
              position: "absolute",
              left,
              top: 6 + top,
              width: 10,
              height: 18,
              borderRadius: 999,
              background: "#20242d"
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 352,
            top: 56,
            width: 272,
            height: 4,
            background: "#e4e8eb",
            transform: "rotate(-2deg)",
            transformOrigin: "left center"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 621,
            top: 41,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#e5b38f"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 615,
            top: 55,
            width: 28,
            height: 72,
            borderRadius: 11,
            background: "#223249"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 612,
            top: 120,
            width: 10,
            height: 60,
            background: "#324968",
            transform: "rotate(4deg)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 632,
            top: 120,
            width: 10,
            height: 60,
            background: "#324968",
            transform: "rotate(-4deg)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 18,
            background: "#8eb0da"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 46,
            top: 404,
            width: 90,
            height: 28,
            borderRadius: 999,
            background: "rgba(163, 163, 163, 0.15)",
            transform: "rotate(-12deg)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 46,
            top: 490,
            width: 112,
            height: 12,
            borderRadius: 999,
            background: "rgba(90, 103, 117, 0.12)",
            transform: "rotate(-6deg)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 48,
            top: 308,
            width: 70,
            height: 18,
            borderRadius: 999,
            background: "rgba(145, 150, 154, 0.12)",
            transform: "rotate(-7deg)"
          }}
        />
      </div>
    );
  }

  return <div style={{ width: "100%", height: "100%", background: "#6a6a6a" }} />;
}

export default async function ScienceCardDesignPage({ searchParams }: ScienceCardDesignPageProps) {
  const params = (await searchParams) ?? {};
  const templateId = resolveTemplateId(params.template);
  const exportMode = params.export === "1";
  const scale = exportMode ? normalizeExportScale(params.scale) : normalizeScale(params.scale);
  const topScale = normalizeFontScale(params.topScale);
  const bottomScale = normalizeFontScale(params.bottomScale);
  const defaultTexts = resolveDefaultTexts(templateId);
  const topText = params.top?.trim() || defaultTexts.topText;
  const bottomText = params.bottom?.trim() || defaultTexts.bottomText;
  const channelName = normalizeOptionalText(params.name);
  const channelHandle = normalizeOptionalText(params.handle);
  const mediaUrl = normalizeOptionalText(params.media);
  const backgroundUrl = normalizeOptionalText(params.background);
  const avatarUrl = normalizeOptionalText(params.avatar);
  const highlightPhrases = parseHighlightPhrases(params.highlights);
  const badgeColor = normalizeOptionalText(params.badgeColor);
  const badgeTextColor = normalizeOptionalText(params.badgeTextColor);
  const badgeGlyph = normalizeOptionalText(params.badgeGlyph);
  const badgeAssetUrl = normalizeOptionalText(params.badgeAsset);
  const exportViewportTemplateId =
    exportMode && templateId === SCIENCE_CARD_V7_TEMPLATE_ID ? templateId : SCIENCE_CARD_TEMPLATE_ID;
  const exportViewportMode = exportMode ? "template-shell" : "full-frame";
  const viewport = exportMode
    ? getTemplatePreviewViewportMetrics(exportViewportTemplateId, exportViewportMode)
    : getTemplatePreviewViewportMetrics(templateId, "full-frame");
  const templateConfig = getTemplateById(templateId);
  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId,
    content: {
      channelName: channelName ?? templateConfig.author.name,
      channelHandle: channelHandle ?? templateConfig.author.handle,
      topText,
      bottomText,
      topHighlightPhrases: highlightPhrases,
      topFontScale: topScale,
      bottomFontScale: bottomScale,
      previewScale: scale,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  const avatarSize = renderSnapshot.layout.avatar.width;
  const badgeSize = renderSnapshot.spec.typography?.badge?.size ?? templateConfig.author.checkSize;
  const verificationBadgeNode = renderRuntimeBadge({
    assetUrl: badgeAssetUrl,
    backgroundColor: badgeColor,
    textColor: badgeTextColor,
    glyph: badgeGlyph,
    size: badgeSize
  });
  const exportCanvasWidth = exportMode ? Math.round(viewport.width * scale) : null;
  const exportCanvasHeight = exportMode ? Math.round(viewport.height * scale) : null;

  return (
    <>
      {exportMode ? (
        <>
          <Script
            src="https://mcp.figma.com/mcp/html-to-design/capture.js"
            strategy="beforeInteractive"
          />
          <style>{`nextjs-portal { display: none !important; }`}</style>
        </>
      ) : null}
      {exportMode && exportCanvasWidth && exportCanvasHeight ? (
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                width: ${exportCanvasWidth}px !important;
                min-width: ${exportCanvasWidth}px !important;
                max-width: ${exportCanvasWidth}px !important;
                height: ${exportCanvasHeight}px !important;
                min-height: ${exportCanvasHeight}px !important;
                max-height: ${exportCanvasHeight}px !important;
                overflow: hidden !important;
                background: transparent !important;
              }

              body {
                display: block !important;
              }
            `
          }}
        />
      ) : null}
      <main
        style={{
          minHeight: exportMode ? exportCanvasHeight ?? viewport.height * scale : "100vh",
          height: exportMode ? exportCanvasHeight ?? viewport.height * scale : undefined,
          width: exportMode ? exportCanvasWidth ?? viewport.width * scale : "100%",
          display: exportMode ? "block" : "grid",
          placeItems: exportMode ? undefined : "center",
          padding: exportMode ? 0 : 32,
          background: exportMode ? "transparent" : "#d8d8d8",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "relative",
            width: exportMode ? exportCanvasWidth ?? viewport.width * scale : viewport.width * scale,
            height: exportMode ? exportCanvasHeight ?? viewport.height * scale : viewport.height * scale,
            overflow: "hidden"
          }}
        >
          <Stage3TemplateViewport
            templateId={exportMode ? exportViewportTemplateId : templateId}
            modeOverride={exportMode ? exportViewportMode : "full-frame"}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left"
            }}
          >
            <Stage3TemplateRenderer
              templateId={templateId}
              content={renderSnapshot.content}
              snapshot={renderSnapshot}
              runtime={{
                backgroundNode: resolveTemplateBackdropNode(templateId, backgroundUrl ?? null),
                mediaNode: mediaUrl ? renderRuntimeImage(mediaUrl, "Media") : renderMediaPlaceholder(templateId),
                avatarNode: avatarUrl ? (
                  <div
                    style={{
                      width: avatarSize,
                      height: avatarSize,
                      flex: "0 0 auto"
                    }}
                  >
                    <img
                      src={avatarUrl}
                      alt=""
                      style={{
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: 999,
                        border: `${templateConfig.author.avatarBorder}px solid ${resolveTemplateAvatarBorderColorNode(templateId)}`,
                        background:
                          templateId === SCIENCE_CARD_V2_TEMPLATE_ID
                            ? "radial-gradient(circle at 30% 30%, rgba(163, 123, 72, 0.92), rgba(56, 41, 32, 0.98) 68%, rgba(16, 18, 22, 1) 100%)"
                            : "#10131a",
                        objectFit: "cover",
                        display: "block",
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                ) : undefined,
                verificationBadgeNode
              }}
            />
          </Stage3TemplateViewport>
        </div>
      </main>
    </>
  );
}
