import {
  CHANNEL_PRODUCTION_PROFILE_VERSION,
  CONCEPT_CONTRACT_VERSION,
  defineChannelProductionProfile
} from "./channel-production-profile";

// Read-only live template JSON SHA captured in the audited production profile facts.
export const COPSCOPES_TEMPLATE_SHA =
  "4b29faab9bc424f8c7aa2e5e863c073e4a7720effe96508b2bd76a0cb0e9ecc8";

export const COPSCOPES_PROJECT_KINGS_PROFILE = defineChannelProductionProfile({
  profileVersion: CHANNEL_PRODUCTION_PROFILE_VERSION,
  profileId: "6187aeeea7bd47188e08089c5916edc1",
  youtube: {
    // Stable identity. The title below is display-only and may change without changing identity.
    channelId: "UCJhBMXXQ5GrTbrhqjwT1leg",
    titleAdvisory: "lessie potirl"
  },
  templateIdentity: {
    channelId: "6187aeeea7bd47188e08089c5916edc1",
    templateSha: COPSCOPES_TEMPLATE_SHA
  },
  concept: {
    contractVersion: CONCEPT_CONTRACT_VERSION,
    conceptId: "copscopes-visible-us-police-incidents",
    label: "Visible US police bodycam and dashcam incidents",
    conceptShape: "channel",
    instagramCoherence: "pass",
    channelPromise:
      "One real US police bodycam or dashcam incident with a visible turn and outcome in every Short.",
    axes: {
      audience:
        "English-speaking US viewers who want concise, visually provable police incident stories.",
      source: {
        platform: "instagram",
        mediaType: "reel",
        description:
          "Instagram Reels containing real police bodycam or dashcam footage from approved donor accounts."
      },
      event:
        "One visible law-enforcement incident with a hook, an action, and a concrete outcome in the footage.",
      emotion:
        "Tension followed by consequence, relief, or a clearly visible reversal without sensational invention.",
      reasonToWatch:
        "See the decisive turn and understand why the stop, pursuit, arrest, firefight, or rescue ended that way.",
      format:
        "One continuous vertical or vertically crop-safe source clip in a branded story card; never an unrelated compilation."
    },
    inclusions: [
      "Vehicle pursuits with a visible stop, crash, escape, or arrest outcome.",
      "Traffic stops that visibly escalate or reverse.",
      "Arrest struggles and foot pursuits with a visible resolution.",
      "Officer-involved rescues, fires, and urgent medical intervention.",
      "Bodycam or dashcam incidents where the decisive action remains readable in a vertical crop."
    ],
    exclusions: [
      "Military footage, military equipment, or battlefield history.",
      "Civilian street fights without visible law-enforcement participation.",
      "Talking heads, studio reactions, or news commentary as the main footage.",
      "Fiction, paranormal stories, or incidents unsupported by visible evidence.",
      "Product advertising, calls to action, and promotional demonstrations.",
      "Compilations of unrelated incidents or static scenes without an event."
    ],
    adjacentCategories: [
      {
        categoryId: "military-combat-footage",
        difference:
          "Military action concerns armed forces and warfare; this channel requires civilian law-enforcement work."
      },
      {
        categoryId: "civilian-street-conflicts",
        difference:
          "A filmed confrontation is insufficient unless police action is visibly central to the incident."
      },
      {
        categoryId: "police-news-commentary",
        difference:
          "Commentary about an incident is not the event; the decisive police action must be visible in source footage."
      }
    ],
    positiveExamples: [
      {
        id: "cop-positive-DXOzkCdjMue",
        url: "https://www.instagram.com/reel/DXOzkCdjMue/",
        storyEventId: "event-domestic-violence-suspect-jumps-moving-car",
        reason: "Dashcam shows the suspect jump onto a moving vehicle and provides a visible incident turn."
      },
      {
        id: "cop-positive-DWwSVVOjMqO",
        url: "https://www.instagram.com/reel/DWwSVVOjMqO/",
        storyEventId: "event-farmington-street-race-burning-car-rescue",
        reason: "A pursuit ends in a rollover and burning car, followed by a visible passenger rescue."
      },
      {
        id: "cop-positive-DYRVHZIN0ta",
        url: "https://www.instagram.com/reel/DYRVHZIN0ta/",
        storyEventId: "event-farmington-street-race-burning-car-rescue",
        reason: "The officer visibly removes a passenger before the vehicle becomes engulfed in fire."
      },
      {
        id: "cop-positive-DW5oCZGjPCs",
        url: "https://www.instagram.com/reel/DW5oCZGjPCs/",
        storyEventId: "event-nashville-officer-involved-shooting",
        reason: "Verified frames show a real police firefight and injured-officer incident rather than commentary."
      },
      {
        id: "cop-positive-DWTlKz_jO0m",
        url: "https://www.instagram.com/reel/DWTlKz_jO0m/",
        storyEventId: "event-wakefield-motorcycle-stop-flight",
        reason: "Verified frames show a traffic stop become a visible attempted motorcycle escape."
      },
      {
        id: "cop-positive-DXY_ED7jSey",
        url: "https://www.instagram.com/reel/DXY_ED7jSey/",
        storyEventId: "event-el-paso-vehicle-approach-arrest",
        reason: "The approach to a vehicle visibly turns into a forceful arrest with a readable outcome."
      },
      {
        id: "cop-positive-DW0w8RMjY3Y",
        url: "https://www.instagram.com/reel/DW0w8RMjY3Y/",
        storyEventId: "event-marysville-drive-through-stop",
        reason: "A drive-through traffic stop develops into one continuous visible police incident."
      },
      {
        id: "cop-positive-DXUPExpjCs2",
        url: "https://www.instagram.com/reel/DXUPExpjCs2/",
        storyEventId: "event-maryland-troopers-infant-rescue",
        reason: "Troopers visibly provide urgent aid to a choking infant and the rescue is the core event."
      }
    ],
    negativeExamples: [
      {
        id: "cop-negative-DYKFYtTNZsW",
        url: "https://www.instagram.com/reel/DYKFYtTNZsW/",
        storyEventId: "reject-emergency-hammer-ad",
        reason: "The Reel promotes an emergency hammer and is product advertising rather than an incident."
      },
      {
        id: "cop-negative-DWWLMhgjM97",
        url: "https://www.instagram.com/reel/DWWLMhgjM97/",
        storyEventId: "reject-unrecoverable-dead-caption",
        reason: "The caption and available evidence do not establish a concrete visible police event."
      },
      {
        id: "cop-negative-DWeYeHujPFx",
        url: "https://www.instagram.com/reel/DWeYeHujPFx/",
        storyEventId: "reject-engagement-bait-without-event",
        reason: "Engagement bait asks for a reaction but does not provide enough evidence of a usable incident."
      },
      {
        id: "cop-negative-DYDvRg-OqIV",
        url: "https://www.instagram.com/reel/DYDvRg-OqIV/",
        storyEventId: "reject-man-with-capuchin",
        reason: "The footage is an animal lifestyle scene and contains no visible police action."
      },
      {
        id: "cop-negative-DYvtDJEp24H",
        url: "https://www.instagram.com/reel/DYvtDJEp24H/",
        storyEventId: "reject-ai-talking-head",
        reason: "The footage is an AI talking head with hard subtitles, outside both the event and format boundary."
      },
      {
        id: "cop-negative-DYWIdjSxbb7",
        url: "https://www.instagram.com/reel/DYWIdjSxbb7/",
        storyEventId: "reject-ai-news",
        reason: "The Reel discusses AI news and has no visible law-enforcement incident."
      }
    ],
    evidenceBoundary: {
      categoryAuthority: "instagram",
      youtubeRole: "market-validation-only",
      youtubeCanWidenCategory: false
    },
    continuityBuffer: {
      uniqueStoryEventIds: [
        "event-domestic-violence-suspect-jumps-moving-car",
        "event-farmington-street-race-burning-car-rescue",
        "event-nashville-officer-involved-shooting",
        "event-wakefield-motorcycle-stop-flight",
        "event-el-paso-vehicle-approach-arrest",
        "event-marysville-drive-through-stop",
        "event-maryland-troopers-infant-rescue"
      ]
    }
  },
  publication: {
    timezone: "Europe/Moscow",
    slots: [
      { slotId: "daily-1", localTime: "21:15" },
      { slotId: "daily-2", localTime: "21:30" },
      { slotId: "daily-3", localTime: "21:45" }
    ],
    limits: {
      dailyPublicationLimit: 3,
      maxCandidatesPerRun: 8,
      maxConcurrentSourceJobs: 1,
      maxConcurrentModelCalls: 1,
      maxConcurrentRenders: 1
    },
    retryPolicy: {
      strategy: "exponential",
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
    }
  },
  credentialRefs: {
    youtubePublishing:
      "credential-ref://clips/channel/6187aeeea7bd47188e08089c5916edc1/youtube-publishing",
    instagramSource: "credential-ref://clips/workspace/instagram-source"
  }
});
