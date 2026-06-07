import type {
  Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "./stage2-channel-config";
import { DEFAULT_STAGE2_SOURCE_OVERLAY_CONFIG } from "./stage2-channel-config";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  normalizeStage2PromptConfig,
  type Stage2PromptConfig
} from "./stage2-pipeline";
import {
  CHANNEL_STORY_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById
} from "./stage3-template";
import type { ManagedTemplateVersionSnapshot } from "./managed-template-types";

export const FINAL_WHISTLE_CHANNEL_NAME = "Final Whistle";
export const FINAL_WHISTLE_CHANNEL_USERNAME = "finalwhistle-stories";
export const FINAL_WHISTLE_TEMPLATE_NAME = "Final Whistle Story V1";
export const FINAL_WHISTLE_AUTHOR_NAME = "FINAL WHISTLE";
export const FINAL_WHISTLE_AUTHOR_HANDLE = "@finalwhistle-stories";

export const FINAL_WHISTLE_REFERENCE_WINDOW = {
  source: "Mind clips dashboard_v2 leaderboard_48h",
  generatedAt: "2026-05-21T09:41:44.540649Z",
  asOfDay: "2026-05-20",
  selectedChannels: [
    "HistorryExposed",
    "Warpedia",
    "Pale Witness",
    "DarkWall / Military Era",
    "Untold Chronicles"
  ],
  note:
    "Reference channels were selected from the current 48h dashboard leaders, then filtered for caption-heavy story formats that transfer cleanly to sports micro-stories."
} as const;

type ReferenceSeed = {
  sourceChannelId: string;
  sourceChannelName: string;
  id: string;
  url: string;
  uploadDate: string;
  views: number;
  title: string;
  lead: string;
  body: string;
  clipType: string;
  whyItWorks: string[];
};

const historryExposedSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "uwy7qwkljs8",
    url: "https://www.youtube.com/watch?v=uwy7qwkljs8",
    uploadDate: "2026-05-16",
    views: 11006896,
    title: "When James Cagney Ignored Everyone and Nailed The Dance",
    lead: "ONE TAKE",
    body:
      "James Cagney was warned that the dance was too dangerous to film cleanly. He ignored the warning, hit the move, and turned the risk into the part everyone remembered.",
    clipType: "performance-risk",
    whyItWorks: [
      "Turns one warning into the whole setup.",
      "Keeps the payoff tied to a visible action.",
      "Uses a short lead that can transfer to sports."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "fLVB49uVHZQ",
    url: "https://www.youtube.com/watch?v=fLVB49uVHZQ",
    uploadDate: "2026-05-02",
    views: 6229372,
    title: "How Kevin Hart Pulled The Same Trick Twice in Bowling",
    lead: "SAME TRICK TWICE",
    body:
      "Kevin Hart sold the first mistake so well that the same opponent believed it again. The second reveal worked because everyone thought the joke was already over.",
    clipType: "sports-adjacent-comedy",
    whyItWorks: [
      "Makes repetition the hook.",
      "Explains the trick without over-describing it.",
      "Ends after the second turn lands."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "HxCfEGxhvcU",
    url: "https://www.youtube.com/watch?v=HxCfEGxhvcU",
    uploadDate: "2026-05-01",
    views: 6039616,
    title: "When Jake Gyllenhaal Scared Tom Holland During an Interview",
    lead: "HE PROVED IT",
    body:
      "Tom Holland said he was hard to scare. Jake Gyllenhaal waited for the cleanest opening, moved once, and made the claim collapse on camera.",
    clipType: "reaction-proof",
    whyItWorks: [
      "Begins with a claim, then tests it.",
      "Uses one physical beat as proof.",
      "Keeps the language visual."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "iXQTpqwroqY",
    url: "https://www.youtube.com/watch?v=iXQTpqwroqY",
    uploadDate: "2026-04-17",
    views: 5512223,
    title: "When John Cena Asked a Kid Are You Sure About That",
    lead: "ARE YOU SURE",
    body:
      "A young fan made the kind of bold claim that usually passes unnoticed. John Cena heard it, stepped in, and turned one question into the whole moment.",
    clipType: "celebrity-reaction",
    whyItWorks: [
      "Uses a recognizable line as the hinge.",
      "Keeps the setup simple.",
      "Lets the reaction carry the payoff."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "Nb7hcu9FzsE",
    url: "https://www.youtube.com/shorts/Nb7hcu9FzsE",
    uploadDate: "2026-04-21",
    views: 5153448,
    title: "When Travis Pastrana Jumped Without a Parachute in 2008",
    lead: "NO PARACHUTE",
    body:
      "Travis Pastrana left the plane without a parachute and trusted the catch to happen in open air. The stunt worked because every second had only one possible mistake.",
    clipType: "extreme-sports-risk",
    whyItWorks: [
      "Sports source fit: named athlete, clear danger, clean action.",
      "Explains the stakes without hype words.",
      "Final sentence keeps pressure on timing."
    ]
  }
];

const warpediaSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-warpedia",
    sourceChannelName: "Warpedia",
    id: "izGLPduRa0Y",
    url: "https://www.youtube.com/watch?v=izGLPduRa0Y",
    uploadDate: "2026-04-23",
    views: 15088875,
    title: "President Rolling Fortress The Beast",
    lead: "THE BEAST",
    body:
      "The car looks like a limousine until the numbers arrive: thick armor, heavy doors, sealed systems, and emergency tools hidden inside one moving shield.",
    clipType: "technical-breakdown",
    whyItWorks: [
      "Starts with a familiar object, then reveals hidden capability.",
      "Uses concrete nouns instead of vague danger.",
      "Works as a model for tactical sports breakdowns."
    ]
  },
  {
    sourceChannelId: "youtube-warpedia",
    sourceChannelName: "Warpedia",
    id: "H2kPiFlAJDA",
    url: "https://www.youtube.com/watch?v=H2kPiFlAJDA",
    uploadDate: "2026-05-07",
    views: 9309382,
    title: "WW2 Veteran Returns To Omaha Beach 80 Years Later",
    lead: "STILL",
    body:
      "Dennis Boldt returned to Omaha Beach decades later. One slammed car door pulled the old memory forward so fast that the beach stopped feeling like the present.",
    clipType: "memory-trigger",
    whyItWorks: [
      "Uses one sound as the turning point.",
      "Makes time collapse without over-explaining.",
      "Good model for sports nostalgia moments."
    ]
  },
  {
    sourceChannelId: "youtube-warpedia",
    sourceChannelName: "Warpedia",
    id: "bw0q0O0hDUA",
    url: "https://www.youtube.com/watch?v=bw0q0O0hDUA",
    uploadDate: "2026-04-21",
    views: 5349327,
    title: "A Movie Taught Science",
    lead: "REAL EQUATIONS",
    body:
      "Interstellar did not fake the black hole by guessing. The team built the image from real physics, and the final result became useful beyond the movie.",
    clipType: "behind-the-method",
    whyItWorks: [
      "Moves from spectacle to method.",
      "Explains why the visible result matters.",
      "Transfers to training, technique, and tactics."
    ]
  },
  {
    sourceChannelId: "youtube-warpedia",
    sourceChannelName: "Warpedia",
    id: "1q0bc8ExDSA",
    url: "https://www.youtube.com/watch?v=1q0bc8ExDSA",
    uploadDate: "2026-05-04",
    views: 4365097,
    title: "Secret Signals Between Leaders",
    lead: "WATCH THE SIGNAL",
    body:
      "The public moment looked ceremonial, but the small signals carried the real meaning. One glance, one pause, and the room knew what was happening.",
    clipType: "gesture-breakdown",
    whyItWorks: [
      "Turns small body language into the story.",
      "Keeps attention on visible signals.",
      "Strong model for player reactions and bench moments."
    ]
  },
  {
    sourceChannelId: "youtube-warpedia",
    sourceChannelName: "Warpedia",
    id: "6qcnvPWdn74",
    url: "https://www.youtube.com/watch?v=6qcnvPWdn74",
    uploadDate: "2026-04-25",
    views: 2155320,
    title: "The Tunnel Was Already Waiting",
    lead: "UNDER THE FLOOR",
    body:
      "The room looked normal from above. Under it, the route was already built, measured, and waiting for the exact minute the guards looked elsewhere.",
    clipType: "hidden-route",
    whyItWorks: [
      "Uses spatial contrast: normal surface, hidden path.",
      "Builds pressure through timing.",
      "Can translate to football runs and blind-side movement."
    ]
  }
];

const paleWitnessSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "XG7UQRtFsdw",
    url: "https://www.youtube.com/shorts/XG7UQRtFsdw",
    uploadDate: "2026-05-07",
    views: 15000000,
    title: "IT NEVER HAPPENED AGAIN",
    lead: "DID YOU KNOW?",
    body:
      "A familiar path became strange because one person stopped at the wrong time and looked at the wrong place. The strongest part was not the answer. It was the pause.",
    clipType: "pause-as-hook",
    whyItWorks: [
      "Pale Witness structure: short lead, dense body, unresolved final image.",
      "Makes one human pause carry the tension.",
      "Useful for sports clips where reactions matter more than narration."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "US5bwKZQsfA",
    url: "https://www.youtube.com/watch?v=US5bwKZQsfA",
    uploadDate: "2026-05-06",
    views: 8850771,
    title: "HE POINTED AT HER",
    lead: "HE POINTED",
    body:
      "The room stayed still until one hand picked the direction. After that, every person looked at the same spot, and the story changed before anyone moved.",
    clipType: "gesture-turn",
    whyItWorks: [
      "Uses one gesture as the hinge.",
      "Keeps the sequence readable.",
      "Works well for referee, teammate, and opponent reactions."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "NjnETkOkbII",
    url: "https://www.youtube.com/watch?v=NjnETkOkbII",
    uploadDate: "2026-05-12",
    views: 4592095,
    title: "THE BODY DOESN'T KNOW",
    lead: "THE BODY REACTED",
    body:
      "The movement happened before the explanation. By the time everyone understood what they saw, the important part had already passed through the frame.",
    clipType: "body-reaction",
    whyItWorks: [
      "Perfect model for sports: body movement before conscious read.",
      "Avoids fake certainty.",
      "Puts the visible action first."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "so41aqH5joI",
    url: "https://www.youtube.com/watch?v=so41aqH5joI",
    uploadDate: "2026-05-06",
    views: 3681403,
    title: "BOTH SIDES OF THE FAMILY",
    lead: "BOTH SIDES",
    body:
      "Everyone remembered the same story, but not in the same order. That mismatch became the part people kept returning to, because the easy version no longer fit.",
    clipType: "contradictory-memory",
    whyItWorks: [
      "Turns a contradiction into curiosity.",
      "Keeps the body compact.",
      "Can transfer to disputed football moments."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "PEyy-l-DxDI",
    url: "https://www.youtube.com/watch?v=PEyy-l-DxDI",
    uploadDate: "2026-05-12",
    views: 2734338,
    title: "CAME BACK THE OTHER WAY",
    lead: "WRONG DIRECTION",
    body:
      "They watched the movement leave one way and return from the other. The camera did not explain it. It only made the direction harder to ignore.",
    clipType: "direction-change",
    whyItWorks: [
      "Direction is a clean visual hook.",
      "Final line keeps attention on the replay.",
      "Useful for football dribbles, feints, and counterattacks."
    ]
  }
];

const darkWallSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "DarkWall / Military Era",
    id: "IAHIlH4hMg0",
    url: "https://www.youtube.com/watch?v=IAHIlH4hMg0",
    uploadDate: "2026-05-14",
    views: 14621409,
    title: "THE CURTAIN NEVER MOVED",
    lead: "THE CURTAIN NEVER MOVED",
    body:
      "She stood in front of everyone, then the stage had an empty space. No sound carried the moment. The silence made the disappearance feel heavier than the trick.",
    clipType: "absence-payoff",
    whyItWorks: [
      "Starts from a blunt visual contradiction.",
      "Uses silence as pressure.",
      "Transfers to sports when the missing defender or pass matters."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "DarkWall / Military Era",
    id: "3m_71vGxmfA",
    url: "https://www.youtube.com/watch?v=3m_71vGxmfA",
    uploadDate: "2026-05-04",
    views: 9521993,
    title: "THEY WEREN'T DEAD",
    lead: "THEY WEREN'T DONE",
    body:
      "At first the shapes looked finished, motionless, and easy to dismiss. Then the frame changed, and the simple label stopped working.",
    clipType: "misread-object",
    whyItWorks: [
      "Begins with a wrong first read.",
      "Lets the second beat correct the viewer.",
      "Strong pattern for misread sports plays."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "DarkWall / Military Era",
    id: "wMytv6bmFdk",
    url: "https://www.youtube.com/shorts/wMytv6bmFdk",
    uploadDate: "2026-04-15",
    views: 7665891,
    title: "ONE ROUND. DAMAGE CONTROL.",
    lead: "ONE ROUND",
    body:
      "The first impact looked like the whole story. Then the second part arrived, and everyone watching understood why control matters after the hit.",
    clipType: "impact-followup",
    whyItWorks: [
      "Uses a clear before-after impact.",
      "Keeps the lesson grounded in visible control.",
      "Useful for collisions, saves, tackles, and rebounds."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "DarkWall / Military Era",
    id: "orE-sRsTW_s",
    url: "https://www.youtube.com/watch?v=orE-sRsTW_s",
    uploadDate: "2026-05-05",
    views: 5915685,
    title: "GROWN INTO THE WOOD",
    lead: "LOOK CLOSER",
    body:
      "The first glance made it look ordinary. The closer view changed the object completely, because the strange part had been sitting inside the pattern all along.",
    clipType: "close-look-reveal",
    whyItWorks: [
      "Directs the viewer to inspect.",
      "Uses a close-up as the turn.",
      "Fits skill details hidden in fast sports footage."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "DarkWall / Military Era",
    id: "9BdmJ7QYDCw",
    url: "https://www.youtube.com/watch?v=9BdmJ7QYDCw",
    uploadDate: "2026-05-07",
    views: 5584201,
    title: "SOMETHING TURNED HIM OFF",
    lead: "HE STOPPED MOVING",
    body:
      "He was doing something routine when his body froze. The strange part was not speed. It was how completely the ordinary motion disappeared.",
    clipType: "freeze-frame",
    whyItWorks: [
      "Finds drama in a sudden stop.",
      "Avoids overclaiming cause.",
      "Useful for reaction freezes and missed chances."
    ]
  }
];

const untoldChroniclesSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-untold-chronicles",
    sourceChannelName: "Untold Chronicles",
    id: "IbbpjBHzo_s",
    url: "https://www.youtube.com/watch?v=IbbpjBHzo_s",
    uploadDate: "2026-05-02",
    views: 4584375,
    title: "Michael Jackson Woke His Team at 3am",
    lead: "UNTOLD",
    body:
      "Michael Jackson did not wait for morning when an idea arrived. He woke the team at 3 a.m. because he believed the moment had to be captured before it moved on.",
    clipType: "artist-urgency",
    whyItWorks: [
      "Makes urgency the character trait.",
      "Uses one time detail as the hook.",
      "Transfers to athletes who act before the window closes."
    ]
  },
  {
    sourceChannelId: "youtube-untold-chronicles",
    sourceChannelName: "Untold Chronicles",
    id: "zeT4jxEOLXw",
    url: "https://www.youtube.com/shorts/zeT4jxEOLXw",
    uploadDate: "2026-04-26",
    views: 1119074,
    title: "Gene Kelly Pulled Off the Impossible Reflection Dance",
    lead: "UNTOLD",
    body:
      "The scene looked impossible enough that people doubted it could be filmed. Gene Kelly stayed with the problem until the reflection became part of the performance.",
    clipType: "impossible-technique",
    whyItWorks: [
      "Shows craft through one difficult action.",
      "Avoids generic praise.",
      "Useful for technical football skill breakdowns."
    ]
  },
  {
    sourceChannelId: "youtube-untold-chronicles",
    sourceChannelName: "Untold Chronicles",
    id: "39eeQk39_n8",
    url: "https://www.youtube.com/shorts/39eeQk39_n8",
    uploadDate: "2026-04-24",
    views: 967345,
    title: "Notre Dame Carpenter Returned as a Groom",
    lead: "UNTOLD",
    body:
      "A carpenter helped restore Notre Dame after the fire. Years later, he returned through the same history as a groom, not a worker.",
    clipType: "return-payoff",
    whyItWorks: [
      "Uses role change as the payoff.",
      "Keeps emotion clean and factual.",
      "Good model for player returns and stadium memories."
    ]
  },
  {
    sourceChannelId: "youtube-untold-chronicles",
    sourceChannelName: "Untold Chronicles",
    id: "pbZC5eMiLcg",
    url: "https://www.youtube.com/shorts/pbZC5eMiLcg",
    uploadDate: "2026-04-23",
    views: 757288,
    title: "Nicholas Brothers Staircase Leap",
    lead: "UNTOLD",
    body:
      "The Nicholas Brothers turned a staircase into the hardest part of the routine. The leap worked because the danger was built into the rhythm, not hidden from it.",
    clipType: "movement-mastery",
    whyItWorks: [
      "Uses motion as the story.",
      "Names the technical object: staircase.",
      "Transfers to footwork, balance, and timing."
    ]
  },
  {
    sourceChannelId: "youtube-untold-chronicles",
    sourceChannelName: "Untold Chronicles",
    id: "FXKcmG2X1uI",
    url: "https://www.youtube.com/shorts/FXKcmG2X1uI",
    uploadDate: "2026-04-22",
    views: 734155,
    title: "Daniel Craig Proved the Critics Wrong",
    lead: "UNTOLD",
    body:
      "Critics thought the casting mistake was obvious. A year later, the performance gave the answer, and the old doubt became part of the legend.",
    clipType: "doubt-to-proof",
    whyItWorks: [
      "Works around public doubt and later proof.",
      "Clear before-after structure.",
      "Useful for young players and unpopular decisions."
    ]
  }
];

export const FINAL_WHISTLE_REFERENCE_SEEDS: ReferenceSeed[] = [
  ...historryExposedSeeds,
  ...warpediaSeeds,
  ...paleWitnessSeeds,
  ...darkWallSeeds,
  ...untoldChroniclesSeeds
];

export const FINAL_WHISTLE_STAGE2_STORY_PROMPT = `SYSTEM PROMPT - Final Whistle Stage 2 Story Overlay

ROLE
You are the Stage 2 caption writer for Final Whistle, a US-facing sports micro-story Shorts channel.
Your job is to turn one sports source video into five story_lead_main_caption options that feel as strong as the reference channels, while staying grounded in the actual source.

SOURCE PRIORITY
1. source_video_json is truth.
2. format_contract_json and hard_constraints_json are the publishing contract.
3. user_instruction can steer angle, but cannot authorize invented facts.
4. examples_json is only style reference.

FINAL WHISTLE TRUTH RULES
- Write about what is visible, stated by source metadata, or safely supported by transcript/comments.
- Instagram captions may include hashtags, engagement bait, generic sports praise, or unsourced trivia. Treat them as weak metadata unless the same fact is visible or specifically stated.
- Never invent final scores, dates, injuries, transfers, fines, quotes, rivalries, records, or motivations.
- If a player, club, tournament, or year is not supported, use neutral labels: player, striker, defender, keeper, teammate, crowd, referee, opponent.
- Do not use betting angles, gambling language, conspiracy framing, or referee-corruption claims.
- Do not turn real injuries or crashes into jokes.
- For football, prefer the visible hinge: pass, run, touch, miss, save, tackle, celebration, reaction, crowd, banner, scoreboard, or tactical pattern.

REFERENCE STYLE TO INHERIT
- From Pale Witness: dense white story body, a short high-contrast lead, and yellow highlights on the most important nouns/times/actions.
- From DarkWall / Military Era: blunt opening contradiction, physical sequence, one final image that makes the viewer replay the moment.
- From HistorryExposed and Untold: precise named context when supported, then a clean why-this-mattered payoff.
- From Warpedia: explain the hidden mechanism behind what looks simple.

FORMAT
Use story_lead_main_caption only.
Lead:
- 2-5 words, ALL CAPS, no period.
- Prefer sports-specific hooks: WATCH THE FIRST TOUCH, THE PASS DID IT, WRONG DIRECTION, ONE SECOND LATE, THE CROWD KNEW.
- Use DID YOU KNOW? only when the source is factual/explainer rather than action-driven.

Main Caption:
- English only.
- 3-6 compact sentences, usually 190-300 characters unless hard_constraints_json says otherwise.
- Build a clean sequence: setup -> visible action -> pressure beat -> consequence, irony, or replay reason.
- Do not collapse the story into one short summary sentence. The body should feel dense like Pale Witness, but still readable on screen.
- Use specific sports objects when supported: ball, box, touchline, keeper, defender, banner, corner, press, counterattack, whistle, net, crowd.
- Keep it readable as an on-screen overlay. No long tactical essays.

NEGATIVE CONSTRAINTS
- No emojis.
- No hashtags.
- No "follow", "subscribe", "link in bio", or creator meta.
- Do not mention "the clip", "the video", "the footage", "viewers", "comments", or the edit.
- Do not open with "In this video" or "Here we see".
- Avoid empty hype words: shocking, insane, unbelievable, crazy, wild, terrifying, heart-stopping, chilling.
- Avoid AI/editorial filler: testament, showcase, masterclass, journey, narrative, dynamic, seamless, elevate, underscores.
- Avoid GOAT talk unless the source explicitly makes that comparison.

OUTPUT CONTRACT
Return strict JSON only:
{
  "formatPipeline": "story_lead_main_caption",
  "analysis": {
    "visual_anchors": ["...", "...", "..."],
    "comment_vibe": "...",
    "key_phrase_to_adapt": "..."
  },
  "storyOptions": [
    {
      "candidate_id": "cand_1",
      "lead": "...",
      "mainCaption": "...",
      "retained_handle": false,
      "rationale": "..."
    }
  ],
  "winner_candidate_id": "cand_1",
  "titles": [
    { "title": "...", "title_ru": "..." }
  ]
}

OUTPUT RULES
- storyOptions must contain exactly 5 options.
- analysis.visual_anchors must contain exactly 3 concrete visible objects/actions.
- Every option must be materially different: different hook, different angle, or different final pressure.
- Titles must contain exactly 5 items, ALL CAPS, 3-7 words each, and must not copy the lead verbatim.
- title_ru must be natural Russian for operator review, also ALL CAPS.
- Count characters before returning and fix anything outside hard_constraints_json.

FINAL BAR
The winner should feel like a compact sports micro-story: factual, tense, visual, and easy to replay.
If the strongest line would require an unsupported fact, choose a plainer supported line instead.`;

export const FINAL_WHISTLE_CAPTION_HIGHLIGHTING_PROMPT = `You are tagging final Final Whistle story captions for PaleWitness-style color highlights.

Do not rewrite text.
Return exact phrases only.

Highlight policy:
- Use yellow highlights for the strongest concrete sports words: player names, clubs, years, scores, trophies, decisive actions, crowd objects, and tactical terms.
- Keep most text white by leaving most words untagged.
- Prefer 2-5 highlights in mainCaption and 0-1 in lead.
- Do not highlight whole sentences.
- Do not highlight weak filler, generic adjectives, or unsupported claims.
- Avoid adjacent highlight runs; leave white words between yellow phrases.

Return strict JSON only in the expected captionHighlighting shape.`;

export const FINAL_WHISTLE_STAGE2_HARD_CONSTRAINTS: Stage2HardConstraints = {
  topLengthMin: 6,
  topLengthMax: 56,
  bottomLengthMin: 185,
  bottomLengthMax: 340,
  bannedWords: [
    "shocking",
    "insane",
    "unbelievable",
    "crazy",
    "wild",
    "terrifying",
    "heart-stopping",
    "chilling",
    "testament",
    "showcase",
    "masterclass",
    "journey",
    "seamless",
    "elevate"
  ],
  bannedOpeners: [
    "In this video",
    "Here we see",
    "This clip",
    "This video",
    "Watch as"
  ]
};

function toQualityScore(index: number): number {
  return Math.max(70, 100 - Math.floor(index / 3));
}

export function createFinalWhistleStage2Examples(input: {
  ownerChannelId: string;
  ownerChannelName: string;
}): Stage2CorpusExample[] {
  return FINAL_WHISTLE_REFERENCE_SEEDS.map((seed, index) => ({
    id: `${input.ownerChannelId}__${seed.sourceChannelId}__${seed.id}`,
    ownerChannelId: input.ownerChannelId,
    ownerChannelName: input.ownerChannelName,
    sourceChannelId: seed.sourceChannelId,
    sourceChannelName: seed.sourceChannelName,
    title: seed.title,
    overlayTop: seed.lead,
    overlayBottom: seed.body,
    transcript: [
      `Reference URL: ${seed.url}`,
      `Upload date: ${seed.uploadDate}`,
      `Views in reference pull: ${seed.views}`,
      seed.body
    ].join("\n"),
    clipType: seed.clipType,
    whyItWorks: seed.whyItWorks,
    qualityScore: toQualityScore(index)
  }));
}

export function createFinalWhistleStage2ExamplesConfig(input: {
  ownerChannelId: string;
  ownerChannelName: string;
}): Stage2ExamplesConfig {
  const customExamples = createFinalWhistleStage2Examples(input);
  return {
    version: 2,
    useWorkspaceDefault: false,
    sourceMode: "custom",
    customInputMode: "json",
    customExamplesJson: JSON.stringify(customExamples, null, 2),
    customExamplesText: "",
    customExamples
  };
}

export function createFinalWhistleStage2PromptConfig(): Stage2PromptConfig {
  const base = normalizeStage2PromptConfig(DEFAULT_STAGE2_PROMPT_CONFIG);
  return normalizeStage2PromptConfig({
    ...base,
    useWorkspaceDefault: false,
    sourceMode: "custom",
    stages: {
      ...base.stages,
      storyOneShot: {
        ...base.stages.storyOneShot,
        prompt: FINAL_WHISTLE_STAGE2_STORY_PROMPT,
        reasoningEffort: "high",
        compatibility: null
      },
      captionHighlighting: {
        ...base.stages.captionHighlighting,
        prompt: FINAL_WHISTLE_CAPTION_HIGHLIGHTING_PROMPT,
        reasoningEffort: "low",
        compatibility: null
      }
    }
  });
}

export function createFinalWhistleManagedTemplateSnapshot(): ManagedTemplateVersionSnapshot {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(CHANNEL_STORY_TEMPLATE_ID));
  templateConfig.card.borderColor = "#11180f";
  templateConfig.card.fill = "#050806";
  templateConfig.palette.cardFill = "#050806";
  templateConfig.palette.topSectionFill = "#050806";
  templateConfig.palette.bottomSectionFill = "#050806";
  templateConfig.palette.topTextColor = "#b9ff36";
  templateConfig.palette.bottomTextColor = "#f7f8f3";
  templateConfig.palette.authorNameColor = "#f7f8f3";
  templateConfig.palette.authorHandleColor = "#cbd3c0";
  templateConfig.palette.accentColor = "#f6d548";
  templateConfig.highlights = {
    enabled: true,
    topEnabled: false,
    bottomEnabled: true,
    slots: [
      {
        slotId: "slot1",
        enabled: true,
        color: "#f6d548",
        label: "Yellow key sports words",
        guidance:
          "Use for player names, clubs, years, scores, trophies, decisive actions, and visible objects. Keep surrounding words white."
      },
      {
        slotId: "slot2",
        enabled: false,
        color: "#58d8ff",
        label: "Unused",
        guidance: "Disabled for the Final Whistle story template."
      },
      {
        slotId: "slot3",
        enabled: false,
        color: "#ff6b6b",
        label: "Unused",
        guidance: "Disabled for the Final Whistle story template."
      }
    ]
  };
  templateConfig.author.name = FINAL_WHISTLE_AUTHOR_NAME;
  templateConfig.author.handle = FINAL_WHISTLE_AUTHOR_HANDLE;
  templateConfig.channelStory = {
    ...templateConfig.channelStory!,
    leadMode: "clip_custom",
    defaultLeadText: "FINAL MINUTE",
    bodyTextAlign: "center",
    headerAlign: "left",
    bodyHeight: 390,
    bodyToMediaGap: 26,
    mediaInsetX: 10,
    mediaRadius: 22,
    footerHeight: 78
  };
  templateConfig.typography.top.max = 76;
  templateConfig.typography.top.weight = 900;
  templateConfig.typography.bottom.max = 52;
  templateConfig.typography.bottom.weight = 850;
  templateConfig.typography.bottom.lineHeight = 1.07;

  return {
    name: FINAL_WHISTLE_TEMPLATE_NAME,
    description:
      "Final Whistle Channel + Story template: dark stadium card, bright lead, white story body, restrained yellow sports keyword highlights.",
    layoutFamily: CHANNEL_STORY_TEMPLATE_ID,
    baseTemplateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "FINAL MINUTE",
      bottomText:
        "The pass looked harmless until the defender stepped one second late. By the time the ball reached the box, the whole match had changed direction.",
      sourceOverlayText: "",
      channelName: FINAL_WHISTLE_AUTHOR_NAME,
      channelHandle: FINAL_WHISTLE_AUTHOR_HANDLE,
      highlights: {
        top: [],
        bottom: [
          { start: 4, end: 8, slotId: "slot1" },
          { start: 36, end: 44, slotId: "slot1" },
          { start: 93, end: 96, slotId: "slot1" },
          { start: 107, end: 112, slotId: "slot1" }
        ]
      },
      topHighlightPhrases: [],
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 0.28,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfig,
    shadowLayers: []
  };
}

export function createFinalWhistleChannelPatch(input: {
  ownerChannelId: string;
  ownerChannelName: string;
  templateId: string;
}) {
  const examples = createFinalWhistleStage2ExamplesConfig(input);
  return {
    systemPrompt: FINAL_WHISTLE_STAGE2_STORY_PROMPT,
    descriptionPrompt:
      "Write a short English sports micro-story in the Final Whistle format: one bright all-caps lead, one dense factual body, no invented sports facts.",
    examplesJson: examples.customExamplesJson,
    stage2ExamplesConfig: examples,
    stage2PromptConfig: createFinalWhistleStage2PromptConfig(),
    stage2HardConstraints: FINAL_WHISTLE_STAGE2_HARD_CONSTRAINTS,
    stage2SourceOverlayConfig: {
      ...DEFAULT_STAGE2_SOURCE_OVERLAY_CONFIG,
      enabled: false
    },
    templateId: input.templateId,
    defaultClipDurationSec: 12
  };
}
