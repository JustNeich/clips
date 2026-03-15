import Script from "next/script";
import { Stage3TemplateRenderer } from "../../../lib/stage3-template-renderer";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID,
  SCIENCE_CARD_V6_TEMPLATE_ID,
  getTemplateById
} from "../../../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../../../lib/stage3-template-core";
import { resolveTemplateBackdropNode } from "../../../lib/stage3-template-runtime";
import {
  Stage3TemplateViewport,
  getTemplatePreviewViewportMetrics
} from "../../../lib/stage3-template-viewport";

const DEFAULT_TOP_TEXT =
  "Between the tight close-up and that wider shot with the round mic, he doesn’t look fired up at all. That’s what makes it land harder. He’s dressed like a gentleman and talking like a foreman.";
const DEFAULT_BOTTOM_TEXT =
  "\"Now it’s awake.\" That little rooster tail out back tells you everything, the rear wheels finally clocked in and quit letting the front suffer alone.";

type ScienceCardDesignPageProps = {
  searchParams?: Promise<{
    template?: string;
    top?: string;
    bottom?: string;
    scale?: string;
    topScale?: string;
    bottomScale?: string;
    export?: string;
  }>;
};

const SUPPORTED_TEMPLATE_IDS = new Set([
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID,
  SCIENCE_CARD_V6_TEMPLATE_ID
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
  return Math.max(0.7, Math.min(1.9, parsed));
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

export default async function ScienceCardDesignPage({ searchParams }: ScienceCardDesignPageProps) {
  const params = (await searchParams) ?? {};
  const templateId = resolveTemplateId(params.template);
  const exportMode = params.export === "1";
  const scale = exportMode ? normalizeExportScale(params.scale) : normalizeScale(params.scale);
  const topScale = normalizeFontScale(params.topScale);
  const bottomScale = normalizeFontScale(params.bottomScale);
  const topText = params.top?.trim() || DEFAULT_TOP_TEXT;
  const bottomText = params.bottom?.trim() || DEFAULT_BOTTOM_TEXT;
  const viewport = exportMode
    ? getTemplatePreviewViewportMetrics(SCIENCE_CARD_TEMPLATE_ID, "template-shell")
    : getTemplatePreviewViewportMetrics(templateId, "full-frame");
  const templateConfig = getTemplateById(templateId);
  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId,
    content: {
      channelName: templateConfig.author.name,
      channelHandle: templateConfig.author.handle,
      topText,
      bottomText,
      topFontScale: topScale,
      bottomFontScale: bottomScale,
      previewScale: scale,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  return (
    <>
      {exportMode ? (
        <Script
          src="https://mcp.figma.com/mcp/html-to-design/capture.js"
          strategy="beforeInteractive"
        />
      ) : null}
      <main
        style={{
          minHeight: exportMode ? viewport.height * scale : "100vh",
          width: exportMode ? viewport.width * scale : "100%",
          display: "grid",
          placeItems: "center",
          padding: exportMode ? 0 : 32,
          background: exportMode ? "transparent" : "#d8d8d8",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "relative",
            width: viewport.width * scale,
            height: viewport.height * scale,
            overflow: "hidden"
          }}
        >
          <Stage3TemplateViewport
            templateId={exportMode ? SCIENCE_CARD_TEMPLATE_ID : templateId}
            modeOverride={exportMode ? "template-shell" : "full-frame"}
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
                backgroundNode: resolveTemplateBackdropNode(templateId),
                mediaNode: <div style={{ width: "100%", height: "100%", background: "#6a6a6a" }} />
              }}
            />
          </Stage3TemplateViewport>
        </div>
      </main>
    </>
  );
}
