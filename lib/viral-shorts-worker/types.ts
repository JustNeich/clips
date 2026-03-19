import type {
  Stage2CorpusExample,
  Stage2ExamplesCorpusSource,
  Stage2HardConstraints
} from "../stage2-channel-config";

export type HardConstraints = {
  topLengthMin: number;
  topLengthMax: number;
  bottomLengthMin: number;
  bottomLengthMax: number;
  bottomQuoteRequired: boolean;
  bannedWords: string[];
  bannedOpeners: string[];
};

export type SourceChannelConfig = {
  sourceChannelId: string;
  name: string;
  url: string;
  archetype: string;
  owned?: boolean;
};

export type ViralShortsChannelProfile = {
  channelId: string;
  name: string;
  url: string;
  language: string;
  archetype: string;
  audience: string;
  voiceNotes: string[];
  hardConstraints: HardConstraints;
  competitorSourceIds: string[];
  stableSourceIds: string[];
  hotPoolEnabled: boolean;
  hotPoolLimit: number;
  hotPoolPerSourceLimit: number;
  hotPoolTtlDays: number;
  hotPoolLookbackHours: number;
  latestFetchLimit: number;
  popularFetchLimit: number;
};

export type StableExample = {
  exampleId: string;
  ownerChannelId: string;
  sourceChannelId: string;
  sourceChannelName: string;
  videoId: string;
  archetype: string;
  clipType: string;
  overlayTop: string;
  overlayBottom: string;
  title: string;
  transcript: string;
  whyItWorks: string[];
  isOwnedAnchor: boolean;
  isAntiExample: boolean;
  qualityScore: number;
  sampleKind: string;
  lastRefreshedAt: string;
};

export type HotPoolItem = {
  ownerChannelId: string;
  sourceChannelId: string;
  sourceChannelName: string;
  videoId: string;
  videoUrl: string;
  title: string;
  publishedAt: string | null;
  views: number | null;
  ageHours: number | null;
  anomalyScore: number;
  overlayTop: string;
  overlayBottom: string;
  clipType: string;
  promotedAt: string;
  expiresAt: string;
};

export type SourceVideoRecord = {
  videoId: string;
  sourceChannelId: string;
  sourceChannelName: string;
  videoUrl: string;
  title: string;
  description: string;
  transcript: string;
  overlayTop: string;
  overlayBottom: string;
  overlayFull: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  currentViews: number | null;
  currentLikes: number | null;
  archetype: string;
  clipType: string;
  whyItWorks: string[];
  isOwnedAnchor: boolean;
  isAntiExample: boolean;
  qualityScore: number;
  sampleKind: string;
  lastSeenAt: string;
};

export type VideoSnapshot = {
  videoId: string;
  capturedAt: string;
  views: number | null;
  likes: number | null;
  ageHours: number | null;
  speed: number | null;
};

export type AnalyzerOutput = {
  visualAnchors: string[];
  specificNouns: string[];
  visibleActions: string[];
  subject: string;
  action: string;
  setting: string;
  firstSecondsSignal: string;
  stakes: string[];
  payoff: string;
  coreTrigger: string;
  humanStake: string;
  narrativeFrame: string;
  whyViewerCares: string;
  bestBottomEnergy: string;
  commentVibe: string;
  slangToAdapt: string[];
  extractableSlang: string[];
  hiddenDetail: string;
  genericRisks: string[];
  rawSummary: string;
};

export type RankedAngle = {
  angle: string;
  score: number;
  why: string;
};

export type SelectorOutput = {
  clipType: string;
  primaryAngle: string;
  secondaryAngles: string[];
  rankedAngles: RankedAngle[];
  coreTrigger: string;
  humanStake: string;
  narrativeFrame: string;
  whyViewerCares: string;
  topStrategy: string;
  bottomEnergy: string;
  whyOldV6WouldWorkHere: string;
  failureModes: string[];
  writerBrief: string;
  rationale?: string;
  selectedExampleIds?: string[];
  rejectedExampleIds?: string[];
  selectedExamples?: Stage2CorpusExample[];
  confidence?: number;
  archetype?: string;
  allowedAngles?: string[];
  retrievalFilters?: {
    stable: {
      archetype: string;
      clipType: string;
    };
    hot: {
      ownerChannelId: string;
      clipType: string;
    };
  };
};

export type RetrievalExample = {
  exampleId?: string;
  ownerChannelId?: string;
  sourceChannelId: string;
  sourceChannelName?: string;
  videoId?: string;
  videoUrl?: string;
  archetype: string;
  clipType: string;
  overlayTop: string;
  overlayBottom: string;
  title: string;
  transcript: string;
  whyItWorks?: string[] | string;
  isOwnedAnchor?: boolean | number;
  isAntiExample?: boolean | number;
  qualityScore: number;
  sampleKind?: string;
  publishedAt?: string | null;
  views?: number | null;
  ageHours?: number | null;
  anomalyScore?: number | null;
  promotedAt?: string | null;
  expiresAt?: string | null;
};

export type RetrievalBundle = {
  stableExamples: RetrievalExample[];
  hotExamples: RetrievalExample[];
  antiExamples: RetrievalExample[];
};

export type CandidateCaption = {
  candidateId: string;
  angle: string;
  top: string;
  bottom: string;
  topRu: string;
  bottomRu: string;
  rationale: string;
};

export type CriticScore = {
  candidateId: string;
  scores: Record<string, number>;
  total: number;
  issues: string[];
  keep: boolean;
};

export type FinalSelectorOutput = {
  finalCandidates: string[];
  finalPick: string;
  rationale: string;
};

export type ViralShortsVideoContext = {
  sourceUrl: string;
  title: string;
  description: string;
  transcript: string;
  frameDescriptions: string[];
  comments: Array<{
    author: string;
    likes: number;
    text: string;
  }>;
  userInstruction?: string | null;
};

export type PreparedGenerationContext = {
  channelProfile?: ViralShortsChannelProfile;
  channelConfig?: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  retrievalBundle?: RetrievalBundle;
  availableExamples?: Stage2CorpusExample[];
};

export type Stage2RuntimeChannelConfig = {
  channelId: string;
  name: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  examplesSource: Stage2ExamplesCorpusSource;
};

export type PromptPacket = {
  context: PreparedGenerationContext;
  stageContexts?: {
    selector?: string;
    retrieval?: string;
  };
  prompts: {
    analyzer: string;
    selector: string;
    writer: string;
    critic: string;
    rewriter: string;
    finalSelector: string;
    titles: string;
  };
};

export type Stage2DiagnosticsPromptStage = {
  stageId: string;
  label: string;
  stageType: "llm_prompt";
  defaultPrompt: string;
  configuredPrompt: string;
  reasoningEffort: string | null;
  isCustomPrompt: boolean;
  promptText: string | null;
  promptChars: number | null;
  usesImages: boolean;
  summary: string;
};

export type Stage2DiagnosticsExample = {
  id: string;
  bucket: "available" | "selected";
  channelName: string;
  sourceChannelId: string;
  sourceChannelName: string;
  videoId: string | null;
  title: string;
  clipType: string;
  overlayTop: string;
  overlayBottom: string;
  whyItWorks: string[];
  qualityScore: number | null;
  retrievalScore: number | null;
  retrievalReasons: string[];
  sampleKind: string | null;
  isOwnedAnchor: boolean;
  isAntiExample: boolean;
  publishedAt: string | null;
  views: number | null;
  ageHours: number | null;
  anomalyScore: number | null;
};

export type Stage2Diagnostics = {
  channel: {
    channelId: string;
    name: string;
    username: string;
    examplesSource: Stage2ExamplesCorpusSource;
    hardConstraints: Stage2HardConstraints;
    workspaceCorpusCount: number;
    activeCorpusCount: number;
  };
  selection: {
    clipType: string;
    primaryAngle: string;
    secondaryAngles: string[];
    rankedAngles: RankedAngle[];
    coreTrigger: string;
    humanStake: string;
    narrativeFrame: string;
    whyViewerCares: string;
    topStrategy: string;
    bottomEnergy: string;
    whyOldV6WouldWorkHere: string;
    failureModes: string[];
    writerBrief: string;
    rationale: string | null;
    selectedExampleIds: string[];
  };
  effectivePrompting: {
    promptStages: Stage2DiagnosticsPromptStage[];
  };
  examples: {
    source: Stage2ExamplesCorpusSource;
    workspaceCorpusCount: number;
    activeCorpusCount: number;
    availableExamples: Stage2DiagnosticsExample[];
    selectedExamples: Stage2DiagnosticsExample[];
  };
};

export type ViralShortsStage2Result = {
  inputAnalysis: {
    visualAnchors: string[];
    commentVibe: string;
    keyPhraseToAdapt: string;
  };
  captionOptions: Array<{
    option: number;
    candidateId: string;
    angle: string;
    top: string;
    bottom: string;
    topRu: string;
    bottomRu: string;
    constraintCheck: {
      passed: boolean;
      repaired: boolean;
      topLength: number;
      bottomLength: number;
      issues: string[];
    };
  }>;
  titleOptions: Array<{
    option: number;
    title: string;
    titleRu: string;
  }>;
  finalPick: {
    option: number;
    reason: string;
  };
  pipeline: {
    channelId: string;
    mode: "packet_only" | "codex_pipeline";
    selectorOutput: SelectorOutput;
    availableExamplesCount: number;
    selectedExamplesCount: number;
    finalSelector?: {
      candidateOptionMap: Array<{
        option: number;
        candidateId: string;
      }>;
      shortlistCandidateIds: string[];
      finalPickCandidateId: string;
      rationaleRaw: string;
      rationaleInternalRaw?: string;
      rationaleInternalModelRaw?: string;
    };
  };
  diagnostics?: Stage2Diagnostics;
};
