export const STAGE2_STYLE_PROFILE_VERSION = 1;
export const STAGE2_STYLE_DISCOVERY_TARGET_COUNT = 20;
export const STAGE2_STYLE_MIN_REFERENCE_LINKS = 10;
export const STAGE2_EDITORIAL_MEMORY_WINDOW = 30;
export const STAGE2_EDITORIAL_EXPLORATION_SHARE = 0.25;

export type Stage2StyleLevel = "low" | "medium" | "high";
export type Stage2ExplorationMode = "aligned" | "exploratory";
export type Stage2StyleFitBand = "core" | "adjacent" | "exploratory";
export type Stage2BootstrapConfidenceLevel = "low" | "medium" | "high";

export type Stage2StyleAxisVector = {
  humor: number;
  sarcasm: number;
  warmth: number;
  insiderDensity: number;
  intensity: number;
  explanationDensity: number;
  quoteDensity: number;
  topCompression: number;
};

export type Stage2StyleReferenceLink = {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  description: string;
  transcriptExcerpt: string;
  commentHighlights: string[];
  totalCommentCount: number;
  selectedCommentCount: number;
  audienceSignalSummary: string;
  frameMoments: string[];
  framesUsed: boolean;
  sourceHint: string;
};

export type Stage2StyleAudiencePortrait = {
  summary: string;
  rewards: string[];
  jokes: string[];
  pushback: string[];
  suspicion: string[];
  languageCues: string[];
  dominantPosture: string;
  tonePreferences: string[];
  rejects: string[];
};

export type Stage2StylePackagingPortrait = {
  summary: string;
  momentPatterns: string[];
  visualTriggers: string[];
  topMechanics: string[];
  bottomMechanics: string[];
  framingModes: string[];
};

export type Stage2StyleBootstrapDiagnostics = {
  confidence: Stage2BootstrapConfidenceLevel;
  summary: string;
  totalReferences: number;
  usableReferences: number;
  referencesWithTranscript: number;
  referencesWithComments: number;
  referencesWithFrames: number;
  imagesUsed: boolean;
  hiddenCandidatePoolSize: number;
  surfacedCandidateCount: number;
  promptVersion: string;
  model: string | null;
  reasoningEffort: string | null;
  commentCoverageSummary: string;
  extractionSummary: string;
  evidenceNotes: string[];
};

export type Stage2StyleDirection = {
  id: string;
  fitBand: Stage2StyleFitBand;
  name: string;
  description: string;
  voice: string;
  topPattern: string;
  bottomPattern: string;
  humorLevel: Stage2StyleLevel;
  sarcasmLevel: Stage2StyleLevel;
  warmthLevel: Stage2StyleLevel;
  insiderDensityLevel: Stage2StyleLevel;
  bestFor: string;
  avoids: string;
  microExample: string;
  sourceReferenceIds: string[];
  internalPromptNotes: string;
  axes: Stage2StyleAxisVector;
};

export type Stage2StyleProfile = {
  version: 1;
  createdAt: string | null;
  updatedAt: string | null;
  onboardingCompletedAt: string | null;
  discoveryPromptVersion: string;
  referenceInfluenceSummary: string;
  audiencePortrait: Stage2StyleAudiencePortrait | null;
  packagingPortrait: Stage2StylePackagingPortrait | null;
  bootstrapDiagnostics: Stage2StyleBootstrapDiagnostics | null;
  explorationShare: number;
  referenceLinks: Stage2StyleReferenceLink[];
  candidateDirections: Stage2StyleDirection[];
  selectedDirectionIds: string[];
};

export type ChannelEditorialFeedbackKind =
  | "more_like_this"
  | "less_like_this"
  | "selected_option";

export type ChannelEditorialFeedbackScope = "option" | "top" | "bottom";

export type ChannelEditorialFeedbackNoteMode =
  | "soft_preference"
  | "hard_rule"
  | "situational_note";

export type ChannelEditorialFeedbackOptionSnapshot = {
  candidateId: string;
  optionNumber: number | null;
  top: string;
  bottom: string;
  angle: string;
  styleDirectionIds: string[];
  explorationMode: Stage2ExplorationMode;
};

export type ChannelEditorialFeedbackEvent = {
  id: string;
  workspaceId: string;
  channelId: string;
  userId: string | null;
  chatId: string | null;
  stage2RunId: string | null;
  kind: ChannelEditorialFeedbackKind;
  scope: ChannelEditorialFeedbackScope;
  noteMode: ChannelEditorialFeedbackNoteMode;
  note: string | null;
  optionSnapshot: ChannelEditorialFeedbackOptionSnapshot | null;
  createdAt: string;
};

export type Stage2EditorialMemoryScore = {
  id: string;
  label: string;
  score: number;
};

export type Stage2EditorialMemorySummary = {
  version: 1;
  windowSize: number;
  recentFeedbackCount: number;
  recentSelectionCount: number;
  activeHardRuleCount: number;
  explorationShare: number;
  directionScores: Stage2EditorialMemoryScore[];
  angleScores: Stage2EditorialMemoryScore[];
  preferredTextCues: string[];
  discouragedTextCues: string[];
  hardRuleNotes: string[];
  recentNotes: string[];
  normalizedAxes: Stage2StyleAxisVector;
  promptSummary: string;
};

export const EMPTY_STAGE2_STYLE_AXES: Stage2StyleAxisVector = {
  humor: 0.5,
  sarcasm: 0.5,
  warmth: 0.5,
  insiderDensity: 0.5,
  intensity: 0.5,
  explanationDensity: 0.5,
  quoteDensity: 0.5,
  topCompression: 0.5
};

export const DEFAULT_STAGE2_STYLE_PROFILE: Stage2StyleProfile = {
  version: 1,
  createdAt: null,
  updatedAt: null,
  onboardingCompletedAt: null,
  discoveryPromptVersion: "unconfigured",
  referenceInfluenceSummary: "",
  audiencePortrait: null,
  packagingPortrait: null,
  bootstrapDiagnostics: null,
  explorationShare: STAGE2_EDITORIAL_EXPLORATION_SHARE,
  referenceLinks: [],
  candidateDirections: [],
  selectedDirectionIds: []
};

function sanitizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const trimmed = sanitizeString(value);
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

function parseStyleLevel(value: unknown, fallback: Stage2StyleLevel = "medium"): Stage2StyleLevel {
  const normalized = sanitizeString(value).toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return fallback;
}

function parseStyleFitBand(value: unknown, fallback: Stage2StyleFitBand = "core"): Stage2StyleFitBand {
  const normalized = sanitizeString(value).toLowerCase();
  if (normalized === "core" || normalized === "adjacent" || normalized === "exploratory") {
    return normalized;
  }
  return fallback;
}

function parseBootstrapConfidenceLevel(
  value: unknown,
  fallback: Stage2BootstrapConfidenceLevel = "medium"
): Stage2BootstrapConfidenceLevel {
  const normalized = sanitizeString(value).toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return fallback;
}

function parseAxisValue(value: unknown, fallback = 0.5): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : fallback;
}

function summarizeLevel(level: Stage2StyleLevel): number {
  if (level === "low") {
    return 0.2;
  }
  if (level === "high") {
    return 0.8;
  }
  return 0.5;
}

function normalizeStage2StyleAxes(input: unknown): Stage2StyleAxisVector {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  const humorLevel = parseStyleLevel(candidate?.humorLevel);
  const sarcasmLevel = parseStyleLevel(candidate?.sarcasmLevel);
  const warmthLevel = parseStyleLevel(candidate?.warmthLevel);
  const insiderDensityLevel = parseStyleLevel(candidate?.insiderDensityLevel);
  return {
    humor: parseAxisValue(candidate?.humor, summarizeLevel(humorLevel)),
    sarcasm: parseAxisValue(candidate?.sarcasm, summarizeLevel(sarcasmLevel)),
    warmth: parseAxisValue(candidate?.warmth, summarizeLevel(warmthLevel)),
    insiderDensity: parseAxisValue(
      candidate?.insiderDensity,
      summarizeLevel(insiderDensityLevel)
    ),
    intensity: parseAxisValue(candidate?.intensity, 0.55),
    explanationDensity: parseAxisValue(candidate?.explanationDensity, 0.45),
    quoteDensity: parseAxisValue(candidate?.quoteDensity, 0.35),
    topCompression: parseAxisValue(candidate?.topCompression, 0.65)
  };
}

function createStage2StyleDirectionId(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || `style_direction_${index + 1}`;
}

export function normalizeStage2StyleReferenceLink(
  input: unknown,
  index: number
): Stage2StyleReferenceLink | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }

  const url = sanitizeString(candidate.url);
  const normalizedUrl = sanitizeString(candidate.normalizedUrl) || url;
  if (!url || !normalizedUrl) {
    return null;
  }

  return {
    id: sanitizeString(candidate.id) || `reference_${index + 1}`,
    url,
    normalizedUrl,
    title: sanitizeString(candidate.title) || `Референс ${index + 1}`,
    description: sanitizeString(candidate.description),
    transcriptExcerpt: sanitizeString(candidate.transcriptExcerpt),
    commentHighlights: dedupeStrings(
      Array.isArray(candidate.commentHighlights) ? (candidate.commentHighlights as string[]) : []
    ).slice(0, 6),
    totalCommentCount: Math.max(0, Math.floor(Number(candidate.totalCommentCount) || 0)),
    selectedCommentCount: Math.max(0, Math.floor(Number(candidate.selectedCommentCount) || 0)),
    audienceSignalSummary: sanitizeString(candidate.audienceSignalSummary),
    frameMoments: dedupeStrings(
      Array.isArray(candidate.frameMoments) ? (candidate.frameMoments as string[]) : []
    ).slice(0, 3),
    framesUsed: candidate.framesUsed === true,
    sourceHint: sanitizeString(candidate.sourceHint)
  };
}

function normalizeStage2StyleAudiencePortrait(
  input: unknown
): Stage2StyleAudiencePortrait | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }
  const summary = sanitizeString(candidate.summary);
  const dominantPosture = sanitizeString(candidate.dominantPosture);
  if (!summary && !dominantPosture) {
    return null;
  }
  return {
    summary,
    rewards: dedupeStrings(Array.isArray(candidate.rewards) ? (candidate.rewards as string[]) : []).slice(0, 6),
    jokes: dedupeStrings(Array.isArray(candidate.jokes) ? (candidate.jokes as string[]) : []).slice(0, 6),
    pushback: dedupeStrings(Array.isArray(candidate.pushback) ? (candidate.pushback as string[]) : []).slice(0, 6),
    suspicion: dedupeStrings(Array.isArray(candidate.suspicion) ? (candidate.suspicion as string[]) : []).slice(0, 6),
    languageCues: dedupeStrings(
      Array.isArray(candidate.languageCues) ? (candidate.languageCues as string[]) : []
    ).slice(0, 8),
    dominantPosture,
    tonePreferences: dedupeStrings(
      Array.isArray(candidate.tonePreferences) ? (candidate.tonePreferences as string[]) : []
    ).slice(0, 6),
    rejects: dedupeStrings(Array.isArray(candidate.rejects) ? (candidate.rejects as string[]) : []).slice(0, 6)
  };
}

function normalizeStage2StylePackagingPortrait(
  input: unknown
): Stage2StylePackagingPortrait | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }
  const summary = sanitizeString(candidate.summary);
  if (!summary) {
    return null;
  }
  return {
    summary,
    momentPatterns: dedupeStrings(
      Array.isArray(candidate.momentPatterns) ? (candidate.momentPatterns as string[]) : []
    ).slice(0, 6),
    visualTriggers: dedupeStrings(
      Array.isArray(candidate.visualTriggers) ? (candidate.visualTriggers as string[]) : []
    ).slice(0, 6),
    topMechanics: dedupeStrings(
      Array.isArray(candidate.topMechanics) ? (candidate.topMechanics as string[]) : []
    ).slice(0, 6),
    bottomMechanics: dedupeStrings(
      Array.isArray(candidate.bottomMechanics) ? (candidate.bottomMechanics as string[]) : []
    ).slice(0, 6),
    framingModes: dedupeStrings(
      Array.isArray(candidate.framingModes) ? (candidate.framingModes as string[]) : []
    ).slice(0, 6)
  };
}

function normalizeStage2StyleBootstrapDiagnostics(
  input: unknown,
  fallbackPromptVersion: string
): Stage2StyleBootstrapDiagnostics | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }
  const summary = sanitizeString(candidate.summary);
  const extractionSummary = sanitizeString(candidate.extractionSummary);
  const commentCoverageSummary = sanitizeString(candidate.commentCoverageSummary);
  const totalReferences = Math.max(0, Math.floor(Number(candidate.totalReferences) || 0));
  if (!summary && !extractionSummary && !commentCoverageSummary && totalReferences === 0) {
    return null;
  }
  return {
    confidence: parseBootstrapConfidenceLevel(candidate.confidence, "medium"),
    summary,
    totalReferences,
    usableReferences: Math.max(0, Math.floor(Number(candidate.usableReferences) || 0)),
    referencesWithTranscript: Math.max(
      0,
      Math.floor(Number(candidate.referencesWithTranscript) || 0)
    ),
    referencesWithComments: Math.max(
      0,
      Math.floor(Number(candidate.referencesWithComments) || 0)
    ),
    referencesWithFrames: Math.max(0, Math.floor(Number(candidate.referencesWithFrames) || 0)),
    imagesUsed: candidate.imagesUsed === true,
    hiddenCandidatePoolSize: Math.max(
      0,
      Math.floor(Number(candidate.hiddenCandidatePoolSize) || 0)
    ),
    surfacedCandidateCount: Math.max(
      0,
      Math.floor(Number(candidate.surfacedCandidateCount) || 0)
    ),
    promptVersion: sanitizeString(candidate.promptVersion) || fallbackPromptVersion,
    model: sanitizeString(candidate.model) || null,
    reasoningEffort: sanitizeString(candidate.reasoningEffort) || null,
    commentCoverageSummary,
    extractionSummary,
    evidenceNotes: dedupeStrings(
      Array.isArray(candidate.evidenceNotes) ? (candidate.evidenceNotes as string[]) : []
    ).slice(0, 8)
  };
}

export function normalizeStage2StyleDirection(
  input: unknown,
  index: number,
  referenceIds: string[]
): Stage2StyleDirection | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }

  const name = sanitizeString(candidate.name) || sanitizeString(candidate.title);
  if (!name) {
    return null;
  }

  const humorLevel = parseStyleLevel(candidate.humorLevel);
  const sarcasmLevel = parseStyleLevel(candidate.sarcasmLevel);
  const warmthLevel = parseStyleLevel(candidate.warmthLevel);
  const insiderDensityLevel = parseStyleLevel(candidate.insiderDensityLevel);
  const sourceReferenceIds = dedupeStrings(
    Array.isArray(candidate.sourceReferenceIds)
      ? (candidate.sourceReferenceIds as string[])
      : Array.isArray(candidate.source_reference_ids)
        ? (candidate.source_reference_ids as string[])
        : []
  ).filter((value) => referenceIds.includes(value));

  const fitBand = parseStyleFitBand(
    candidate.fitBand ?? candidate.fit_band,
    sourceReferenceIds.length === 0 ? "exploratory" : "core"
  );

  return {
    id: sanitizeString(candidate.id) || createStage2StyleDirectionId(name, index),
    fitBand,
    name,
    description:
      sanitizeString(candidate.description) ||
      sanitizeString(candidate.summary) ||
      `${name} помогает держать стиль живым, конкретным и привязанным к самому клипу.`,
    voice: sanitizeString(candidate.voice) || "Наблюдательный, живой и завязанный на сам клип.",
    topPattern:
      sanitizeString(candidate.topPattern) ||
      sanitizeString(candidate.top_play) ||
      "Начинаем с самого ясного повода, почему этот клип цепляет.",
    bottomPattern:
      sanitizeString(candidate.bottomPattern) ||
      sanitizeString(candidate.bottom_play) ||
      "Заканчиваем человеческой реакцией, а не сухим пересказом.",
    humorLevel,
    sarcasmLevel,
    warmthLevel,
    insiderDensityLevel,
    bestFor:
      sanitizeString(candidate.bestFor) ||
      sanitizeString(candidate.best_for) ||
      "Клипы, которым нужен ясный редакторский угол.",
    avoids:
      sanitizeString(candidate.avoids) ||
      "Общие слова, плоскую реакцию и безликие AI-формулировки.",
    microExample:
      sanitizeString(candidate.microExample) ||
      sanitizeString(candidate.micro_example),
    sourceReferenceIds,
    internalPromptNotes:
      sanitizeString(candidate.internalPromptNotes) ||
      sanitizeString(candidate.internal_prompt_notes) ||
      sanitizeString(candidate.promptNote) ||
      sanitizeString(candidate.prompt_note) ||
      "Use this lane as guidance, not as a rigid template.",
    axes: normalizeStage2StyleAxes({
      ...candidate,
      humorLevel,
      sarcasmLevel,
      warmthLevel,
      insiderDensityLevel
    })
  };
}

export function normalizeStage2StyleProfile(input: unknown): Stage2StyleProfile {
  const candidate =
    input && typeof input === "object" ? (input as Partial<Stage2StyleProfile>) : undefined;
  const referenceLinks = (Array.isArray(candidate?.referenceLinks) ? candidate.referenceLinks : [])
    .map((reference, index) => normalizeStage2StyleReferenceLink(reference, index))
    .filter((reference): reference is Stage2StyleReferenceLink => reference !== null);
  const referenceIds = referenceLinks.map((reference) => reference.id);
  const candidateDirections = (
    Array.isArray(candidate?.candidateDirections) ? candidate.candidateDirections : []
  )
    .map((direction, index) => normalizeStage2StyleDirection(direction, index, referenceIds))
    .filter((direction): direction is Stage2StyleDirection => direction !== null);
  const selectedDirectionIds = dedupeStrings(
    Array.isArray(candidate?.selectedDirectionIds) ? candidate.selectedDirectionIds : []
  ).filter((id) => candidateDirections.some((direction) => direction.id === id));

  return {
    version: 1,
    createdAt: sanitizeString(candidate?.createdAt) || null,
    updatedAt: sanitizeString(candidate?.updatedAt) || null,
    onboardingCompletedAt: sanitizeString(candidate?.onboardingCompletedAt) || null,
    discoveryPromptVersion:
      sanitizeString(candidate?.discoveryPromptVersion) || DEFAULT_STAGE2_STYLE_PROFILE.discoveryPromptVersion,
    referenceInfluenceSummary: sanitizeString(candidate?.referenceInfluenceSummary),
    audiencePortrait: normalizeStage2StyleAudiencePortrait(candidate?.audiencePortrait),
    packagingPortrait: normalizeStage2StylePackagingPortrait(candidate?.packagingPortrait),
    bootstrapDiagnostics: normalizeStage2StyleBootstrapDiagnostics(
      candidate?.bootstrapDiagnostics,
      sanitizeString(candidate?.discoveryPromptVersion) ||
        DEFAULT_STAGE2_STYLE_PROFILE.discoveryPromptVersion
    ),
    explorationShare: parseAxisValue(
      candidate?.explorationShare,
      STAGE2_EDITORIAL_EXPLORATION_SHARE
    ),
    referenceLinks,
    candidateDirections,
    selectedDirectionIds
  };
}

export function parseStage2StyleProfileJson(raw: string | null | undefined): Stage2StyleProfile {
  const trimmed = sanitizeString(raw);
  if (!trimmed) {
    return DEFAULT_STAGE2_STYLE_PROFILE;
  }
  try {
    return normalizeStage2StyleProfile(JSON.parse(trimmed));
  } catch {
    return DEFAULT_STAGE2_STYLE_PROFILE;
  }
}

export function stringifyStage2StyleProfile(profile: Stage2StyleProfile): string {
  return JSON.stringify(normalizeStage2StyleProfile(profile));
}

export function getSelectedStage2StyleDirections(
  profile: Stage2StyleProfile
): Stage2StyleDirection[] {
  const normalized = normalizeStage2StyleProfile(profile);
  const selectedIds = new Set(normalized.selectedDirectionIds);
  return normalized.candidateDirections.filter((direction) => selectedIds.has(direction.id));
}

export function createEmptyStage2EditorialMemorySummary(
  profile?: Stage2StyleProfile | null
): Stage2EditorialMemorySummary {
  const normalizedProfile = profile ? normalizeStage2StyleProfile(profile) : DEFAULT_STAGE2_STYLE_PROFILE;
  const selectedDirections = getSelectedStage2StyleDirections(normalizedProfile);
  const selectedDirectionSummary = summarizeDirectionNames(selectedDirections);
  const defaultSummary =
    selectedDirections.length > 0
      ? `Bootstrap style prior: ${selectedDirectionSummary}. Keep roughly ${Math.round(
          normalizedProfile.explorationShare * 100
        )}% exploratory room.`
      : `No channel style prior yet. Keep roughly ${Math.round(
          normalizedProfile.explorationShare * 100
        )}% exploratory room while the channel learns.`;

  return {
    version: 1,
    windowSize: STAGE2_EDITORIAL_MEMORY_WINDOW,
    recentFeedbackCount: 0,
    recentSelectionCount: 0,
    activeHardRuleCount: 0,
    explorationShare: normalizedProfile.explorationShare,
    directionScores: selectedDirections.map((direction) => ({
      id: direction.id,
      label: direction.name,
      score: 0.35
    })),
    angleScores: [],
    preferredTextCues: [],
    discouragedTextCues: [],
    hardRuleNotes: [],
    recentNotes: [],
    normalizedAxes: selectedDirections.length > 0
      ? averageAxes(selectedDirections.map((direction) => direction.axes))
      : { ...EMPTY_STAGE2_STYLE_AXES },
    promptSummary: defaultSummary
  };
}

function normalizeFeedbackKind(value: unknown): ChannelEditorialFeedbackKind {
  const normalized = sanitizeString(value).toLowerCase();
  if (
    normalized === "more_like_this" ||
    normalized === "less_like_this" ||
    normalized === "selected_option"
  ) {
    return normalized;
  }
  return "more_like_this";
}

function normalizeFeedbackScope(value: unknown): ChannelEditorialFeedbackScope {
  const normalized = sanitizeString(value).toLowerCase();
  if (normalized === "top" || normalized === "bottom") {
    return normalized;
  }
  return "option";
}

function normalizeFeedbackNoteMode(value: unknown): ChannelEditorialFeedbackNoteMode {
  const normalized = sanitizeString(value).toLowerCase();
  if (normalized === "hard_rule" || normalized === "situational_note") {
    return normalized;
  }
  return "soft_preference";
}

export function normalizeChannelEditorialFeedbackOptionSnapshot(
  input: unknown
): ChannelEditorialFeedbackOptionSnapshot | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }
  const candidateId = sanitizeString(candidate.candidateId);
  const optionNumberRaw = Number(candidate.optionNumber);
  const top = sanitizeString(candidate.top);
  const bottom = sanitizeString(candidate.bottom);
  if (!candidateId || (!top && !bottom)) {
    return null;
  }
  const explorationMode = sanitizeString(candidate.explorationMode) === "exploratory"
    ? "exploratory"
    : "aligned";
  return {
    candidateId,
    optionNumber:
      Number.isFinite(optionNumberRaw) && optionNumberRaw > 0
        ? Math.floor(optionNumberRaw)
        : null,
    top,
    bottom,
    angle: sanitizeString(candidate.angle),
    styleDirectionIds: dedupeStrings(
      Array.isArray(candidate.styleDirectionIds) ? (candidate.styleDirectionIds as string[]) : []
    ),
    explorationMode
  };
}

export function normalizeChannelEditorialFeedbackEvent(
  input: unknown
): ChannelEditorialFeedbackEvent | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }
  const id = sanitizeString(candidate.id);
  const workspaceId = sanitizeString(candidate.workspaceId);
  const channelId = sanitizeString(candidate.channelId);
  const createdAt = sanitizeString(candidate.createdAt);
  if (!id || !workspaceId || !channelId || !createdAt) {
    return null;
  }
  return {
    id,
    workspaceId,
    channelId,
    userId: sanitizeString(candidate.userId) || null,
    chatId: sanitizeString(candidate.chatId) || null,
    stage2RunId: sanitizeString(candidate.stage2RunId) || null,
    kind: normalizeFeedbackKind(candidate.kind),
    scope: normalizeFeedbackScope(candidate.scope),
    noteMode: normalizeFeedbackNoteMode(candidate.noteMode),
    note: sanitizeString(candidate.note) || null,
    optionSnapshot: normalizeChannelEditorialFeedbackOptionSnapshot(candidate.optionSnapshot),
    createdAt
  };
}

function getFeedbackModeWeight(noteMode: ChannelEditorialFeedbackNoteMode): number {
  if (noteMode === "hard_rule") {
    return 1.35;
  }
  if (noteMode === "situational_note") {
    return 0.72;
  }
  return 1;
}

function averageAxes(axesList: Stage2StyleAxisVector[]): Stage2StyleAxisVector {
  if (axesList.length === 0) {
    return { ...EMPTY_STAGE2_STYLE_AXES };
  }
  const totals = axesList.reduce(
    (acc, item) => ({
      humor: acc.humor + item.humor,
      sarcasm: acc.sarcasm + item.sarcasm,
      warmth: acc.warmth + item.warmth,
      insiderDensity: acc.insiderDensity + item.insiderDensity,
      intensity: acc.intensity + item.intensity,
      explanationDensity: acc.explanationDensity + item.explanationDensity,
      quoteDensity: acc.quoteDensity + item.quoteDensity,
      topCompression: acc.topCompression + item.topCompression
    }),
    {
      humor: 0,
      sarcasm: 0,
      warmth: 0,
      insiderDensity: 0,
      intensity: 0,
      explanationDensity: 0,
      quoteDensity: 0,
      topCompression: 0
    }
  );
  return {
    humor: Number((totals.humor / axesList.length).toFixed(3)),
    sarcasm: Number((totals.sarcasm / axesList.length).toFixed(3)),
    warmth: Number((totals.warmth / axesList.length).toFixed(3)),
    insiderDensity: Number((totals.insiderDensity / axesList.length).toFixed(3)),
    intensity: Number((totals.intensity / axesList.length).toFixed(3)),
    explanationDensity: Number((totals.explanationDensity / axesList.length).toFixed(3)),
    quoteDensity: Number((totals.quoteDensity / axesList.length).toFixed(3)),
    topCompression: Number((totals.topCompression / axesList.length).toFixed(3))
  };
}

function addWeightedAxes(
  target: Stage2StyleAxisVector,
  source: Stage2StyleAxisVector,
  weight: number
): Stage2StyleAxisVector {
  return {
    humor: target.humor + source.humor * weight,
    sarcasm: target.sarcasm + source.sarcasm * weight,
    warmth: target.warmth + source.warmth * weight,
    insiderDensity: target.insiderDensity + source.insiderDensity * weight,
    intensity: target.intensity + source.intensity * weight,
    explanationDensity: target.explanationDensity + source.explanationDensity * weight,
    quoteDensity: target.quoteDensity + source.quoteDensity * weight,
    topCompression: target.topCompression + source.topCompression * weight
  };
}

function normalizeAccumulatedAxes(
  totals: Stage2StyleAxisVector,
  totalWeight: number
): Stage2StyleAxisVector {
  if (totalWeight <= 0) {
    return { ...EMPTY_STAGE2_STYLE_AXES };
  }
  return {
    humor: Number(clamp(totals.humor / totalWeight, 0, 1).toFixed(3)),
    sarcasm: Number(clamp(totals.sarcasm / totalWeight, 0, 1).toFixed(3)),
    warmth: Number(clamp(totals.warmth / totalWeight, 0, 1).toFixed(3)),
    insiderDensity: Number(clamp(totals.insiderDensity / totalWeight, 0, 1).toFixed(3)),
    intensity: Number(clamp(totals.intensity / totalWeight, 0, 1).toFixed(3)),
    explanationDensity: Number(clamp(totals.explanationDensity / totalWeight, 0, 1).toFixed(3)),
    quoteDensity: Number(clamp(totals.quoteDensity / totalWeight, 0, 1).toFixed(3)),
    topCompression: Number(clamp(totals.topCompression / totalWeight, 0, 1).toFixed(3))
  };
}

function extractTextCue(text: string): string {
  return sanitizeString(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?]["']?)\s+/)[0]
    .split(/[,:;]/)[0]
    .trim()
    .split(/\s+/)
    .slice(0, 10)
    .join(" ");
}

function scoreMapToList(scores: Map<string, { label: string; score: number }>): Stage2EditorialMemoryScore[] {
  return Array.from(scores.entries())
    .map(([id, value]) => ({
      id,
      label: value.label,
      score: Number(value.score.toFixed(3))
    }))
    .sort((left, right) => right.score - left.score);
}

function summarizeDirectionNames(
  directions: Array<Pick<Stage2StyleDirection, "name">>,
  maxVisible = 6
): string {
  const names = directions.map((direction) => sanitizeString(direction.name)).filter(Boolean);
  if (names.length === 0) {
    return "none yet";
  }
  if (names.length <= maxVisible) {
    return names.join(", ");
  }
  return `${names.slice(0, maxVisible).join(", ")}, plus ${names.length - maxVisible} more`;
}

function truncatePromptText(value: string, maxLength: number): string {
  const normalized = sanitizeString(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildBootstrapStyleLessons(profile: Stage2StyleProfile) {
  const selectedDirections = getSelectedStage2StyleDirections(profile);
  const topMoves = dedupeStrings(selectedDirections.map((direction) => direction.topPattern)).slice(0, 4);
  const bottomMoves = dedupeStrings(selectedDirections.map((direction) => direction.bottomPattern)).slice(0, 4);
  const toneWins = dedupeStrings(
    selectedDirections.flatMap((direction) => [direction.voice, direction.bestFor])
  ).slice(0, 4);
  const avoidNotes = dedupeStrings(selectedDirections.map((direction) => direction.avoids)).slice(0, 4);
  const audienceSummary = sanitizeString(profile.audiencePortrait?.summary);
  const packagingSummary = sanitizeString(profile.packagingPortrait?.summary);
  const summaryParts = [
    topMoves.length > 0 ? `TOP tends to work when it: ${topMoves.join(" | ")}.` : "",
    bottomMoves.length > 0 ? `BOTTOM tends to work when it: ${bottomMoves.join(" | ")}.` : "",
    toneWins.length > 0 ? `Winning tone cues: ${toneWins.join(" | ")}.` : "",
    avoidNotes.length > 0 ? `Avoid drifting into: ${avoidNotes.join(" | ")}.` : "",
    audienceSummary ? `Bootstrap audience portrait: ${audienceSummary}` : "",
    packagingSummary ? `Bootstrap packaging portrait: ${packagingSummary}` : ""
  ].filter(Boolean);

  return {
    topMoves,
    bottomMoves,
    toneWins,
    avoidNotes,
    audienceSummary,
    packagingSummary,
    summary:
      summaryParts.join(" ") ||
      `No distilled bootstrap lessons yet. Stay clip-truthful and let the channel learn through live feedback.`
  };
}

function getPromptDirectionWeight(direction: Pick<Stage2StyleDirection, "fitBand">): number {
  if (direction.fitBand === "core") {
    return 1;
  }
  if (direction.fitBand === "adjacent") {
    return 0.72;
  }
  return 0.45;
}

function buildPromptDirectionHighlights(
  profile: Stage2StyleProfile,
  detail: "minimal" | "compact"
): {
  totalSelected: number;
  fitBandCounts: Record<Stage2StyleFitBand, number>;
  selectionSummary: string;
  highlights: Array<{
    id: string;
    name: string;
    fitBand: Stage2StyleFitBand;
    weight: number;
    cue: string;
  }>;
} {
  const selectedDirections = getSelectedStage2StyleDirections(profile);
  const fitBandCounts = selectedDirections.reduce<Record<Stage2StyleFitBand, number>>(
    (accumulator, direction) => {
      accumulator[direction.fitBand] += 1;
      return accumulator;
    },
    {
      core: 0,
      adjacent: 0,
      exploratory: 0
    }
  );
  const weighted = selectedDirections
    .map((direction, index) => ({
      direction,
      weight: Number((getPromptDirectionWeight(direction) - index * 0.0001).toFixed(3))
    }))
    .sort((left, right) => right.weight - left.weight);

  const targetCount = detail === "minimal" ? 4 : 6;
  const selectedIds = new Set<string>();
  const highlights: typeof weighted = [];
  const quotas =
    detail === "minimal"
      ? { core: 2, adjacent: 1, exploratory: 1 }
      : { core: 3, adjacent: 2, exploratory: 1 };

  (["core", "adjacent", "exploratory"] as const).forEach((fitBand) => {
    const fitBandMatches = weighted.filter((entry) => entry.direction.fitBand === fitBand);
    for (const entry of fitBandMatches.slice(0, quotas[fitBand])) {
      if (highlights.length >= targetCount || selectedIds.has(entry.direction.id)) {
        continue;
      }
      highlights.push(entry);
      selectedIds.add(entry.direction.id);
    }
  });

  for (const entry of weighted) {
    if (highlights.length >= targetCount) {
      break;
    }
    if (selectedIds.has(entry.direction.id)) {
      continue;
    }
    highlights.push(entry);
    selectedIds.add(entry.direction.id);
  }

  const compactHighlights = highlights
    .slice(0, detail === "minimal" ? 4 : 5)
    .map(({ direction, weight }) => ({
    id: direction.id,
    name: direction.name,
    fitBand: direction.fitBand,
    weight,
    cue: truncatePromptText(
      `Voice: ${direction.voice} TOP: ${direction.topPattern} BOTTOM: ${direction.bottomPattern} Avoid: ${direction.avoids}`,
      detail === "minimal" ? 180 : 220
    )
    }));

  return {
    totalSelected: selectedDirections.length,
    fitBandCounts,
    selectionSummary:
      selectedDirections.length > 0
        ? `Selected ${selectedDirections.length} directions (${fitBandCounts.core} core, ${fitBandCounts.adjacent} adjacent, ${fitBandCounts.exploratory} exploratory). Runtime uses weighted highlights and lessons instead of treating every selected card as equal prompt guidance.`
        : "No selected style directions yet.",
    highlights: compactHighlights
  };
}

export function normalizeStage2EditorialMemorySummary(
  input: unknown,
  profile?: Stage2StyleProfile | null
): Stage2EditorialMemorySummary {
  const candidate =
    input && typeof input === "object" ? (input as Partial<Stage2EditorialMemorySummary>) : undefined;
  const fallback = createEmptyStage2EditorialMemorySummary(profile);
  return {
    version: 1,
    windowSize: Math.max(
      1,
      Math.floor(Number(candidate?.windowSize) || fallback.windowSize)
    ),
    recentFeedbackCount: Math.max(
      0,
      Math.floor(Number(candidate?.recentFeedbackCount) || fallback.recentFeedbackCount)
    ),
    recentSelectionCount: Math.max(
      0,
      Math.floor(Number(candidate?.recentSelectionCount) || fallback.recentSelectionCount)
    ),
    activeHardRuleCount: Math.max(
      0,
      Math.floor(Number(candidate?.activeHardRuleCount) || fallback.activeHardRuleCount)
    ),
    explorationShare: parseAxisValue(candidate?.explorationShare, fallback.explorationShare),
    directionScores: Array.isArray(candidate?.directionScores)
      ? (candidate.directionScores as Stage2EditorialMemoryScore[])
          .map((score) => ({
            id: sanitizeString(score.id),
            label: sanitizeString(score.label),
            score: Number.isFinite(Number(score.score)) ? Number(score.score) : 0
          }))
          .filter((score) => score.id && score.label)
      : fallback.directionScores,
    angleScores: Array.isArray(candidate?.angleScores)
      ? (candidate.angleScores as Stage2EditorialMemoryScore[])
          .map((score) => ({
            id: sanitizeString(score.id),
            label: sanitizeString(score.label),
            score: Number.isFinite(Number(score.score)) ? Number(score.score) : 0
          }))
          .filter((score) => score.id && score.label)
      : fallback.angleScores,
    preferredTextCues: dedupeStrings(
      Array.isArray(candidate?.preferredTextCues) ? candidate.preferredTextCues : []
    ).slice(0, 6),
    discouragedTextCues: dedupeStrings(
      Array.isArray(candidate?.discouragedTextCues) ? candidate.discouragedTextCues : []
    ).slice(0, 6),
    hardRuleNotes: dedupeStrings(
      Array.isArray(candidate?.hardRuleNotes) ? candidate.hardRuleNotes : []
    ).slice(0, 6),
    recentNotes: dedupeStrings(
      Array.isArray(candidate?.recentNotes) ? candidate.recentNotes : []
    ).slice(0, 6),
    normalizedAxes: candidate?.normalizedAxes
      ? normalizeStage2StyleAxes(candidate.normalizedAxes)
      : fallback.normalizedAxes,
    promptSummary: sanitizeString(candidate?.promptSummary) || fallback.promptSummary
  };
}

export function buildStage2EditorialMemorySummary(input: {
  profile: Stage2StyleProfile | null | undefined;
  feedbackEvents: ChannelEditorialFeedbackEvent[];
  windowSize?: number;
  passiveSelectionWeight?: number;
}): Stage2EditorialMemorySummary {
  const profile = normalizeStage2StyleProfile(input.profile);
  const selectedDirections = getSelectedStage2StyleDirections(profile);
  const directionLookup = new Map(profile.candidateDirections.map((direction) => [direction.id, direction]));
  const directionScores = new Map<string, { label: string; score: number }>();
  const angleScores = new Map<string, { label: string; score: number }>();
  const feedbackDirectionScores = new Map<string, { label: string; score: number }>();
  const feedbackAngleScores = new Map<string, { label: string; score: number }>();
  const preferredCueScores = new Map<string, number>();
  const discouragedCueScores = new Map<string, number>();
  const hardRuleNotes: string[] = [];
  const recentNotes: string[] = [];
  const windowSize = Math.max(1, Math.floor(input.windowSize ?? STAGE2_EDITORIAL_MEMORY_WINDOW));
  const passiveSelectionWeight = Math.max(
    0,
    Number.isFinite(input.passiveSelectionWeight)
      ? Number(input.passiveSelectionWeight)
      : 0.22
  );

  let axisTotals = { ...EMPTY_STAGE2_STYLE_AXES };
  let axisWeight = 0;

  for (const direction of selectedDirections) {
    directionScores.set(direction.id, { label: direction.name, score: 0.35 });
    axisTotals = addWeightedAxes(axisTotals, direction.axes, 0.35);
    axisWeight += 0.35;
  }

  const allRecentEvents = [...input.feedbackEvents]
    .map((event) => normalizeChannelEditorialFeedbackEvent(event))
    .filter((event): event is ChannelEditorialFeedbackEvent => event !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const recentExplicitEvents = allRecentEvents
    .filter(
      (event) =>
        (event.kind === "more_like_this" || event.kind === "less_like_this") &&
        event.noteMode !== "hard_rule"
    )
    .slice(0, windowSize);
  const activeHardRuleEvents = allRecentEvents.filter(
    (event) =>
      (event.kind === "more_like_this" || event.kind === "less_like_this") &&
      event.noteMode === "hard_rule"
  );
  const recentPassiveSelectionEvents = allRecentEvents
    .filter((event) => event.kind === "selected_option")
    .slice(0, 12);

  const applyEventWeight = (
    event: ChannelEditorialFeedbackEvent,
    signedWeight: number
  ) => {
    const option = event.optionSnapshot;
    const scopeWeight =
      event.scope === "option"
        ? 1
        : 0.58;
    const weightedSigned = Number((signedWeight * scopeWeight).toFixed(4));
    const absoluteWeighted = Math.abs(weightedSigned);

    if (event.note && event.noteMode === "hard_rule" && hardRuleNotes.length < 6) {
      hardRuleNotes.push(event.note);
    } else if (event.note && recentNotes.length < 6) {
      recentNotes.push(event.note);
    }

    if (option?.angle && event.scope !== "bottom") {
      const entry = angleScores.get(option.angle) ?? { label: option.angle, score: 0 };
      entry.score += weightedSigned;
      angleScores.set(option.angle, entry);
      if (event.kind !== "selected_option") {
        const feedbackEntry = feedbackAngleScores.get(option.angle) ?? {
          label: option.angle,
          score: 0
        };
        feedbackEntry.score += weightedSigned;
        feedbackAngleScores.set(option.angle, feedbackEntry);
      }
    }

    const cueText = [
      event.scope !== "bottom" ? extractTextCue(option?.top ?? "") : "",
      event.scope !== "top" ? extractTextCue(option?.bottom ?? "") : ""
    ]
      .map((value) => sanitizeString(value))
      .filter(Boolean);
    for (const cue of cueText) {
      const target = weightedSigned >= 0 ? preferredCueScores : discouragedCueScores;
      target.set(cue, (target.get(cue) ?? 0) + absoluteWeighted);
    }

    const matchedDirections =
      option?.styleDirectionIds
        .map((id) => directionLookup.get(id))
        .filter((direction): direction is Stage2StyleDirection => Boolean(direction)) ?? [];

    for (const direction of matchedDirections) {
      const entry = directionScores.get(direction.id) ?? { label: direction.name, score: 0 };
      entry.score += weightedSigned;
      directionScores.set(direction.id, entry);
      if (event.kind !== "selected_option") {
        const feedbackEntry = feedbackDirectionScores.get(direction.id) ?? {
          label: direction.name,
          score: 0
        };
        feedbackEntry.score += weightedSigned;
        feedbackDirectionScores.set(direction.id, feedbackEntry);
      }
      axisTotals = addWeightedAxes(axisTotals, direction.axes, absoluteWeighted);
      axisWeight += absoluteWeighted;
    }
  };

  activeHardRuleEvents.forEach((event) => {
    const kindWeight = event.kind === "less_like_this" ? -1 : 1;
    applyEventWeight(
      event,
      Number((kindWeight * getFeedbackModeWeight(event.noteMode)).toFixed(4))
    );
  });

  recentExplicitEvents.forEach((event, index) => {
    const recencyWeight = 1 - (index / Math.max(windowSize - 1, 1)) * 0.82;
    const kindWeight = event.kind === "less_like_this" ? -1 : 1;
    applyEventWeight(
      event,
      Number((recencyWeight * kindWeight * getFeedbackModeWeight(event.noteMode)).toFixed(4))
    );
  });

  recentPassiveSelectionEvents.forEach((event, index) => {
    const recencyWeight = 1 - (index / Math.max(Math.max(recentPassiveSelectionEvents.length, 1) - 1, 1)) * 0.6;
    applyEventWeight(
      event,
      Number((recencyWeight * passiveSelectionWeight * getFeedbackModeWeight(event.noteMode)).toFixed(4))
    );
  });

  const directionScoreList = scoreMapToList(directionScores);
  const angleScoreList = scoreMapToList(angleScores);
  const feedbackDirectionScoreList = scoreMapToList(feedbackDirectionScores);
  const feedbackAngleScoreList = scoreMapToList(feedbackAngleScores);
  const preferredDirections = feedbackDirectionScoreList
    .filter((entry) => entry.score > 0.12)
    .slice(0, 4)
    .map((entry) => entry.label);
  const avoidedDirections = feedbackDirectionScoreList
    .filter((entry) => entry.score < -0.12)
    .slice(-4)
    .map((entry) => entry.label);
  const preferredAngles = feedbackAngleScoreList
    .filter((entry) => entry.score > 0.12)
    .slice(0, 3)
    .map((entry) => entry.label);
  const discouragedAngles = [...feedbackAngleScoreList]
    .reverse()
    .filter((entry) => entry.score < -0.12)
    .slice(0, 3)
    .map((entry) => entry.label);
  const preferredTextCues = Array.from(preferredCueScores.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([cue]) => cue)
    .slice(0, 5);
  const discouragedTextCues = Array.from(discouragedCueScores.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([cue]) => cue)
    .slice(0, 5);

  const promptSummaryParts = [
    selectedDirections.length > 0
      ? `Bootstrap directions: ${summarizeDirectionNames(selectedDirections)}.`
      : "Bootstrap directions are still light or unset.",
    hardRuleNotes.length > 0
      ? `Active hard rules: ${hardRuleNotes.map((note) => `"${note}"`).join("; ")}.`
      : activeHardRuleEvents.length > 0
        ? `Active hard-rule reactions: ${activeHardRuleEvents.length}.`
      : "",
    recentExplicitEvents.length === 0 && activeHardRuleEvents.length === 0
      ? "No recent explicit editor ratings yet, so the bootstrap prior is still doing the early steering."
      : "",
    recentExplicitEvents.length === 0 && activeHardRuleEvents.length > 0
      ? "No recent rolling ratings beyond the pinned hard rules yet, so those rules are carrying most of the editorial memory."
      : "",
    preferredDirections.length > 0
      ? `Recent positive pull: ${preferredDirections.join(", ")}.`
      : "",
    avoidedDirections.length > 0
      ? `Recent negative pull: ${avoidedDirections.join(", ")}.`
      : "",
    preferredAngles.length > 0
      ? `Preferred editorial lanes lately: ${preferredAngles.join(", ")}.`
      : "",
    discouragedAngles.length > 0
      ? `De-emphasize lanes like: ${discouragedAngles.join(", ")}.`
      : "",
    recentNotes.length > 0
      ? `Recent editor notes: ${recentNotes.map((note) => `"${note}"`).join("; ")}.`
      : "",
    recentPassiveSelectionEvents.length > 0
      ? passiveSelectionWeight > 0.22
        ? `Passive option selections lately: ${recentPassiveSelectionEvents.length}. Treat them as medium-strength same-line signals for this line, but still below explicit likes or dislikes.`
        : `Passive option selections lately: ${recentPassiveSelectionEvents.length}. Treat them as weaker than explicit likes or dislikes.`
      : "",
    `Keep roughly ${Math.round(profile.explorationShare * 100)}% of the option space exploratory so the channel can keep learning.`
  ].filter(Boolean);

  return {
    version: 1,
    windowSize,
    recentFeedbackCount: recentExplicitEvents.length + activeHardRuleEvents.length,
    recentSelectionCount: recentPassiveSelectionEvents.length,
    activeHardRuleCount: activeHardRuleEvents.length,
    explorationShare: profile.explorationShare,
    directionScores: directionScoreList,
    angleScores: angleScoreList,
    preferredTextCues,
    discouragedTextCues,
    hardRuleNotes: dedupeStrings(hardRuleNotes).slice(0, 6),
    recentNotes,
    normalizedAxes: normalizeAccumulatedAxes(axisTotals, axisWeight),
    promptSummary: promptSummaryParts.join(" ")
  };
}

export function buildStage2LearningPromptContext(input: {
  profile: Stage2StyleProfile | null | undefined;
  editorialMemory: Stage2EditorialMemorySummary | null | undefined;
  detail?: "minimal" | "compact";
}) {
  const profile = normalizeStage2StyleProfile(input.profile);
  const editorialMemory = normalizeStage2EditorialMemorySummary(
    input.editorialMemory,
    profile
  );
  const detail = input.detail ?? "compact";
  const bootstrapLessons = buildBootstrapStyleLessons(profile);
  const directionHighlights = buildPromptDirectionHighlights(profile, detail);
  return {
    bootstrap: {
      referenceInfluenceSummary: truncatePromptText(
        profile.referenceInfluenceSummary,
        detail === "minimal" ? 280 : 520
      ),
      audiencePortraitSummary: truncatePromptText(
        profile.audiencePortrait?.summary ?? "",
        detail === "minimal" ? 200 : 320
      ),
      packagingPortraitSummary: truncatePromptText(
        profile.packagingPortrait?.summary ?? "",
        detail === "minimal" ? 200 : 320
      ),
      bootstrapConfidence: profile.bootstrapDiagnostics
        ? {
            level: profile.bootstrapDiagnostics.confidence,
            summary: truncatePromptText(
              profile.bootstrapDiagnostics.summary,
              detail === "minimal" ? 180 : 280
            )
          }
        : null,
      explorationShare: profile.explorationShare,
      selectionSummary: directionHighlights.selectionSummary,
      selectedDirectionCount: directionHighlights.totalSelected,
      selectedFitBandCounts: directionHighlights.fitBandCounts,
      directionHighlights: directionHighlights.highlights,
      lessons:
        detail === "minimal"
          ? {
              summary: truncatePromptText(bootstrapLessons.summary, 420),
              topMoves: bootstrapLessons.topMoves.slice(0, 2),
              bottomMoves: bootstrapLessons.bottomMoves.slice(0, 2),
              audienceSummary: truncatePromptText(bootstrapLessons.audienceSummary, 180),
              packagingSummary: truncatePromptText(bootstrapLessons.packagingSummary, 180)
            }
          : {
              topMoves: bootstrapLessons.topMoves.slice(0, 2),
              bottomMoves: bootstrapLessons.bottomMoves.slice(0, 2),
              toneWins: bootstrapLessons.toneWins.slice(0, 2),
              avoidNotes: bootstrapLessons.avoidNotes.slice(0, 2),
              audienceSummary: truncatePromptText(bootstrapLessons.audienceSummary, 240),
              packagingSummary: truncatePromptText(bootstrapLessons.packagingSummary, 240),
              summary: truncatePromptText(bootstrapLessons.summary, 620)
            }
    },
    editorialMemory: {
      recentFeedbackCount: editorialMemory.recentFeedbackCount,
      recentSelectionCount: editorialMemory.recentSelectionCount,
      activeHardRuleCount: editorialMemory.activeHardRuleCount,
      promptSummary: truncatePromptText(
        editorialMemory.promptSummary,
        detail === "minimal" ? 220 : 360
      ),
      directionScores:
        editorialMemory.recentFeedbackCount > 0
          ? editorialMemory.directionScores.slice(0, detail === "minimal" ? 2 : 4)
          : [],
      angleScores:
        editorialMemory.recentFeedbackCount > 0
          ? editorialMemory.angleScores.slice(0, detail === "minimal" ? 2 : 4)
          : [],
      preferredTextCues: [],
      discouragedTextCues: [],
      hardRuleNotes: editorialMemory.hardRuleNotes.slice(0, detail === "minimal" ? 2 : 4),
      recentNotes: editorialMemory.recentNotes.slice(0, detail === "minimal" ? 2 : 4),
      normalizedAxes:
        detail === "compact"
          ? editorialMemory.normalizedAxes
          : undefined
    }
  };
}
