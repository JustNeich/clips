import { Stage3TemplateRenderer } from "../../../lib/stage3-template-renderer";
import { TURBO_FACE_TEMPLATE_ID } from "../../../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../../../lib/stage3-template-core";
import { resolveTemplateBackdropNode } from "../../../lib/stage3-template-runtime";

const DEFAULT_TOP_TEXT =
  "This is what happens when you have more money for toys than you have actual snow to plow. Those tracks are massive enough to crush a minivan, yet it's just creeping along in reverse.";
const DEFAULT_BOTTOM_TEXT =
  "\"Tell me your coffee is overpriced without telling me.\" It's a hell of a snow machine, but it'll take three days and ten gallons of fuel just to turn around.";

type TurboFaceDesignPageProps = {
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

export default async function TurboFaceDesignPage({ searchParams }: TurboFaceDesignPageProps) {
  const params = (await searchParams) ?? {};
  const scale = normalizeScale(params.scale);
  const topScale = normalizeFontScale(params.topScale);
  const bottomScale = normalizeFontScale(params.bottomScale);
  const topText = params.top?.trim() || DEFAULT_TOP_TEXT;
  const bottomText = params.bottom?.trim() || DEFAULT_BOTTOM_TEXT;
  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId: TURBO_FACE_TEMPLATE_ID,
    content: {
      channelName: "Stone Face Turbo",
      channelHandle: "@StoneFaceTurbo",
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
        background:
          "radial-gradient(circle at 50% 8%, rgba(188,210,245,0.38), transparent 24%), linear-gradient(180deg, #0d4da0 0%, #114890 25%, #17386a 50%, #0a172c 100%)"
      }}
    >
      <div
        style={{
          position: "relative",
          width: 1080 * scale,
          height: 1920 * scale,
          borderRadius: 32,
          overflow: "hidden",
          boxShadow: "0 30px 70px rgba(0,0,0,0.45)"
        }}
      >
        <Stage3TemplateRenderer
          templateId={TURBO_FACE_TEMPLATE_ID}
          content={renderSnapshot.content}
          snapshot={renderSnapshot}
          runtime={{
            backgroundNode: resolveTemplateBackdropNode(TURBO_FACE_TEMPLATE_ID),
            mediaNode: (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background:
                    "radial-gradient(circle at 78% 14%, rgba(255,255,255,0.8), rgba(255,255,255,0) 16%), linear-gradient(180deg, rgba(74,104,160,0.82) 0%, rgba(71,86,118,0.66) 35%, rgba(64,72,88,0.66) 100%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(7,12,20,0.12)"
                }}
              />
            ),
            style: {
              transform: `scale(${scale})`,
              transformOrigin: "top left"
            }
          }}
        />
      </div>
    </main>
  );
}
