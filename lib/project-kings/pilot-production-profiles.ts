import {
  CHANNEL_PRODUCTION_PROFILE_VERSION,
  CONCEPT_CONTRACT_VERSION,
  defineChannelProductionProfile
} from "./channel-production-profile";
import { COPSCOPES_PROJECT_KINGS_PROFILE } from "./copscopes-production-profile";

export const INFAMOUS_SHARED_TEMPLATE_SHA =
  "b491e55267c73bd1315f26b2a7641b0865b7bcef8ca428c88df12baaa1a4c904";

const COMMON_RETRY_POLICY = {
  strategy: "exponential" as const,
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  retryableErrorCodes: ["network_error", "provider_5xx", "rate_limit", "lease_lost"],
  nonRetryableErrorCodes: [
    "invalid_credentials",
    "concept_mismatch",
    "visual_quality_rejected",
    "copyright_block"
  ]
};

const FOUR_SLOT_GRID = [
  { slotId: "daily-1", localTime: "21:00" },
  { slotId: "daily-2", localTime: "21:15" },
  { slotId: "daily-3", localTime: "21:30" },
  { slotId: "daily-4", localTime: "21:45" }
];

const PILOT_LIMITS = {
  dailyPublicationLimit: 3,
  maxCandidatesPerRun: 9,
  maxConcurrentSourceJobs: 1,
  maxConcurrentModelCalls: 3,
  maxConcurrentRenders: 1
};

export const DARK_JOY_BOY_PROJECT_KINGS_PROFILE = defineChannelProductionProfile({
  profileVersion: CHANNEL_PRODUCTION_PROFILE_VERSION,
  profileId: "4b59c5cf412e4c07b192f3312361c2eb",
  youtube: {
    channelId: "UCwO37rtHMhHX8caUr5Rc0Bw",
    titleAdvisory: "Tiger the Apex"
  },
  templateIdentity: {
    channelId: "4b59c5cf412e4c07b192f3312361c2eb",
    templateSha: INFAMOUS_SHARED_TEMPLATE_SHA
  },
  concept: {
    contractVersion: CONCEPT_CONTRACT_VERSION,
    conceptId: "human-exotic-animal-contact",
    label: "Close human contact with exotic animals",
    conceptShape: "channel",
    instagramCoherence: "pass",
    channelPromise:
      "One close, emotionally readable human interaction with an exotic animal in every Short.",
    axes: {
      audience:
        "English-speaking viewers drawn to warm, surprising, or awe-filled contact with exotic animals.",
      source: {
        platform: "instagram",
        mediaType: "reel",
        description:
          "Instagram Reels from reviewed keepers and wildlife parks showing a human and an exotic animal together."
      },
      event:
        "One continuous visible interaction such as feeding, bathing, swimming, embracing, grooming, or playful contact.",
      emotion:
        "Warmth, trust, delight, or respectful awe created by the animal's visible response to a person.",
      reasonToWatch:
        "See how an exotic animal reacts at close range and receive a clear emotional payoff without invented danger.",
      format:
        "One clean vertical or crop-safe interaction clip under a top-and-bottom card; never a multi-animal compilation."
    },
    inclusions: [
      "A keeper feeds or bathes a primate, big cat, or other exotic animal.",
      "A person and an exotic animal visibly embrace, play, swim, or move together.",
      "A wildlife-park encounter where the human-animal contact is the main visible event.",
      "A calm close-range bond with a visible response from both the person and the animal."
    ],
    exclusions: [
      "Ordinary pets, farm animals, or wildlife footage without a person in frame.",
      "Animal distress, cruelty, staged danger, or unsupported threat claims.",
      "Compilations containing unrelated animals, visitors, or locations.",
      "Police incidents, AI fiction mashups, talking heads, and product advertising.",
      "Large burned-in captions or donor branding over the interaction."
    ],
    adjacentCategories: [
      {
        categoryId: "ordinary-pet-moments",
        difference:
          "Dogs, cats, and farm animals are outside the exotic-animal promise even when the interaction is warm."
      },
      {
        categoryId: "wildlife-observation",
        difference:
          "An exotic animal alone is insufficient; a visible human-animal interaction must drive the event."
      },
      {
        categoryId: "animal-danger-footage",
        difference:
          "The channel supplies readable contact and emotion, not distress, attack spectacle, or invented danger."
      }
    ],
    positiveExamples: [
      {
        id: "dark-positive-Cxb0DmpJ7oM",
        url: "https://www.instagram.com/reel/Cxb0DmpJ7oM/",
        storyEventId: "event-towel-wrapped-spider-monkey-held-close",
        reason: "A man holds a towel-wrapped baby spider monkey close to his face in one warm interaction."
      },
      {
        id: "dark-positive-C9gLu79MklN",
        url: "https://www.instagram.com/reel/C9gLu79MklN/",
        storyEventId: "event-owner-feeds-and-plays-with-spider-monkey",
        reason: "The owner feeds and plays with a hand-raised spider monkey throughout one continuous clip."
      },
      {
        id: "dark-positive-BtDnmx6HRr_",
        url: "https://www.instagram.com/reel/BtDnmx6HRr_/",
        storyEventId: "event-man-wrestles-and-hugs-tiger",
        reason: "A man and a large tiger chase, embrace, and roll together with a clear affectionate payoff."
      },
      {
        id: "dark-positive-DIUYX9QStl3",
        url: "https://www.instagram.com/reel/DIUYX9QStl3/",
        storyEventId: "event-man-swims-embracing-chimpanzee",
        reason: "A man swims while holding a chimpanzee and both remain visibly engaged in the interaction."
      },
      {
        id: "dark-positive-CsYa4skNBjP",
        url: "https://www.instagram.com/reel/CsYa4skNBjP/",
        storyEventId: "event-man-bottle-feeds-lion",
        reason: "A man bottle-feeds a large lion and holds its paw in a close, readable encounter."
      },
      {
        id: "dark-positive-DKM66d2tamf",
        url: "https://www.instagram.com/reel/DKM66d2tamf/",
        storyEventId: "event-young-tiger-belly-rub",
        reason: "A young tiger rests on a man's lap, receives a belly rub, and licks his hand."
      },
      {
        id: "dark-positive-Cw_QTMmA69_",
        url: "https://www.instagram.com/reel/Cw_QTMmA69_/",
        storyEventId: "event-woman-bottle-feeds-liger",
        reason: "A woman bottle-feeds and strokes a giant liger in one sustained close-range moment."
      },
      {
        id: "dark-positive-C-0YpsCAODv",
        url: "https://www.instagram.com/reel/C-0YpsCAODv/",
        storyEventId: "event-chimpanzee-waves-from-womans-shoulders",
        reason: "A chimpanzee hangs from a woman's shoulders while both smile and wave at the camera."
      }
    ],
    negativeExamples: [
      {
        id: "dark-negative-C9d0ALvstDH",
        url: "https://www.instagram.com/reel/C9d0ALvstDH/",
        storyEventId: "reject-spider-monkey-alone",
        reason: "The monkey runs alone and no person appears, so the required contact event is absent."
      },
      {
        id: "dark-negative-C6weULIg7GK",
        url: "https://www.instagram.com/reel/C6weULIg7GK/",
        storyEventId: "reject-wildlife-park-compilation",
        reason: "Several unrelated animals and visitor encounters are cut together as a compilation."
      },
      {
        id: "dark-negative-CyWztiXACoC",
        url: "https://www.instagram.com/reel/CyWztiXACoC/",
        storyEventId: "reject-animal-to-animal-grooming",
        reason: "The clip shows one primate grooming another and contains no human interaction."
      },
      {
        id: "dark-negative-C_LN7npAcI4",
        url: "https://www.instagram.com/reel/C_LN7npAcI4/",
        storyEventId: "reject-safari-promotional-montage",
        reason: "The Reel is a promotional photo montage rather than one continuous encounter."
      },
      {
        id: "dark-negative-C5dfo8igsFA",
        url: "https://www.instagram.com/reel/C5dfo8igsFA/",
        storyEventId: "reject-animal-hug-with-large-hardsub",
        reason: "Large donor text covers the interaction area and makes the source unsuitable for the card."
      }
    ],
    evidenceBoundary: {
      categoryAuthority: "instagram",
      youtubeRole: "market-validation-only",
      youtubeCanWidenCategory: false
    },
    continuityBuffer: {
      uniqueStoryEventIds: [
        "event-towel-wrapped-spider-monkey-held-close",
        "event-owner-feeds-and-plays-with-spider-monkey",
        "event-man-wrestles-and-hugs-tiger",
        "event-man-swims-embracing-chimpanzee",
        "event-man-bottle-feeds-lion",
        "event-young-tiger-belly-rub",
        "event-woman-bottle-feeds-liger",
        "event-chimpanzee-waves-from-womans-shoulders"
      ]
    }
  },
  publication: {
    timezone: "Europe/Moscow",
    slots: FOUR_SLOT_GRID,
    limits: PILOT_LIMITS,
    retryPolicy: COMMON_RETRY_POLICY
  },
  credentialRefs: {
    youtubePublishing:
      "credential-ref://clips/channel/4b59c5cf412e4c07b192f3312361c2eb/youtube-publishing",
    instagramSource: "credential-ref://clips/workspace/instagram-source"
  }
});

export const LIGHT_KINGDOM_PROJECT_KINGS_PROFILE = defineChannelProductionProfile({
  profileVersion: CHANNEL_PRODUCTION_PROFILE_VERSION,
  profileId: "43923d42c1c0495282f29d4c6e09b0b4",
  youtube: {
    channelId: "UC0LWZYpYuYAWK55WmvDqxbg",
    titleAdvisory: "THE LIGHT KINGDOM"
  },
  templateIdentity: {
    channelId: "43923d42c1c0495282f29d4c6e09b0b4",
    templateSha: INFAMOUS_SHARED_TEMPLATE_SHA
  },
  concept: {
    contractVersion: CONCEPT_CONTRACT_VERSION,
    conceptId: "recognizable-fiction-with-visible-ai-twist",
    label: "Recognizable fiction rebuilt with a visible AI twist",
    conceptShape: "channel",
    instagramCoherence: "pass",
    channelPromise:
      "One recognizable film or television scene transformed by a visible AI idea in every Short.",
    axes: {
      audience:
        "English-speaking viewers who recognize mainstream film and television and enjoy visual AI remixes.",
      source: {
        platform: "instagram",
        mediaType: "reel",
        description:
          "Instagram Reels establishing the fixed fiction-times-AI boundary through visible remakes, generated characters, or AI tools inside known scenes."
      },
      event:
        "A recognizable fictional scene develops into a visible AI-generated anomaly, character, remake, or changed payoff.",
      emotion:
        "Recognition followed by curiosity, surprise, or comedy when the AI alteration becomes visually clear.",
      reasonToWatch:
        "Identify the familiar scene and see the exact visual change created by the AI premise or remake.",
      format:
        "One short vertical or crop-safe scene with a readable visual AI payoff; never a talking-head explanation or audio-only parody."
    },
    inclusions: [
      "A known film or television scene visibly remade in another AI-generated style.",
      "A visible AI tool, AI persona, or generated character placed inside recognizable fiction.",
      "An AI-generated replacement ending or scene payoff that is understandable without sound.",
      "A short generated skit using recognizable fictional characters and a clear visual turn."
    ],
    exclusions: [
      "Unmodified film footage whose AI element exists only in voice or subtitles.",
      "Talking-head AI news, interviews, tutorials, and product demonstrations.",
      "Pure pop-culture mashups with no visible AI alteration.",
      "Police incidents, animal encounters, and unrelated viral footage.",
      "Dense burned-in subtitles, aggregator branding, or multi-scene compilations."
    ],
    adjacentCategories: [
      {
        categoryId: "ai-news-and-tutorials",
        difference:
          "AI discussion is not enough; the source must show a visible AI transformation inside recognizable fiction."
      },
      {
        categoryId: "ordinary-pop-culture-mashups",
        difference:
          "Combining two fictional properties without a visible AI premise does not satisfy the channel boundary."
      },
      {
        categoryId: "audio-only-ai-parody",
        difference:
          "AI voices over untouched film footage are rejected because the twist must remain readable without sound."
      }
    ],
    positiveExamples: [
      {
        id: "light-positive-DYWIdjSxbb7",
        url: "https://www.instagram.com/reel/DYWIdjSxbb7/",
        storyEventId: "event-claude-inside-the-office",
        reason: "The Office scene visibly contains the Claude identity and turns an AI tool into the fictional premise."
      },
      {
        id: "light-positive-DYpHeq4pM-R",
        url: "https://www.instagram.com/reel/DYpHeq4pM-R/",
        storyEventId: "event-ai-remakes-the-boys-ending",
        reason: "A recognizable The Boys ending is visibly regenerated into a different action payoff."
      },
      {
        id: "light-positive-DYuu2CVJc3G",
        url: "https://www.instagram.com/reel/DYuu2CVJc3G/",
        storyEventId: "event-michael-scott-onboards-karpathy",
        reason: "A generated Karpathy double appears inside The Office and makes the AI-fiction premise visible."
      }
    ],
    negativeExamples: [
      {
        id: "light-negative-DYvtDJEp24H",
        url: "https://www.instagram.com/reel/DYvtDJEp24H/",
        storyEventId: "reject-ai-news-talking-head",
        reason: "The source is a talking-head AI news clip with dense hard subtitles and no fiction remake."
      },
      {
        id: "light-negative-DW5oCZGjPCs",
        url: "https://www.instagram.com/reel/DW5oCZGjPCs/",
        storyEventId: "reject-police-firefight",
        reason: "Police bodycam footage has no recognizable fictional scene or visible AI transformation."
      },
      {
        id: "light-negative-DDR2PcXRP4j",
        url: "https://www.instagram.com/reel/DDR2PcXRP4j/",
        storyEventId: "reject-baby-monkey-bath",
        reason: "A real animal-care moment is outside both the fiction and AI axes."
      },
      {
        id: "light-negative-DXOzkCdjMue",
        url: "https://www.instagram.com/reel/DXOzkCdjMue/",
        storyEventId: "reject-police-suspect-on-car",
        reason: "A real pursuit event belongs to police footage and has no visible AI-fiction premise."
      },
      {
        id: "light-negative-DKVNp4JS57c",
        url: "https://www.instagram.com/reel/DKVNp4JS57c/",
        storyEventId: "reject-human-animal-pool-encounter",
        reason: "A real human-animal encounter is outside the recognizable-fiction AI-remake boundary."
      }
    ],
    evidenceBoundary: {
      categoryAuthority: "instagram",
      youtubeRole: "market-validation-only",
      youtubeCanWidenCategory: false
    },
    continuityBuffer: {
      uniqueStoryEventIds: [
        "event-claude-inside-the-office",
        "event-ai-remakes-the-boys-ending",
        "event-michael-scott-onboards-karpathy",
        "event-ai-remakes-shining-as-90s-sitcom",
        "event-ai-reimagines-terminator-mirror-scene",
        "event-ai-star-wars-jedi-council-vlog"
      ]
    }
  },
  publication: {
    timezone: "Europe/Moscow",
    slots: FOUR_SLOT_GRID,
    limits: PILOT_LIMITS,
    retryPolicy: COMMON_RETRY_POLICY
  },
  credentialRefs: {
    youtubePublishing:
      "credential-ref://clips/channel/43923d42c1c0495282f29d4c6e09b0b4/youtube-publishing",
    instagramSource: "credential-ref://clips/workspace/instagram-source"
  }
});

export const PROJECT_KINGS_PILOT_PROFILES = Object.freeze({
  "dark-joy-boy": DARK_JOY_BOY_PROJECT_KINGS_PROFILE,
  "light-kingdom": LIGHT_KINGDOM_PROJECT_KINGS_PROFILE,
  "copscopes-x2e": COPSCOPES_PROJECT_KINGS_PROFILE
});

export type ProjectKingsPilotProfileKey = keyof typeof PROJECT_KINGS_PILOT_PROFILES;

export function getProjectKingsPilotProfile(
  key: ProjectKingsPilotProfileKey
): (typeof PROJECT_KINGS_PILOT_PROFILES)[ProjectKingsPilotProfileKey] {
  return PROJECT_KINGS_PILOT_PROFILES[key];
}
