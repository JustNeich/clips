export const STAGE2_SINGLE_BASELINE_PROFILE_ID = "stable_reference_v7" as const;

export const STAGE2_ACTIVE_WORKER_PROFILE_IDS = [
  STAGE2_SINGLE_BASELINE_PROFILE_ID
] as const;

export const STAGE2_HISTORICAL_WORKER_PROFILE_IDS = [
  "stable_reference_v6",
  "stable_reference_v6_experimental",
  "stable_social_wave_v1",
  "stable_skill_gap_v1",
  "experimental"
] as const;

export const STAGE2_WORKER_PROFILE_IDS = [
  ...STAGE2_ACTIVE_WORKER_PROFILE_IDS,
  ...STAGE2_HISTORICAL_WORKER_PROFILE_IDS
] as const;

export type Stage2WorkerProfileId = (typeof STAGE2_WORKER_PROFILE_IDS)[number];

export type Stage2WorkerProfileOrigin =
  | "channel_setting"
  | "default_baseline";

export type Stage2WorkerProfileExecutionMode =
  | "one_shot_reference_v2"
  | "one_shot_reference_v1"
  | "one_shot_reference_v1_experimental"
  | "native_modular_v1";

export type Stage2WorkerProfileStyleCard = {
  channel_voice: {
    core_tone: string;
    best_at: string[];
    avoid: string[];
  };
  hook_rules: string[];
  bottom_rules: string[];
  positive_micro_moves: string[];
  negative_micro_moves: string[];
};

export type Stage2WorkerProfileLanePreset = {
  laneId: string;
  count: number;
  purpose: string;
};

export type Stage2WorkerProfileDefinition = {
  id: Stage2WorkerProfileId;
  label: string;
  description: string;
  summary: string;
  executionMode: Stage2WorkerProfileExecutionMode;
  styleCard: Stage2WorkerProfileStyleCard;
  dominantWaveLanePlan: Stage2WorkerProfileLanePreset[];
  defaultLanePlan: Stage2WorkerProfileLanePreset[];
  active: boolean;
};

export type ResolvedStage2WorkerProfile = {
  requestedId: string | null;
  resolvedId: Stage2WorkerProfileId;
  label: string;
  description: string;
  summary: string;
  origin: Stage2WorkerProfileOrigin;
  executionMode: Stage2WorkerProfileExecutionMode;
  styleCard: Stage2WorkerProfileStyleCard;
};

export const DEFAULT_STAGE2_WORKER_PROFILE_ID: Stage2WorkerProfileId =
  STAGE2_SINGLE_BASELINE_PROFILE_ID;

const SINGLE_BASELINE_STYLE_CARD: Stage2WorkerProfileStyleCard = {
  channel_voice: {
    core_tone:
      "dense, grounded, context-first, anti-meta, human on the release, never documentary and never commentary about the audience or the edit",
    best_at: [
      "compressed contextual paraphrase",
      "fast event grounding before inference",
      "paradox-first hooks without media commentary",
      "human release after the explanation",
      "clean one-shot caption writing from video truth"
    ],
    avoid: [
      "edit commentary",
      "comment-section narration",
      "preset lane logic",
      "style-library borrowing",
      "generic clean-English filler"
    ]
  },
  hook_rules: [
    "Ground the event before the inference.",
    "Use comments only as weak phrasing hints, never as the narrator stance.",
    "Treat video truth and hard constraints as the real authority."
  ],
  bottom_rules: [
    "Release into the human read, consequence, or punchline without audience commentary.",
    "Do not restate the top.",
    "Keep the line human, lived-in, and visually defensible."
  ],
  positive_micro_moves: [
    "context before inference",
    "anti-meta paraphrase",
    "specific visible nouns",
    "human release",
    "exact-length discipline"
  ],
  negative_micro_moves: [
    "clip commentary",
    "comment-section narration",
    "borrowed stylistic presets",
    "lane-filler variants",
    "generic safe sludge"
  ]
};

function createProfile(
  definition: Omit<Stage2WorkerProfileDefinition, "styleCard"> & {
    styleCard?: Stage2WorkerProfileStyleCard;
  }
): Stage2WorkerProfileDefinition {
  return {
    ...definition,
    styleCard: definition.styleCard ?? SINGLE_BASELINE_STYLE_CARD
  };
}

const STAGE2_WORKER_PROFILES: Record<Stage2WorkerProfileId, Stage2WorkerProfileDefinition> = {
  stable_reference_v7: createProfile({
    id: "stable_reference_v7",
    label: "Stable Reference",
    description:
      "The only active Stage 2 baseline: a video-first, context-first one-shot pipeline with weak comments hints and no style-learning steering.",
    summary:
      "Writes captions directly from video truth, bounded comments hints, hard constraints, and user instruction. No line selector, lane plan, examples corpus, or editorial-memory steering is active.",
    executionMode: "one_shot_reference_v2",
    dominantWaveLanePlan: [],
    defaultLanePlan: [],
    active: true
  }),
  stable_reference_v6: createProfile({
    id: "stable_reference_v6",
    label: "Stable Reference v6",
    description:
      "Historical one-shot reference profile kept only for read compatibility with older runs and snapshots.",
    summary: "Historical profile. New Stage 2 runs no longer resolve to this line.",
    executionMode: "one_shot_reference_v1",
    dominantWaveLanePlan: [],
    defaultLanePlan: [],
    active: false
  }),
  stable_reference_v6_experimental: createProfile({
    id: "stable_reference_v6_experimental",
    label: "Stable Reference v6 Experimental",
    description:
      "Historical experimental one-shot profile kept only for read compatibility with older runs and snapshots.",
    summary: "Historical profile. Its behavior has been promoted into the current single baseline.",
    executionMode: "one_shot_reference_v1_experimental",
    dominantWaveLanePlan: [],
    defaultLanePlan: [],
    active: false
  }),
  stable_social_wave_v1: createProfile({
    id: "stable_social_wave_v1",
    label: "Stable Social Wave v1",
    description:
      "Historical modular profile kept only so older runs and traces can still render truthfully.",
    summary: "Historical modular profile. New Stage 2 runs no longer use modular native flow.",
    executionMode: "native_modular_v1",
    dominantWaveLanePlan: [],
    defaultLanePlan: [],
    active: false
  }),
  stable_skill_gap_v1: createProfile({
    id: "stable_skill_gap_v1",
    label: "Stable Skill Gap v1",
    description:
      "Historical modular profile kept only so older runs and traces can still render truthfully.",
    summary: "Historical modular profile. New Stage 2 runs no longer use modular native flow.",
    executionMode: "native_modular_v1",
    dominantWaveLanePlan: [],
    defaultLanePlan: [],
    active: false
  }),
  experimental: createProfile({
    id: "experimental",
    label: "Experimental",
    description:
      "Historical modular profile kept only so older runs and traces can still render truthfully.",
    summary: "Historical modular profile. New Stage 2 runs no longer use modular native flow.",
    executionMode: "native_modular_v1",
    dominantWaveLanePlan: [],
    defaultLanePlan: [],
    active: false
  })
};

function sanitizeStage2WorkerProfileId(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

export function isStage2WorkerProfileId(value: unknown): value is Stage2WorkerProfileId {
  return STAGE2_WORKER_PROFILE_IDS.includes(value as Stage2WorkerProfileId);
}

export function normalizeStage2WorkerProfileId(value: unknown): Stage2WorkerProfileId | null {
  const trimmed = sanitizeStage2WorkerProfileId(value);
  return trimmed && isStage2WorkerProfileId(trimmed) ? trimmed : null;
}

export function parseStage2WorkerProfileId(value: unknown): string | null {
  const trimmed = sanitizeStage2WorkerProfileId(value);
  if (!trimmed) {
    return null;
  }
  if (!isStage2WorkerProfileId(trimmed)) {
    throw new Error("Unknown Stage 2 platform line.");
  }
  return trimmed;
}

export function resolveStage2WorkerProfile(value: unknown): ResolvedStage2WorkerProfile {
  const requestedId = sanitizeStage2WorkerProfileId(value);
  const normalizedRequestedId = normalizeStage2WorkerProfileId(requestedId);
  const resolvedId = normalizedRequestedId ?? DEFAULT_STAGE2_WORKER_PROFILE_ID;
  const definition = STAGE2_WORKER_PROFILES[resolvedId];
  return {
    requestedId,
    resolvedId,
    label: definition.label,
    description: definition.description,
    summary: definition.summary,
    origin: normalizedRequestedId ? "channel_setting" : "default_baseline",
    executionMode: definition.executionMode,
    styleCard: definition.styleCard
  };
}

export function listStage2WorkerProfiles(): Stage2WorkerProfileDefinition[] {
  return STAGE2_ACTIVE_WORKER_PROFILE_IDS.map((id) => STAGE2_WORKER_PROFILES[id]);
}

export function isReferenceOneShotExecutionMode(
  value: Stage2WorkerProfileExecutionMode
): boolean {
  return (
    value === "one_shot_reference_v2" ||
    value === "one_shot_reference_v1" ||
    value === "one_shot_reference_v1_experimental"
  );
}

export function buildStage2WorkerProfilePromptPayload(
  profile: ResolvedStage2WorkerProfile
): Record<string, unknown> {
  return {
    id: profile.resolvedId,
    label: profile.label,
    description: profile.description,
    summary: profile.summary,
    origin: profile.origin,
    execution_mode: profile.executionMode,
    style_card: profile.styleCard
  };
}

export function buildStage2WorkerProfileRequiredLanes(input: {
  profileId: Stage2WorkerProfileId;
  dominantWave: boolean;
  weakWave: boolean;
}): Stage2WorkerProfileLanePreset[] {
  const profile = STAGE2_WORKER_PROFILES[input.profileId] ?? STAGE2_WORKER_PROFILES[DEFAULT_STAGE2_WORKER_PROFILE_ID];
  if (input.dominantWave && !input.weakWave) {
    return profile.dominantWaveLanePlan.map((entry) => ({ ...entry }));
  }
  return profile.defaultLanePlan.map((entry) => ({ ...entry }));
}
