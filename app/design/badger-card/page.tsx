import Script from "next/script";

type BadgerCardPageProps = {
  searchParams?: Promise<{
    export?: string;
    scale?: string;
    topScale?: string;
    bottomScale?: string;
    mediaX?: string;
    mediaY?: string;
  }>;
};

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;
const CARD_X = 62;
const CARD_Y = 165;
const CARD_WIDTH = 954;
const CARD_HEIGHT = 1590;
const BORDER_WIDTH = 8;
const TOP_HEIGHT = 420;
const BOTTOM_HEIGHT = 240;
const MEDIA_HEIGHT = CARD_HEIGHT - TOP_HEIGHT - BOTTOM_HEIGHT;
const BOTTOM_META_HEIGHT = 92;
const GREEN = "#4b8f61";
const DARK = "#23282f";
const HANDLE = "#9ca2aa";
const BADGE = "#f0c13f";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numberParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function textShadow(opacity = 0.85): string {
  return `0 2px 0 rgba(0,0,0,${opacity}), 0 0 3px rgba(0,0,0,${opacity * 0.72})`;
}

function Highlight({ children }: { children: string }) {
  return <span style={{ color: GREEN }}>{children}</span>;
}

export default async function BadgerCardPage({ searchParams }: BadgerCardPageProps) {
  const params = (await searchParams) ?? {};
  const exportMode = params.export === "1";
  const scale = numberParam(params.scale, 1, 0.25, 1);
  const topScale = numberParam(params.topScale, 1, 0.8, 1.35);
  const bottomScale = numberParam(params.bottomScale, 1, 0.8, 1.35);
  const mediaX = numberParam(params.mediaX, 34, 0, 100);
  const mediaY = numberParam(params.mediaY, 52, 0, 100);
  const exportWidth = Math.round(FRAME_WIDTH * scale);
  const exportHeight = Math.round(FRAME_HEIGHT * scale);

  const topFont = Math.round(54 * topScale);
  const bottomFont = Math.round(22 * bottomScale);

  return (
    <>
      {exportMode ? (
        <>
          <Script
            src="https://mcp.figma.com/mcp/html-to-design/capture.js"
            strategy="beforeInteractive"
          />
          <style>{`nextjs-portal { display: none !important; }`}</style>
          <style
            dangerouslySetInnerHTML={{
              __html: `
                html, body {
                  width: ${exportWidth}px !important;
                  min-width: ${exportWidth}px !important;
                  max-width: ${exportWidth}px !important;
                  height: ${exportHeight}px !important;
                  min-height: ${exportHeight}px !important;
                  max-height: ${exportHeight}px !important;
                  overflow: hidden !important;
                  margin: 0 !important;
                  background: transparent !important;
                }
              `
            }}
          />
        </>
      ) : null}
      <main
        style={{
          width: exportMode ? exportWidth : "100%",
          minHeight: exportMode ? exportHeight : "100vh",
          display: exportMode ? "block" : "grid",
          placeItems: exportMode ? undefined : "center",
          padding: exportMode ? 0 : 32,
          overflow: "hidden",
          background: exportMode ? "transparent" : "#10151b"
        }}
      >
        <div
          data-figma-root=""
          style={{
            position: "relative",
            width: FRAME_WIDTH * scale,
            height: FRAME_HEIGHT * scale,
            overflow: "hidden"
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              overflow: "hidden"
            }}
          >
            <img
              src="/stage3-template-backdrops/science-card-v2.png"
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
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, rgba(4, 8, 14, 0.14), rgba(4, 8, 14, 0.1))"
              }}
            />

            <div
              style={{
                position: "absolute",
                left: CARD_X,
                top: CARD_Y,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                boxSizing: "border-box",
                border: `${BORDER_WIDTH}px solid ${GREEN}`,
                background: DARK,
                overflow: "hidden"
              }}
            >
              <section
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: TOP_HEIGHT,
                  background: DARK,
                  padding: "34px 38px 26px",
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <p
                  style={{
                    margin: 0,
                    color: "#f4f4f4",
                    fontFamily: '"Arial Black","Arial",sans-serif',
                    fontSize: topFont,
                    lineHeight: 0.985,
                    letterSpacing: "-0.04em",
                    textAlign: "center",
                    textShadow: textShadow()
                  }}
                >
                  Watch how hesitant <Highlight>the pride</Highlight> is to actually strike. A honey badger is pure{" "}
                  <Highlight>muscle</Highlight>, capable of turning inside its own loose skin to bite back.{" "}
                  <Highlight>For the lions</Highlight>, the pain-to-food ratio simply doesn&apos;t <Highlight>add up</Highlight>.
                </p>
              </section>

              <section
                style={{
                  position: "absolute",
                  left: 0,
                  top: TOP_HEIGHT,
                  width: "100%",
                  height: MEDIA_HEIGHT,
                  overflow: "hidden",
                  background: "#73835d"
                }}
              >
                <img
                  src="/badger-card/lions-badger-crop.png"
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: `${mediaX}% ${mediaY}%`,
                    display: "block",
                    transform: "scale(1.06)"
                  }}
                />
              </section>

              <section
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  width: "100%",
                  height: BOTTOM_HEIGHT,
                  background: DARK,
                  padding: "12px 22px 14px",
                  boxSizing: "border-box"
                }}
              >
                <div
                  style={{
                    height: BOTTOM_META_HEIGHT,
                    display: "flex",
                    alignItems: "center",
                    gap: 14
                  }}
                >
                  <div
                    style={{
                      width: 62,
                      height: 62,
                      borderRadius: 999,
                      overflow: "hidden",
                      flex: "0 0 auto",
                      background:
                        "radial-gradient(circle at 30% 30%, rgba(163, 123, 72, 0.92), rgba(56, 41, 32, 0.98) 68%, rgba(16, 18, 22, 1) 100%)"
                    }}
                  >
                    <img
                      src="/badger-card/avatar-head.png"
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block"
                      }}
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10
                      }}
                    >
                      <span
                        style={{
                          color: "#f4f2ea",
                          fontFamily: '"Arial Black","Arial",sans-serif',
                          fontSize: 28,
                          lineHeight: 1,
                          letterSpacing: "-0.03em",
                          textShadow: textShadow(0.7)
                        }}
                      >
                        Zack The Bison
                      </span>
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          background: BADGE,
                          color: "#fff6d7",
                          display: "grid",
                          placeItems: "center",
                          fontFamily: '"Arial Black","Arial",sans-serif',
                          fontSize: 16,
                          lineHeight: 1,
                          textShadow: textShadow(0.45)
                        }}
                      >
                        ✓
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        color: HANDLE,
                        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                        fontSize: 18,
                        lineHeight: 1,
                        fontWeight: 700,
                        textShadow: textShadow(0.6)
                      }}
                    >
                      @zackthebison
                    </div>
                  </div>
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "#f2f2f2",
                    fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                    fontSize: bottomFont,
                    lineHeight: 1.04,
                    fontStyle: "italic",
                    fontWeight: 700,
                    letterSpacing: "-0.015em",
                    textShadow: textShadow(0.82)
                  }}
                >
                  They know they could probably win the fight, but an infected scratch in the wild is a death sentence.
                  It is just not worth the calories.
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
