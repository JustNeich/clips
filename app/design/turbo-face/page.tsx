import { TURBO_FACE, TURBO_FACE_TEMPLATE_ID, getTemplateComputed } from "../../../lib/stage3-template";

const TOP_TEXT =
  "This is what happens when you have more money for toys than you have actual snow to plow. Those tracks are massive enough to crush a minivan, yet it's just creeping along in reverse.";
const BOTTOM_TEXT =
  "\"Tell me your coffee is overpriced without telling me.\" It's a hell of a snow machine, but it'll take three days and ten gallons of fuel just to turn around.";

export default function TurboFaceDesignPage() {
  const computed = getTemplateComputed(TURBO_FACE_TEMPLATE_ID, TOP_TEXT, BOTTOM_TEXT, {
    topFontScale: 1.1,
    bottomFontScale: 1
  });
  const scale = 0.34;
  const shellHeight =
    TURBO_FACE.frame.height -
    TURBO_FACE.top.y -
    TURBO_FACE.bottom.bottom;

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
          width: TURBO_FACE.frame.width * scale,
          height: TURBO_FACE.frame.height * scale,
          borderRadius: 32,
          overflow: "hidden",
          boxShadow: "0 30px 70px rgba(0,0,0,0.45)"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 18%), linear-gradient(180deg, rgba(215,226,244,0.18) 0%, rgba(94,125,173,0.22) 28%, rgba(15,27,46,0.24) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            filter: "blur(12px)",
            transform: "scale(1.04)",
            background:
              "radial-gradient(circle at 72% 12%, rgba(255,255,255,0.85), rgba(255,255,255,0) 16%), radial-gradient(circle at 20% 18%, rgba(255,255,255,0.42), rgba(255,255,255,0) 18%), linear-gradient(180deg, rgba(22,81,166,0.95) 0%, rgba(77,114,172,0.7) 34%, rgba(48,73,111,0.72) 58%, rgba(28,44,69,0.82) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "34%",
            background:
              "linear-gradient(180deg, rgba(194,210,230,0) 0%, rgba(189,207,235,0.24) 26%, rgba(195,208,224,0.82) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "7%",
            right: "7%",
            bottom: "12%",
            height: "22%",
            borderRadius: 26,
            transform: "perspective(800px) rotateX(72deg)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0.02)), linear-gradient(90deg, rgba(76,94,125,0.55), rgba(224,232,246,0.2) 20%, rgba(72,92,124,0.5) 40%, rgba(226,234,246,0.22) 58%, rgba(66,84,116,0.48) 76%, rgba(218,228,243,0.14) 100%)",
            boxShadow: "0 24px 60px rgba(9,16,30,0.35)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "21%",
            top: "42%",
            width: "58%",
            height: "16%",
            borderRadius: 28,
            transform: "rotate(-12deg)",
            background:
              "linear-gradient(180deg, rgba(245,247,252,0.96), rgba(162,177,203,0.94) 65%, rgba(113,127,154,0.98) 100%)",
            boxShadow: "0 20px 40px rgba(4,10,20,0.25)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: TURBO_FACE.frame.width,
            height: TURBO_FACE.frame.height,
            transformOrigin: "top left",
            transform: `scale(${scale})`
          }}
        >
          <div
            style={{
              position: "absolute",
              left: TURBO_FACE.top.x,
              top: TURBO_FACE.top.y,
              width: TURBO_FACE.top.width,
              height: shellHeight,
              borderRadius: 34,
              background: "rgba(252,252,249,0.035)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow:
                "0 30px 80px rgba(4,10,20,0.36), 0 12px 28px rgba(4,10,20,0.18), inset 0 1px 0 rgba(255,255,255,0.12)"
            }}
          />
          <section
            style={{
              position: "absolute",
              left: TURBO_FACE.top.x,
              top: TURBO_FACE.top.y,
              width: TURBO_FACE.top.width,
              height: computed.topBlockHeight,
              background: "rgba(255,255,255,0.975)",
              borderRadius: `${TURBO_FACE.top.radius}px ${TURBO_FACE.top.radius}px 0 0`,
              borderBottom: "1px solid rgba(6,13,22,0.08)",
              padding: `${TURBO_FACE.top.paddingY}px ${TURBO_FACE.top.paddingX}px`,
              boxSizing: "border-box",
              display: "grid",
              placeItems: "center",
              textAlign: "center"
            }}
          >
            <p
              style={{
                margin: 0,
                color: "#11161f",
                fontFamily: '"Trebuchet MS","Arial",sans-serif',
                fontWeight: 900,
                fontSize: computed.topFont,
                lineHeight: computed.topLineHeight,
                letterSpacing: "-0.03em"
              }}
            >
              {computed.top}
            </p>
          </section>

          <section
            style={{
              position: "absolute",
              left: computed.videoX,
              top: computed.videoY,
              width: computed.videoWidth,
              height: computed.videoHeight,
              overflow: "hidden",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(7,12,20,0.12)",
              background:
                "radial-gradient(circle at 78% 14%, rgba(255,255,255,0.8), rgba(255,255,255,0) 16%), linear-gradient(180deg, rgba(74,104,160,0.82) 0%, rgba(71,86,118,0.66) 35%, rgba(64,72,88,0.66) 100%)"
            }}
          />

          <section
            style={{
              position: "absolute",
              left: TURBO_FACE.bottom.x,
              top: TURBO_FACE.frame.height - TURBO_FACE.bottom.bottom - computed.bottomBlockHeight,
              width: TURBO_FACE.bottom.width,
              height: computed.bottomBlockHeight,
              borderRadius: `0 0 ${TURBO_FACE.bottom.radius}px ${TURBO_FACE.bottom.radius}px`,
              backgroundColor: "rgba(250,249,246,0.985)",
              borderTop: "1px solid rgba(6,13,22,0.09)",
              display: "grid",
              gridTemplateRows: `${TURBO_FACE.bottom.metaHeight + TURBO_FACE.bottom.paddingY * 2}px minmax(0, 1fr)`,
              overflow: "hidden"
            }}
          >
            <div
              style={{
                padding: `${TURBO_FACE.bottom.paddingY}px ${TURBO_FACE.bottom.paddingX}px`,
                display: "flex",
                alignItems: "center",
                gap: 14
              }}
            >
              <div
                style={{
                  width: TURBO_FACE.author.avatarSize,
                  height: TURBO_FACE.author.avatarSize,
                  borderRadius: 999,
                  border: "2px solid rgba(8,12,18,0.12)",
                  background: "radial-gradient(circle at 30% 30%, #f6db98, #2f86bb 70%, #20506f)"
                }}
              />
              <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      color: "#11161f",
                      fontWeight: 700,
                      fontFamily: '"Trebuchet MS","Arial",sans-serif',
                      fontSize: TURBO_FACE.typography.authorName.font,
                      lineHeight: TURBO_FACE.typography.authorName.lineHeight
                    }}
                  >
                    Stone Face Turbo
                  </span>
                  <span
                    style={{
                      width: TURBO_FACE.author.checkSize,
                      height: TURBO_FACE.author.checkSize,
                      borderRadius: 999,
                      background: "#72b6e6",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 800,
                      fontSize: Math.round(TURBO_FACE.author.checkSize * 0.56)
                    }}
                  >
                    ✓
                  </span>
                </div>
                <span
                  style={{
                    color: "#8b919a",
                    fontFamily: '"Trebuchet MS","Arial",sans-serif',
                    fontSize: TURBO_FACE.typography.authorHandle.font,
                    lineHeight: TURBO_FACE.typography.authorHandle.lineHeight
                  }}
                >
                  @StoneFaceTurbo
                </span>
              </div>
            </div>
            <div
              style={{
                padding: `8px ${TURBO_FACE.bottom.paddingX}px ${TURBO_FACE.bottom.paddingY}px ${TURBO_FACE.bottom.paddingX}px`
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#181b22",
                  fontFamily: '"Trebuchet MS","Arial",sans-serif',
                  fontWeight: 500,
                  fontSize: computed.bottomFont,
                  lineHeight: computed.bottomLineHeight,
                  letterSpacing: "-0.015em"
                }}
              >
                {computed.bottom}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
