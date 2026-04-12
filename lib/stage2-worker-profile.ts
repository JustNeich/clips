export const STAGE2_WORKER_PROFILE_IDS = [
  "stable_reference_v6",
  "stable_reference_v6_experimental",
  "stable_social_wave_v1",
  "stable_skill_gap_v1",
  "experimental"
] as const;

export type Stage2WorkerProfileId = (typeof STAGE2_WORKER_PROFILE_IDS)[number];

export type Stage2WorkerProfileOrigin = "channel_setting" | "default_baseline";
export type Stage2WorkerProfileExecutionMode =
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

export const DEFAULT_STAGE2_WORKER_PROFILE_ID: Stage2WorkerProfileId = "stable_reference_v6";

const STAGE2_WORKER_PROFILES: Record<Stage2WorkerProfileId, Stage2WorkerProfileDefinition> = {
  stable_reference_v6: {
    id: "stable_reference_v6",
    label: "Stable Reference v6",
    description:
      "Production baseline for the proven benchmark DNA: dense explanatory or paradox-forward TOP, human or punchline BOTTOM, grounded in benchmark-style narration.",
    summary:
      "Use the benchmark narrator DNA as the baseline. TOP should explain the contradiction or hidden rule early; BOTTOM should cash it out with a human or punchline read instead of generic commentary.",
    executionMode: "one_shot_reference_v1",
    styleCard: {
      channel_voice: {
        core_tone:
          "dense, grounded, explanatory, paradox-aware, human on the release, never documentary",
        best_at: [
          "compressed explanatory turns",
          "paradox-first hooks",
          "earned respect without ad copy",
          "human punchline payoffs",
          "benchmark-like narrator density"
        ],
        avoid: [
          "inventory openings",
          "flat documentary recap",
          "marketing awe language",
          "vague editorial abstraction",
          "generic clean-English filler"
        ]
      },
      hook_rules: [
        "TOP should explain the contradiction or hidden rule in the first clause",
        "Prefer explanatory compression over scene logging",
        "If the benchmark DNA fits, let the hook feel denser than casual social copy"
      ],
      bottom_rules: [
        "BOTTOM should pivot into a human or punchline release",
        "BOTTOM must not restate the explanation verbatim",
        "Respect warmth or amused disbelief when the clip earns it"
      ],
      positive_micro_moves: [
        "dense but readable first clause",
        "paradox or hidden-rule framing",
        "human release after the explanation",
        "benchmark-style confidence without hype"
      ],
      negative_micro_moves: [
        "beat logging",
        "documentary nouns before the hook",
        "empty competence worship",
        "clean but lifeless fallback copy"
      ]
    },
    dominantWaveLanePlan: [
      {
        laneId: "audience_locked_reference",
        count: 2,
        purpose: "Preserve the harmless public handle without losing the benchmark explanatory DNA."
      },
      {
        laneId: "explanatory_paradox",
        count: 3,
        purpose: "TOP should explain the contradiction or hidden rule as early as possible."
      },
      {
        laneId: "human_punchline",
        count: 2,
        purpose: "BOTTOM should release into a human or punchline read rather than abstract commentary."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Keep one cleaner fallback alive for display safety."
      }
    ],
    defaultLanePlan: [
      {
        laneId: "explanatory_paradox",
        count: 4,
        purpose: "TOP should explain the contradiction or hidden rule as early as possible."
      },
      {
        laneId: "human_punchline",
        count: 2,
        purpose: "BOTTOM should release into a human or punchline read rather than abstract commentary."
      },
      {
        laneId: "earned_reaction",
        count: 1,
        purpose: "Catch the strongest grounded human reaction without going soft."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Keep one cleaner fallback alive for display safety."
      }
    ]
  },
  stable_reference_v6_experimental: {
    id: "stable_reference_v6_experimental",
    label: "Stable Reference v6 Experimental",
    description:
      "Isolated experimental one-shot baseline for benchmark DNA with context-first anti-meta guardrails, stronger same-line learning, and weaker comment-wave steering under weak grounding.",
    summary:
      "Keep the benchmark explanatory density, but force context-first paraphrase instead of edit/commentary language. This line promotes matching-line editor feedback more aggressively and treats weakly grounded comments as secondary hints rather than narrator stance.",
    executionMode: "one_shot_reference_v1_experimental",
    styleCard: {
      channel_voice: {
        core_tone:
          "dense, grounded, explanatory, context-first, human on the release, never documentary and never meta about the clip itself",
        best_at: [
          "compressed contextual paraphrase",
          "paradox-first hooks without edit commentary",
          "human release after the explanation",
          "benchmark-like narrator density with stricter grounding",
          "using channel rules as active framing boundaries"
        ],
        avoid: [
          "edit or video commentary",
          "comment-section narration",
          "inventory openings",
          "flat documentary recap",
          "generic clean-English filler"
        ]
      },
      hook_rules: [
        "TOP should establish the event context first, then compress the contradiction or hidden rule",
        "Paraphrase visible or textual context as the world of the clip, not as commentary about the clip",
        "If grounding is weak, do not let audience reaction phrasing replace context"
      ],
      bottom_rules: [
        "BOTTOM should release into a human or punchline read without talking about viewers or comments",
        "BOTTOM must not restate the explanation verbatim",
        "Editorial memory hard rules override comment-wave stylistic habits in this line"
      ],
      positive_micro_moves: [
        "context before inference",
        "anti-meta paraphrase",
        "human release after the explanation",
        "benchmark-style confidence without edit commentary"
      ],
      negative_micro_moves: [
        "clip-edit commentary",
        "comment-section narration",
        "empty competence worship",
        "clean but lifeless fallback copy"
      ]
    },
    dominantWaveLanePlan: [
      {
        laneId: "context_first_reference",
        count: 3,
        purpose: "Open with the actual event context before the explanatory turn."
      },
      {
        laneId: "explanatory_paradox",
        count: 2,
        purpose: "TOP should still explain the contradiction or hidden rule early."
      },
      {
        laneId: "human_punchline",
        count: 2,
        purpose: "BOTTOM should release into a human or punchline read instead of audience commentary."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Keep one cleaner fallback alive for display safety."
      }
    ],
    defaultLanePlan: [
      {
        laneId: "context_first_reference",
        count: 3,
        purpose: "Open with the actual event context before the explanatory turn."
      },
      {
        laneId: "explanatory_paradox",
        count: 2,
        purpose: "TOP should still explain the contradiction or hidden rule early."
      },
      {
        laneId: "human_punchline",
        count: 2,
        purpose: "BOTTOM should release into a human or punchline read instead of audience commentary."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Keep one cleaner fallback alive for display safety."
      }
    ]
  },
  stable_social_wave_v1: {
    id: "stable_social_wave_v1",
    label: "Stable Social Wave v1",
    description:
      "For Popvein-like social clips where public handle, comment wave, and comment-native phrasing must survive the pipeline instead of being sanded into clean generic English.",
    summary:
      "Let the dominant harmless handle and comment-native wave stay alive. Prioritize social-read pressure, comment-native phrasing, and sharp human observation over benchmark density.",
    executionMode: "native_modular_v1",
    styleCard: {
      channel_voice: {
        core_tone:
          "human, public-facing, socially observant, comment-native, quick to read, never synthetic",
        best_at: [
          "dominant harmless handles",
          "comment-native phrasing",
          "social pressure and public read",
          "micro-hesitation or side-eye",
          "clean but lived-in wave preservation"
        ],
        avoid: [
          "benchmark-style over-explaining when the clip wants social wave",
          "sanding the public handle into generic English",
          "fake pseudo-slang",
          "PR or analyst tone",
          "sterile summary copy"
        ]
      },
      hook_rules: [
        "If a harmless public handle exists, preserve it naturally",
        "TOP should carry the social wave early instead of replacing it with cleaner copy",
        "Use comment-native phrasing when it sharpens the clip safely"
      ],
      bottom_rules: [
        "BOTTOM should feel like a lived-in reaction from the same public wave",
        "BOTTOM should sharpen the social consequence or room read",
        "Do not over-explain what the audience already named well"
      ],
      positive_micro_moves: [
        "public-handle retention",
        "comment-native but still readable",
        "human room read",
        "quick social consequence"
      ],
      negative_micro_moves: [
        "generic clean-English smoothing",
        "synthetic editorial slang",
        "benchmark-density where the clip wants breezier public phrasing",
        "dead fallback wording"
      ]
    },
    dominantWaveLanePlan: [
      {
        laneId: "audience_locked",
        count: 3,
        purpose: "Preserve the dominant harmless handle or public read directly."
      },
      {
        laneId: "comment_native",
        count: 2,
        purpose: "Keep the copy comment-native instead of smoothing it into generic English."
      },
      {
        laneId: "human_observational",
        count: 2,
        purpose: "Catch the strongest human micro-read without losing the public wave."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Keep one simpler fallback that is still socially alive."
      }
    ],
    defaultLanePlan: [
      {
        laneId: "comment_native",
        count: 3,
        purpose: "Keep the copy comment-native instead of smoothing it into generic English."
      },
      {
        laneId: "balanced_clean",
        count: 2,
        purpose: "Stay clear and readable without erasing the social read."
      },
      {
        laneId: "human_observational",
        count: 2,
        purpose: "Catch the strongest human micro-read without meme overkill."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Keep one simpler fallback that is still socially alive."
      }
    ]
  },
  stable_skill_gap_v1: {
    id: "stable_skill_gap_v1",
    label: "Stable Skill Gap v1",
    description:
      "For LaunchMind-like clips where the caption wins by compressing a competence gap, hidden process miss, or painful contrast between what should happen and what actually happens.",
    summary:
      "Prioritize skill-gap explanation, hidden process misses, and practical consequence. Let TOP compress the competence gap fast; let BOTTOM land the human or consequence read without jargon sludge.",
    executionMode: "native_modular_v1",
    styleCard: {
      channel_voice: {
        core_tone:
          "clear, compressed, process-aware, competence-gap focused, human on consequence, never corporate",
        best_at: [
          "skill-gap explanation",
          "hidden process miss",
          "practical consequence",
          "compressed teacherly clarity",
          "human frustration without boardroom tone"
        ],
        avoid: [
          "social-wave phrasing when the clip needs explanation",
          "benchmark poetry without concrete mechanism",
          "startup or productivity cliches",
          "consulting English",
          "template-safe vagueness"
        ]
      },
      hook_rules: [
        "TOP should compress the competence gap or hidden miss immediately",
        "Explain what is wrong, missing, or mismatched without turning into a lecture",
        "Prefer concrete process contrast over abstract motivation talk"
      ],
      bottom_rules: [
        "BOTTOM should land the practical consequence, frustration, or human cost",
        "BOTTOM must stay human instead of sounding like a postmortem",
        "If there is a mild public read, keep it supporting rather than primary"
      ],
      positive_micro_moves: [
        "competence-gap compression",
        "practical consequence",
        "clear process contrast",
        "human frustration or respect"
      ],
      negative_micro_moves: [
        "startup cliches",
        "social-wave copy pasted onto process clips",
        "generic inspiration language",
        "flat tutorial recap"
      ]
    },
    dominantWaveLanePlan: [
      {
        laneId: "skill_gap_explainer",
        count: 3,
        purpose: "Compress the competence gap or hidden miss quickly."
      },
      {
        laneId: "competence_consequence",
        count: 2,
        purpose: "Land the practical outcome or human cost of the gap."
      },
      {
        laneId: "audience_locked_supporting",
        count: 1,
        purpose: "Keep one public-handle-aware route only if the harmless handle is genuinely useful."
      },
      {
        laneId: "plain_backup",
        count: 2,
        purpose: "Hold cleaner backup routes that stay explanatory."
      }
    ],
    defaultLanePlan: [
      {
        laneId: "skill_gap_explainer",
        count: 4,
        purpose: "Compress the competence gap or hidden miss quickly."
      },
      {
        laneId: "competence_consequence",
        count: 2,
        purpose: "Land the practical outcome or human cost of the gap."
      },
      {
        laneId: "human_process_read",
        count: 1,
        purpose: "Catch the most human or practical process read."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Hold a cleaner explanatory fallback."
      }
    ]
  },
  experimental: {
    id: "experimental",
    label: "Experimental",
    description:
      "Looser exploratory line for side-by-side experiments. Keeps stronger novelty pressure and a wider risk envelope, but still respects hard validity.",
    summary:
      "Use broader exploratory space and permit one or two bolder framing attempts, while still obeying visual truth and deterministic validity.",
    executionMode: "native_modular_v1",
    styleCard: {
      channel_voice: {
        core_tone:
          "adaptive, sharp, novelty-seeking, still grounded, willing to push one bolder read",
        best_at: [
          "novel but safe hook attempts",
          "strong contrast experiments",
          "alternative framing pressure",
          "finding one sharper angle without full derailment"
        ],
        avoid: [
          "reckless invention",
          "non-native flourishes",
          "novelty for its own sake",
          "template-safe blandness"
        ]
      },
      hook_rules: [
        "Keep visual truth first even when exploring harder angles",
        "At least one route may push a bolder but still defensible read",
        "Do not let experimentation collapse the whole batch into one gimmick"
      ],
      bottom_rules: [
        "BOTTOM may push a sharper payoff, but still has to feel human",
        "Keep one cleaner route in reserve",
        "Novelty should improve why-care, not just sound different"
      ],
      positive_micro_moves: [
        "one sharper read",
        "novel but grounded phrasing",
        "clear why-care contrast",
        "exploratory variety"
      ],
      negative_micro_moves: [
        "wild unsupported claims",
        "all eight candidates feeling like experiments",
        "forced novelty",
        "losing the display-safe reserve"
      ]
    },
    dominantWaveLanePlan: [
      {
        laneId: "audience_locked",
        count: 2,
        purpose: "Keep the harmless public read alive if it is clearly dominant."
      },
      {
        laneId: "bolder_safe",
        count: 2,
        purpose: "Push one or two sharper but still defensible reads."
      },
      {
        laneId: "human_observational",
        count: 2,
        purpose: "Keep the strongest human micro-read in the batch."
      },
      {
        laneId: "plain_backup",
        count: 2,
        purpose: "Reserve cleaner display-safe options."
      }
    ],
    defaultLanePlan: [
      {
        laneId: "bolder_safe",
        count: 3,
        purpose: "Push one or two sharper but still defensible reads."
      },
      {
        laneId: "human_observational",
        count: 2,
        purpose: "Keep the strongest human micro-read in the batch."
      },
      {
        laneId: "contrast_first",
        count: 2,
        purpose: "Try a stronger contrast framing if the clip supports it."
      },
      {
        laneId: "plain_backup",
        count: 1,
        purpose: "Reserve one cleaner display-safe option."
      }
    ]
  }
};

function sanitizeStage2WorkerProfileId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const resolvedId = normalizeStage2WorkerProfileId(requestedId) ?? DEFAULT_STAGE2_WORKER_PROFILE_ID;
  const definition = STAGE2_WORKER_PROFILES[resolvedId];
  return {
    requestedId,
    resolvedId,
    label: definition.label,
    description: definition.description,
    summary: definition.summary,
    origin: normalizeStage2WorkerProfileId(requestedId) ? "channel_setting" : "default_baseline",
    executionMode: definition.executionMode,
    styleCard: definition.styleCard
  };
}

export function listStage2WorkerProfiles(): Stage2WorkerProfileDefinition[] {
  return STAGE2_WORKER_PROFILE_IDS.map((id) => STAGE2_WORKER_PROFILES[id]);
}

export function isReferenceOneShotExecutionMode(
  value: Stage2WorkerProfileExecutionMode
): boolean {
  return value === "one_shot_reference_v1" || value === "one_shot_reference_v1_experimental";
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
  const profile = STAGE2_WORKER_PROFILES[input.profileId];
  if (input.dominantWave && !input.weakWave) {
    return profile.dominantWaveLanePlan.map((entry) => ({ ...entry }));
  }
  return profile.defaultLanePlan.map((entry) => ({ ...entry }));
}
