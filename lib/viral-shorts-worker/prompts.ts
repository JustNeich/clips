import {
  AnalyzerOutput,
  CandidateCaption,
  CriticScore,
  PreparedGenerationContext,
  PromptPacket,
  SelectorOutput,
  Stage2DiagnosticsPromptStageInputManifest,
  Stage2DiagnosticsSourceContext,
  Stage2ExamplesAssessment,
  Stage2RuntimeChannelConfig,
  ViralShortsVideoContext
} from "./types";
import { Stage2PromptConfig } from "../stage2-pipeline";
import {
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  Stage2PromptConfigStageId,
  Stage2ReasoningEffort
} from "../stage2-prompt-specs";
import { buildStage2LearningPromptContext } from "../stage2-channel-learning";

const BASE_STYLE_RULES = [
  "Role:",
  "You are building viral Shorts overlay candidates for a US audience.",
  "Stay visually anchored, channel-aware, and specific.",
  "",
  "Core rules:",
  "- Match what the paused frame visibly shows right now.",
  "- Use concrete nouns and actions, not abstractions.",
  "- Never use emojis.",
  "- Respect hard constraints exactly.",
  "- Use examples as conditioning, not as lines to copy.",
  "- Let channel flavor come from the channel learning payload, not from one default personality.",
  "- Keep controlled exploratory space alive instead of collapsing every option into one repetitive mode."
].join("\n");

const MAX_SELECTOR_DESCRIPTION_CHARS = 1_200;
const MAX_SELECTOR_TRANSCRIPT_CHARS = 6_000;
const MAX_SELECTOR_COMMENT_COUNT = 12;
const MAX_SELECTOR_COMMENT_CHARS = 220;
const MAX_ANALYZER_DESCRIPTION_CHARS = 1_200;
const MAX_ANALYZER_TRANSCRIPT_CHARS = 8_000;
const MAX_ANALYZER_COMMENT_COUNT = 20;
const MAX_ANALYZER_COMMENT_CHARS = 280;
const GENERIC_BOTTOM_TAIL_PATTERNS = [
  /reaction basically writes itself/i,
  /whole room feels it immediately/i,
  /nobody there can shrug (?:it|that) off/i,
  /everybody in the shot gets the same message/i,
  /the whole room feels it/i
];
const COMMENT_CARRY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "get",
  "got",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "too",
  "was",
  "we",
  "were",
  "what",
  "when",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your"
]);

export type CommentCarryExpectation = "low" | "medium" | "high";

export type Stage2CommentCarryProfile = {
  expectation: CommentCarryExpectation;
  dominantCues: string[];
  allCues: string[];
  summary: string | null;
};

export type Stage2CandidateCommentCarry = {
  matchedCues: string[];
  matchedInBottom: boolean;
  usesDominantCue: boolean;
  score: number;
};

export type Stage2PromptTemplateKind = "llm_system";

export type ResolvedStage2PromptTemplate = {
  stageId: Stage2PromptConfigStageId;
  stageType: "llm_prompt";
  templateKind: Stage2PromptTemplateKind;
  defaultPrompt: string;
  configuredPrompt: string;
  reasoningEffort: Stage2ReasoningEffort;
  isCustomPrompt: boolean;
};

function renderPrompt(system: string, payload: unknown): string {
  return [`SYSTEM`, system.trim(), ``, `USER CONTEXT JSON`, JSON.stringify(payload, null, 2)].join(
    "\n"
  );
}

function renderTemplate(template: string, bindings: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => bindings[key] ?? "");
}

export function resolveStage2PromptTemplate(
  stageId: Stage2PromptConfigStageId,
  promptConfig?: Stage2PromptConfig | null
): ResolvedStage2PromptTemplate {
  const defaultPrompt = STAGE2_DEFAULT_STAGE_PROMPTS[stageId];
  const stageConfig = promptConfig?.stages[stageId];
  const configuredPrompt = stageConfig?.prompt?.trim() || defaultPrompt;
  const reasoningEffort =
    stageConfig?.reasoningEffort ?? STAGE2_DEFAULT_REASONING_EFFORTS[stageId];
  return {
    stageId,
    stageType: "llm_prompt",
    templateKind: "llm_system",
    defaultPrompt,
    configuredPrompt,
    reasoningEffort,
    isCustomPrompt: configuredPrompt !== defaultPrompt
  };
}

function buildChannelPayload(
  channelConfig: Stage2RuntimeChannelConfig,
  learningDetail: "minimal" | "compact" = "compact"
) {
  return {
    channel: channelConfig.name,
    channelId: channelConfig.channelId,
    username: channelConfig.username,
    examplesSource: channelConfig.examplesSource,
    constraints: channelConfig.hardConstraints,
    channelLearning: buildStage2LearningPromptContext({
      profile: channelConfig.styleProfile,
      editorialMemory: channelConfig.editorialMemory,
      detail: learningDetail
    })
  };
}

function buildSystemPrompt(
  stageId: Stage2PromptConfigStageId,
  promptConfig: Stage2PromptConfig | null | undefined
): string {
  const resolved = resolveStage2PromptTemplate(stageId, promptConfig);
  return renderTemplate(resolved.configuredPrompt, {
    baseStyleRules: BASE_STYLE_RULES
  }).trim();
}

function normalizePromptTextKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateWords(value: string, maxWords: number): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function extractCommentCueFragments(cue: string): string[] {
  const original = String(cue ?? "").replace(/\s+/g, " ").trim();
  if (!original) {
    return [];
  }
  const normalized = normalizePromptTextKey(original);
  const normalizedTokens = normalized.split(" ").filter(Boolean);
  const contentTokens = normalizedTokens.filter((token) => !COMMENT_CARRY_STOPWORDS.has(token));
  const fragments = new Set<string>();
  const push = (value: string) => {
    const cleaned = normalizePromptTextKey(value);
    if (cleaned) {
      fragments.add(cleaned);
    }
  };

  push(original);
  if (contentTokens.length >= 2) {
    push(contentTokens.slice(0, 2).join(" "));
  }
  if (contentTokens.length >= 3) {
    push(contentTokens.slice(0, 3).join(" "));
  }
  for (let index = 0; index < contentTokens.length; index += 1) {
    const token = contentTokens[index];
    if (!token) {
      continue;
    }
    if (token.length >= 4 || /^[a-z0-9]{2,6}$/.test(token)) {
      push(token);
    }
    if (index < contentTokens.length - 1) {
      push(`${token} ${contentTokens[index + 1]}`);
    }
  }
  for (const match of original.matchAll(/\b[A-Z]{2,6}\b/g)) {
    push(match[0] ?? "");
  }

  return Array.from(fragments).slice(0, 6);
}

function buildCommentCarryCueList(analyzerOutput: Pick<
  AnalyzerOutput,
  | "slangToAdapt"
  | "commentLanguageCues"
  | "commentConsensusLane"
  | "commentJokeLane"
  | "commentDissentLane"
>): string[] {
  const merged = Array.from(
    new Set(
      [...analyzerOutput.slangToAdapt, ...analyzerOutput.commentLanguageCues]
        .map((cue) => String(cue ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  );
  const laneHints = [
    analyzerOutput.commentConsensusLane,
    analyzerOutput.commentJokeLane,
    analyzerOutput.commentDissentLane
  ]
    .map((lane) => extractPromptCommentCue(lane ?? ""))
    .filter(Boolean);
  return Array.from(new Set([...merged, ...laneHints])).slice(0, 8);
}

export function buildCommentCarryProfile(
  analyzerOutput: Pick<
    AnalyzerOutput,
    | "slangToAdapt"
    | "commentLanguageCues"
    | "commentConsensusLane"
    | "commentJokeLane"
    | "commentDissentLane"
  >
): Stage2CommentCarryProfile {
  const allCues = buildCommentCarryCueList(analyzerOutput);
  const dominantCues = allCues.slice(0, 3);
  const hasMixedCommentPressure = Boolean(
    analyzerOutput.commentConsensusLane || analyzerOutput.commentJokeLane || analyzerOutput.commentDissentLane
  );
  const expectation: CommentCarryExpectation =
    dominantCues.length >= 2 && hasMixedCommentPressure
      ? "high"
      : dominantCues.length >= 1
        ? "medium"
        : "low";
  return {
    expectation,
    dominantCues,
    allCues,
    summary:
      dominantCues.length > 0
        ? `Audience shorthand worth carrying when clip-safe: ${dominantCues.join(" | ")}.`
        : null
  };
}

export function evaluateCandidateCommentCarry(input: {
  candidate: Pick<CandidateCaption, "top" | "bottom">;
  commentCarryProfile: Stage2CommentCarryProfile;
}): Stage2CandidateCommentCarry {
  const text = `${input.candidate.top} ${input.candidate.bottom}`;
  const normalizedFull = normalizePromptTextKey(text);
  const normalizedBottom = normalizePromptTextKey(input.candidate.bottom);
  if (!normalizedFull || input.commentCarryProfile.allCues.length === 0) {
    return {
      matchedCues: [],
      matchedInBottom: false,
      usesDominantCue: false,
      score: 0
    };
  }

  const matchedCues: string[] = [];
  let matchedInBottom = false;
  let usesDominantCue = false;

  for (const cue of input.commentCarryProfile.allCues) {
    const fragments = extractCommentCueFragments(cue);
    if (fragments.length === 0) {
      continue;
    }
    const matchedFragment = fragments.find(
      (fragment) =>
        normalizedFull.includes(fragment) ||
        (fragment.length >= 8 &&
          fragment.split(" ").filter(Boolean).length >= 2 &&
          fragment
            .split(" ")
            .filter((token) => token.length >= 4)
            .every((token) => normalizedFull.includes(token)))
    );
    if (!matchedFragment) {
      continue;
    }
    matchedCues.push(cue);
    if (normalizedBottom.includes(matchedFragment)) {
      matchedInBottom = true;
    }
    if (
      input.commentCarryProfile.dominantCues.some(
        (dominantCue) => normalizePromptTextKey(dominantCue) === normalizePromptTextKey(cue)
      )
    ) {
      usesDominantCue = true;
    }
  }

  const score =
    matchedCues.length === 0
      ? 0
      : matchedInBottom
        ? usesDominantCue
          ? 3
          : 2
        : usesDominantCue
          ? 1.5
          : 1;

  return {
    matchedCues: Array.from(new Set(matchedCues)).slice(0, 3),
    matchedInBottom,
    usesDominantCue,
    score
  };
}

function extractLeadingCommentClause(text: string, maxWords: number): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const firstClause =
    normalized.split(/(?:\.{2,}|[.!?]+|[,;]+|\u2026|\s[-\u2014]\s)/)[0] ?? normalized;
  return truncateWords(firstClause, maxWords).replace(/^"+|"+$/g, "").trim();
}

function extractPromptCommentCue(text: string): string {
  const normalized = truncatePromptValue(String(text ?? ""), 120);
  const quoted = normalized.match(/"([^"]{2,60})"/)?.[1];
  if (quoted) {
    return quoted.trim();
  }
  return extractLeadingCommentClause(normalized, 7);
}

function buildCommentPromptDigest(
  comments: ViralShortsVideoContext["comments"]
): {
  reusableLanguage: string[];
  consensusLaneHint: string | null;
  jokeLaneHint: string | null;
  dissentLaneHint: string | null;
  suspicionLaneHint: string | null;
} {
  const sorted = [...comments]
    .map((comment) => ({
      likes: comment.likes,
      text: truncatePromptValue(comment.text, 140),
      lower: String(comment.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    }))
    .filter((comment) => comment.text)
    .sort((left, right) => right.likes - left.likes)
    .slice(0, 12);
  const suspicionPattern =
    /\b(fake|staged|scripted|setup|set up|pre[- ]?opened|resealed|tampered|planted|cgi|acting)\b/;
  const dissentPattern =
    /\b(cringe|corny|overrated|not that deep|not that serious|equality|from a movie|it'?s a movie|just acting)\b/;
  const jokePattern = /\b(lol|lmao|haha|ahah|😭|😂|💀|queen|mode|bro|what\b)\b|:/;
  const consensus = sorted.filter(
    (comment) => !suspicionPattern.test(comment.lower) && !dissentPattern.test(comment.lower)
  );
  const jokes = sorted.filter((comment) => jokePattern.test(comment.lower));
  const dissent = sorted.filter(
    (comment) => dissentPattern.test(comment.lower) && !suspicionPattern.test(comment.lower)
  );
  const suspicion = sorted.filter((comment) => suspicionPattern.test(comment.lower));
  const summarize = (items: typeof sorted, lead: string) =>
    items.length > 0 ? `${lead}: ${items.slice(0, 2).map((item) => item.text).join(" | ")}` : null;
  return {
    reusableLanguage: Array.from(
      new Set(sorted.map((comment) => extractPromptCommentCue(comment.text)).filter(Boolean))
    ).slice(0, 6),
    consensusLaneHint: summarize(consensus, "Consensus read"),
    jokeLaneHint: summarize(jokes, "Joke or meme lane"),
    dissentLaneHint: summarize(dissent, "Dissent or pushback lane"),
    suspicionLaneHint: summarize(suspicion, "Suspicion or hidden-read lane")
  };
}

function buildCandidateBatchSignals(
  candidates: CandidateCaption[],
  analyzerOutput?: Pick<
    AnalyzerOutput,
    | "slangToAdapt"
    | "commentLanguageCues"
    | "commentConsensusLane"
    | "commentJokeLane"
    | "commentDissentLane"
  >
) {
  const angleCounts = new Map<string, number>();
  const styleDirectionCounts = new Map<string, number>();
  const openingCounts = new Map<string, { count: number; candidateIds: string[] }>();
  const tailCounts = new Map<string, { count: number; candidateIds: string[] }>();
  const genericTailCandidateIds: string[] = [];
  const commentCarryProfile = analyzerOutput ? buildCommentCarryProfile(analyzerOutput) : null;
  const commentNativeCandidates: Array<{
    candidateId: string;
    matchedCues: string[];
    matchedInBottom: boolean;
    usesDominantCue: boolean;
  }> = [];
  let alignedCount = 0;
  let exploratoryCount = 0;

  for (const candidate of candidates) {
    angleCounts.set(candidate.angle, (angleCounts.get(candidate.angle) ?? 0) + 1);
    if (candidate.explorationMode === "exploratory") {
      exploratoryCount += 1;
    } else {
      alignedCount += 1;
    }
    for (const directionId of candidate.styleDirectionIds ?? []) {
      styleDirectionCounts.set(directionId, (styleDirectionCounts.get(directionId) ?? 0) + 1);
    }

    const bottomWords = candidate.bottom.trim().split(/\s+/).filter(Boolean);
    const openingKey = normalizePromptTextKey(bottomWords.slice(0, 5).join(" "));
    if (openingKey) {
      const current = openingCounts.get(openingKey) ?? { count: 0, candidateIds: [] };
      current.count += 1;
      current.candidateIds.push(candidate.candidateId);
      openingCounts.set(openingKey, current);
    }

    const tailKey = normalizePromptTextKey(bottomWords.slice(-7).join(" "));
    if (tailKey) {
      const current = tailCounts.get(tailKey) ?? { count: 0, candidateIds: [] };
      current.count += 1;
      current.candidateIds.push(candidate.candidateId);
      tailCounts.set(tailKey, current);
    }

    if (GENERIC_BOTTOM_TAIL_PATTERNS.some((pattern) => pattern.test(candidate.bottom))) {
      genericTailCandidateIds.push(candidate.candidateId);
    }
    if (commentCarryProfile) {
      const commentCarry = evaluateCandidateCommentCarry({
        candidate,
        commentCarryProfile
      });
      if (commentCarry.matchedCues.length > 0) {
        commentNativeCandidates.push({
          candidateId: candidate.candidateId,
          matchedCues: commentCarry.matchedCues,
          matchedInBottom: commentCarry.matchedInBottom,
          usesDominantCue: commentCarry.usesDominantCue
        });
      }
    }
  }

  const toRepeatedList = (
    counts: Map<string, { count: number; candidateIds: string[] }>
  ) =>
    Array.from(counts.entries())
      .filter(([, value]) => value.count >= 2)
      .sort((left, right) => right[1].count - left[1].count)
      .slice(0, 4)
      .map(([signature, value]) => ({
        signature,
        count: value.count,
        candidateIds: value.candidateIds
      }));

  return {
    totalCandidates: candidates.length,
    alignedCount,
    exploratoryCount,
    angleCounts: Array.from(angleCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([angle, count]) => ({ angle, count })),
    repeatedBottomOpenings: toRepeatedList(openingCounts),
    repeatedBottomTailSignatures: toRepeatedList(tailCounts),
    styleDirectionCounts: Array.from(styleDirectionCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([styleDirectionId, count]) => ({ styleDirectionId, count })),
    genericTailCandidateIds,
    commentCarryExpectation: commentCarryProfile?.expectation ?? "low",
    dominantAudienceCues: commentCarryProfile?.dominantCues ?? [],
    commentCarrySummary: commentCarryProfile?.summary ?? null,
    commentNativeCandidates
  };
}

function truncatePromptValue(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildCompactSelectorExamples(
  availableExamples: PreparedGenerationContext["availableExamples"]
): Array<{
  id: string;
  channelName: string;
  clipType: string;
  title: string;
  overlayTop: string;
  overlayBottom: string;
  whyItWorks: string[];
  qualityScore: number | null;
}> {
  return (availableExamples ?? []).map((example) => ({
    id: example.id,
    channelName: example.sourceChannelName || example.ownerChannelName,
    clipType: example.clipType,
    title: truncatePromptValue(example.title, 120),
    overlayTop: truncatePromptValue(example.overlayTop, 220),
    overlayBottom: truncatePromptValue(example.overlayBottom, 180),
    whyItWorks: example.whyItWorks.slice(0, 2).map((item) => truncatePromptValue(item, 100)),
    qualityScore: typeof example.qualityScore === "number" ? example.qualityScore : null
  }));
}

function buildCompactSelectorVideoContext(videoContext: ViralShortsVideoContext) {
  const commentDigest = buildCommentPromptDigest(videoContext.comments);
  return {
    sourceUrl: videoContext.sourceUrl,
    title: videoContext.title,
    description: truncatePromptValue(videoContext.description, MAX_SELECTOR_DESCRIPTION_CHARS),
    transcript: truncatePromptValue(videoContext.transcript, MAX_SELECTOR_TRANSCRIPT_CHARS),
    frameDescriptions: videoContext.frameDescriptions.slice(0, 8),
    commentsAvailable: videoContext.comments.length > 0,
    commentDigest,
    comments: videoContext.comments.slice(0, MAX_SELECTOR_COMMENT_COUNT).map((comment) => ({
      author: truncatePromptValue(comment.author, 40),
      likes: comment.likes,
      text: truncatePromptValue(comment.text, MAX_SELECTOR_COMMENT_CHARS)
    }))
  };
}

function buildPromptSelectorOutputPayload(selectorOutput: SelectorOutput) {
  return {
    clipType: selectorOutput.clipType,
    primaryAngle: selectorOutput.primaryAngle,
    secondaryAngles: selectorOutput.secondaryAngles,
    rankedAngles: selectorOutput.rankedAngles,
    selectedExampleIds: selectorOutput.selectedExampleIds ?? [],
    rejectedExampleIds: selectorOutput.rejectedExampleIds ?? [],
    coreTrigger: selectorOutput.coreTrigger,
    humanStake: selectorOutput.humanStake,
    narrativeFrame: selectorOutput.narrativeFrame,
    whyViewerCares: selectorOutput.whyViewerCares,
    topStrategy: selectorOutput.topStrategy,
    bottomEnergy: selectorOutput.bottomEnergy,
    whyOldV6WouldWorkHere: selectorOutput.whyOldV6WouldWorkHere,
    failureModes: selectorOutput.failureModes,
    rationale: selectorOutput.rationale ?? "",
    confidence: selectorOutput.confidence,
    retrievalConfidence: selectorOutput.retrievalConfidence ?? "",
    examplesMode: selectorOutput.examplesMode ?? "",
    examplesRoleSummary: selectorOutput.examplesRoleSummary ?? "",
    primaryDriverSummary: selectorOutput.primaryDriverSummary ?? "",
    retrievalWarning: selectorOutput.retrievalWarning ?? "",
    writerBrief: selectorOutput.writerBrief
  };
}

function buildExamplesAssessmentPayload(examplesAssessment: Stage2ExamplesAssessment) {
  return {
    retrievalConfidence: examplesAssessment.retrievalConfidence,
    examplesMode: examplesAssessment.examplesMode,
    explanation: examplesAssessment.explanation,
    evidence: examplesAssessment.evidence,
    retrievalWarning: examplesAssessment.retrievalWarning,
    examplesRoleSummary: examplesAssessment.examplesRoleSummary,
    primaryDriverSummary: examplesAssessment.primaryDriverSummary,
    primaryDrivers: examplesAssessment.primaryDrivers,
    channelStylePriority: examplesAssessment.channelStylePriority,
    editorialMemoryPriority: examplesAssessment.editorialMemoryPriority
  };
}

function buildCompactAnalyzerVideoContext(videoContext: ViralShortsVideoContext) {
  const commentDigest = buildCommentPromptDigest(videoContext.comments);
  return {
    sourceUrl: videoContext.sourceUrl,
    title: videoContext.title,
    description: truncatePromptValue(videoContext.description, MAX_ANALYZER_DESCRIPTION_CHARS),
    transcript: truncatePromptValue(videoContext.transcript, MAX_ANALYZER_TRANSCRIPT_CHARS),
    frameDescriptions: videoContext.frameDescriptions.slice(0, 12),
    commentsAvailable: videoContext.comments.length > 0,
    commentDigest,
    comments: videoContext.comments.slice(0, MAX_ANALYZER_COMMENT_COUNT).map((comment) => ({
      author: truncatePromptValue(comment.author, 40),
      likes: comment.likes,
      text: truncatePromptValue(comment.text, MAX_ANALYZER_COMMENT_CHARS)
    }))
  };
}

function buildTextUsage(
  value: string,
  limit: number | null
): NonNullable<Stage2DiagnosticsPromptStageInputManifest["description"]> {
  const trimmed = value.trim();
  const availableChars = trimmed.length;
  const passedChars = limit === null ? availableChars : Math.min(availableChars, limit);
  return {
    availableChars,
    passedChars,
    omittedChars: Math.max(0, availableChars - passedChars),
    truncated: limit !== null ? availableChars > passedChars : false,
    limit
  };
}

function buildListUsage<T>(
  items: T[],
  limit: number | null
): NonNullable<Stage2DiagnosticsPromptStageInputManifest["frames"]> {
  const availableCount = items.length;
  const passedCount = limit === null ? availableCount : Math.min(availableCount, limit);
  return {
    availableCount,
    passedCount,
    omittedCount: Math.max(0, availableCount - passedCount),
    truncated: limit !== null ? availableCount > passedCount : false,
    limit
  };
}

function buildCommentUsage(
  comments: ViralShortsVideoContext["comments"],
  limit: number | null
): NonNullable<Stage2DiagnosticsPromptStageInputManifest["comments"]> {
  const usage = buildListUsage(comments, limit);
  return {
    ...usage,
    passedCommentIds: comments
      .slice(0, usage.passedCount)
      .map((comment, index) => String(comment.id ?? `comment_${index + 1}`))
  };
}

function buildChannelLearningUsage(
  channelConfig: Stage2RuntimeChannelConfig,
  detail: Stage2DiagnosticsPromptStageInputManifest["learningDetail"]
): NonNullable<Stage2DiagnosticsPromptStageInputManifest["channelLearning"]> | null {
  if (detail === "none") {
    return null;
  }
  const learningContext = buildStage2LearningPromptContext({
    profile: channelConfig.styleProfile,
    editorialMemory: channelConfig.editorialMemory,
    detail
  });
  return {
    detail,
    selectedDirectionCount: learningContext.bootstrap.selectedDirectionCount,
    highlightedDirectionIds: learningContext.bootstrap.directionHighlights.map((entry) => entry.id),
    explorationShare: learningContext.bootstrap.explorationShare ?? null,
    recentFeedbackCount: learningContext.editorialMemory.recentFeedbackCount,
    recentSelectionCount: learningContext.editorialMemory.recentSelectionCount,
    promptSummary: learningContext.editorialMemory.promptSummary || null
  };
}

function buildExamplesUsage(input: {
  activeCorpusCount: number;
  promptPool: PreparedGenerationContext["availableExamples"];
  passedExamples: PreparedGenerationContext["availableExamples"];
  selectedExampleIds?: string[] | null;
  rejectedExampleIds?: string[] | null;
  examplesAssessment: Stage2ExamplesAssessment;
}): NonNullable<Stage2DiagnosticsPromptStageInputManifest["examples"]> {
  const promptPool = input.promptPool ?? [];
  const passedExamples = input.passedExamples ?? [];
  const selectedExampleIds = input.selectedExampleIds ?? [];
  const rejectedExampleIds = input.rejectedExampleIds ?? [];
  return {
    availableCount: promptPool.length,
    passedCount: passedExamples.length,
    omittedCount: Math.max(0, promptPool.length - passedExamples.length),
    truncated: promptPool.length > passedExamples.length,
    limit: null,
    activeCorpusCount: input.activeCorpusCount,
    promptPoolCount: promptPool.length,
    passedExampleIds: passedExamples.map((example) => example.id),
    selectedExampleIds,
    rejectedExampleIds,
    retrievalConfidence: input.examplesAssessment.retrievalConfidence,
    examplesMode: input.examplesAssessment.examplesMode,
    examplesRoleSummary: input.examplesAssessment.examplesRoleSummary,
    primaryDriverSummary: input.examplesAssessment.primaryDriverSummary
  };
}

function buildCandidateUsage(input: {
  candidates: CandidateCaption[];
  criticScores?: CriticScore[] | null;
  shortlist?: CandidateCaption[] | null;
}): NonNullable<Stage2DiagnosticsPromptStageInputManifest["candidates"]> {
  return {
    passedCount: input.candidates.length,
    passedCandidateIds: input.candidates.map((candidate) => candidate.candidateId),
    criticScoreCount: input.criticScores ? input.criticScores.length : null,
    shortlistCount: input.shortlist ? input.shortlist.length : null
  };
}

export function buildStage2SourceContextSummary(
  videoContext: ViralShortsVideoContext
): Stage2DiagnosticsSourceContext {
  return {
    sourceUrl: videoContext.sourceUrl,
    title: videoContext.title,
    descriptionChars: videoContext.description.trim().length,
    transcriptChars: videoContext.transcript.trim().length,
    frameCount: videoContext.frameDescriptions.length,
    runtimeCommentCount: videoContext.comments.length,
    runtimeCommentIds: videoContext.comments.map((comment, index) =>
      String(comment.id ?? `comment_${index + 1}`)
    ),
    userInstructionChars: videoContext.userInstruction?.trim().length ?? 0
  };
}

export function buildStage2PromptInputManifestMap(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  activeExamplesCount: number;
  selectorPromptPool: PreparedGenerationContext["availableExamples"];
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  writerCandidates: CandidateCaption[];
  criticScores: CriticScore[];
  rewriteCandidates: CandidateCaption[];
  shortlist: CandidateCaption[];
}): Record<string, Stage2DiagnosticsPromptStageInputManifest> {
  const commonSelectorExamples = buildExamplesUsage({
    activeCorpusCount: input.activeExamplesCount,
    promptPool: input.selectorPromptPool,
    passedExamples: input.selectorPromptPool,
    selectedExampleIds: input.selectorOutput.selectedExampleIds ?? [],
    rejectedExampleIds: input.selectorOutput.rejectedExampleIds ?? [],
    examplesAssessment: input.examplesAssessment
  });
  const selectedExamples = input.selectorOutput.selectedExamples ?? [];
  return {
    analyzer: {
      learningDetail: "minimal",
      description: buildTextUsage(input.videoContext.description, MAX_ANALYZER_DESCRIPTION_CHARS),
      transcript: buildTextUsage(input.videoContext.transcript, MAX_ANALYZER_TRANSCRIPT_CHARS),
      frames: buildListUsage(input.videoContext.frameDescriptions, 12),
      comments: buildCommentUsage(input.videoContext.comments, MAX_ANALYZER_COMMENT_COUNT),
      examples: null,
      channelLearning: buildChannelLearningUsage(input.channelConfig, "minimal"),
      candidates: null,
      stageFlags: ["frames+comments aware", "heuristic analyzer seed", "comment digest included"]
    },
    selector: {
      learningDetail: "compact",
      description: buildTextUsage(input.videoContext.description, MAX_SELECTOR_DESCRIPTION_CHARS),
      transcript: buildTextUsage(input.videoContext.transcript, MAX_SELECTOR_TRANSCRIPT_CHARS),
      frames: buildListUsage(input.videoContext.frameDescriptions, 8),
      comments: buildCommentUsage(input.videoContext.comments, MAX_SELECTOR_COMMENT_COUNT),
      examples: commonSelectorExamples,
      channelLearning: buildChannelLearningUsage(input.channelConfig, "compact"),
      candidates: null,
      stageFlags: ["curated prompt pool", "retrieval-mode aware", "comment digest included"]
    },
    writer: {
      learningDetail: "compact",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: buildExamplesUsage({
        activeCorpusCount: input.activeExamplesCount,
        promptPool: input.selectorPromptPool,
        passedExamples: selectedExamples,
        selectedExampleIds: input.selectorOutput.selectedExampleIds ?? [],
        rejectedExampleIds: input.selectorOutput.rejectedExampleIds ?? [],
        examplesAssessment: input.examplesAssessment
      }),
      channelLearning: buildChannelLearningUsage(input.channelConfig, "compact"),
      candidates: null,
      stageFlags: ["selected examples only", "selector brief context", "user instruction aware"]
    },
    critic: {
      learningDetail: "compact",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: {
        ...commonSelectorExamples,
        passedCount: 0,
        omittedCount: commonSelectorExamples.promptPoolCount,
        truncated: commonSelectorExamples.promptPoolCount > 0,
        passedExampleIds: []
      },
      channelLearning: buildChannelLearningUsage(input.channelConfig, "compact"),
      candidates: buildCandidateUsage({
        candidates: input.writerCandidates,
        criticScores: input.criticScores
      }),
      stageFlags: ["candidate batch signals", "selector-output examples context only"]
    },
    rewriter: {
      learningDetail: "compact",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: buildExamplesUsage({
        activeCorpusCount: input.activeExamplesCount,
        promptPool: input.selectorPromptPool,
        passedExamples: selectedExamples,
        selectedExampleIds: input.selectorOutput.selectedExampleIds ?? [],
        rejectedExampleIds: input.selectorOutput.rejectedExampleIds ?? [],
        examplesAssessment: input.examplesAssessment
      }),
      channelLearning: buildChannelLearningUsage(input.channelConfig, "compact"),
      candidates: buildCandidateUsage({
        candidates: input.rewriteCandidates,
        criticScores: input.criticScores
      }),
      stageFlags: ["critic-shortlisted candidates", "selected examples included", "user instruction aware"]
    },
    finalSelector: {
      learningDetail: "minimal",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: {
        ...commonSelectorExamples,
        passedCount: 0,
        omittedCount: commonSelectorExamples.promptPoolCount,
        truncated: commonSelectorExamples.promptPoolCount > 0,
        passedExampleIds: []
      },
      channelLearning: buildChannelLearningUsage(input.channelConfig, "minimal"),
      candidates: buildCandidateUsage({
        candidates: input.rewriteCandidates,
        shortlist: input.shortlist
      }),
      stageFlags: ["quality-first shortlist assembly", "exploration-aware final mix"]
    },
    titles: {
      learningDetail: "minimal",
      description: null,
      transcript: null,
      frames: buildListUsage(input.videoContext.frameDescriptions, null),
      comments: null,
      examples: {
        ...commonSelectorExamples,
        passedCount: 0,
        omittedCount: commonSelectorExamples.promptPoolCount,
        truncated: commonSelectorExamples.promptPoolCount > 0,
        passedExampleIds: []
      },
      channelLearning: buildChannelLearningUsage(input.channelConfig, "minimal"),
      candidates: buildCandidateUsage({
        candidates: input.shortlist,
        shortlist: input.shortlist
      }),
      stageFlags: ["shortlist-only title generation", "frame context only"]
    }
  };
}

export function buildAnalyzerPrompt(
  channelConfig: Stage2RuntimeChannelConfig,
  videoContext: ViralShortsVideoContext,
  heuristicAnalyzer: AnalyzerOutput,
  promptConfig?: Stage2PromptConfig | null
): string {
  return renderPrompt(buildSystemPrompt("analyzer", promptConfig), {
    ...buildChannelPayload(channelConfig, "minimal"),
    videoContext: buildCompactAnalyzerVideoContext(videoContext),
    heuristicAnalyzer
  });
}

export function buildSelectorPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
  availableExamples: PreparedGenerationContext["availableExamples"];
  examplesAssessment: Stage2ExamplesAssessment;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("selector", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig, "compact"),
    videoContext: buildCompactSelectorVideoContext(input.videoContext),
    analyzerOutput: input.analyzerOutput,
    examplesAssessment: buildExamplesAssessmentPayload(input.examplesAssessment),
    availableExamples: buildCompactSelectorExamples(input.availableExamples)
  });
}

export function buildWriterPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  userInstruction?: string | null;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  const commentCarryProfile = buildCommentCarryProfile(input.analyzerOutput);
  return renderPrompt(buildSystemPrompt("writer", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig, "compact"),
    analyzerOutput: input.analyzerOutput,
    commentCarryProfile,
    examplesAssessment: buildExamplesAssessmentPayload(input.examplesAssessment),
    selectorOutput: buildPromptSelectorOutputPayload(input.selectorOutput),
    selectedExamples: buildCompactSelectorExamples(input.selectorOutput.selectedExamples ?? []),
    userInstruction: input.userInstruction?.trim() || null
  });
}

export function buildCriticPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  candidates: CandidateCaption[];
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("critic", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig, "compact"),
    analyzerOutput: input.analyzerOutput,
    examplesAssessment: buildExamplesAssessmentPayload(input.examplesAssessment),
    selectorOutput: buildPromptSelectorOutputPayload(input.selectorOutput),
    candidateSetSignals: buildCandidateBatchSignals(input.candidates, input.analyzerOutput),
    candidates: input.candidates
  });
}

export function buildRewriterPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  candidates: CandidateCaption[];
  criticScores: CriticScore[];
  userInstruction?: string | null;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  const commentCarryProfile = buildCommentCarryProfile(input.analyzerOutput);
  return renderPrompt(buildSystemPrompt("rewriter", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig, "compact"),
    analyzerOutput: input.analyzerOutput,
    commentCarryProfile,
    examplesAssessment: buildExamplesAssessmentPayload(input.examplesAssessment),
    selectorOutput: buildPromptSelectorOutputPayload(input.selectorOutput),
    selectedExamples: buildCompactSelectorExamples(input.selectorOutput.selectedExamples ?? []),
    candidateSetSignals: buildCandidateBatchSignals(input.candidates, input.analyzerOutput),
    criticScores: input.criticScores,
    candidates: input.candidates,
    userInstruction: input.userInstruction?.trim() || null
  });
}

export function buildFinalSelectorPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  candidates: CandidateCaption[];
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("finalSelector", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig, "minimal"),
    analyzerOutput: input.analyzerOutput,
    examplesAssessment: buildExamplesAssessmentPayload(input.examplesAssessment),
    selectorOutput: buildPromptSelectorOutputPayload(input.selectorOutput),
    candidateSetSignals: buildCandidateBatchSignals(input.candidates, input.analyzerOutput),
    candidates: input.candidates
  });
}

export function buildTitlePrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  shortlist: CandidateCaption[];
  userInstruction?: string | null;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("titles", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig, "minimal"),
    examplesAssessment: buildExamplesAssessmentPayload(input.examplesAssessment),
    videoContext: {
      sourceUrl: input.videoContext.sourceUrl,
      title: input.videoContext.title,
      frameDescriptions: input.videoContext.frameDescriptions
    },
    selectorOutput: buildPromptSelectorOutputPayload(input.selectorOutput),
    shortlist: input.shortlist,
    userInstruction: input.userInstruction?.trim() || null
  });
}

export function buildPromptPacket(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  examplesAssessment: Stage2ExamplesAssessment;
  availableExamples: NonNullable<PreparedGenerationContext["availableExamples"]>;
  promptConfig?: Stage2PromptConfig | null;
}): PromptPacket {
  return {
    context: {
      channelConfig: input.channelConfig,
      analyzerOutput: input.analyzerOutput,
      selectorOutput: input.selectorOutput,
      examplesAssessment: input.examplesAssessment,
      availableExamples: input.availableExamples
    },
    prompts: {
      analyzer: buildAnalyzerPrompt(
        input.channelConfig,
        input.videoContext,
        input.analyzerOutput,
        input.promptConfig
      ),
      selector: buildSelectorPrompt({
        channelConfig: input.channelConfig,
        videoContext: input.videoContext,
        analyzerOutput: input.analyzerOutput,
        availableExamples: input.availableExamples,
        examplesAssessment: input.examplesAssessment,
        promptConfig: input.promptConfig
      }),
      writer: buildWriterPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        examplesAssessment: input.examplesAssessment,
        userInstruction: input.videoContext.userInstruction,
        promptConfig: input.promptConfig
      }),
      critic: buildCriticPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        examplesAssessment: input.examplesAssessment,
        candidates: [],
        promptConfig: input.promptConfig
      }),
      rewriter: buildRewriterPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        examplesAssessment: input.examplesAssessment,
        candidates: [],
        criticScores: [],
        userInstruction: input.videoContext.userInstruction,
        promptConfig: input.promptConfig
      }),
      finalSelector: buildFinalSelectorPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        examplesAssessment: input.examplesAssessment,
        candidates: [],
        promptConfig: input.promptConfig
      }),
      titles: buildTitlePrompt({
        channelConfig: input.channelConfig,
        videoContext: input.videoContext,
        selectorOutput: input.selectorOutput,
        examplesAssessment: input.examplesAssessment,
        shortlist: [],
        userInstruction: input.videoContext.userInstruction,
        promptConfig: input.promptConfig
      })
    }
  };
}
