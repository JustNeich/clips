import type {
  Stage2CorpusExample,
  Stage2ExamplesCorpusSource,
  Stage2HardConstraints
} from "../stage2-channel-config";
import type {
  Stage2EditorialMemorySummary,
  Stage2ExplorationMode,
  Stage2StyleProfile
} from "../stage2-channel-learning";

export type Stage2RetrievalConfidence = "high" | "medium" | "low";
export type Stage2ExamplesMode = "domain_guided" | "form_guided" | "style_guided";
export type Stage2ExampleGuidanceRole =
  | "semantic_guidance"
  | "form_guidance"
  | "weak_support";

export type Stage2ExamplesAssessment = {
  retrievalConfidence: Stage2RetrievalConfidence;
  examplesMode: Stage2ExamplesMode;
  explanation: string;
  evidence: string[];
  retrievalWarning: string | null;
  examplesRoleSummary: string;
  primaryDriverSummary: string;
  primaryDrivers: string[];
  channelStylePriority: "supporting" | "elevated" | "primary";
  editorialMemoryPriority: "supporting" | "elevated" | "primary";
};

export type HardConstraints = {
  topLengthMin: number;
  topLengthMax: number;
  bottomLengthMin: number;
  bottomLengthMax: number;
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
  sceneBeats: string[];
  revealMoment: string;
  lateClipChange: string;
  stakes: string[];
  payoff: string;
  coreTrigger: string;
  humanStake: string;
  narrativeFrame: string;
  whyViewerCares: string;
  bestBottomEnergy: string;
  commentVibe: string;
  commentConsensusLane: string;
  commentJokeLane: string;
  commentDissentLane: string;
  commentSuspicionLane: string;
  slangToAdapt: string[];
  commentLanguageCues: string[];
  extractableSlang: string[];
  hiddenDetail: string;
  genericRisks: string[];
  uncertaintyNotes: string[];
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
  retrievalConfidence?: Stage2RetrievalConfidence;
  examplesMode?: Stage2ExamplesMode;
  retrievalExplanation?: string;
  retrievalEvidence?: string[];
  retrievalWarning?: string | null;
  examplesRoleSummary?: string;
  primaryDriverSummary?: string;
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
  styleDirectionIds?: string[];
  explorationMode?: Stage2ExplorationMode;
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
    id?: string | null;
    author: string;
    likes: number;
    text: string;
    postedAt?: string | null;
  }>;
  userInstruction?: string | null;
};

export type PreparedGenerationContext = {
  channelProfile?: ViralShortsChannelProfile;
  channelConfig?: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  retrievalBundle?: RetrievalBundle;
  examplesAssessment?: Stage2ExamplesAssessment;
  availableExamples?: Stage2CorpusExample[];
};

export type Stage2RuntimeChannelConfig = {
  channelId: string;
  name: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  examplesSource: Stage2ExamplesCorpusSource;
  styleProfile?: Stage2StyleProfile;
  editorialMemory?: Stage2EditorialMemorySummary;
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

export type Stage2DebugMode = "summary" | "raw";

export type Stage2TokenUsageStage = {
  stageId: string;
  promptChars: number | null;
  estimatedInputTokens: number | null;
  estimatedOutputTokens: number | null;
  serializedResultBytes: number | null;
  persistedPayloadBytes: number | null;
};

export type Stage2TokenUsage = {
  stages: Stage2TokenUsageStage[];
  totalPromptChars: number;
  totalEstimatedInputTokens: number;
  totalEstimatedOutputTokens: number;
  totalSerializedResultBytes: number;
  totalPersistedPayloadBytes: number;
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
  promptTextAvailable?: boolean;
  promptChars: number | null;
  estimatedInputTokens?: number | null;
  estimatedOutputTokens?: number | null;
  serializedResultBytes?: number | null;
  persistedPayloadBytes?: number | null;
  usesImages: boolean;
  summary: string;
  inputManifest?: Stage2DiagnosticsPromptStageInputManifest;
};

export type Stage2DiagnosticsPromptStageTextUsage = {
  availableChars: number;
  passedChars: number;
  omittedChars: number;
  truncated: boolean;
  limit: number | null;
};

export type Stage2DiagnosticsPromptStageListUsage = {
  availableCount: number;
  passedCount: number;
  omittedCount: number;
  truncated: boolean;
  limit: number | null;
};

export type Stage2DiagnosticsPromptStageCommentsUsage = Stage2DiagnosticsPromptStageListUsage & {
  passedCommentIds: string[];
};

export type Stage2DiagnosticsPromptStageExamplesUsage = Stage2DiagnosticsPromptStageListUsage & {
  activeCorpusCount: number;
  promptPoolCount: number;
  passedExampleIds: string[];
  selectedExampleIds: string[];
  rejectedExampleIds: string[];
  retrievalConfidence: Stage2RetrievalConfidence | null;
  examplesMode: Stage2ExamplesMode | null;
  examplesRoleSummary: string | null;
  primaryDriverSummary: string | null;
};

export type Stage2DiagnosticsPromptStageChannelLearningUsage = {
  detail: "none" | "minimal" | "compact";
  selectedDirectionCount: number;
  highlightedDirectionIds: string[];
  explorationShare: number | null;
  recentFeedbackCount: number;
  recentSelectionCount: number;
  promptSummary: string | null;
};

export type Stage2DiagnosticsPromptStageCandidateUsage = {
  passedCount: number;
  passedCandidateIds: string[];
  criticScoreCount: number | null;
  shortlistCount: number | null;
};

export type Stage2DiagnosticsPromptStageInputManifest = {
  learningDetail: "none" | "minimal" | "compact";
  description: Stage2DiagnosticsPromptStageTextUsage | null;
  transcript: Stage2DiagnosticsPromptStageTextUsage | null;
  frames: Stage2DiagnosticsPromptStageListUsage | null;
  comments: Stage2DiagnosticsPromptStageCommentsUsage | null;
  examples: Stage2DiagnosticsPromptStageExamplesUsage | null;
  channelLearning: Stage2DiagnosticsPromptStageChannelLearningUsage | null;
  candidates: Stage2DiagnosticsPromptStageCandidateUsage | null;
  stageFlags: string[];
};

export type Stage2DiagnosticsSourceContext = {
  sourceUrl: string;
  title: string;
  descriptionChars: number;
  transcriptChars: number;
  frameCount: number;
  runtimeCommentCount: number;
  runtimeCommentIds: string[];
  userInstructionChars: number;
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
  guidanceRole: Stage2ExampleGuidanceRole;
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
    styleProfile?: Stage2StyleProfile;
    editorialMemory?: Stage2EditorialMemorySummary;
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
  analysis: {
    visualAnchors: string[];
    specificNouns: string[];
    visibleActions: string[];
    firstSecondsSignal: string;
    sceneBeats: string[];
    revealMoment: string;
    lateClipChange: string;
    whyViewerCares: string;
    bestBottomEnergy: string;
    commentVibe: string;
    commentConsensusLane?: string;
    commentJokeLane?: string;
    commentDissentLane?: string;
    commentSuspicionLane?: string;
    slangToAdapt?: string[];
    commentLanguageCues?: string[];
    hiddenDetail?: string;
    genericRisks?: string[];
    uncertaintyNotes: string[];
    rawSummary: string;
  };
  sourceContext?: Stage2DiagnosticsSourceContext;
  effectivePrompting: {
    promptStages: Stage2DiagnosticsPromptStage[];
  };
  examples: {
    source: Stage2ExamplesCorpusSource;
    workspaceCorpusCount: number;
    activeCorpusCount: number;
    selectorCandidateCount: number;
    retrievalConfidence: Stage2RetrievalConfidence;
    examplesMode: Stage2ExamplesMode;
    explanation: string;
    evidence: string[];
    retrievalWarning: string | null;
    examplesRoleSummary: string;
    primaryDriverSummary: string;
    primaryDrivers: string[];
    channelStylePriority: Stage2ExamplesAssessment["channelStylePriority"];
    editorialMemoryPriority: Stage2ExamplesAssessment["editorialMemoryPriority"];
    availableExamples: Stage2DiagnosticsExample[];
    selectedExamples: Stage2DiagnosticsExample[];
  };
};

export type Stage2AnalysisDigest = Pick<
  AnalyzerOutput,
  | "visualAnchors"
  | "specificNouns"
  | "visibleActions"
  | "firstSecondsSignal"
  | "sceneBeats"
  | "revealMoment"
  | "lateClipChange"
  | "stakes"
  | "coreTrigger"
  | "humanStake"
  | "narrativeFrame"
  | "whyViewerCares"
  | "bestBottomEnergy"
  | "commentVibe"
  | "commentConsensusLane"
  | "commentJokeLane"
  | "commentDissentLane"
  | "commentSuspicionLane"
  | "slangToAdapt"
  | "commentLanguageCues"
  | "hiddenDetail"
  | "genericRisks"
  | "uncertaintyNotes"
  | "rawSummary"
>;

export type CommentCarryExpectation = "low" | "medium" | "high";

export type Stage2CommentCarryProfile = {
  expectation: CommentCarryExpectation;
  dominantCues: string[];
  allCues: string[];
  summary: string | null;
};

export type Stage2WriterBriefDigest = {
  clipType: string;
  primaryAngle: string;
  secondaryAngles: string[];
  rankedAngles: RankedAngle[];
  writerBrief: string;
  topStrategy: string;
  bottomEnergy: string;
  whyViewerCares: string;
  failureModes: string[];
  selectedExamples: Array<{
    id: string;
    channelName: string;
    title: string;
    overlayTop: string;
    overlayBottom: string;
    whyItWorks: string[];
  }>;
  commentCarry: Stage2CommentCarryProfile;
  userInstruction: string | null;
};

export type Stage2RegenerateBaseSnapshot = {
  channel: {
    id: string;
    name: string;
    username: string;
    constraints: Stage2HardConstraints;
  };
  source: {
    url: string;
    title: string;
    frameDescriptions: string[];
    topComments: Array<{
      author: string;
      likes: number;
      text: string;
    }>;
  };
  analysis: {
    whyViewerCares: string;
    bottomEnergy: string;
    commentVibe: string;
    commentConsensusLane: string;
    commentJokeLane: string;
    commentDissentLane: string;
    commentSuspicionLane: string;
    commentLanguageCues: string[];
  };
  retrieval: {
    retrievalConfidence: Stage2RetrievalConfidence | null;
    examplesMode: Stage2ExamplesMode | null;
    examplesRoleSummary: string | null;
    primaryDriverSummary: string | null;
    selectedExamples: Array<{
      id: string;
      title: string;
      channelName: string;
    }>;
  };
  selection: {
    clipType: string;
    primaryAngle: string;
    secondaryAngles: string[];
    rankedAngles: RankedAngle[];
    writerBrief: string;
    rationale: string | null;
  };
  currentOptions: Array<{
    option: number;
    candidateId: string;
    angle: string;
    top: string;
    bottom: string;
    topRu: string;
    bottomRu: string;
    title: string;
    titleRu: string;
    styleDirectionIds?: string[];
    explorationMode?: Stage2ExplorationMode;
  }>;
  currentFinalPick: {
    option: number;
    reason: string;
  };
  userInstruction: string | null;
};

export type Stage2RunDebugArtifact = {
  kind: "stage2-run-debug";
  runId: string;
  createdAt: string;
  promptStages: Stage2DiagnosticsPromptStage[];
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
    mode: "packet_only" | "codex_pipeline" | "regenerate";
    selectorOutput: SelectorOutput;
    availableExamplesCount: number;
    selectedExamplesCount: number;
    retrievalConfidence?: Stage2RetrievalConfidence;
    examplesMode?: Stage2ExamplesMode;
    retrievalExplanation?: string;
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
      shortlistStats?: {
        targetCount: number;
        requestedCount: number;
        validatedCount: number;
        visibleCount: number;
        repairedCount: number;
        droppedAfterValidationCount: number;
      };
    };
  };
  diagnostics?: Stage2Diagnostics;
};
