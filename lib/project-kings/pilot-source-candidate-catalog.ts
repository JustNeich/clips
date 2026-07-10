import type { ProjectKingsPilotProfileKey } from "./pilot-production-profiles";

export type ProjectKingsCandidateDisposition =
  | "pending_semantic_review"
  | "rejected";

export type ProjectKingsCandidateRightsStatus =
  | "owner_approved_source_pool"
  | "policy_pending";

export type ProjectKingsLocalMediaReference =
  | Readonly<{
      kind: "direct";
      relativePath: string;
    }>
  | Readonly<{
      kind: "source_cache_file_name";
      fileName: string;
    }>;

export type ProjectKingsPilotCandidateObservation = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  sourceUrl: string;
  provider: "instagram" | "youtube_ask";
  discoveryRoute: "local_source_cache" | "instagram_donor_pool" | "youtube_ask_v3";
  storyEventId: string | null;
  localMedia: ProjectKingsLocalMediaReference;
  disposition: ProjectKingsCandidateDisposition;
  rightsStatus: ProjectKingsCandidateRightsStatus;
  findings: readonly string[];
}>;

/**
 * Exact local media selected for a profile example when the raw donor download
 * and an already extracted inner-video artifact coexist. This is deliberately
 * explicit: differing hashes are never resolved by newest-file or largest-file
 * heuristics.
 */
export const PROJECT_KINGS_PROFILE_MEDIA_OVERRIDES: Readonly<
  Partial<Record<string, ProjectKingsLocalMediaReference>>
> = Object.freeze({
  "light-positive-DYuu2CVJc3G": Object.freeze({
    kind: "source_cache_file_name" as const,
    fileName: "v3-light-kingdom-DYuu2CVJc3G"
  })
});

function cachedInstagram(input: {
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  reelId: string;
  cacheFileName: string;
  storyEventId: string | null;
  disposition?: ProjectKingsCandidateDisposition;
  rightsStatus?: ProjectKingsCandidateRightsStatus;
  findings: readonly string[];
}): ProjectKingsPilotCandidateObservation {
  return Object.freeze({
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    sourceUrl: `https://www.instagram.com/reel/${input.reelId}/`,
    provider: "instagram",
    discoveryRoute: "local_source_cache",
    storyEventId: input.storyEventId,
    localMedia: {
      kind: "source_cache_file_name",
      fileName: input.cacheFileName
    } as const,
    disposition: input.disposition ?? "pending_semantic_review",
    rightsStatus: input.rightsStatus ?? "policy_pending",
    findings: input.findings
  });
}

function askYoutube(input: {
  videoId: string;
  storyEventId: string | null;
  disposition: ProjectKingsCandidateDisposition;
  findings: readonly string[];
}): ProjectKingsPilotCandidateObservation {
  return Object.freeze({
    candidateId: `light-ask-${input.videoId}`,
    profileKey: "light-kingdom",
    sourceUrl: `https://www.youtube.com/watch?v=${input.videoId}`,
    provider: "youtube_ask",
    discoveryRoute: "youtube_ask_v3",
    storyEventId: input.storyEventId,
    localMedia: {
      kind: "direct",
      relativePath: `.data/project-kings/source-candidates/light/ask-v3/${input.videoId}.mp4`
    } as const,
    disposition: input.disposition,
    // The owner explicitly authorised YouTube Ask as a source-acquisition route
    // for this channel. This approves the candidate for Source Fit; it does not
    // bypass duplicate, concept, visual, factual, or publication quality gates.
    rightsStatus: "owner_approved_source_pool",
    findings: input.findings
  });
}

function downloadedInstagram(input: {
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  reelId: string;
  localPath: string;
  storyEventId: string | null;
  findings: readonly string[];
}): ProjectKingsPilotCandidateObservation {
  return Object.freeze({
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    sourceUrl: `https://www.instagram.com/reel/${input.reelId}/`,
    provider: "instagram",
    discoveryRoute: "instagram_donor_pool",
    storyEventId: input.storyEventId,
    localMedia: {
      kind: "direct",
      relativePath: input.localPath
    } as const,
    disposition: "pending_semantic_review",
    rightsStatus: "owner_approved_source_pool",
    findings: input.findings
  });
}

/**
 * Frozen observations from the already completed local source-search pass.
 *
 * These records are discovery evidence, not qualification verdicts. In
 * particular, `pending_semantic_review` never means PASS. A candidate still
 * needs an exact decoded media hash, an independently recorded Source Fit
 * attestation, duplicate checks and an authorised source-pool policy before it
 * can enter the ready buffer.
 */
export const PROJECT_KINGS_PILOT_CANDIDATE_OBSERVATIONS = Object.freeze([
  cachedInstagram({
    candidateId: "dark-local-DDR2PcXRP4j",
    profileKey: "dark-joy-boy",
    reelId: "DDR2PcXRP4j",
    cacheFileName: "v3-dark-joyboy-DDR2PcXRP4j",
    storyEventId: "event-man-bathes-baby-spider-monkey",
    rightsStatus: "owner_approved_source_pool",
    findings: [
      "Local source-research media exists.",
      "A human and an exotic animal are visible, but profile-v2 Source Fit has not been recorded."
    ]
  }),
  cachedInstagram({
    candidateId: "dark-local-DKVNp4JS57c",
    profileKey: "dark-joy-boy",
    reelId: "DKVNp4JS57c",
    cacheFileName: "v3-dark-joyboy-DKVNp4JS57c",
    storyEventId: "event-human-animal-pool-encounter",
    rightsStatus: "owner_approved_source_pool",
    findings: [
      "Local source-research media exists.",
      "The prior observation describes a human-animal pool encounter; exact concept and event identity still require Source Fit."
    ]
  }),
  cachedInstagram({
    candidateId: "dark-local-DYDvRg-OqIV",
    profileKey: "dark-joy-boy",
    reelId: "DYDvRg-OqIV",
    cacheFileName: "v3-dark-joyboy-DYDvRg-OqIV",
    storyEventId: "event-man-with-capuchin",
    rightsStatus: "owner_approved_source_pool",
    findings: [
      "Local source-research media exists.",
      "The prior observation describes a man with a capuchin; exact continuous interaction still requires Source Fit."
    ]
  }),
  cachedInstagram({
    candidateId: "light-local-DYuu2CVJc3G",
    profileKey: "light-kingdom",
    reelId: "DYuu2CVJc3G",
    cacheFileName: "v3-light-kingdom-DYuu2CVJc3G",
    storyEventId: "event-michael-scott-onboards-karpathy",
    rightsStatus: "owner_approved_source_pool",
    findings: [
      "The source is an immutable positive example in profile v2 and local media exists.",
      "No hash-bound Source Fit attestation has been recorded yet."
    ]
  }),
  cachedInstagram({
    candidateId: "light-local-DYvtDJEp24H",
    profileKey: "light-kingdom",
    reelId: "DYvtDJEp24H",
    cacheFileName: "v3-light-kingdom-DYvtDJEp24H",
    storyEventId: null,
    disposition: "rejected",
    findings: [
      "Profile v2 explicitly rejects this talking-head AI-news clip.",
      "Dense hard subtitles are visible and no fiction remake is present."
    ]
  }),
  cachedInstagram({
    candidateId: "cop-local-DW5oCZGjPCs",
    profileKey: "copscopes-x2e",
    reelId: "DW5oCZGjPCs",
    cacheFileName: "v3-copscopes-DW5oCZGjPCs",
    storyEventId: "event-nashville-officer-involved-shooting",
    rightsStatus: "owner_approved_source_pool",
    findings: [
      "The source is an immutable positive example in profile v2 and local media exists.",
      "No hash-bound Source Fit attestation has been recorded yet."
    ]
  }),
  cachedInstagram({
    candidateId: "cop-local-DWTlKz_jO0m",
    profileKey: "copscopes-x2e",
    reelId: "DWTlKz_jO0m",
    cacheFileName: "v3-copscopes-DWTlKz_jO0m",
    storyEventId: "event-wakefield-motorcycle-stop-flight",
    rightsStatus: "owner_approved_source_pool",
    findings: [
      "The source is an immutable positive example in profile v2 and local media exists.",
      "No hash-bound Source Fit attestation has been recorded yet."
    ]
  }),
  downloadedInstagram({
    candidateId: "cop-donor-DWnxlyIDcoK",
    profileKey: "copscopes-x2e",
    reelId: "DWnxlyIDcoK",
    localPath: ".data/project-kings/source-candidates/cop/instagram/DWnxlyIDcoK.mp4",
    storyEventId: "event-off-duty-officer-traffic-disagreement-assault",
    findings: [
      "The Reel was acquired from the owner-approved @copscopes Instagram donor pool.",
      "Donor metadata describes an off-duty officer traffic disagreement; exact visible event, factual fit, crop safety and source usability still require Source Fit."
    ]
  }),
  downloadedInstagram({
    candidateId: "cop-donor-DXNBoz7jYmd",
    profileKey: "copscopes-x2e",
    reelId: "DXNBoz7jYmd",
    localPath: ".data/project-kings/source-candidates/cop/instagram/DXNBoz7jYmd.mp4",
    storyEventId: "event-whitehall-stolen-vehicle-pursuit",
    findings: [
      "The Reel was acquired from the owner-approved @copscopes Instagram donor pool.",
      "Donor metadata describes a Columbus/Whitehall pursuit involving a stolen vehicle; the donor wrapper, captions and CTA must be removable by the approved crop/template, and exact factual fit still requires Source Fit."
    ]
  }),
  downloadedInstagram({
    candidateId: "cop-donor-DXBhsJPjSgW",
    profileKey: "copscopes-x2e",
    reelId: "DXBhsJPjSgW",
    localPath: ".data/project-kings/source-candidates/cop/instagram/DXBhsJPjSgW.mp4",
    storyEventId: "event-utah-dodge-charger-crash-hospital",
    findings: [
      "The Reel was acquired from the owner-approved @copscopes Instagram donor pool.",
      "Donor metadata and the local contact sheet show one crash-to-hospital incident; inner marks and the wrapper must remain subject to Source Fit and final QA."
    ]
  }),
  downloadedInstagram({
    candidateId: "cop-donor-DW5s3qoDbHC",
    profileKey: "copscopes-x2e",
    reelId: "DW5s3qoDbHC",
    localPath: ".data/project-kings/source-candidates/cop/instagram/DW5s3qoDbHC.mp4",
    storyEventId: "event-husband-flees-traffic-stop-on-foot",
    findings: [
      "The Reel was acquired from the owner-approved @copscopes Instagram donor pool.",
      "The local contact sheet shows a traffic stop and on-foot flight, but central donor subtitles, watermark and CTA may make the source unusable."
    ]
  }),
  downloadedInstagram({
    candidateId: "cop-donor-DWjH5fWjBnt",
    profileKey: "copscopes-x2e",
    reelId: "DWjH5fWjBnt",
    localPath: ".data/project-kings/source-candidates/cop/instagram/DWjH5fWjBnt.mp4",
    storyEventId: "event-police-grappler-stops-fleeing-pickup",
    findings: [
      "The Reel was acquired from the owner-approved @copscopes Instagram donor pool.",
      "The local contact sheet shows one readable grappler-device pursuit payoff; the donor header and CTA must be removable by the approved crop."
    ]
  }),
  downloadedInstagram({
    candidateId: "cop-donor-DXHx529DVb0",
    profileKey: "copscopes-x2e",
    reelId: "DXHx529DVb0",
    localPath: ".data/project-kings/source-candidates/cop/instagram/DXHx529DVb0.mp4",
    storyEventId: "event-south-carolina-trooper-stops-wrong-way-driver",
    findings: [
      "The Reel was acquired from the owner-approved @copscopes Instagram donor pool.",
      "Donor metadata describes a trooper stopping a fleeing wrong-way driver; the local contact sheet shows one dashcam impact payoff, with wrapper and inner mark subject to the exact crop gate."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DZO838rIfHO",
    profileKey: "light-kingdom",
    reelId: "DZO838rIfHO",
    localPath: ".data/project-kings/source-candidates/light/instagram/DZO838rIfHO.mp4",
    storyEventId: "event-ai-harry-potter-balenciaga-remake",
    findings: [
      "Public @learnaifaster donor discovery describes a recognizable Harry Potter scene rebuilt in a Balenciaga AI style.",
      "The donor header is outside the central scene, but an inner creator mark is visible and must be rejected unless the approved crop removes it."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DaDxHb1poeD",
    profileKey: "light-kingdom",
    reelId: "DaDxHb1poeD",
    localPath: ".data/project-kings/source-candidates/light/instagram/DaDxHb1poeD.mp4",
    storyEventId: "event-ai-tom-and-jerry-live-action-remake",
    findings: [
      "Public @learnaifaster donor discovery describes Tom and Jerry rebuilt from animation into live action with AI.",
      "The stacked source comparison and donor header require exact crop and source-usability review."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DaADZ3AxOqO",
    profileKey: "light-kingdom",
    reelId: "DaADZ3AxOqO",
    localPath: ".data/project-kings/source-candidates/light/instagram/DaADZ3AxOqO.mp4",
    storyEventId: "event-ai-breaking-bad-fat-remake",
    findings: [
      "Public @learnaifaster donor discovery describes Breaking Bad characters visibly rebuilt with one comedic AI transformation.",
      "The central scene appears crop-safe in the local contact sheet; Source Fit still owns exact concept, watermark and factual checks."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DZULhPeI62U",
    profileKey: "light-kingdom",
    reelId: "DZULhPeI62U",
    localPath: ".data/project-kings/source-candidates/light/instagram/DZULhPeI62U.mp4",
    storyEventId: "event-ai-gladiator-fat-remake",
    findings: [
      "Public @learnaifaster donor discovery describes the recognizable Gladiator arena rebuilt with one comedic AI transformation.",
      "The donor header is outside the central scene; exact crop safety and any inner marks still require Source Fit."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DYM7AYJpMYa",
    profileKey: "light-kingdom",
    reelId: "DYM7AYJpMYa",
    localPath: ".data/project-kings/source-candidates/light/instagram/DYM7AYJpMYa.mp4",
    storyEventId: "event-ai-titanic-alternate-ending-remake",
    findings: [
      "Public @learnaifaster donor discovery describes Titanic rebuilt with an alternate AI ending.",
      "A small inner-source mark appears late in the local contact sheet and must be removable before the source can PASS."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DYl89L5Ry_n",
    profileKey: "light-kingdom",
    reelId: "DYl89L5Ry_n",
    localPath: ".data/project-kings/source-candidates/light/instagram/DYl89L5Ry_n.mp4",
    storyEventId: "event-ai-star-wars-fat-remake",
    findings: [
      "Public @learnaifaster donor discovery describes recognizable Star Wars characters rebuilt through one visible comedic AI transformation.",
      "The donor header is outside the central scene in the local contact sheet; Source Fit still owns exact crop, mark and usability checks."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DYejZ-RxFEJ",
    profileKey: "light-kingdom",
    reelId: "DYejZ-RxFEJ",
    localPath: ".data/project-kings/source-candidates/light/instagram/DYejZ-RxFEJ.mp4",
    storyEventId: "event-ai-euphoria-fat-remake",
    findings: [
      "Public @learnaifaster donor discovery describes Euphoria rebuilt through one visible comedic AI transformation.",
      "The central scene appears free of inner donor branding in the local contact sheet; exact Source Fit remains mandatory."
    ]
  }),
  downloadedInstagram({
    candidateId: "light-donor-DYctdBjpD5y",
    profileKey: "light-kingdom",
    reelId: "DYctdBjpD5y",
    localPath: ".data/project-kings/source-candidates/light/instagram/DYctdBjpD5y.mp4",
    storyEventId: "event-ai-spider-man-fat-remake",
    findings: [
      "Public @learnaifaster donor discovery describes Spider-Man rebuilt through one visible comedic AI transformation.",
      "The central scene appears free of inner donor branding in the local contact sheet; exact Source Fit remains mandatory."
    ]
  }),

  askYoutube({
    videoId: "BwIaEb5vGDo",
    storyEventId: "event-ai-mandalorian-grogu-short-scene",
    disposition: "pending_semantic_review",
    findings: [
      "Clean short Mandalorian/Grogu AI scene with no visible donor UI or CTA in the local visual pass.",
      "Provider policy and profile-v2 Source Fit are still required."
    ]
  }),
  askYoutube({
    videoId: "J6tw2l128YE",
    storyEventId: "event-ai-harry-potter-afterparty",
    disposition: "pending_semantic_review",
    findings: [
      "Recognizable AI Harry Potter scene without visible captions or watermark.",
      "Multi-scene structure and drug-party premise require semantic and policy review."
    ]
  }),
  askYoutube({
    videoId: "6QIdqyFoxFE",
    storyEventId: "event-ai-fiction-parody-part-nine",
    disposition: "pending_semantic_review",
    findings: [
      "Visible AI-fiction parody is present.",
      "Part label and multi-scene compilation risk require Source Fit."
    ]
  }),
  askYoutube({
    videoId: "tOk5MQFB0cU",
    storyEventId: "event-ai-fiction-parody-part-five",
    disposition: "pending_semantic_review",
    findings: [
      "Visible AI-fiction parody is present.",
      "Part label and multi-scene compilation risk require Source Fit."
    ]
  }),
  askYoutube({
    videoId: "WkEyab1jINA",
    storyEventId: "event-ai-trump-inside-harry-potter-one",
    disposition: "pending_semantic_review",
    findings: [
      "A visible generated character is placed inside recognizable fiction.",
      "Political/deepfake and multi-scene risks require policy and Source Fit review."
    ]
  }),
  askYoutube({
    videoId: "V-xIvJs0Jbo",
    storyEventId: "event-ai-trump-inside-harry-potter-two",
    disposition: "pending_semantic_review",
    findings: [
      "A visible generated character is placed inside recognizable fiction.",
      "Political/deepfake and multi-scene risks require policy and Source Fit review."
    ]
  }),

  askYoutube({
    videoId: "1diIRo4sHtk",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Dense foreign burned-in captions violate profile v2."]
  }),
  askYoutube({
    videoId: "6IlkA1MLVYA",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Ranking UI plus explicit subscribe/CTA overlays violate profile v2."]
  }),
  askYoutube({
    videoId: "EYkw1ELHXq0",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Large burned-in captions make the source unusable for the channel card."]
  }),
  askYoutube({
    videoId: "XPKBwhDPxk0",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Large LIKE/SUBSCRIBE overlay and end card violate the no-CTA gate."]
  }),
  askYoutube({
    videoId: "fj6CXk2KTIs",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Split-screen layout, large text and watermark violate the visual-source gate."]
  }),
  askYoutube({
    videoId: "n9kD935iROw",
    storyEventId: null,
    disposition: "rejected",
    findings: ["The visible AI premise is not established; footage reads as ordinary horizontal source material."]
  }),
  askYoutube({
    videoId: "oA7rziyGv8s",
    storyEventId: null,
    disposition: "rejected",
    findings: ["StrangeAI watermark and foreign burned-in captions violate profile v2."]
  }),
  askYoutube({
    videoId: "vgsWEnGfKRM",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Talking-head presentation and huge captions fall outside the fiction-remake format."]
  }),
  askYoutube({
    videoId: "wjFbQjlr1Uk",
    storyEventId: null,
    disposition: "rejected",
    findings: ["Static transformations, watermark/text and no continuous event violate profile v2."]
  })
] satisfies readonly ProjectKingsPilotCandidateObservation[]);
