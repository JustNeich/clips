import React, { CSSProperties } from "react";
import type {
  TemplateCompareScope,
  TemplateContentFixture
} from "./template-calibration-types";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID,
  SCIENCE_CARD_V6_TEMPLATE_ID,
  STAGE3_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID,
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

export type TemplateSceneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TemplateSceneRegions = {
  shell: TemplateSceneRect;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(
  text: string,
  highlightPhrases: string[] | undefined,
  accentColor: string
): React.ReactNode {
  const normalized = (highlightPhrases ?? []).map((item) => item.trim()).filter(Boolean);
  if (!normalized.length || !text.trim()) {
    return text;
  }
  const matcher = new RegExp(`(${normalized.map((item) => escapeRegExp(item)).join("|")})`, "gi");
  const parts = text.split(matcher);
  return parts.map((part, index) => {
    const isAccent = normalized.some((phrase) => phrase.toLowerCase() === part.toLowerCase());
    return isAccent ? (
      <span key={`${part}-${index}`} style={{ color: accentColor }}>
        {part}
      </span>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    );
  });
}

const SCIENCE_CARD_V2_STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "into",
  "over",
  "than",
  "they",
  "them",
  "their",
  "there",
  "have",
  "has",
  "had",
  "were",
  "been",
  "will",
  "would",
  "could",
  "should",
  "just",
  "like",
  "your",
  "about",
  "after",
  "before",
  "every",
  "because",
  "across",
  "follow",
  "follows",
  "press",
  "later",
  "wrap"
]);

function inferScienceCardV2HighlightPhrases(text: string): string[] {
  const words = Array.from(text.matchAll(/[A-Za-z][A-Za-z'-]*/g)).map((match) => ({
    value: match[0],
    normalized: match[0].toLowerCase()
  }));
  const phrases: string[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const first = words[index];
    const second = words[index + 1];
    if (
      first.value.length < 4 ||
      second.value.length < 4 ||
      SCIENCE_CARD_V2_STOP_WORDS.has(first.normalized) ||
      SCIENCE_CARD_V2_STOP_WORDS.has(second.normalized)
    ) {
      continue;
    }
    phrases.push(`${first.value} ${second.value}`);
    index += 1;
    if (phrases.length >= 4) {
      break;
    }
  }
  if (phrases.length >= 3) {
    return phrases;
  }
  return words
    .filter((word) => word.value.length >= 5 && !SCIENCE_CARD_V2_STOP_WORDS.has(word.normalized))
    .slice(0, 4)
    .map((word) => word.value);
}

function resolveTopHighlightPhrases(templateId: string, content: TemplateContentFixture, topText: string): string[] | undefined {
  if (Array.isArray(content.topHighlightPhrases) && content.topHighlightPhrases.length > 0) {
    return content.topHighlightPhrases;
  }
  if (
    templateId === SCIENCE_CARD_V2_TEMPLATE_ID ||
    templateId === SCIENCE_CARD_V4_TEMPLATE_ID ||
    templateId === SCIENCE_CARD_V5_TEMPLATE_ID ||
    templateId === SCIENCE_CARD_V6_TEMPLATE_ID
  ) {
    const inferred = inferScienceCardV2HighlightPhrases(topText);
    return inferred.length > 0 ? inferred : undefined;
  }
  return undefined;
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
  if (templateId === SCIENCE_CARD_V3_TEMPLATE_ID) {
    return {
      shellBackdropNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x - 24,
            top: regions.shell.y - 30,
            width: regions.shell.width + 48,
            height: regions.shell.height + 60,
            borderRadius: templateConfig.card.radius + 38,
            background:
              "radial-gradient(circle at 50% 12%, rgba(125, 193, 255, 0.34), rgba(125, 193, 255, 0) 62%)",
            filter: "blur(18px)",
            opacity: 0.9,
            pointerEvents: "none"
          }}
        />
      ),
      shellFrameNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x + 10,
            top: regions.shell.y + 10,
            width: regions.shell.width - 20,
            height: regions.shell.height - 20,
            borderRadius: Math.max(12, templateConfig.card.radius - 10),
            border: "1px solid rgba(117, 161, 214, 0.24)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ),
      topStyle: {
        background: palette.topSectionFill,
        borderBottom: "1px solid rgba(76, 128, 181, 0.18)"
      },
      topNode: (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 50% 0%, rgba(150, 208, 255, 0.18), rgba(255, 255, 255, 0) 58%)",
            pointerEvents: "none"
          }}
        />
      ),
      mediaNode: (
        <div
          style={{
            position: "absolute",
            inset: 12,
            borderRadius: 18,
            border: "1px solid rgba(81, 129, 180, 0.26)",
            boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.36)",
            pointerEvents: "none"
          }}
        />
      ),
      bottomStyle: {
        background: palette.bottomSectionFill,
        borderTop: "1px solid rgba(76, 128, 181, 0.16)"
      },
      authorStyle: {
        background: "linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(237, 245, 255, 0.78))",
        borderBottom: "1px solid rgba(76, 128, 181, 0.12)"
      },
      bottomTextWrapStyle: {
        background: "linear-gradient(180deg, rgba(250, 253, 255, 0.96), rgba(241, 248, 255, 0.98))"
      },
      bottomTextStyle: {
        textShadow: "0 1px 0 rgba(255, 255, 255, 0.55)"
      }
    };
  }

  if (templateId === SCIENCE_CARD_V4_TEMPLATE_ID) {
    return {
      shellBackdropNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x - 28,
            top: regions.shell.y - 32,
            width: regions.shell.width + 56,
            height: regions.shell.height + 64,
            borderRadius: templateConfig.card.radius + 42,
            background:
              "radial-gradient(circle at 50% 12%, rgba(73, 208, 255, 0.26), rgba(73, 208, 255, 0) 62%)",
            filter: "blur(20px)",
            opacity: 0.9,
            pointerEvents: "none"
          }}
        />
      ),
      shellFrameNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x + 8,
            top: regions.shell.y + 8,
            width: regions.shell.width - 16,
            height: regions.shell.height - 16,
            borderRadius: Math.max(12, templateConfig.card.radius - 8),
            border: "1px solid rgba(139, 240, 255, 0.18)",
            boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ),
      topStyle: {
        background: palette.topSectionFill,
        borderBottom: "1px solid rgba(98, 217, 255, 0.18)"
      },
      topNode: (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(93, 231, 255, 0.08), rgba(93, 231, 255, 0) 42%)",
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 28,
              right: 28,
              top: 0,
              height: 2,
              background:
                "linear-gradient(90deg, rgba(98, 217, 255, 0), rgba(98, 217, 255, 0.68), rgba(98, 217, 255, 0))",
              pointerEvents: "none"
            }}
          />
        </>
      ),
      mediaStyle: {
        background: "#08121c"
      },
      mediaNode: (
        <>
          <div
            style={{
              position: "absolute",
              inset: 12,
              borderRadius: 18,
              border: "1px solid rgba(101, 224, 255, 0.22)",
              boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.04)",
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 18,
              right: 18,
              top: 0,
              height: 1,
              background:
                "linear-gradient(90deg, rgba(98, 217, 255, 0), rgba(98, 217, 255, 0.5), rgba(98, 217, 255, 0))",
              pointerEvents: "none"
            }}
          />
        </>
      ),
      bottomStyle: {
        background: palette.bottomSectionFill,
        borderTop: "1px solid rgba(98, 217, 255, 0.18)"
      },
      authorStyle: {
        background: "linear-gradient(180deg, rgba(11, 23, 35, 0.88), rgba(7, 15, 24, 0.96))",
        borderBottom: "1px solid rgba(98, 217, 255, 0.12)"
      },
      authorNode: (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(90, 240, 207, 0.1), rgba(90, 240, 207, 0) 22%, rgba(90, 240, 207, 0) 100%)",
            pointerEvents: "none"
          }}
        />
      ),
      bottomTextWrapStyle: {
        background: "linear-gradient(180deg, rgba(8, 16, 26, 0.98), rgba(5, 10, 18, 0.98))",
        paddingLeft: 34
      },
      bottomTextNode: (
        <div
          style={{
            position: "absolute",
            left: 18,
            top: 18,
            bottom: 18,
            width: 4,
            borderRadius: 999,
            background: "linear-gradient(180deg, rgba(90, 240, 207, 0.96), rgba(98, 217, 255, 0.18))",
            pointerEvents: "none"
          }}
        />
      )
    };
  }

  if (templateId === SCIENCE_CARD_V5_TEMPLATE_ID) {
    return {
      shellBackdropNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x - 24,
            top: regions.shell.y - 28,
            width: regions.shell.width + 48,
            height: regions.shell.height + 56,
            borderRadius: templateConfig.card.radius + 30,
            background:
              "radial-gradient(circle at 50% 10%, rgba(211, 110, 52, 0.24), rgba(211, 110, 52, 0) 64%)",
            filter: "blur(18px)",
            opacity: 0.86,
            pointerEvents: "none"
          }}
        />
      ),
      shellFrameNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x + 11,
            top: regions.shell.y + 11,
            width: regions.shell.width - 22,
            height: regions.shell.height - 22,
            borderRadius: Math.max(10, templateConfig.card.radius - 8),
            border: "1px solid rgba(255, 255, 255, 0.45)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ),
      topStyle: {
        background: palette.topSectionFill,
        borderBottom: "2px solid rgba(106, 50, 22, 0.12)"
      },
      topNode: (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0) 35%)",
            pointerEvents: "none"
          }}
        />
      ),
      mediaNode: (
        <div
          style={{
            position: "absolute",
            inset: 14,
            borderRadius: 16,
            border: "2px solid rgba(106, 50, 22, 0.18)",
            boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.34)",
            pointerEvents: "none"
          }}
        />
      ),
      bottomStyle: {
        background: palette.bottomSectionFill,
        borderTop: "2px solid rgba(106, 50, 22, 0.12)"
      },
      authorStyle: {
        background: "linear-gradient(180deg, rgba(255, 248, 238, 0.78), rgba(245, 231, 214, 0.82))",
        borderBottom: "1px solid rgba(106, 50, 22, 0.12)"
      },
      bottomTextWrapStyle: {
        background: "linear-gradient(180deg, rgba(255, 252, 248, 0.98), rgba(246, 236, 223, 0.98))",
        paddingLeft: 34
      },
      bottomTextNode: (
        <div
          style={{
            position: "absolute",
            left: 18,
            top: 18,
            bottom: 18,
            width: 5,
            borderRadius: 999,
            background: "linear-gradient(180deg, rgba(211, 110, 52, 0.92), rgba(211, 110, 52, 0.18))",
            pointerEvents: "none"
          }}
        />
      )
    };
  }

  if (templateId === SCIENCE_CARD_V6_TEMPLATE_ID) {
    return {
      shellBackdropNode: (
        <>
          <div
            style={{
              position: "absolute",
              left: regions.shell.x + 14,
              top: regions.shell.y + 16,
              width: regions.shell.width,
              height: regions.shell.height,
              borderRadius: templateConfig.card.radius,
              background: "rgba(18, 20, 23, 0.08)",
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: regions.shell.x - 18,
              top: regions.shell.y + 60,
              width: 74,
              height: 154,
              borderRadius: 28,
              background: "#8df33d",
              pointerEvents: "none"
            }}
          />
        </>
      ),
      shellFrameNode: (
        <div
          style={{
            position: "absolute",
            left: regions.shell.x + 12,
            top: regions.shell.y + 12,
            width: regions.shell.width - 24,
            height: regions.shell.height - 24,
            borderRadius: Math.max(12, templateConfig.card.radius - 8),
            border: "2px solid rgba(18, 20, 23, 0.08)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ),
      topStyle: {
        background: palette.topSectionFill,
        borderBottom: "4px solid #121417"
      },
      mediaStyle: {
        background: "#1a1c20"
      },
      mediaNode: (
        <>
          <div
            style={{
              position: "absolute",
              inset: 16,
              borderRadius: 18,
              border: "3px solid #121417",
              boxSizing: "border-box",
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 16,
              bottom: 16,
              width: 20,
              height: 20,
              borderRadius: 6,
              background: "#8df33d",
              pointerEvents: "none"
            }}
          />
        </>
      ),
      bottomStyle: {
        background: palette.bottomSectionFill,
        borderTop: "4px solid #121417"
      },
      authorStyle: {
        background: "#fffdf8",
        borderBottom: "2px solid rgba(18, 20, 23, 0.12)"
      },
      bottomTextWrapStyle: {
        background: "#f7f4ea",
        paddingLeft: 52
      },
      bottomTextNode: (
        <>
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 18,
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "#121417",
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 36,
              top: 18,
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "#8df33d",
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 38,
              bottom: 18,
              width: 10,
              borderRadius: 999,
              background: "#121417",
              pointerEvents: "none"
            }}
          />
        </>
      )
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
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 52% 10%, rgba(174, 211, 255, 0.88), rgba(45, 107, 203, 0.72) 42%, rgba(8, 24, 56, 0.96) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "24%",
            background: "linear-gradient(180deg, rgba(244, 250, 255, 0.08), rgba(236, 244, 255, 0.24))"
          }}
        />
      </>
    );
  }

  if (templateId === SCIENCE_CARD_V2_TEMPLATE_ID) {
    return (
      <>
        <img
          src={assetUrl ?? "/stage3-template-backdrops/science-card-v2.png"}
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
            background: "linear-gradient(180deg, rgba(4, 8, 14, 0.12), rgba(4, 8, 14, 0.06))"
          }}
        />
      </>
    );
  }

  if (templateId === SCIENCE_CARD_V3_TEMPLATE_ID) {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 48% 8%, rgba(214, 236, 255, 0.96), rgba(139, 192, 255, 0.72) 30%, rgba(31, 75, 131, 0.92) 66%, rgba(9, 20, 43, 0.98) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 26%, rgba(7, 19, 38, 0.2) 100%)"
          }}
        />
      </>
    );
  }

  if (templateId === SCIENCE_CARD_V4_TEMPLATE_ID) {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 50% 10%, rgba(64, 210, 255, 0.34), rgba(64, 210, 255, 0.02) 30%, rgba(6, 19, 33, 0.9) 62%, rgba(3, 8, 15, 0.98) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(90, 240, 207, 0.08), rgba(90, 240, 207, 0) 18%, rgba(90, 240, 207, 0) 82%, rgba(90, 240, 207, 0.06))"
          }}
        />
      </>
    );
  }

  if (templateId === SCIENCE_CARD_V5_TEMPLATE_ID) {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 50% 8%, rgba(255, 221, 182, 0.95), rgba(223, 142, 91, 0.68) 30%, rgba(118, 56, 28, 0.78) 62%, rgba(34, 12, 6, 0.94) 100%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255, 245, 234, 0.14), rgba(255, 245, 234, 0) 24%, rgba(26, 8, 4, 0.18) 100%)"
          }}
        />
      </>
    );
  }

  if (templateId === SCIENCE_CARD_V6_TEMPLATE_ID) {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#ebe5da"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 76,
            top: 118,
            width: 126,
            height: 126,
            borderRadius: 36,
            background: "rgba(141, 243, 61, 0.16)"
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 88,
            top: 242,
            width: 82,
            height: 82,
            borderRadius: 22,
            border: "3px solid rgba(18, 20, 23, 0.08)",
            boxSizing: "border-box"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 88,
            bottom: 224,
            width: 136,
            height: 18,
            borderRadius: 999,
            background: "rgba(18, 20, 23, 0.1)"
          }}
        />
      </>
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
  snapshot?: TemplateRenderSnapshot
) {
  const renderSnapshot =
    snapshot ??
    buildTemplateRenderSnapshot({
      templateId,
      content
    });
  const computed = computedOverride ?? renderSnapshot.computed;
  const templateConfig = getTemplateById(templateId);
  const isTurbo = templateId === TURBO_FACE_TEMPLATE_ID;
  const layoutModel: TemplateLayoutModel = snapshot
    ? renderSnapshot.layout
    : buildTemplateLayoutModel(templateId, computed, templateConfig);

  return {
    isTurbo,
    frame: layoutModel.frame,
    computed,
    regions: {
      shell: layoutModel.shell,
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
  channelName: string,
  sizeOverride?: number
): React.JSX.Element {
  const isTurbo = templateId === TURBO_FACE_TEMPLATE_ID;
  const isScienceCardV1 = templateId === SCIENCE_CARD_TEMPLATE_ID;
  const isScienceCardV2 = templateId === SCIENCE_CARD_V2_TEMPLATE_ID;
  const isScienceCardV3 = templateId === SCIENCE_CARD_V3_TEMPLATE_ID;
  const isScienceCardV4 = templateId === SCIENCE_CARD_V4_TEMPLATE_ID;
  const isScienceCardV5 = templateId === SCIENCE_CARD_V5_TEMPLATE_ID;
  const isScienceCardV6 = templateId === SCIENCE_CARD_V6_TEMPLATE_ID;
  const templateConfig = getTemplateById(templateId || STAGE3_TEMPLATE_ID);
  const author = templateConfig.author;
  const avatarSize = sizeOverride ?? author.avatarSize;
  const palette = resolvePalette(templateConfig);
  let borderColor = "rgba(7, 13, 23, 0.25)";
  if (isTurbo) {
    borderColor = "rgba(8, 12, 18, 0.16)";
  } else if (isScienceCardV2) {
    borderColor = "rgba(218, 189, 136, 0.34)";
  } else if (isScienceCardV3) {
    borderColor = "rgba(24, 74, 138, 0.24)";
  } else if (isScienceCardV4) {
    borderColor = "rgba(101, 224, 255, 0.3)";
  } else if (isScienceCardV5) {
    borderColor = "rgba(122, 58, 25, 0.26)";
  } else if (isScienceCardV6) {
    borderColor = "rgba(79, 217, 42, 0.34)";
  }

  let background = `radial-gradient(circle at 30% 30%, ${palette.topSectionFill}, ${palette.cardFill} 70%, #20506f)`;
  if (isTurbo) {
    background = "radial-gradient(circle at 30% 30%, #f6db98, #2f86bb 70%, #20506f)";
  } else if (isScienceCardV2) {
    background =
      "radial-gradient(circle at 30% 30%, rgba(163, 123, 72, 0.92), rgba(56, 41, 32, 0.98) 68%, rgba(16, 18, 22, 1) 100%)";
  } else if (isScienceCardV3) {
    background =
      "radial-gradient(circle at 30% 30%, rgba(242, 248, 255, 0.98), rgba(98, 146, 214, 0.92) 68%, rgba(17, 36, 72, 0.98) 100%)";
  } else if (isScienceCardV4) {
    background =
      "radial-gradient(circle at 30% 30%, rgba(118, 248, 255, 0.96), rgba(21, 94, 134, 0.94) 56%, rgba(4, 9, 19, 0.98) 100%)";
  } else if (isScienceCardV5) {
    background =
      "radial-gradient(circle at 30% 30%, rgba(255, 224, 193, 0.98), rgba(204, 106, 54, 0.94) 62%, rgba(78, 29, 14, 0.98) 100%)";
  } else if (isScienceCardV6) {
    background = "#121417";
  }
  return (
    <div
      style={{
        width: avatarSize,
        height: avatarSize,
        borderRadius: 999,
        border: `${author.avatarBorder}px solid ${borderColor}`,
        background: isScienceCardV1 ? "#d9d9d9" : background,
        color: isScienceCardV6 ? "#8df33d" : "rgba(255,255,255,0.95)",
        display: "grid",
        placeItems: "center",
        fontFamily: '"Inter","Helvetica Neue",Helvetica,sans-serif',
        fontWeight: 800,
        fontSize: Math.round(avatarSize * 0.32),
        letterSpacing: "0.02em",
        boxSizing: "border-box",
        flex: "0 0 auto"
      }}
    >
      {isScienceCardV1 || isScienceCardV2 ? null : avatarInitials(channelName)}
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
    <span
      style={{
        width: badgeSize,
        height: badgeSize,
        borderRadius: 999,
        background: palette.checkBadgeColor,
        color: "#ffffff",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontFamily: '"Inter","Helvetica Neue",Helvetica,sans-serif',
        fontSize: Math.round(badgeSize * 0.52),
        lineHeight: 1,
        flex: "0 0 auto"
      }}
    >
      ✓
    </span>
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
      content
    });
  const effectiveContent = renderSnapshot.content;
  const layout = getTemplateSceneLayout(resolvedTemplateId, effectiveContent, computedOverride, renderSnapshot);
  const { regions, frame, computed, isTurbo } = layout;
  const templateConfig = getTemplateById(resolvedTemplateId);
  const isScienceCardV1 = resolvedTemplateId === SCIENCE_CARD_TEMPLATE_ID;
  const isScienceCardV2 = resolvedTemplateId === SCIENCE_CARD_V2_TEMPLATE_ID;
  const chromeMetrics = resolveTemplateChromeMetrics(resolvedTemplateId, templateConfig, renderSnapshot.spec);
  const palette = resolvePalette(templateConfig);
  const cardSpec = renderSnapshot.spec.card;
  const cardRadius = isScienceCardV1 ? chromeMetrics.cardRadius : cardSpec.radius;
  const cardBorderWidth = isScienceCardV1 ? chromeMetrics.cardBorderWidth : cardSpec.borderWidth;
  const cardBorderColor = cardSpec.borderColor || palette.borderColor;
  const cardFill = cardSpec.fill || palette.cardFill;
  const cardShadow = cardSpec.shadow ?? templateConfig.card.shadow;
  const scienceShellVisuals: ScienceShellVisuals =
    isTurbo || isScienceCardV1
      ? {}
      : resolveScienceShellVisuals(resolvedTemplateId, templateConfig, palette, regions);
  const topText = computed.top || "Верхний текст появится здесь.";
  const bottomText = computed.bottom || "Нижний текст появится здесь.";
  const highlightPhrases = resolveTopHighlightPhrases(resolvedTemplateId, effectiveContent, topText);
  const authorName = effectiveContent.channelName || templateConfig.author.name;
  const authorHandle = effectiveContent.channelHandle || templateConfig.author.handle;
  const authorGap = templateConfig.author.gap ?? (isTurbo ? 14 : isScienceCardV2 ? 10 : 11);
  const authorCopyGap = templateConfig.author.copyGap ?? (isTurbo ? 0 : isScienceCardV2 ? 0 : 1);
  const authorNameCheckGap = templateConfig.author.nameCheckGap ?? (isTurbo ? 4 : isScienceCardV2 ? 5 : 8);
  const authorAvatarSize = regions.avatar.width;
  const authorCheckSize = renderSnapshot.spec.typography?.badge?.size ?? templateConfig.author.checkSize;
  const authorNameFontSize =
    renderSnapshot.spec.typography?.authorName?.fontSize ?? templateConfig.typography.authorName.font;
  const authorHandleFontSize =
    renderSnapshot.spec.typography?.authorHandle?.fontSize ?? templateConfig.typography.authorHandle.font;
  const topTextWeight = templateConfig.typography.top.weight ?? (isTurbo ? 850 : 800);
  const topTextLetterSpacing = templateConfig.typography.top.letterSpacing ?? (isTurbo ? "-0.038em" : isScienceCardV2 ? "-0.03em" : "-0.015em");
  const topTextFontFamily =
    resolvedTemplateId === TURBO_FACE_TEMPLATE_ID
      ? '"Arial Black","Arial",sans-serif'
      : '"Inter","Helvetica Neue",Helvetica,sans-serif';
  const bodyTextFontFamily = isTurbo
    ? '"Arial","Helvetica Neue",Helvetica,sans-serif'
    : '"Inter","Helvetica Neue",Helvetica,sans-serif';
  const bottomTextWeight = templateConfig.typography.bottom.weight ?? (isScienceCardV2 ? 700 : isTurbo ? 400 : 500);
  const bottomTextLetterSpacing = templateConfig.typography.bottom.letterSpacing ?? (isScienceCardV2 ? "-0.015em" : isTurbo ? "0" : "-0.005em");
  const bottomTextFontStyle = templateConfig.typography.bottom.fontStyle ?? (isScienceCardV2 ? "italic" : "normal");
  const authorNameWeight = templateConfig.typography.authorName.weight ?? (isScienceCardV1 ? 800 : isTurbo ? 700 : 700);
  const authorNameLetterSpacing = templateConfig.typography.authorName.letterSpacing ?? (isTurbo ? "-0.012em" : isScienceCardV1 ? "-0.03em" : "-0.01em");
  const authorHandleWeight = templateConfig.typography.authorHandle.weight ?? (isScienceCardV2 ? 600 : isScienceCardV1 ? 300 : isTurbo ? 400 : 600);
  const authorHandleLetterSpacing = templateConfig.typography.authorHandle.letterSpacing ?? (isScienceCardV2 ? "-0.02em" : isTurbo ? "-0.006em" : "-0.02em");
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

  const topPaddingTop = isScienceCardV1 ? chromeMetrics.topPaddingTop : getTopPaddingTop(templateConfig);
  const topPaddingBottom = isScienceCardV1 ? chromeMetrics.topPaddingBottom : getTopPaddingBottom(templateConfig);
  const topPaddingX = isScienceCardV1 ? chromeMetrics.topPaddingX : templateConfig.slot.topPaddingX;
  const scienceCardChromeOutset = isScienceCardV1 ? Math.max(1, Math.round(cardBorderWidth / 2)) : 0;
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

      {isTurbo ? (
        <>
          <div
            style={{
              position: "absolute",
              left: regions.shell.x,
              top: regions.shell.y,
              width: regions.shell.width,
              height: regions.shell.height,
              borderRadius: cardRadius,
              background: cardFill,
              border: `${cardBorderWidth}px solid ${cardBorderColor}`,
              boxShadow: cardShadow ?? "0 24px 48px rgba(4, 10, 20, 0.38), 0 8px 22px rgba(4, 10, 20, 0.2)",
              overflow: "hidden",
              boxSizing: "border-box"
            }}
          />
          <section
            style={{
              position: "absolute",
              left: regions.top.x,
              top: regions.top.y,
              width: regions.top.width,
              height: regions.top.height,
              borderRadius: `${cardRadius}px ${cardRadius}px 0 0`,
              backgroundColor: palette.topSectionFill,
              borderBottom: "1px solid rgba(6,13,22,0.07)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              textAlign: "center",
                padding: `${topPaddingTop}px ${topPaddingX}px ${topPaddingBottom}px`,
              boxSizing: "border-box"
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
              left: regions.media.x,
              top: regions.media.y,
              width: regions.media.width,
              height: regions.media.height,
              overflow: "hidden"
            }}
          >
            {mediaNode}
          </section>
          <section
            style={{
              position: "absolute",
              left: regions.bottom.x,
              top: regions.bottom.y,
              width: regions.bottom.width,
              height: regions.bottom.height,
              borderRadius: `0 0 ${cardRadius}px ${cardRadius}px`,
              backgroundColor: palette.bottomSectionFill,
              borderTop: "1px solid rgba(6,13,22,0.07)",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: `${regions.author.height}px minmax(0, 1fr)`
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                padding: `${templateConfig.slot.bottomMetaPaddingY}px ${templateConfig.slot.bottomMetaPaddingX}px`,
                backgroundColor: palette.bottomSectionFill
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: authorGap }}>
                {avatarNode ?? renderDefaultAvatar(resolvedTemplateId, authorName, authorAvatarSize)}
                <div style={{ minWidth: 0, display: "grid", gap: authorCopyGap }}>
                  <div style={{ display: "flex", alignItems: "center", gap: authorNameCheckGap }}>
                  <span
                    style={{
                        color: palette.authorNameColor,
                        fontWeight: authorNameWeight,
                        letterSpacing: authorNameLetterSpacing,
                        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                        fontSize: authorNameFontSize,
                        lineHeight: templateConfig.typography.authorName.lineHeight,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {authorName}
                    </span>
                    <span
                      style={{
                        width: authorCheckSize,
                        height: authorCheckSize,
                        borderRadius: 999,
                        background: palette.checkBadgeColor,
                        color: "#ffffff",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 800,
                        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                        fontSize: Math.round(authorCheckSize * 0.52),
                        lineHeight: 1
                      }}
                    >
                      ✓
                    </span>
                  </div>
                    <span
                    style={{
                        color: palette.authorHandleColor,
                        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                        fontWeight: authorHandleWeight,
                        letterSpacing: authorHandleLetterSpacing,
                        fontSize: authorHandleFontSize,
                        lineHeight: templateConfig.typography.authorHandle.lineHeight
                      }}
                  >
                    {authorHandle}
                  </span>
                </div>
              </div>
            </div>
            <div
              style={{
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                padding: `${getBottomTextPaddingTop(templateConfig)}px ${getBottomTextPaddingRight(templateConfig)}px ${getBottomTextPaddingBottom(
                  templateConfig
                )}px ${getBottomTextPaddingLeft(templateConfig)}px`,
                backgroundColor: palette.bottomSectionFill
              }}
            >
              <p
                data-template-slot="bottom-text"
                style={{
                    margin: 0,
                  color: palette.bottomTextColor,
                  fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                  fontWeight: bottomTextWeight,
                  letterSpacing: bottomTextLetterSpacing,
                  fontStyle: bottomTextFontStyle,
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
        </>
      ) : isScienceCardV1 ? (
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
              left: cardSpec.x - scienceCardChromeOutset,
              top: cardSpec.y - scienceCardChromeOutset,
              width: cardSpec.width + scienceCardChromeOutset * 2,
              height: cardSpec.height + scienceCardChromeOutset * 2,
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
                width: cardSpec.width,
                height: cardSpec.height,
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
                width: cardSpec.width,
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
                top: scienceCardChromeOutset + (regions.media.y - cardSpec.y),
                width: cardSpec.width,
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
                top: scienceCardChromeOutset + (regions.bottom.y - cardSpec.y),
                width: cardSpec.width,
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
                {avatarNode ?? renderDefaultAvatar(resolvedTemplateId, authorName, authorAvatarSize)}
                <div style={{ minWidth: 0, display: "grid", gap: authorCopyGap }}>
                  <div style={{ display: "flex", alignItems: "center", gap: authorNameCheckGap }}>
                    <span
                      style={{
                        color: palette.authorNameColor,
                        fontWeight: authorNameWeight,
                        fontFamily: bodyTextFontFamily,
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
                      fontFamily: bodyTextFontFamily,
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
                    fontFamily: bodyTextFontFamily,
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
              left: regions.shell.x,
              top: regions.shell.y,
              width: regions.shell.width,
              height: regions.shell.height,
              borderRadius: cardRadius,
              border: `${cardBorderWidth}px solid ${cardBorderColor}`,
              background: cardFill,
              boxShadow: cardShadow ?? (isScienceCardV2 ? "0 18px 36px rgba(0,0,0,0.22)" : "none"),
              overflow: "hidden",
              boxSizing: "border-box",
              ...scienceShellVisuals.shellStyle
            }}
          />
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
              {highlightPhrases
                ? renderHighlightedText(topText, highlightPhrases, palette.accentColor ?? palette.topTextColor)
                : topText}
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
              {avatarNode ?? renderDefaultAvatar(resolvedTemplateId, authorName, authorAvatarSize)}
              <div style={{ minWidth: 0, display: "grid", gap: authorCopyGap }}>
                <div style={{ display: "flex", alignItems: "center", gap: authorNameCheckGap }}>
                  <span
                    style={{
                      color: palette.authorNameColor,
                      fontWeight: authorNameWeight,
                      fontFamily: bodyTextFontFamily,
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
                    fontFamily: bodyTextFontFamily,
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
                  fontFamily: bodyTextFontFamily,
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
                {bottomText}
              </p>
            </div>
          </section>
        </>
      )}

      {showGuides ? <TemplateSceneGuides guides={getSceneGuides(regions)} compareScope={compareScope} /> : null}
    </div>
  );
}
