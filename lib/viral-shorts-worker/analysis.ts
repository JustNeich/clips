import {
  AnalyzerOutput,
  RankedAngle,
  SelectorOutput,
  ViralShortsChannelProfile
} from "./types";
import { ALLOWED_ANGLES } from "./profiles";
import { compact, tokenOverlapScore } from "./utils";

const CLIP_TYPE_RULES: Record<string, Record<string, string[]>> = {
  country_life: {
    vehicle_failure_diagnosis: ["engine", "oil", "cv joint", "diesel", "transmission", "leak", "runaway", "axle", "motor"],
    improvised_fix_or_shop_hack: ["hack", "shop vac", "rig", "ratchet", "slide hammer", "tool", "custom", "fix", "welded"],
    truck_or_rural_vehicle_humor: ["truck", "bass pro", "grandpa", "ford", "chevy", "uaz", "subaru", "steering wheel"],
    farm_animal_behavior: ["calf", "cow", "goat", "bull", "farm animal", "livestock", "field"],
    close_call_or_hazard: ["close call", "jack stand", "concrete", "danger", "hazard", "fence", "stuck"],
    rural_oddity_or_sighting: ["mater", "double take", "spot", "weird", "sign", "sighting"]
  },
  workers: {
    process_mastery: ["forge", "press", "weld", "seal", "trim", "roof", "process", "precision"],
    unsafe_or_sketchy_method: ["unsafe", "sketchy", "danger", "bucket over a river", "spoons", "jump start"],
    bad_workmanship_or_failure: ["cheaper", "failure", "wrong", "broken", "duct tape", "job shouldn't"],
    tool_improvisation: ["rigged", "custom", "made his own", "tool", "hack", "lever", "cord"],
    jobsite_chaos: ["coworkers", "shop", "chaos", "everybody's problem", "surprise"],
    satisfying_transform: ["satisfying", "turns into", "melts", "squishes", "pressure wash"]
  },
  military: {
    hardware_scale_demo: ["c-17", "bomber", "tank", "bradley", "howitzer", "massive", "globemaster"],
    maneuver_or_flyby: ["flyby", "touchdown", "landing", "helicopter", "runway", "bronco", "tornado"],
    training_hardship: ["training", "mud", "lane", "recruits", "reception", "field hygiene"],
    logistics_mass_movement: ["convoy", "train", "logistics", "flatbed", "shipment", "rails"],
    ceremony_or_reunion: ["purple heart", "family day", "reunion", "ceremony", "hug"],
    barracks_or_uniform_humor: ["costco", "pizza", "uniform", "eye exam", "bag", "barracks"]
  },
  animals: {
    cute_or_bonding: ["cute", "baby", "reunites", "pets", "bond", "mother", "calf", "puppies"],
    predator_or_attack: ["lion", "attack", "predator", "bear", "charging", "take down", "orca"],
    unusual_behavior_fact: ["why", "how", "scientists", "behavior", "fact", "discovered", "tilt"],
    farm_livestock_incident: ["bull", "goat", "farm", "livestock", "pasture", "horns"],
    rescue_or_protection: ["protect", "capture", "drop nets", "dogs", "rescue", "safely"],
    scale_or_strength: ["massive", "strength", "weigh", "size", "giant", "huge"]
  },
  science_curiosity: {
    engineering_oddity: ["work smarter", "engineering", "rig", "tool", "oddity"],
    scale_contrast: ["huge", "tiny", "half-width", "blocks", "giant"],
    extreme_weather_or_disaster: ["storm", "horror movie", "burning", "forest", "violent"],
    nature_anomaly: ["lizard", "spiral tail", "weird", "nature"],
    improbable_vehicle_or_object: ["fake ferrari", "festiva", "floating picnic", "dodge charger"]
  },
  turbo_offroad: {
    snow_recovery: ["snow", "buried", "recovery", "dig", "plow"],
    stuck_vehicle: ["stuck", "ditch", "bowl", "disappear", "half buried"],
    climb_attempt: ["climb", "trail", "village", "wake up", "out before"],
    engine_strain_or_failure: ["crying", "engine", "strain", "failed"],
    offroad_setup_or_gear: ["lifted", "super duty", "wrangler", "land cruiser", "1hd"],
    vehicle_mishap: ["nose first", "mishap", "joins the other truck"]
  }
};

const CLIP_DEFAULT_ANGLES: Record<string, string[]> = {
  vehicle_failure_diagnosis: ["insider_expertise", "shared_experience", "absurdity_chaos"],
  improvised_fix_or_shop_hack: ["competence_process", "insider_expertise", "absurdity_chaos"],
  truck_or_rural_vehicle_humor: ["shared_experience", "absurdity_chaos", "payoff_reveal"],
  farm_animal_behavior: ["warmth_reverence", "absurdity_chaos", "shared_experience"],
  close_call_or_hazard: ["tension_danger", "shared_experience", "payoff_reveal"],
  rural_oddity_or_sighting: ["absurdity_chaos", "payoff_reveal", "shared_experience"],
  process_mastery: ["competence_process", "insider_expertise", "payoff_reveal"],
  unsafe_or_sketchy_method: ["tension_danger", "absurdity_chaos", "shared_experience"],
  bad_workmanship_or_failure: ["insider_expertise", "absurdity_chaos", "shared_experience"],
  tool_improvisation: ["competence_process", "absurdity_chaos", "insider_expertise"],
  jobsite_chaos: ["absurdity_chaos", "shared_experience", "tension_danger"],
  satisfying_transform: ["payoff_reveal", "competence_process", "awe_scale"],
  hardware_scale_demo: ["awe_scale", "shared_experience", "payoff_reveal"],
  maneuver_or_flyby: ["awe_scale", "tension_danger", "payoff_reveal"],
  training_hardship: ["shared_experience", "tension_danger", "warmth_reverence"],
  logistics_mass_movement: ["awe_scale", "shared_experience", "payoff_reveal"],
  ceremony_or_reunion: ["warmth_reverence", "shared_experience", "payoff_reveal"],
  barracks_or_uniform_humor: ["shared_experience", "absurdity_chaos", "warmth_reverence"],
  cute_or_bonding: ["warmth_reverence", "shared_experience", "payoff_reveal"],
  predator_or_attack: ["tension_danger", "awe_scale", "payoff_reveal"],
  unusual_behavior_fact: ["payoff_reveal", "shared_experience", "awe_scale"],
  farm_livestock_incident: ["shared_experience", "absurdity_chaos", "tension_danger"],
  rescue_or_protection: ["warmth_reverence", "tension_danger", "payoff_reveal"],
  scale_or_strength: ["awe_scale", "shared_experience", "payoff_reveal"],
  engineering_oddity: ["payoff_reveal", "competence_process", "absurdity_chaos"],
  scale_contrast: ["awe_scale", "absurdity_chaos", "payoff_reveal"],
  extreme_weather_or_disaster: ["tension_danger", "awe_scale", "payoff_reveal"],
  nature_anomaly: ["awe_scale", "payoff_reveal", "absurdity_chaos"],
  improbable_vehicle_or_object: ["absurdity_chaos", "payoff_reveal", "shared_experience"],
  snow_recovery: ["tension_danger", "insider_expertise", "payoff_reveal"],
  stuck_vehicle: ["shared_experience", "tension_danger", "absurdity_chaos"],
  climb_attempt: ["tension_danger", "payoff_reveal", "shared_experience"],
  engine_strain_or_failure: ["insider_expertise", "tension_danger", "shared_experience"],
  offroad_setup_or_gear: ["insider_expertise", "awe_scale", "shared_experience"],
  vehicle_mishap: ["absurdity_chaos", "tension_danger", "shared_experience"]
};

const ANGLE_HINTS: Record<string, string[]> = {
  awe_scale: ["massive", "huge", "giant", "scale", "heavy", "air force", "tank", "storm"],
  tension_danger: ["danger", "close call", "stuck", "attack", "charging", "mud", "buried", "risk", "hazard"],
  absurdity_chaos: ["weird", "funny", "chaos", "lol", "ridiculous", "double take", "strange"],
  competence_process: ["process", "guides", "precise", "technique", "uses", "method", "tool"],
  shared_experience: ["you know", "anyone", "every mechanic", "everyone", "you can tell", "when you"],
  warmth_reverence: ["hug", "baby", "mother", "respect", "sacrifice", "bond", "care"],
  payoff_reveal: ["watch", "what happens", "moment", "suddenly", "ends up", "before it"],
  insider_expertise: ["diagnose", "line", "seal", "pressure", "transmission", "cv joint", "diesel", "weld"]
};

export function classifyClipType(archetype: string, text: string): string {
  const haystack = compact(text).toLowerCase();
  const rules = CLIP_TYPE_RULES[archetype] ?? {};
  const scored = Object.entries(rules)
    .map(([clipType, keywords]) => ({
      clipType,
      score: keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 2 : 0), 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length > 0) {
    return scored[0]?.clipType ?? "general";
  }

  return Object.keys(rules)[0] ?? "general";
}

export function deriveWhyItWorks(
  title: string,
  overlayTop: string,
  overlayBottom: string,
  transcript: string,
  clipType: string
): string[] {
  const reasons: string[] = [];
  if (compact(overlayTop)) {
    reasons.push("strong visual anchor in top overlay");
  }
  if (compact(overlayBottom)) {
    reasons.push("bottom delivers a reaction instead of repeating the top");
  }
  if (compact(overlayTop).length >= 120) {
    reasons.push("top supplies detailed scene-setting");
  }
  if (compact(transcript)) {
    reasons.push("transcript provides extra context for retrieval");
  }
  if (clipType) {
    reasons.push(`clear ${clipType} pattern`);
  }
  return reasons.slice(0, 4);
}

export function computeQualityScore(
  title: string,
  overlayTop: string,
  overlayBottom: string,
  transcript: string
): number {
  let score = 0;
  if (compact(overlayTop)) {
    score += 0.35;
  }
  if (compact(overlayBottom)) {
    score += 0.35;
  }
  if (compact(transcript)) {
    score += 0.1;
  }
  if (compact(overlayTop).length >= 40 && compact(overlayTop).length <= 220) {
    score += 0.1;
  }
  if (compact(overlayBottom).length >= 30 && compact(overlayBottom).length <= 200) {
    score += 0.1;
  }
  return Math.min(1, Math.round(score * 1000) / 1000);
}

export function isAntiExample(overlayTop: string, overlayBottom: string, qualityScore: number): boolean {
  if (qualityScore < 0.35) {
    return true;
  }
  if (!compact(overlayBottom)) {
    return true;
  }
  return compact(overlayTop).length > 260;
}

export function heuristicAnalyzer(videoContext: {
  title?: string;
  transcript?: string;
  description?: string;
  comments?: string[];
  visualAnchors?: string[];
}): AnalyzerOutput {
  const title = compact(videoContext.title);
  const transcript = compact(videoContext.transcript);
  const description = compact(videoContext.description);
  const comments = videoContext.comments ?? [];
  const combined = compact([title, transcript, description].filter(Boolean).join(" "));

  const anchors = (videoContext.visualAnchors ?? [])
    .map((value) => compact(value))
    .filter(Boolean)
    .slice(0, 3);

  const fallbackAnchors = [title, transcript, description].filter(Boolean).slice(0, 3);
  const visualAnchors = (anchors.length > 0 ? anchors : fallbackAnchors).slice(0, 3);
  const subject = title.split(" ")[0] || "subject";
  const action =
    combined.match(/[A-Za-z0-9'-]+ing\b/)?.[0] ??
    combined.match(/[A-Za-z0-9'-]+ed\b/)?.[0] ??
    "visible action";

  let setting = "visible setting";
  const lower = combined.toLowerCase();
  if (lower.includes("field")) {
    setting = "field";
  } else if (lower.includes("shop")) {
    setting = "worksite";
  }

  const stakes: string[] = [];
  if (/(danger|attack|charging|close call|risk|buried)/i.test(lower)) {
    stakes.push("danger");
  }
  if (/(massive|huge|giant|scale|storm)/i.test(lower)) {
    stakes.push("scale");
  }
  if (/(funny|chaos|weird|double take|lol)/i.test(lower)) {
    stakes.push("absurdity");
  }
  if (/(respect|sacrifice|mother|baby|hug)/i.test(lower)) {
    stakes.push("reverence");
  }
  if (stakes.length === 0) {
    stakes.push("observation");
  }

  const commentBlob = comments.map((comment) => compact(comment)).join(" ").toLowerCase();
  let commentVibe = "unknown";
  if (commentBlob) {
    if (/(lol|lmao|funny)/i.test(commentBlob)) {
      commentVibe = "sarcastic amusement";
    } else if (/(respect|insane|crazy)/i.test(commentBlob)) {
      commentVibe = "awed respect";
    } else {
      commentVibe = "observational reaction";
    }
  }

  const extractableSlang = Array.from(
    new Set(
      (commentBlob.match(/[a-z]{4,}/g) ?? []).filter(
        (token) => !["that", "with", "this", "they", "from"].includes(token)
      )
    )
  ).slice(0, 5);

  const specificNouns = Array.from(
    new Set(
      [title, transcript, description, ...visualAnchors]
        .join(" ")
        .split(/\s+/)
        .map((token) => token.replace(/[^A-Za-z0-9-]/g, "").trim())
        .filter((token) => token.length >= 4)
    )
  ).slice(0, 8);

  const visibleActions = Array.from(
    new Set([action, ...visualAnchors.filter((anchor) => /\b(ing|ed)\b/i.test(anchor))])
  ).slice(0, 5);

  const firstSecondsSignal = visualAnchors[0] || title || "visible setup";
  const hiddenDetail = comments.map((comment) => compact(comment)).find(Boolean) ?? "";
  const genericRisks = [
    "generic nouns that ignore what is visibly on screen",
    "abstract narration that skips the visible action"
  ];
  const coreTrigger =
    title ||
    visualAnchors[0] ||
    hiddenDetail ||
    "the visible moment that makes the clip worth reacting to";
  const humanStake = stakes.includes("danger")
    ? "People are waiting to see whether this turns into a real problem."
    : stakes.includes("absurdity")
      ? "The moment invites a human reaction because it looks ridiculous in a real-world way."
      : stakes.includes("reverence")
        ? "The viewer feels respect or emotional buy-in, not just detached curiosity."
        : stakes.includes("scale")
          ? "The viewer cares because the scale or intensity feels larger than expected."
          : "The viewer wants the human payoff, not just the raw facts.";
  const narrativeFrame = stakes.includes("danger")
    ? "a visible close-call or failure building in real time"
    : stakes.includes("absurdity")
      ? "a real moment that reads like unintentional comedy"
      : stakes.includes("reverence")
        ? "a moment that earns respect rather than irony"
        : stakes.includes("scale")
          ? "a scale contrast that makes the clip feel bigger than normal"
          : "a grounded moment where the viewer quickly understands why it matters";
  const whyViewerCares = humanStake;
  const bestBottomEnergy =
    commentVibe === "sarcastic amusement"
      ? "sarcasm"
      : commentVibe === "awed respect"
        ? "respect"
        : commentVibe === "observational reaction"
          ? "dry humor"
          : stakes.includes("danger")
            ? "panic"
            : stakes.includes("reverence")
              ? "awe"
              : "insider recognition";

  return {
    visualAnchors,
    specificNouns,
    visibleActions,
    subject,
    action,
    setting,
    firstSecondsSignal,
    stakes,
    payoff: title || description.slice(0, 140),
    coreTrigger,
    humanStake,
    narrativeFrame,
    whyViewerCares,
    bestBottomEnergy,
    commentVibe,
    slangToAdapt: extractableSlang,
    extractableSlang,
    hiddenDetail,
    genericRisks,
    rawSummary: combined.slice(0, 500)
  };
}

function explainAngle(angle: string, analyzerOutput: AnalyzerOutput, clipType: string): string {
  if (angle === "insider_expertise") {
    return `${clipType} clips usually reward insider commentary and specific nouns.`;
  }
  if (angle === "awe_scale") {
    return `The footage carries scale or spectacle cues: ${analyzerOutput.stakes.join(", ")}.`;
  }
  if (angle === "tension_danger") {
    return "There is visible risk, strain, or a close-call payoff.";
  }
  if (angle === "absurdity_chaos") {
    return "The scene reads as strange, chaotic, or unintentionally funny.";
  }
  if (angle === "competence_process") {
    return "The viewer is watching a method, technique, or skilled sequence unfold.";
  }
  if (angle === "shared_experience") {
    return "The clip invites a relatable reaction from people who know this pain point.";
  }
  if (angle === "warmth_reverence") {
    return "The moment carries respect, bonding, or emotional weight.";
  }
  if (angle === "payoff_reveal") {
    return "The scene has a visible turn or payoff the text can set up cleanly.";
  }
  return "Angle chosen by heuristic score.";
}

export function selectAngles(
  channelProfile: ViralShortsChannelProfile,
  analyzerOutput: AnalyzerOutput,
  clipType: string
): SelectorOutput {
  const allowed = ALLOWED_ANGLES[channelProfile.archetype] ?? [];
  const scores = new Map<string, number>();
  const combined = compact(
    [
      ...analyzerOutput.visualAnchors,
      analyzerOutput.subject,
      analyzerOutput.action,
      analyzerOutput.setting,
      analyzerOutput.payoff,
      analyzerOutput.rawSummary
    ].join(" ")
  ).toLowerCase();

  for (const angle of CLIP_DEFAULT_ANGLES[clipType] ?? []) {
    scores.set(angle, (scores.get(angle) ?? 0) + 2);
  }

  for (const [angle, hints] of Object.entries(ANGLE_HINTS)) {
    for (const hint of hints) {
      if (
        combined.includes(hint) ||
        analyzerOutput.stakes.some((stake) => compact(stake).toLowerCase().includes(hint))
      ) {
        scores.set(angle, (scores.get(angle) ?? 0) + 0.6);
      }
    }
  }

  if (analyzerOutput.commentVibe === "sarcastic amusement" || analyzerOutput.commentVibe === "observational reaction") {
    scores.set("shared_experience", (scores.get("shared_experience") ?? 0) + 0.6);
    scores.set("absurdity_chaos", (scores.get("absurdity_chaos") ?? 0) + 0.4);
  }
  if (analyzerOutput.commentVibe === "awed respect") {
    scores.set("awe_scale", (scores.get("awe_scale") ?? 0) + 0.8);
    scores.set("warmth_reverence", (scores.get("warmth_reverence") ?? 0) + 0.4);
  }

  if (analyzerOutput.stakes.includes("danger")) {
    scores.set("tension_danger", (scores.get("tension_danger") ?? 0) + 1.4);
  }
  if (analyzerOutput.stakes.includes("scale")) {
    scores.set("awe_scale", (scores.get("awe_scale") ?? 0) + 1.2);
  }
  if (analyzerOutput.stakes.includes("absurdity")) {
    scores.set("absurdity_chaos", (scores.get("absurdity_chaos") ?? 0) + 1.1);
  }
  if (analyzerOutput.stakes.includes("reverence")) {
    scores.set("warmth_reverence", (scores.get("warmth_reverence") ?? 0) + 1.1);
  }

  const rankedAngles = allowed
    .map<RankedAngle>((angle) => ({
      angle,
      score: Math.round(((scores.get(angle) ?? 0) + Number.EPSILON) * 1000) / 1000,
      why: explainAngle(angle, analyzerOutput, clipType)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  return {
    archetype: channelProfile.archetype,
    clipType,
    primaryAngle: rankedAngles[0]?.angle ?? allowed[0] ?? "payoff_reveal",
    secondaryAngles: rankedAngles.slice(1, 3).map((item) => item.angle),
    allowedAngles: [...allowed],
    rankedAngles,
    coreTrigger: analyzerOutput.coreTrigger,
    humanStake: analyzerOutput.humanStake,
    narrativeFrame: analyzerOutput.narrativeFrame,
    whyViewerCares: analyzerOutput.whyViewerCares,
    topStrategy: analyzerOutput.stakes.includes("danger")
      ? "danger-first setup"
      : analyzerOutput.stakes.includes("competence")
        ? "competence-first setup"
        : analyzerOutput.stakes.includes("absurdity")
          ? "paradox-first setup"
          : "contrast-first context compression",
    bottomEnergy: analyzerOutput.bestBottomEnergy,
    whyOldV6WouldWorkHere:
      "Old v6 would anchor on the strongest visible trigger fast, compress why the moment matters into the TOP, and use the BOTTOM for an immediate human reaction instead of explanation.",
    failureModes: [
      "literal camera-log description",
      "object inventory instead of trigger framing",
      "bottom repeating top",
      "overly clean AI wording"
    ],
    retrievalFilters: {
      stable: {
        archetype: channelProfile.archetype,
        clipType
      },
      hot: {
        ownerChannelId: channelProfile.channelId,
        clipType
      }
    },
    writerBrief:
      `Write like ${channelProfile.name} for a ${channelProfile.archetype} clip. ` +
      `Lead with visible facts, then react like the crowd. Prioritize angles: ${rankedAngles.map((item) => item.angle).join(", ")}.`
  };
}

export function bestClipTypeForExample(
  archetype: string,
  title: string,
  overlayTop: string,
  overlayBottom: string,
  transcript: string
): string {
  return classifyClipType(archetype, [title, overlayTop, overlayBottom, transcript].join(" "));
}

export function scoreTextMatch(query: string, example: {
  title?: string;
  overlayTop?: string;
  overlayBottom?: string;
  transcript?: string;
  clipType?: string;
}): number {
  const haystack = [
    example.title ?? "",
    example.overlayTop ?? "",
    example.overlayBottom ?? "",
    example.transcript ?? "",
    example.clipType ?? ""
  ].join(" ");
  return tokenOverlapScore(query, haystack);
}
