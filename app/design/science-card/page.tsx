import { Stage3TemplateRenderer } from "../../../lib/stage3-template-renderer";
import { SCIENCE_CARD_TEMPLATE_ID } from "../../../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../../../lib/stage3-template-core";
import {
  Stage3TemplateViewport,
  getTemplatePreviewViewportMetrics
} from "../../../lib/stage3-template-viewport";

const DEFAULT_TOP_TEXT =
  "Between the tight close-up and that wider shot with the round mic, he doesn’t look fired up at all. That’s what makes it land harder. He’s dressed like a gentleman and talking like a foreman.";
const DEFAULT_BOTTOM_TEXT =
  "\"Now it’s awake.\" That little rooster tail out back tells you everything, the rear wheels finally clocked in and quit letting the front suffer alone.";

type ScienceCardDesignPageProps = {
  searchParams?: Promise<{ top?: string; bottom?: string; scale?: string; topScale?: string; bottomScale?: string }>;
};

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

export default async function ScienceCardDesignPage({ searchParams }: ScienceCardDesignPageProps) {
  const params = (await searchParams) ?? {};
  const scale = normalizeScale(params.scale);
  const topScale = normalizeFontScale(params.topScale);
  const bottomScale = normalizeFontScale(params.bottomScale);
  const topText = params.top?.trim() || DEFAULT_TOP_TEXT;
  const bottomText = params.bottom?.trim() || DEFAULT_BOTTOM_TEXT;
  const viewport = getTemplatePreviewViewportMetrics(SCIENCE_CARD_TEMPLATE_ID, "full-frame");
  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId: SCIENCE_CARD_TEMPLATE_ID,
    content: {
      channelName: "Science Snack",
      channelHandle: "@Science_Snack_1",
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
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 32,
        background: "#d8d8d8"
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
          templateId={SCIENCE_CARD_TEMPLATE_ID}
          modeOverride="full-frame"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left"
          }}
        >
          <Stage3TemplateRenderer
            templateId={SCIENCE_CARD_TEMPLATE_ID}
            content={renderSnapshot.content}
            snapshot={renderSnapshot}
            runtime={{
              mediaNode: <div style={{ width: "100%", height: "100%", background: "#6a6a6a" }} />
            }}
          />
        </Stage3TemplateViewport>
      </div>
    </main>
  );
}
