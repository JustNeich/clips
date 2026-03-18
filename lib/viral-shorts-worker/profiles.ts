import {
  HardConstraints,
  SourceChannelConfig,
  ViralShortsChannelProfile
} from "./types";

export const BASE_CONSTRAINTS: HardConstraints = {
  topLengthMin: 175,
  topLengthMax: 180,
  bottomLengthMin: 140,
  bottomLengthMax: 150,
  bottomQuoteRequired: true,
  bannedWords: [
    "testament",
    "showcase",
    "unleash",
    "masterclass",
    "symphony",
    "tapestry",
    "vibe",
    "literally",
    "seamless",
    "elevate",
    "realm"
  ],
  bannedOpeners: ["In this video we see", "Here is a"]
};

export const ALLOWED_ANGLES: Record<string, string[]> = {
  country_life: [
    "insider_expertise",
    "tension_danger",
    "absurdity_chaos",
    "competence_process",
    "shared_experience",
    "warmth_reverence",
    "payoff_reveal"
  ],
  workers: [
    "insider_expertise",
    "tension_danger",
    "absurdity_chaos",
    "competence_process",
    "shared_experience",
    "payoff_reveal"
  ],
  military: [
    "awe_scale",
    "tension_danger",
    "shared_experience",
    "warmth_reverence",
    "payoff_reveal"
  ],
  animals: [
    "tension_danger",
    "absurdity_chaos",
    "shared_experience",
    "warmth_reverence",
    "payoff_reveal",
    "awe_scale"
  ],
  science_curiosity: ["awe_scale", "absurdity_chaos", "competence_process", "payoff_reveal"],
  turbo_offroad: [
    "insider_expertise",
    "tension_danger",
    "absurdity_chaos",
    "competence_process",
    "shared_experience",
    "payoff_reveal"
  ]
};

export const SOURCE_CHANNELS: SourceChannelConfig[] = [
  {
    sourceChannelId: "disaster_strucks",
    name: "Disaster Strucks",
    url: "https://www.youtube.com/channel/UCxh2HY36ogM5CMrnXpZ3zSQ",
    archetype: "animals"
  },
  {
    sourceChannelId: "jaqqsa",
    name: "Jaqqsa",
    url: "https://www.youtube.com/channel/UC2AA6zAsKcP9h3Lsk-gKDGA",
    archetype: "animals"
  },
  {
    sourceChannelId: "bob_the_bear",
    name: "Bob the Bear",
    url: "https://www.youtube.com/channel/UCDNPs0HJyIfDizMmCyVL_wQ",
    archetype: "animals"
  },
  {
    sourceChannelId: "stone_face_patriot",
    name: "Stone Face Patriot",
    url: "https://www.youtube.com/channel/UCN0dPr34mWi-Ujqat_5Vaog",
    archetype: "military"
  },
  {
    sourceChannelId: "stone_face_tradesmen",
    name: "Stone Face Tradesmen",
    url: "https://www.youtube.com/channel/UCuQ3OOZsc0O5jb2_wvuNtzw",
    archetype: "workers"
  },
  {
    sourceChannelId: "stone_face_country",
    name: "Stone Face Country",
    url: "https://www.youtube.com/@SFCountry",
    archetype: "country_life"
  },
  {
    sourceChannelId: "true_country",
    name: "True Country",
    url: "https://www.youtube.com/@TrueCountryDaily",
    archetype: "country_life"
  },
  {
    sourceChannelId: "the_uncle_rock",
    name: "The Uncle Rock",
    url: "https://www.youtube.com/@TheUncleRockZone/shorts",
    archetype: "country_life",
    owned: true
  },
  {
    sourceChannelId: "martin_the_worker",
    name: "Martin The Worker",
    url: "https://www.youtube.com/@MartinTheWorker/shorts",
    archetype: "workers",
    owned: true
  },
  {
    sourceChannelId: "echoes_of_honor",
    name: "Echoes of Honor",
    url: "https://www.youtube.com/@EchoesOfHonor50",
    archetype: "military",
    owned: true
  },
  {
    sourceChannelId: "zackthezison",
    name: "Zackthezison",
    url: "https://www.youtube.com/@zackthezison",
    archetype: "animals",
    owned: true
  },
  {
    sourceChannelId: "american_news",
    name: "AMERICAN NEWS",
    url: "https://www.youtube.com/@amnnews9",
    archetype: "animals",
    owned: true
  },
  {
    sourceChannelId: "science_snack",
    name: "Science Snack",
    url: "https://www.youtube.com/@Science_Snack_1",
    archetype: "science_curiosity",
    owned: true
  },
  {
    sourceChannelId: "stone_face_turbo",
    name: "Stone Face Turbo",
    url: "https://www.youtube.com/@StoneFaceTurbo",
    archetype: "turbo_offroad",
    owned: true
  }
];

export const VIRAL_SHORTS_CHANNEL_PROFILES: ViralShortsChannelProfile[] = [
  {
    channelId: "the_uncle_rock",
    name: "The Uncle Rock",
    url: "https://www.youtube.com/@TheUncleRockZone/shorts",
    language: "en",
    archetype: "country_life",
    audience: "US blue-collar, truck, farm, mechanic humor audience",
    voiceNotes: ["blue-collar insider voice", "dry humor beats hype", "observational and slightly cynical"],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: ["stone_face_country", "true_country"],
    stableSourceIds: ["stone_face_country", "true_country", "the_uncle_rock"],
    hotPoolEnabled: true,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  },
  {
    channelId: "martin_the_worker",
    name: "Martin The Worker",
    url: "https://www.youtube.com/@MartinTheWorker/shorts",
    language: "en",
    archetype: "workers",
    audience: "US working-class and skilled labor audience",
    voiceNotes: ["respect competence", "call out risk clearly", "sound like someone who's seen job sites before"],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: ["stone_face_tradesmen"],
    stableSourceIds: ["stone_face_tradesmen", "martin_the_worker"],
    hotPoolEnabled: true,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  },
  {
    channelId: "echoes_of_honor",
    name: "Echoes of Honor",
    url: "https://www.youtube.com/@EchoesOfHonor50",
    language: "en",
    archetype: "military",
    audience: "US military-curious and patriotic audience",
    voiceNotes: ["awe without marketing tone", "respect scale and risk", "keep it grounded in what the viewer sees"],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: ["stone_face_patriot"],
    stableSourceIds: ["stone_face_patriot", "echoes_of_honor"],
    hotPoolEnabled: true,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  },
  {
    channelId: "zackthezison",
    name: "Zackthezison",
    url: "https://www.youtube.com/@zackthezison",
    language: "en",
    archetype: "animals",
    audience: "US audience for animals, wildlife, farm humor, and cute chaos",
    voiceNotes: [
      "human observational tone",
      "react like a sharp commenter, not a documentarian",
      "favor warmth or absurdity depending on the clip"
    ],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: ["disaster_strucks", "jaqqsa", "bob_the_bear"],
    stableSourceIds: ["disaster_strucks", "jaqqsa", "bob_the_bear", "zackthezison"],
    hotPoolEnabled: true,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  },
  {
    channelId: "american_news",
    name: "AMERICAN NEWS",
    url: "https://www.youtube.com/@amnnews9",
    language: "en",
    archetype: "animals",
    audience: "US audience for animal spectacle and farm incidents",
    voiceNotes: [
      "action-first animal commentary",
      "humor should feel human, not cute for the sake of cute",
      "keep the overlay visually anchored"
    ],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: ["disaster_strucks", "jaqqsa", "bob_the_bear"],
    stableSourceIds: ["disaster_strucks", "jaqqsa", "bob_the_bear", "american_news"],
    hotPoolEnabled: true,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  },
  {
    channelId: "science_snack",
    name: "Science Snack",
    url: "https://www.youtube.com/@Science_Snack_1",
    language: "en",
    archetype: "science_curiosity",
    audience: "US audience for weird engineering, natural anomalies, and curiosity-driven spectacle",
    voiceNotes: ["curiosity over lecture", "still grounded in the visible moment", "prefer sharp contrast and payoff"],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: [],
    stableSourceIds: ["science_snack"],
    hotPoolEnabled: false,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  },
  {
    channelId: "stone_face_turbo",
    name: "Stone Face Turbo",
    url: "https://www.youtube.com/@StoneFaceTurbo",
    language: "en",
    archetype: "turbo_offroad",
    audience: "US off-road, snow-recovery, and diesel truck audience",
    voiceNotes: ["mechanic-adjacent and dry", "respect the setup and the failure equally", "sound like a forum regular, not a hype editor"],
    hardConstraints: BASE_CONSTRAINTS,
    competitorSourceIds: [],
    stableSourceIds: ["stone_face_turbo"],
    hotPoolEnabled: false,
    hotPoolLimit: 10,
    hotPoolPerSourceLimit: 2,
    hotPoolTtlDays: 10,
    hotPoolLookbackHours: 72,
    latestFetchLimit: 30,
    popularFetchLimit: 30
  }
];

export const VIRAL_SHORTS_CHANNEL_PROFILES_BY_ID = Object.fromEntries(
  VIRAL_SHORTS_CHANNEL_PROFILES.map((profile) => [profile.channelId, profile])
) as Record<string, ViralShortsChannelProfile>;

export const SOURCE_CHANNELS_BY_ID = Object.fromEntries(
  SOURCE_CHANNELS.map((source) => [source.sourceChannelId, source])
) as Record<string, SourceChannelConfig>;

export function listViralShortsProfileOptions(): Array<{
  id: string;
  label: string;
  archetype: string;
  hotPoolEnabled: boolean;
}> {
  return VIRAL_SHORTS_CHANNEL_PROFILES.map((profile) => ({
    id: profile.channelId,
    label: profile.name,
    archetype: profile.archetype,
    hotPoolEnabled: profile.hotPoolEnabled
  }));
}

export function resolveProfileIdFromUsername(username: string | null | undefined): string | null {
  const normalized = String(username ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  if (!normalized) {
    return null;
  }

  if (VIRAL_SHORTS_CHANNEL_PROFILES_BY_ID[normalized]) {
    return normalized;
  }

  const match = VIRAL_SHORTS_CHANNEL_PROFILES.find(
    (profile) =>
      profile.name.toLowerCase() === normalized ||
      profile.url.toLowerCase().includes(`@${normalized}`)
  );
  return match?.channelId ?? null;
}
