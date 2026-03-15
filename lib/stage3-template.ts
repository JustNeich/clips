export const SCIENCE_CARD_TEMPLATE_ID = "science-card-v1";
export const TURBO_FACE_TEMPLATE_ID = "turbo-face-v1";
export const SCIENCE_CARD_V2_TEMPLATE_ID = "science-card-v2";
export const SCIENCE_CARD_V3_TEMPLATE_ID = "science-card-v3";
export const SCIENCE_CARD_V4_TEMPLATE_ID = "science-card-v4";
export const SCIENCE_CARD_V5_TEMPLATE_ID = "science-card-v5";
export const STAGE3_TEMPLATE_ID = SCIENCE_CARD_TEMPLATE_ID;

const SHARED_STAGE3_CARD_METRICS = {
  x: 90,
  y: 160,
  width: 901,
  height: 1600
} as const;

const SCIENCE_CARD_SECTION_METRICS = {
  topHeight: 349,
  bottomHeight: 243
} as const;

const SCIENCE_CARD_V2_SECTION_METRICS = {
  topHeight: 390,
  bottomHeight: 270
} as const;

const TURBO_FACE_SECTION_METRICS = {
  topHeight: 360,
  bottomHeight: 300
} as const;

const TURBO_FACE_BASE_AUTHOR_METRICS = {
  avatarSize: 88,
  checkSize: 20,
  authorNameFont: 38,
  authorHandleFont: 24
} as const;

const SHARED_STAGE3_AUTHOR_METRICS = {
  bottomMetaHeight: 118,
  bottomMetaPaddingX: 20,
  bottomMetaPaddingY: 4,
  avatarSize: Math.round(TURBO_FACE_BASE_AUTHOR_METRICS.avatarSize * 1.2),
  checkSize: Math.round(TURBO_FACE_BASE_AUTHOR_METRICS.checkSize * 2),
  authorNameFont: Math.round(TURBO_FACE_BASE_AUTHOR_METRICS.authorNameFont * 1.1),
  authorHandleFont: Math.round(TURBO_FACE_BASE_AUTHOR_METRICS.authorHandleFont * 1.5),
  copyGap: 2,
  nameCheckGap: 4
} as const;

const SCIENCE_CARD_AUTHOR_METRICS = {
  bottomMetaHeight: 110,
  bottomMetaPaddingX: 19,
  bottomMetaPaddingY: 0,
  avatarSize: 84,
  checkSize: 45,
  authorNameFont: 33,
  authorHandleFont: 28,
  gap: 8,
  copyGap: 0,
  nameCheckGap: 2
} as const;

export const SCIENCE_CARD = {
  frame: { width: 1080, height: 1920 },
  card: {
    x: 159,
    y: 320,
    width: 757,
    height: 1217,
    radius: 12,
    borderWidth: 8,
    borderColor: "#000000",
    fill: "#ffffff",
    shadow: "0 4px 4px rgba(0,0,0,0.25)"
  },
  slot: {
    topHeight: 349,
    bottomHeight: 243,
    topPaddingX: 6,
    topPaddingY: 15,
    topPaddingTop: 15,
    topPaddingBottom: 15,
    bottomMetaHeight: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaHeight,
    bottomMetaPaddingX: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaPaddingX,
    bottomMetaPaddingY: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaPaddingY,
    bottomTextPaddingX: 19,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 0,
    bottomTextPaddingBottom: 0,
    bottomTextPaddingLeft: 19,
    bottomTextPaddingRight: 39
  },
  palette: {
    cardFill: "#ffffff",
    topSectionFill: "#ffffff",
    bottomSectionFill: "#ffffff",
    topTextColor: "#000000",
    bottomTextColor: "#0b0d10",
    authorNameColor: "#000000",
    authorHandleColor: "#acacac",
    checkBadgeColor: "#e985d6",
    borderColor: "#000000"
  },
  author: {
    name: "Science Snack",
    handle: "@Science_Snack_1",
    avatarSize: SCIENCE_CARD_AUTHOR_METRICS.avatarSize,
    avatarBorder: 0,
    checkSize: SCIENCE_CARD_AUTHOR_METRICS.checkSize,
    gap: SCIENCE_CARD_AUTHOR_METRICS.gap,
    copyGap: SCIENCE_CARD_AUTHOR_METRICS.copyGap,
    nameCheckGap: SCIENCE_CARD_AUTHOR_METRICS.nameCheckGap,
    checkAssetPath: "/stage3-template-badges/science-card-v1-check.png"
  },
  typography: {
    top: {
      min: 40,
      max: 56,
      softLimit: 220,
      penalty: 0.14,
      lineHeight: 0.938,
      maxLines: 7,
      maxChars: 420,
      horizontalSafety: 0.975,
      glyphFactor: 0.53,
      fillTargetMin: 0.9,
      fillTargetMax: 0.95,
      weight: 900,
      letterSpacing: "-0.04em"
    },
    bottom: {
      min: 24,
      max: 34,
      softLimit: 190,
      penalty: 0.16,
      lineHeight: 1.08,
      maxLines: 4,
      maxChars: 320,
      fillTargetMin: 0.8,
      fillTargetMax: 0.88,
      weight: 500,
      letterSpacing: "-0.01em",
      fontStyle: "normal"
    },
    authorName: {
      font: SCIENCE_CARD_AUTHOR_METRICS.authorNameFont,
      lineHeight: 1,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    authorHandle: {
      font: SCIENCE_CARD_AUTHOR_METRICS.authorHandleFont,
      lineHeight: 1,
      weight: 300,
      letterSpacing: "-0.022em"
    }
  }
} as const;

export const SCIENCE_CARD_V2 = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    ...SHARED_STAGE3_CARD_METRICS,
    radius: 0,
    borderWidth: 6,
    borderColor: "#22a65a",
    fill: "#1b222a"
  },
  slot: {
    ...SCIENCE_CARD.slot,
    topHeight: SCIENCE_CARD_V2_SECTION_METRICS.topHeight,
    topPaddingX: 58,
    topPaddingY: 10,
    topPaddingTop: 10,
    topPaddingBottom: 12,
    bottomHeight: SCIENCE_CARD_V2_SECTION_METRICS.bottomHeight,
    bottomMetaHeight: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaHeight,
    bottomMetaPaddingX: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaPaddingX,
    bottomMetaPaddingY: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaPaddingY,
    bottomTextPaddingX: 18,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 6,
    bottomTextPaddingBottom: 13,
    bottomTextPaddingLeft: 18,
    bottomTextPaddingRight: 18
  },
  author: {
    ...SCIENCE_CARD.author,
    name: "Zack The Bison",
    handle: "@zackthebison",
    avatarSize: SHARED_STAGE3_AUTHOR_METRICS.avatarSize,
    avatarBorder: 1,
    checkSize: SHARED_STAGE3_AUTHOR_METRICS.checkSize,
    gap: 10,
    copyGap: SHARED_STAGE3_AUTHOR_METRICS.copyGap,
    nameCheckGap: SHARED_STAGE3_AUTHOR_METRICS.nameCheckGap
  },
  typography: {
    ...SCIENCE_CARD.typography,
    top: {
      ...SCIENCE_CARD.typography.top,
      min: 42,
      max: 58,
      softLimit: 190,
      penalty: 0.18,
      lineHeight: 0.93,
      maxLines: 5,
      maxChars: 240,
      horizontalSafety: 0.95,
      glyphFactor: 0.53,
      fillTargetMin: 0.88,
      fillTargetMax: 0.94,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    bottom: {
      ...SCIENCE_CARD.typography.bottom,
      min: 18,
      max: 24,
      softLimit: 165,
      penalty: 0.2,
      lineHeight: 0.97,
      maxLines: 4,
      maxChars: 220,
      fillTargetMin: 0.84,
      fillTargetMax: 0.9,
      weight: 700,
      letterSpacing: "-0.015em",
      fontStyle: "italic"
    },
    authorName: {
      ...SCIENCE_CARD.typography.authorName,
      font: SHARED_STAGE3_AUTHOR_METRICS.authorNameFont,
      lineHeight: 1,
      weight: 700,
      letterSpacing: "-0.012em"
    },
    authorHandle: {
      ...SCIENCE_CARD.typography.authorHandle,
      font: SHARED_STAGE3_AUTHOR_METRICS.authorHandleFont,
      lineHeight: 1,
      weight: 600,
      letterSpacing: "-0.02em"
    }
  },
  palette: {
    cardFill: "#1b222a",
    topSectionFill: "#232a32",
    bottomSectionFill: "#21272f",
    topTextColor: "#f5f7f7",
    bottomTextColor: "#edf0f2",
    authorNameColor: "#f0e7d4",
    authorHandleColor: "#9da3ab",
    checkBadgeColor: "#d4aa24",
    borderColor: "#22a65a",
    accentColor: "#77c15e"
  }
} as const;

export const SCIENCE_CARD_V3 = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    radius: 22,
    borderWidth: 4,
    borderColor: "#10243c",
    fill: "#f8fbff",
    shadow: "0 30px 80px rgba(10, 26, 48, 0.28), 0 12px 30px rgba(45, 108, 189, 0.18)"
  },
  slot: {
    ...SCIENCE_CARD.slot,
    topPaddingX: 30,
    topPaddingY: 18,
    topPaddingTop: 18,
    topPaddingBottom: 16,
    bottomMetaPaddingX: 22,
    bottomMetaPaddingY: 2,
    bottomTextPaddingX: 22,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 2,
    bottomTextPaddingBottom: 4,
    bottomTextPaddingLeft: 22,
    bottomTextPaddingRight: 30
  },
  author: {
    ...SCIENCE_CARD.author,
    avatarBorder: 2,
    gap: 10,
    nameCheckGap: 5
  },
  typography: {
    ...SCIENCE_CARD.typography,
    top: {
      ...SCIENCE_CARD.typography.top,
      min: 38,
      max: 54,
      softLimit: 210,
      penalty: 0.14,
      lineHeight: 0.94,
      maxLines: 6,
      horizontalSafety: 0.96,
      glyphFactor: 0.52,
      fillTargetMin: 0.89,
      fillTargetMax: 0.95,
      weight: 830,
      letterSpacing: "-0.036em"
    },
    bottom: {
      ...SCIENCE_CARD.typography.bottom,
      min: 23,
      max: 32,
      softLimit: 180,
      penalty: 0.15,
      lineHeight: 1.04,
      maxChars: 300,
      fillTargetMin: 0.82,
      fillTargetMax: 0.9,
      weight: 550,
      letterSpacing: "-0.012em"
    },
    authorName: {
      ...SCIENCE_CARD.typography.authorName,
      font: 34,
      weight: 800,
      letterSpacing: "-0.026em"
    },
    authorHandle: {
      ...SCIENCE_CARD.typography.authorHandle,
      font: 26,
      weight: 450,
      letterSpacing: "-0.018em"
    }
  },
  palette: {
    cardFill: "linear-gradient(180deg, #ffffff 0%, #edf5ff 100%)",
    topSectionFill: "linear-gradient(180deg, #ffffff 0%, #f1f7ff 100%)",
    bottomSectionFill: "linear-gradient(180deg, #ffffff 0%, #f6faff 100%)",
    topTextColor: "#08121e",
    bottomTextColor: "#0f1826",
    authorNameColor: "#071320",
    authorHandleColor: "rgba(12, 25, 38, 0.46)",
    checkBadgeColor: "#4fbef7",
    borderColor: "#10243c",
    accentColor: "#178de8"
  }
} as const;

export const SCIENCE_CARD_V4 = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    radius: 28,
    borderWidth: 3,
    borderColor: "rgba(112, 228, 255, 0.58)",
    fill: "#071019",
    shadow: "0 38px 90px rgba(0, 0, 0, 0.42), 0 18px 50px rgba(14, 120, 158, 0.22)"
  },
  slot: {
    ...SCIENCE_CARD.slot,
    topPaddingX: 34,
    topPaddingY: 20,
    topPaddingTop: 20,
    topPaddingBottom: 16,
    bottomMetaPaddingX: 24,
    bottomMetaPaddingY: 3,
    bottomTextPaddingX: 24,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 4,
    bottomTextPaddingBottom: 8,
    bottomTextPaddingLeft: 24,
    bottomTextPaddingRight: 28
  },
  author: {
    ...SCIENCE_CARD.author,
    avatarBorder: 2,
    gap: 10,
    nameCheckGap: 5
  },
  typography: {
    ...SCIENCE_CARD.typography,
    top: {
      ...SCIENCE_CARD.typography.top,
      min: 40,
      max: 56,
      softLimit: 210,
      penalty: 0.17,
      lineHeight: 0.93,
      maxLines: 6,
      horizontalSafety: 0.95,
      glyphFactor: 0.52,
      fillTargetMin: 0.88,
      fillTargetMax: 0.94,
      weight: 820,
      letterSpacing: "-0.03em"
    },
    bottom: {
      ...SCIENCE_CARD.typography.bottom,
      min: 22,
      max: 30,
      softLimit: 175,
      penalty: 0.16,
      lineHeight: 1.05,
      maxChars: 280,
      fillTargetMin: 0.82,
      fillTargetMax: 0.9,
      weight: 560,
      letterSpacing: "-0.01em"
    },
    authorName: {
      ...SCIENCE_CARD.typography.authorName,
      font: 34,
      weight: 700,
      letterSpacing: "-0.018em"
    },
    authorHandle: {
      ...SCIENCE_CARD.typography.authorHandle,
      font: 25,
      weight: 500,
      letterSpacing: "-0.014em"
    }
  },
  palette: {
    cardFill: "linear-gradient(180deg, rgba(10, 20, 31, 0.98) 0%, rgba(4, 9, 16, 0.98) 100%)",
    topSectionFill: "linear-gradient(180deg, rgba(13, 25, 38, 0.98) 0%, rgba(9, 17, 28, 0.98) 100%)",
    bottomSectionFill: "linear-gradient(180deg, rgba(8, 16, 26, 0.98) 0%, rgba(6, 12, 20, 0.98) 100%)",
    topTextColor: "#f3fbff",
    bottomTextColor: "#dfe9ef",
    authorNameColor: "#f4fdff",
    authorHandleColor: "rgba(194, 214, 229, 0.66)",
    checkBadgeColor: "#64d9ff",
    borderColor: "rgba(112, 228, 255, 0.58)",
    accentColor: "#5af0cf"
  }
} as const;

export const SCIENCE_CARD_V5 = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    radius: 18,
    borderWidth: 5,
    borderColor: "#6a3216",
    fill: "#fff7ef",
    shadow: "0 26px 60px rgba(79, 33, 16, 0.22), 0 10px 22px rgba(145, 74, 31, 0.14)"
  },
  slot: {
    ...SCIENCE_CARD.slot,
    topPaddingX: 28,
    topPaddingY: 16,
    topPaddingTop: 16,
    topPaddingBottom: 14,
    bottomMetaPaddingX: 21,
    bottomMetaPaddingY: 1,
    bottomTextPaddingX: 21,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 3,
    bottomTextPaddingBottom: 5,
    bottomTextPaddingLeft: 21,
    bottomTextPaddingRight: 28
  },
  author: {
    ...SCIENCE_CARD.author,
    avatarBorder: 1,
    gap: 10,
    nameCheckGap: 6
  },
  typography: {
    ...SCIENCE_CARD.typography,
    top: {
      ...SCIENCE_CARD.typography.top,
      min: 39,
      max: 55,
      softLimit: 210,
      penalty: 0.15,
      lineHeight: 0.95,
      maxLines: 6,
      horizontalSafety: 0.96,
      glyphFactor: 0.52,
      fillTargetMin: 0.89,
      fillTargetMax: 0.95,
      weight: 820,
      letterSpacing: "-0.03em"
    },
    bottom: {
      ...SCIENCE_CARD.typography.bottom,
      min: 23,
      max: 31,
      softLimit: 185,
      penalty: 0.16,
      lineHeight: 1.06,
      maxChars: 290,
      fillTargetMin: 0.82,
      fillTargetMax: 0.9,
      weight: 600,
      letterSpacing: "-0.012em",
      fontStyle: "italic"
    },
    authorName: {
      ...SCIENCE_CARD.typography.authorName,
      font: 34,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    authorHandle: {
      ...SCIENCE_CARD.typography.authorHandle,
      font: 26,
      weight: 500,
      letterSpacing: "-0.016em"
    }
  },
  palette: {
    cardFill: "linear-gradient(180deg, #fffaf4 0%, #f8eadb 100%)",
    topSectionFill:
      "radial-gradient(circle at 18% 14%, rgba(255, 255, 255, 0.96), rgba(255, 245, 230, 0.95) 38%, rgba(245, 220, 194, 0.96) 100%)",
    bottomSectionFill: "linear-gradient(180deg, rgba(255, 253, 250, 0.98) 0%, rgba(246, 236, 223, 0.98) 100%)",
    topTextColor: "#351308",
    bottomTextColor: "#3a190d",
    authorNameColor: "#281107",
    authorHandleColor: "rgba(67, 29, 13, 0.48)",
    checkBadgeColor: "#f28f5a",
    borderColor: "#6a3216",
    accentColor: "#d36e34"
  }
} as const;

export const STAGE3_TEMPLATE_SHELL = {
  x: SHARED_STAGE3_CARD_METRICS.x,
  y: SHARED_STAGE3_CARD_METRICS.y,
  width: SHARED_STAGE3_CARD_METRICS.width,
  height: SHARED_STAGE3_CARD_METRICS.height,
  radius: 30
} as const;

const STAGE3_TEMPLATE_SHELL_BOTTOM =
  SCIENCE_CARD.frame.height - STAGE3_TEMPLATE_SHELL.y - STAGE3_TEMPLATE_SHELL.height;

export const TURBO_FACE = {
  frame: { width: 1080, height: 1920 },
  top: {
    x: STAGE3_TEMPLATE_SHELL.x,
    y: STAGE3_TEMPLATE_SHELL.y,
    width: STAGE3_TEMPLATE_SHELL.width,
    radius: 0,
    paddingX: 20,
    paddingY: 10,
    minHeight: TURBO_FACE_SECTION_METRICS.topHeight,
    maxHeight: TURBO_FACE_SECTION_METRICS.topHeight
  },
  video: {
    x: STAGE3_TEMPLATE_SHELL.x,
    minHeight: 760
  },
  bottom: {
    x: STAGE3_TEMPLATE_SHELL.x,
    bottom: STAGE3_TEMPLATE_SHELL_BOTTOM,
    width: STAGE3_TEMPLATE_SHELL.width,
    radius: 0,
    paddingX: 18,
    paddingY: 8,
    metaHeight: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaHeight,
    metaGap: 6,
    minHeight: TURBO_FACE_SECTION_METRICS.bottomHeight,
    maxHeight: TURBO_FACE_SECTION_METRICS.bottomHeight
  },
  author: {
    name: "Stone Face Turbo",
    handle: "@StoneFaceTurbo",
    avatarSize: SHARED_STAGE3_AUTHOR_METRICS.avatarSize,
    avatarBorder: 1,
    checkSize: SHARED_STAGE3_AUTHOR_METRICS.checkSize,
    gap: 10,
    copyGap: SHARED_STAGE3_AUTHOR_METRICS.copyGap,
    nameCheckGap: SHARED_STAGE3_AUTHOR_METRICS.nameCheckGap
  },
  typography: {
    top: {
      min: 50,
      max: 76,
      softLimit: 280,
      penalty: 0.15,
      lineHeight: 0.9,
      maxLines: 6,
      maxChars: 500,
      horizontalSafety: 0.96,
      glyphFactor: 0.52,
      fillTargetMin: 0.9,
      fillTargetMax: 0.95,
      weight: 850,
      letterSpacing: "-0.038em"
    },
    bottom: {
      min: 26,
      max: 46,
      softLimit: 220,
      penalty: 0.16,
      lineHeight: 1.06,
      maxLines: 4,
      maxChars: 340,
      fillTargetMin: 0.88,
      fillTargetMax: 0.94,
      weight: 400,
      letterSpacing: "0",
      fontStyle: "normal"
    },
    authorName: {
      font: SHARED_STAGE3_AUTHOR_METRICS.authorNameFont,
      lineHeight: 1.01,
      weight: 700,
      letterSpacing: "-0.012em"
    },
    authorHandle: {
      font: SHARED_STAGE3_AUTHOR_METRICS.authorHandleFont,
      lineHeight: 1.02,
      weight: 400,
      letterSpacing: "-0.006em"
    }
  }
} as const;

export const TURBO_FACE_PALETTE = {
  cardFill: "#f6f3eb",
  topSectionFill: "#fbf7ef",
  bottomSectionFill: "#fbf7ef",
  topTextColor: "#05070b",
  bottomTextColor: "#171b21",
  authorNameColor: "#0c1018",
  authorHandleColor: "rgba(16, 19, 26, 0.46)",
  checkBadgeColor: "#73b2dd",
  borderColor: "rgba(10, 17, 25, 0.88)"
} as const;

const TURBO_FACE_COMPAT = {
  frame: TURBO_FACE.frame,
  card: {
    x: STAGE3_TEMPLATE_SHELL.x,
    y: STAGE3_TEMPLATE_SHELL.y,
    width: STAGE3_TEMPLATE_SHELL.width,
    height: STAGE3_TEMPLATE_SHELL.height,
    radius: 18,
    borderWidth: 2,
    borderColor: "#0a1119",
    fill: "#fbfbf8",
    shadow: "0 24px 48px rgba(4, 10, 20, 0.38), 0 8px 22px rgba(4, 10, 20, 0.2)"
  },
  slot: {
    topHeight: TURBO_FACE_SECTION_METRICS.topHeight,
    bottomHeight: TURBO_FACE_SECTION_METRICS.bottomHeight,
    topPaddingX: 38,
    topPaddingY: 10,
    topPaddingTop: 10,
    topPaddingBottom: 12,
    bottomMetaHeight: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaHeight,
    bottomMetaPaddingX: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaPaddingX,
    bottomMetaPaddingY: SHARED_STAGE3_AUTHOR_METRICS.bottomMetaPaddingY,
    bottomTextPaddingX: 18,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 4,
    bottomTextPaddingBottom: 8
  },
  palette: TURBO_FACE_PALETTE,
  author: TURBO_FACE.author,
  typography: TURBO_FACE.typography
} as const;

export type Stage3TemplateConfig = {
  frame: { width: number; height: number };
  card: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    borderWidth: number;
    borderColor: string;
    fill: string;
    shadow?: string;
  };
  slot: {
    topHeight: number;
    bottomHeight: number;
    topPaddingX: number;
    topPaddingY: number;
    topPaddingTop?: number;
    topPaddingBottom?: number;
    bottomMetaHeight: number;
    bottomMetaPaddingX: number;
    bottomMetaPaddingY: number;
    bottomTextPaddingX: number;
    bottomTextPaddingY: number;
    bottomTextPaddingTop?: number;
    bottomTextPaddingBottom?: number;
    bottomTextPaddingLeft?: number;
    bottomTextPaddingRight?: number;
  };
  author: {
    name: string;
    handle: string;
    avatarSize: number;
    avatarBorder: number;
    checkSize: number;
    gap?: number;
    copyGap?: number;
    nameCheckGap?: number;
    checkAssetPath?: string;
  };
  typography: {
    top: {
      min: number;
      max: number;
      softLimit: number;
      penalty: number;
      lineHeight: number;
      maxLines: number;
      maxChars: number;
      horizontalSafety?: number;
      glyphFactor?: number;
      fillTargetMin?: number;
      fillTargetMax?: number;
      weight?: number;
      letterSpacing?: string;
      fontStyle?: "normal" | "italic";
    };
    bottom: {
      min: number;
      max: number;
      softLimit: number;
      penalty: number;
      lineHeight: number;
      maxLines: number;
      maxChars: number;
      horizontalSafety?: number;
      glyphFactor?: number;
      fillTargetMin?: number;
      fillTargetMax?: number;
      weight?: number;
      letterSpacing?: string;
      fontStyle?: "normal" | "italic";
    };
    authorName: {
      font: number;
      lineHeight: number;
      weight?: number;
      letterSpacing?: string;
    };
    authorHandle: {
      font: number;
      lineHeight: number;
      weight?: number;
      letterSpacing?: string;
    };
  };
  palette: {
    cardFill: string;
    topSectionFill: string;
    bottomSectionFill: string;
    topTextColor: string;
    bottomTextColor: string;
    authorNameColor: string;
    authorHandleColor: string;
    checkBadgeColor: string;
    borderColor: string;
    accentColor?: string;
  };
};

type TypographyConfig = {
  min: number;
  max: number;
  lineHeight: number;
  maxLines: number;
  maxChars: number;
  horizontalSafety?: number;
  glyphFactor?: number;
  fillTargetMin?: number;
  fillTargetMax?: number;
};

type SlotSize = {
  width: number;
  height: number;
};

type FontScaleOverrides = {
  topFontScale?: number;
  bottomFontScale?: number;
};

function getBottomTextPaddingTop(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingTop ?? template.slot.bottomTextPaddingY;
}

function getBottomTextPaddingBottom(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingBottom ?? template.slot.bottomTextPaddingY;
}

function getTopPaddingTop(template: Stage3TemplateConfig): number {
  return template.slot.topPaddingTop ?? template.slot.topPaddingY;
}

function getTopPaddingBottom(template: Stage3TemplateConfig): number {
  return template.slot.topPaddingBottom ?? template.slot.topPaddingY;
}

function getBottomTextPaddingLeft(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingLeft ?? template.slot.bottomTextPaddingX;
}

function getBottomTextPaddingRight(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingRight ?? template.slot.bottomTextPaddingX;
}

function getSectionBorderLosses(template: Stage3TemplateConfig): {
  topWidth: number;
  topHeight: number;
  bottomWidth: number;
  bottomHeight: number;
} {
  if (template === SCIENCE_CARD) {
    return {
      topWidth: template.card.borderWidth * 2,
      topHeight: template.card.borderWidth,
      bottomWidth: template.card.borderWidth * 2,
      bottomHeight: template.card.borderWidth
    };
  }
  return {
    topWidth: 0,
    topHeight: 0,
    bottomWidth: 0,
    bottomHeight: 0
  };
}

const DEFAULT_AVERAGE_GLYPH_FACTOR = 0.56;
const DEFAULT_HORIZONTAL_SAFETY = 0.92;
const VERTICAL_SAFETY = 0.995;
const FONT_SCALE_MIN = 0.7;
const FONT_SCALE_MAX = 1.9;
const MIN_FONT_FALLBACK_RATIO = 0.58;
const FILLER_WORDS = new Set([
  "really",
  "very",
  "quite",
  "basically",
  "actually",
  "just",
  "literally"
]);

export function resolveScaledMaxLines(baseMaxLines: number, scale: number, slot: "top" | "bottom"): number {
  if (!Number.isFinite(scale) || scale <= 1.05) {
    return baseMaxLines;
  }
  if (slot === "bottom") {
    if (scale >= 1.6) {
      return baseMaxLines + 2;
    }
    if (scale >= 1.22) {
      return baseMaxLines + 1;
    }
  }
  return baseMaxLines;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return clampNumber(value, FONT_SCALE_MIN, FONT_SCALE_MAX);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s([,.:;!?])/g, "$1").trim();
}

function getSafeMinimumFont(config: TypographyConfig): number {
  return Math.max(14, Math.floor(config.min * MIN_FONT_FALLBACK_RATIO));
}

function resolveGlyphFactor(config: TypographyConfig): number {
  return clampNumber(config.glyphFactor ?? DEFAULT_AVERAGE_GLYPH_FACTOR, 0.45, 0.7);
}

function resolveHorizontalSafety(config: TypographyConfig): number {
  return clampNumber(config.horizontalSafety ?? DEFAULT_HORIZONTAL_SAFETY, 0.86, 1);
}

function estimateLineCount(
  text: string,
  fontPx: number,
  widthPx: number,
  config: TypographyConfig
): number {
  const normalized = normalizeText(text);
  if (!normalized) {
    return 1;
  }
  const horizontalSafety = resolveHorizontalSafety(config);
  const glyphFactor = resolveGlyphFactor(config);

  const maxCharsPerLine = Math.max(
    3,
    Math.floor((widthPx * horizontalSafety) / Math.max(1, fontPx * glyphFactor))
  );
  const words = normalized.split(" ");
  let lines = 1;
  let currentLen = 0;

  for (const word of words) {
    const len = word.length;
    if (len > maxCharsPerLine) {
      const chunkLines = Math.ceil(len / maxCharsPerLine);
      if (currentLen > 0) {
        lines += 1;
        currentLen = 0;
      }
      lines += chunkLines - 1;
      currentLen = len % maxCharsPerLine;
      continue;
    }

    const nextLen = currentLen === 0 ? len : currentLen + 1 + len;
    if (nextLen <= maxCharsPerLine) {
      currentLen = nextLen;
      continue;
    }

    lines += 1;
    currentLen = len;
  }

  return lines;
}

function findBestFontForSlot(
  text: string,
  slot: SlotSize,
  config: TypographyConfig
): { font: number; lines: number; fits: boolean } {
  const minFont = getSafeMinimumFont(config);
  let fallbackFont = minFont;
  let fallbackLines = estimateLineCount(text, fallbackFont, slot.width, config);

  for (let font = config.max; font >= minFont; font -= 1) {
    const lines = estimateLineCount(text, font, slot.width, config);
    const contentHeight = lines * font * config.lineHeight;
    if (lines <= config.maxLines && contentHeight <= slot.height * VERTICAL_SAFETY) {
      return { font, lines, fits: true };
    }

    if (lines < fallbackLines || (lines === fallbackLines && font > fallbackFont)) {
      fallbackFont = font;
      fallbackLines = lines;
    }
  }

  return { font: fallbackFont, lines: fallbackLines, fits: false };
}

function applyFontScaleWithSafety(params: {
  text: string;
  baseFont: number;
  slot: SlotSize;
  config: TypographyConfig;
  scale: number;
}): { font: number; lines: number; lineHeight: number } {
  const normalizedScale = normalizeFontScale(params.scale);
  const minFont = getSafeMinimumFont(params.config);
  const maxFont = Math.max(
    params.config.max,
    Math.round(params.config.max * Math.max(1, normalizedScale))
  );
  const minLineHeight = clampNumber(params.config.lineHeight * 0.82, 0.82, params.config.lineHeight);
  const maxHeight = params.slot.height * VERTICAL_SAFETY;
  let font = clampNumber(Math.round(params.baseFont * normalizedScale), minFont, maxFont);
  let effectiveLineHeight = params.config.lineHeight;
  let lines = estimateLineCount(params.text, font, params.slot.width, params.config);
  let contentHeight = lines * font * effectiveLineHeight;

  while (
    font > minFont &&
    (lines > params.config.maxLines || contentHeight > params.slot.height * VERTICAL_SAFETY)
  ) {
    if (lines <= params.config.maxLines && contentHeight > maxHeight && effectiveLineHeight > minLineHeight) {
      effectiveLineHeight = Math.max(
        minLineHeight,
        Number((effectiveLineHeight - 0.02).toFixed(3))
      );
      contentHeight = lines * font * effectiveLineHeight;
      continue;
    }

    font -= 1;
    effectiveLineHeight = params.config.lineHeight;
    lines = estimateLineCount(params.text, font, params.slot.width, params.config);
    contentHeight = lines * font * effectiveLineHeight;
  }

  const fillTargetMin = clampNumber(params.config.fillTargetMin ?? 0, 0, VERTICAL_SAFETY);
  if (fillTargetMin > 0) {
    const targetContentHeight = params.slot.height * fillTargetMin;
    const maxLineHeight = Math.min(1.35, Math.max(params.config.lineHeight, params.config.lineHeight + 0.18));
    let growIterations = 0;

    while (contentHeight < targetContentHeight && growIterations < 64) {
      growIterations += 1;
      let expanded = false;

      if (font < maxFont) {
        const candidateFont = font + 1;
        const candidateLines = estimateLineCount(params.text, candidateFont, params.slot.width, params.config);
        const candidateHeight = candidateLines * candidateFont * effectiveLineHeight;
        if (candidateLines <= params.config.maxLines && candidateHeight <= maxHeight) {
          font = candidateFont;
          lines = candidateLines;
          contentHeight = candidateHeight;
          expanded = true;
        }
      }

      if (!expanded && effectiveLineHeight < maxLineHeight) {
        const candidateLineHeight = Number(Math.min(maxLineHeight, effectiveLineHeight + 0.01).toFixed(3));
        const candidateHeight = lines * font * candidateLineHeight;
        if (candidateHeight <= maxHeight) {
          effectiveLineHeight = candidateLineHeight;
          contentHeight = candidateHeight;
          expanded = true;
        }
      }

      if (!expanded) {
        break;
      }
    }
  }

  return { font, lines, lineHeight: Number(effectiveLineHeight.toFixed(3)) };
}

function compactText(value: string, targetChars: number): string {
  let text = normalizeText(value);
  if (!text) {
    return text;
  }

  text = text.replace(/\([^)]*\)/g, " ");
  text = text.replace(/\[[^\]]*]/g, " ");
  text = normalizeText(text);

  const withoutFillers = text
    .split(" ")
    .filter((word) => !FILLER_WORDS.has(word.toLowerCase()))
    .join(" ");
  text = normalizeText(withoutFillers || text);

  if (text.length <= targetChars) {
    return text;
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (sentences.length > 1) {
    let summary = "";
    for (const sentence of sentences) {
      const candidate = summary ? `${summary} ${sentence}` : sentence;
      if (candidate.length > targetChars) {
        break;
      }
      summary = candidate;
    }
    if (summary && summary.length >= Math.min(40, targetChars)) {
      return summary;
    }
  }

  const words = text.split(" ");
  while (words.length > 5 && words.join(" ").length > targetChars) {
    words.pop();
  }
  return normalizeText(words.join(" "));
}

function optimizeTextForSlot(
  value: string,
  slot: SlotSize,
  config: TypographyConfig,
  fallbackText: string
): { text: string; font: number; lines: number; compacted: boolean } {
  let candidate = normalizeText(value || fallbackText);
  if (!candidate) {
    candidate = fallbackText;
  }

  let compacted = false;
  const horizontalSafety = resolveHorizontalSafety(config);
  const glyphFactor = resolveGlyphFactor(config);
  const minCapacity = Math.max(
    24,
    Math.floor((slot.width * horizontalSafety) / Math.max(1, config.min * glyphFactor) * config.maxLines * 0.92)
  );

  const directFit = findBestFontForSlot(candidate, slot, config);
  if (directFit.fits) {
    return { text: candidate, font: directFit.font, lines: directFit.lines, compacted };
  }

  const shouldCompactAsLastResort = candidate.length > Math.max(config.maxChars * 2, minCapacity * 1.6);
  if (!shouldCompactAsLastResort) {
    const fallback = findBestFontForSlot(candidate, slot, config);
    return { text: candidate, font: fallback.font, lines: fallback.lines, compacted };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fit = findBestFontForSlot(candidate, slot, config);
    if (fit.fits) {
      return { text: candidate, font: fit.font, lines: fit.lines, compacted };
    }

    const targetChars = Math.max(24, Math.min(config.maxChars, minCapacity - attempt * 10));
    const next = compactText(candidate, targetChars);
    if (next === candidate) {
      return { text: candidate, font: fit.font, lines: fit.lines, compacted };
    }
    candidate = next;
    compacted = true;
  }

  const fallback = findBestFontForSlot(candidate, slot, config);
  return { text: candidate, font: fallback.font, lines: fallback.lines, compacted };
}

export function clampText(value: string, maxChars: number): string {
  if (!value) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}...`;
}

export function getScienceCardComputed(
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides,
  templateConfig: Stage3TemplateConfig = SCIENCE_CARD
): {
  top: string;
  bottom: string;
  topFont: number;
  bottomFont: number;
  topLineHeight: number;
  bottomLineHeight: number;
  topLines: number;
  bottomLines: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  videoHeight: number;
  bottomMetaHeight: number;
  bottomBodyHeight: number;
  topBlockHeight: number;
  bottomBlockHeight: number;
  videoY: number;
  videoX: number;
  videoWidth: number;
} {
  const topScale = normalizeFontScale(fontOverrides?.topFontScale);
  const bottomScale = normalizeFontScale(fontOverrides?.bottomFontScale);
  const topTypography = {
    ...templateConfig.typography.top,
    maxLines: resolveScaledMaxLines(templateConfig.typography.top.maxLines, topScale, "top")
  };
  const bottomTypography = {
    ...templateConfig.typography.bottom,
    maxLines: resolveScaledMaxLines(templateConfig.typography.bottom.maxLines, bottomScale, "bottom")
  };
  const topPaddingTop = getTopPaddingTop(templateConfig);
  const topPaddingBottom = getTopPaddingBottom(templateConfig);
  const topBlockHeight = templateConfig.slot.topHeight;
  const bottomBlockHeight = templateConfig.slot.bottomHeight;
  const bottomMetaHeight = templateConfig.slot.bottomMetaHeight;
  const sectionBorderLosses = getSectionBorderLosses(templateConfig);
  const bottomBodyHeight = Math.max(80, bottomBlockHeight - sectionBorderLosses.bottomHeight - bottomMetaHeight);

  const topSlot: SlotSize = {
    width: templateConfig.card.width - sectionBorderLosses.topWidth - templateConfig.slot.topPaddingX * 2,
    height: topBlockHeight - sectionBorderLosses.topHeight - topPaddingTop - topPaddingBottom
  };
  const bottomTextPaddingTop = getBottomTextPaddingTop(templateConfig);
  const bottomTextPaddingBottom = getBottomTextPaddingBottom(templateConfig);
  const bottomTextPaddingLeft = getBottomTextPaddingLeft(templateConfig);
  const bottomTextPaddingRight = getBottomTextPaddingRight(templateConfig);
  const bottomSlot: SlotSize = {
    width: templateConfig.card.width - sectionBorderLosses.bottomWidth - bottomTextPaddingLeft - bottomTextPaddingRight,
    height: bottomBodyHeight - bottomTextPaddingTop - bottomTextPaddingBottom
  };

  const topFit = optimizeTextForSlot(topText, topSlot, topTypography, "Top text");
  const topSized = applyFontScaleWithSafety({
    text: topFit.text,
    baseFont: topFit.font,
    slot: topSlot,
    config: topTypography,
    scale: topScale
  });
  const bottomFit = optimizeTextForSlot(
    bottomText,
    bottomSlot,
    bottomTypography,
    "Bottom text"
  );
  const bottomSized = applyFontScaleWithSafety({
    text: bottomFit.text,
    baseFont: bottomFit.font,
    slot: bottomSlot,
    config: bottomTypography,
    scale: bottomScale
  });
  const videoHeight = templateConfig.card.height - topBlockHeight - bottomBlockHeight;

  return {
    top: topFit.text,
    bottom: bottomFit.text,
    topFont: topSized.font,
    bottomFont: bottomSized.font,
    topLineHeight: topSized.lineHeight,
    bottomLineHeight: bottomSized.lineHeight,
    topLines: topSized.lines,
    bottomLines: bottomSized.lines,
    topCompacted: topFit.compacted,
    bottomCompacted: bottomFit.compacted,
    videoHeight,
    bottomMetaHeight,
    bottomBodyHeight,
    topBlockHeight,
    bottomBlockHeight,
    videoY: templateConfig.card.y + topBlockHeight,
    videoX: templateConfig.card.x,
    videoWidth: templateConfig.card.width
  };
}

export function getTurboFaceComputed(
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides
): {
  top: string;
  bottom: string;
  topFont: number;
  bottomFont: number;
  topLineHeight: number;
  bottomLineHeight: number;
  topLines: number;
  bottomLines: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  videoHeight: number;
  bottomMetaHeight: number;
  bottomBodyHeight: number;
  topBlockHeight: number;
  bottomBlockHeight: number;
  videoY: number;
  videoX: number;
  videoWidth: number;
} {
  return getScienceCardComputed(topText, bottomText, fontOverrides, TURBO_FACE_COMPAT);
}

export function getTemplateComputed(
  templateId: string,
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides
): ReturnType<typeof getScienceCardComputed> {
  if (templateId === SCIENCE_CARD_V2_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_V2);
  }
  if (templateId === SCIENCE_CARD_V3_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_V3);
  }
  if (templateId === SCIENCE_CARD_V4_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_V4);
  }
  if (templateId === SCIENCE_CARD_V5_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_V5);
  }
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return getTurboFaceComputed(topText, bottomText, fontOverrides);
  }
  return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD);
}

export function getTemplateById(templateId: string): Stage3TemplateConfig {
  if (templateId === SCIENCE_CARD_V2_TEMPLATE_ID) {
    return SCIENCE_CARD_V2;
  }
  if (templateId === SCIENCE_CARD_V3_TEMPLATE_ID) {
    return SCIENCE_CARD_V3;
  }
  if (templateId === SCIENCE_CARD_V4_TEMPLATE_ID) {
    return SCIENCE_CARD_V4;
  }
  if (templateId === SCIENCE_CARD_V5_TEMPLATE_ID) {
    return SCIENCE_CARD_V5;
  }
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return TURBO_FACE_COMPAT;
  }
  return SCIENCE_CARD;
}

export function templateUsesBuiltInBackdrop(templateId: string | null | undefined): boolean {
  return templateId === SCIENCE_CARD_V2_TEMPLATE_ID;
}
