import type { Stage2CorpusExample, Stage2ExamplesConfig, Stage2HardConstraints } from "./stage2-channel-config";
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

export const COPSCOPES_CHANNEL_USERNAME = "copscopes";
export const COPSCOPES_TEMPLATE_NAME = "Copscopes Story V1";

export const COPSCOPES_REFERENCE_WINDOW = {
  from: "2026-04-22",
  to: "2026-05-13",
  selectedPerChannel: 20,
  note:
    "Reference videos were selected from the most-viewed accessible Shorts in the three-week window. Military Era entries using the older comedic top/bottom military-tech format were excluded."
} as const;

export const COPSCOPES_SOURCE_REELS = [
  {
    shortcode: "DYRVHZIN0ta",
    url: "https://www.instagram.com/copscopes/reel/DYRVHZIN0ta/",
    viewsLabel: "15.9K",
    sourceNote:
      "Farmington officers followed street racers until a car flipped and caught fire; an officer pulled a passenger out before the vehicle was engulfed."
  },
  {
    shortcode: "DYRHZNrseVo",
    url: "https://www.instagram.com/copscopes/reel/DYRHZNrseVo/",
    viewsLabel: "10.8K",
    sourceNote:
      "Suspect used a bridge as cover, let a Jaguar keep rolling, and disappeared before officers realized the car was empty."
  },
  {
    shortcode: "DYMDoh8tHtA",
    url: "https://www.instagram.com/copscopes/reel/DYMDoh8tHtA/",
    viewsLabel: "4.2M",
    sourceNote:
      "Highest-view visible reel from the public profile scrape; Instagram metadata is engagement-heavy and must be treated as weak source text."
  }
] as const;

export const COPSCOPES_EXCLUDED_REFERENCE_IDS = [
  "7CaqtjLXP1A",
  "dO_Z8ytSsz4",
  "v9N4dcgCkuM"
] as const;

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

const historyExposedSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "Gibs71o1mVQ",
    url: "https://www.youtube.com/shorts/Gibs71o1mVQ",
    uploadDate: "2026-05-07",
    views: 2271843,
    title: "When Norm Macdonald Caught a Game Show Rigging the 50/50",
    lead: "ONE QUIET PREDICTION",
    body:
      "Norm Macdonald announced the trick before the lifeline even moved. When the board changed, the joke stopped feeling like a joke.",
    clipType: "entertainment-history",
    whyItWorks: [
      "Opens with a precise public moment.",
      "Turns the reveal into a simple cause-and-effect beat.",
      "Lets the final sentence reframe the whole clip."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "Rt7kaO1VJns",
    url: "https://www.youtube.com/shorts/Rt7kaO1VJns",
    uploadDate: "2026-05-08",
    views: 1219066,
    title: "How a Nike Commercial Accidentally Created The Viral LeBron Meme",
    lead: "THE AD BECAME THE JOKE",
    body:
      "Nike wanted four versions of LeBron in one polished commercial. Years later, the internet found the exact frame that made it immortal.",
    clipType: "pop-culture-origin",
    whyItWorks: [
      "Uses brand context only to set up the later twist.",
      "Makes the audience wait for the meme origin.",
      "Keeps the explanation compact and visual."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "yfcaah0EINg",
    url: "https://www.youtube.com/shorts/yfcaah0EINg",
    uploadDate: "2026-05-03",
    views: 787778,
    title: "The Movie Nobody Knew Jean-Claude Van Damme Was In",
    lead: "BEFORE THE HIGH KICKS",
    body:
      "Long before the action-star image, Van Damme was just another background dancer trying to get noticed in a breakdancing movie.",
    clipType: "hidden-career-origin",
    whyItWorks: [
      "Contrasts the known public image with the early detail.",
      "Names the person immediately.",
      "Uses a grounded before-after structure."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "wkJ4NYqVK8c",
    url: "https://www.youtube.com/shorts/wkJ4NYqVK8c",
    uploadDate: "2026-05-06",
    views: 779295,
    title: "The Quickest Christoph Waltz Interview Ever",
    lead: "THE QUESTION ENDED IT",
    body:
      "The interview tried to turn a movie controversy into a bit. Waltz answered with the kind of silence that made the whole room smaller.",
    clipType: "awkward-interview",
    whyItWorks: [
      "Builds tension from a social misread.",
      "Avoids over-explaining the clip.",
      "Ends on the human reaction, not the premise."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "k3TDUCM0t_8",
    url: "https://www.youtube.com/shorts/k3TDUCM0t_8",
    uploadDate: "2026-05-05",
    views: 684777,
    title: "When Two Pilots Swapped Planes Mid-Air and Lost Their Licenses",
    lead: "THE STUNT HAD A PRICE",
    body:
      "Two pilots tried to trade planes while falling through open air. The stunt was built for attention, and the penalty arrived right after it.",
    clipType: "stunt-consequence",
    whyItWorks: [
      "States the impossible action plainly.",
      "Adds consequence without moralizing.",
      "Keeps the stakes tied to the visible event."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "aiRf-gLdYbU",
    url: "https://www.youtube.com/shorts/aiRf-gLdYbU",
    uploadDate: "2026-05-06",
    views: 385983,
    title: "How The Dark Knight Faked Batman's Skyscraper Jump",
    lead: "THE JUMP WAS CONTROLLED",
    body:
      "The shot looks like a clean rooftop fall. Behind it was wire work, camera math, and a stunt team hiding the danger in plain sight.",
    clipType: "film-production",
    whyItWorks: [
      "Explains a production trick through one visual illusion.",
      "Uses concrete craft terms without becoming technical.",
      "Makes the audience re-watch the shot."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "1lL9qtB524o",
    url: "https://www.youtube.com/shorts/1lL9qtB524o",
    uploadDate: "2026-05-05",
    views: 354048,
    title: "When John Krasinski Kept Breaking Character",
    lead: "EIGHTEEN TAKES LATER",
    body:
      "The Office needed Jim to stay perfectly still. Krasinski kept losing it, and the scene became funnier because everyone was fighting the same laugh.",
    clipType: "behind-the-scenes",
    whyItWorks: [
      "Uses a count as the hook.",
      "Frames laughter as the hidden conflict.",
      "Connects production detail to the viewer's memory."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "DslLau3o818",
    url: "https://www.youtube.com/shorts/DslLau3o818",
    uploadDate: "2026-05-07",
    views: 331415,
    title: "The Skit That Always Catches You Off Guard",
    lead: "THE SKETCH HIDES THE TURN",
    body:
      "Key and Peele trained viewers to wait for one clean joke. This skit keeps moving until the punchline arrives from the wrong direction.",
    clipType: "comedy-breakdown",
    whyItWorks: [
      "Describes comedic structure, not just fandom.",
      "Names the expectation first.",
      "Uses the final phrase as the turn."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "yY2PZMUPs_c",
    url: "https://www.youtube.com/shorts/yY2PZMUPs_c",
    uploadDate: "2026-05-04",
    views: 293645,
    title: "When Shaq and Gary Coleman Couldn't Keep a Straight Face",
    lead: "THE HEIGHT GAP WON",
    body:
      "The script was simple. Then Shaq and Gary Coleman stood next to each other, and the scene became too visually ridiculous to finish cleanly.",
    clipType: "sitcom-moment",
    whyItWorks: [
      "Turns a visible contrast into the central joke.",
      "Uses short sentence rhythm.",
      "Avoids generic praise for the actors."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "8CrNVwtsYqQ",
    url: "https://www.youtube.com/shorts/8CrNVwtsYqQ",
    uploadDate: "2026-05-03",
    views: 288451,
    title: "When Gregory Peck Made Audrey Hepburn Scream for Real",
    lead: "THE SCARE WAS REAL",
    body:
      "Roman Holiday needed a playful reaction. Gregory Peck hid the gag until the camera rolled, and Hepburn gave them the real scream.",
    clipType: "film-history",
    whyItWorks: [
      "Pins the story to one famous production moment.",
      "Uses the real reaction as the payoff.",
      "Keeps the line warm without becoming nostalgic."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "jufXTKdFOnk",
    url: "https://www.youtube.com/shorts/jufXTKdFOnk",
    uploadDate: "2026-05-07",
    views: 269224,
    title: "When BMW Made The M5 Feel Like it Was Faster Than a Jet",
    lead: "THE COMMERCIAL CHEATED SCALE",
    body:
      "BMW opened with a machine that already looked impossible. Then the ad used timing and perspective to make the M5 feel even faster.",
    clipType: "advertising-origin",
    whyItWorks: [
      "Explains the trick as perception, not specs.",
      "Uses the brand detail as setup only.",
      "Creates a clear visual reason to keep watching."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "EHd2PqRSGBg",
    url: "https://www.youtube.com/shorts/EHd2PqRSGBg",
    uploadDate: "2026-05-06",
    views: 207545,
    title: "When Supernatural's Winchester Brothers Forgot Who Closes The Scene",
    lead: "THE BROTHERS KEPT ARGUING",
    body:
      "After years playing the same bond, the actors had their own instincts about the scene. The argument felt less like acting and more like history leaking out.",
    clipType: "behind-the-scenes",
    whyItWorks: [
      "Uses relationship history to deepen a small moment.",
      "Avoids fan-service wording.",
      "Ends with a clear emotional read."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "SnMlyxh8TLY",
    url: "https://www.youtube.com/shorts/SnMlyxh8TLY",
    uploadDate: "2026-05-04",
    views: 205408,
    title: "When a Nun's Ringtone Blew a Man's Mind in The Hood",
    lead: "THE RINGTONE BROKE THE IMAGE",
    body:
      "A stranger expected one kind of conversation from a woman in a habit. The phone rang, the bass hit, and the whole read changed instantly.",
    clipType: "street-comedy",
    whyItWorks: [
      "Makes the contradiction visual and audible.",
      "Keeps the punchline in the final turn.",
      "Uses everyday detail instead of abstract commentary."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "FW8edk_1ytU",
    url: "https://www.youtube.com/shorts/FW8edk_1ytU",
    uploadDate: "2026-05-04",
    views: 185611,
    title: "Before Breaking Bad Bryan Cranston Was Just a Comedy Dad",
    lead: "THE CASTING LOOKED WRONG",
    body:
      "Before Walter White, most people saw Bryan Cranston as the frantic sitcom dad. That is what made the casting feel risky, and why it worked.",
    clipType: "casting-history",
    whyItWorks: [
      "Uses audience memory as the setup.",
      "Frames the tension before the payoff.",
      "Keeps the explanation direct."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "nU5TCo-4dNs",
    url: "https://www.youtube.com/shorts/nU5TCo-4dNs",
    uploadDate: "2026-05-08",
    views: 165698,
    title: "When Jared Padalecki Stole The Show on Celebrity Family Feud",
    lead: "HE READ THE ROOM",
    body:
      "The bit only worked because Padalecki matched the host's rhythm instead of shrinking from it. The answer became the moment.",
    clipType: "game-show-moment",
    whyItWorks: [
      "Explains why a live moment lands.",
      "Keeps attention on timing and reaction.",
      "Uses a concise final sentence."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "FVKLmJU-fbk",
    url: "https://www.youtube.com/shorts/FVKLmJU-fbk",
    uploadDate: "2026-05-08",
    views: 106654,
    title: "When Shaq's Own Employee Checked If His Money Was Real",
    lead: "THE REGISTER DID NOT CARE",
    body:
      "Shaq owned the restaurant and still got treated like any other customer at the counter. The funny part is how normal the employee made it.",
    clipType: "celebrity-everyday",
    whyItWorks: [
      "Finds the small institutional joke.",
      "Names status first, then strips it away.",
      "Avoids over-selling the clip."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "3Tros1wB1Hc",
    url: "https://www.youtube.com/shorts/3Tros1wB1Hc",
    uploadDate: "2026-05-10",
    views: 85168,
    title: "How Daniel Radcliffe Got Sent Down Rivers and Mauled by a Bear",
    lead: "THE CORPSE ROLE WAS WORK",
    body:
      "Daniel Radcliffe had to play dead while the production dragged him through water, dirt, and chaos. The weird role was also a physical one.",
    clipType: "film-production",
    whyItWorks: [
      "Turns a bizarre premise into a physical workload.",
      "Keeps the body of the story concrete.",
      "Uses a clean final reframing."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "zobXXkiKAFM",
    url: "https://www.youtube.com/shorts/zobXXkiKAFM",
    uploadDate: "2026-05-12",
    views: 73260,
    title: "When a Police Officer Erased 4.5 Years of Evidence With a USB",
    lead: "ONE USB RUINED YEARS",
    body:
      "The case had years of digital work behind it. Then one procedural mistake with a storage device turned the evidence itself into the problem.",
    clipType: "police-procedure",
    whyItWorks: [
      "Closest History Exposed reference for Copscopes.",
      "Makes procedure the tension source.",
      "Avoids courtroom certainty beyond the described mistake."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "l-SKVAG4ZPg",
    url: "https://www.youtube.com/shorts/l-SKVAG4ZPg",
    uploadDate: "2026-05-06",
    views: 72835,
    title: "When Supernatural Got an Unexpected Brad Pitt Reference",
    lead: "THE LINE BROKE THE TENSION",
    body:
      "A serious scene gave Dean one opening for a movie reference. The joke worked because it arrived exactly where the drama wanted silence.",
    clipType: "script-moment",
    whyItWorks: [
      "Names the tonal interruption.",
      "Keeps the setup simple.",
      "Ends on contrast."
    ]
  },
  {
    sourceChannelId: "youtube-historry-exposed",
    sourceChannelName: "HistorryExposed",
    id: "xKZrWhsRHHQ",
    url: "https://www.youtube.com/shorts/xKZrWhsRHHQ",
    uploadDate: "2026-05-11",
    views: 69165,
    title: "When Jim Carrey Went Off-Script in Dumb and Dumber",
    lead: "THE SCRIPT LOST CONTROL",
    body:
      "Jim Carrey kept replacing the planned line with something stranger. The crew had to survive the take before the movie could use it.",
    clipType: "improv-origin",
    whyItWorks: [
      "Turns improvisation into the conflict.",
      "Keeps the humor human.",
      "Uses action verbs instead of praise."
    ]
  }
];

const militaryEraSeeds: ReferenceSeed[] = [
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "3m_71vGxmfA",
    url: "https://www.youtube.com/shorts/3m_71vGxmfA",
    uploadDate: "2026-05-04",
    views: 16392526,
    title: "THEY WEREN'T DEAD",
    lead: "THEY WEREN'T DEAD",
    body:
      "Nearly sixty turtle-shaped bodies were packed underground, not moving and not matching anything in the records. Three were taken away. The rest had not shifted by morning.",
    clipType: "unexplained-discovery",
    whyItWorks: [
      "Begins with a blunt contradiction.",
      "Uses counts and object details to make the story feel specific.",
      "Ends with an unresolved final image."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "9BdmJ7QYDCw",
    url: "https://www.youtube.com/shorts/9BdmJ7QYDCw",
    uploadDate: "2026-05-07",
    views: 9185750,
    title: "SOMETHING TURNED HIM OFF",
    lead: "SOMETHING TURNED HIM OFF",
    body:
      "He was cleaning the pool when a black shape entered his vision and his body simply stopped. His wife reached him after it vanished. He remembered none of it.",
    clipType: "frozen-reaction",
    whyItWorks: [
      "Makes one physical change the hook.",
      "Uses witness arrival as the story clock.",
      "Avoids explaining the unknown too early."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "lSM00CS_KWg",
    url: "https://www.youtube.com/shorts/lSM00CS_KWg",
    uploadDate: "2026-05-03",
    views: 7205349,
    title: "KEEP IT FROM GETTING OUT",
    lead: "KEEP IT FROM GETTING OUT",
    body:
      "The sealed chamber did not look like preservation. The wall markings warned that something was meant to stay buried, and nobody asked to study the statue twice.",
    clipType: "sealed-object",
    whyItWorks: [
      "Reframes an archaeological find as containment.",
      "Uses an institutional behavior as the payoff.",
      "Maintains dread without naming a monster."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "orE-sRsTW_s",
    url: "https://www.youtube.com/shorts/orE-sRsTW_s",
    uploadDate: "2026-05-05",
    views: 6730860,
    title: "GROWN INTO THE WOOD",
    lead: "GROWN INTO THE WOOD",
    body:
      "The figure was not carved into the tree. It was inside the rings, year after year, like the wood had been holding the same pose for decades.",
    clipType: "natural-anomaly",
    whyItWorks: [
      "Turns object formation into time pressure.",
      "Uses a tactile visual anchor.",
      "Keeps the final line eerie but simple."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "ffrQuVEA7vg",
    url: "https://www.youtube.com/shorts/ffrQuVEA7vg",
    uploadDate: "2026-05-07",
    views: 6510842,
    title: "THREE DAYS TO NOTICE",
    lead: "THREE DAYS TO NOTICE",
    body:
      "The water looked clean. The danger entered through the nose in one second, stayed invisible, and gave the boy only days before anyone understood what happened.",
    clipType: "medical-hazard",
    whyItWorks: [
      "Uses a clear timeline to create dread.",
      "Contrasts clean visuals with hidden risk.",
      "Keeps the body factual and severe."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "Tz4CJGydm60",
    url: "https://www.youtube.com/shorts/Tz4CJGydm60",
    uploadDate: "2026-05-05",
    views: 6349361,
    title: "WATER STOPPED CARING",
    lead: "WATER STOPPED CARING",
    body:
      "She got trapped in the dark middle of a waterslide with no way forward and no way back. She screamed where nobody outside could hear it.",
    clipType: "trapped-person",
    whyItWorks: [
      "Personifies the environment in one memorable phrase.",
      "Uses spatial limits as the stakes.",
      "Ends on isolation."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "l4EEM61cgno",
    url: "https://www.youtube.com/shorts/l4EEM61cgno",
    uploadDate: "2026-05-02",
    views: 5834373,
    title: "ONE WRONG STEP",
    lead: "ONE WRONG STEP",
    body:
      "She brings a broom to the edge nobody else wants to approach. No harness, no net, just loose rock and the job tourists never think about.",
    clipType: "dangerous-work",
    whyItWorks: [
      "Sets up respect through visible labor.",
      "Uses concrete negatives instead of hype.",
      "Ends with an unseen human cost."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "Y76V2P8cp4I",
    url: "https://www.youtube.com/shorts/Y76V2P8cp4I",
    uploadDate: "2026-05-06",
    views: 5358102,
    title: "STANDING IN THE DARK",
    lead: "STANDING IN THE DARK",
    body:
      "Behind the rockfall, a human-sized black figure stood upright and moved slowly. Nobody went in. The next day it was facing another direction.",
    clipType: "dark-figure",
    whyItWorks: [
      "Uses blocked access as tension.",
      "Gives one unsettling movement detail.",
      "Saves the orientation change for the end."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "lcOquwKc6bA",
    url: "https://www.youtube.com/shorts/lcOquwKc6bA",
    uploadDate: "2026-05-08",
    views: 4873704,
    title: "FROM BELOW THE SURFACE",
    lead: "FROM BELOW THE SURFACE",
    body:
      "He sat at the water's edge until a human-shaped hand rose slowly and wrapped around his ankle. The water was shallow enough to make it worse.",
    clipType: "water-contact",
    whyItWorks: [
      "Uses body contact as the hook.",
      "Gives a slow sequence of movement.",
      "Reframes shallow water as more unsettling."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "GAwpOj6QbfE",
    url: "https://www.youtube.com/shorts/GAwpOj6QbfE",
    uploadDate: "2026-05-06",
    views: 4823810,
    title: "UNDER THE TONGUE",
    lead: "UNDER THE TONGUE",
    body:
      "The crocodile opened its mouth and something black moved beneath the tongue. It reacted to light, went still at sound, and the animal showed no distress.",
    clipType: "animal-anomaly",
    whyItWorks: [
      "Builds from one impossible close-up.",
      "Uses response-to-stimulus details.",
      "Keeps the ending observational."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "nNimMa4PbZk",
    url: "https://www.youtube.com/shorts/nNimMa4PbZk",
    uploadDate: "2026-05-03",
    views: 4760866,
    title: "STRAIGHT TOWARD HIS HAND",
    lead: "STRAIGHT TOWARD HIS HAND",
    body:
      "The fish looked normal until he opened its mouth. Then the thing living where the tongue should have been crawled out fast, straight at his hand.",
    clipType: "animal-parasite",
    whyItWorks: [
      "Starts normal, then violates the expected anatomy.",
      "Makes the movement directional.",
      "Stops at the human reaction."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "MH9oUzU_Ej4",
    url: "https://www.youtube.com/shorts/MH9oUzU_Ej4",
    uploadDate: "2026-05-09",
    views: 3679323,
    title: "A DOOR FOR SOMETHING SMALL",
    lead: "A DOOR FOR SOMETHING SMALL",
    body:
      "The staircase was carved into a lonely rock, each step too precise to dismiss. The door was smaller than a fist, and one of them tried the handle.",
    clipType: "small-door",
    whyItWorks: [
      "Uses scale as the uncanny detail.",
      "Keeps craft and age in the setup.",
      "Ends on a pending action."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "I1MJhvCnh9c",
    url: "https://www.youtube.com/shorts/I1MJhvCnh9c",
    uploadDate: "2026-05-01",
    views: 3207542,
    title: "THE COLLAR ON THE TABLE",
    lead: "THE COLLAR ON THE TABLE",
    body:
      "He came home from the vet with the collar and went to sleep alone. At 5:30, a shape at her exact height waited outside the window.",
    clipType: "grief-sighting",
    whyItWorks: [
      "Turns one object into emotional evidence.",
      "Uses time as the next beat.",
      "Leaves the choice not to check as the ending."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "miPXGv4-RS4",
    url: "https://www.youtube.com/shorts/miPXGv4-RS4",
    uploadDate: "2026-05-05",
    views: 2744189,
    title: "THE FATHER NEVER KNEW",
    lead: "THE FATHER NEVER KNEW",
    body:
      "Every night the doll moved a little closer to the chair where he sat. By morning it was back in the corner, and nobody caught that part.",
    clipType: "object-movement",
    whyItWorks: [
      "Uses repetition as the engine.",
      "Makes the unseen reset more frightening than the move.",
      "Keeps the father unaware."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "enZMfpMLGGs",
    url: "https://www.youtube.com/shorts/enZMfpMLGGs",
    uploadDate: "2026-05-09",
    views: 2628117,
    title: "NOT WORTH THE TROUBLE",
    lead: "NOT WORTH THE TROUBLE",
    body:
      "A bear walked in behind a mother and child, looked around the room, and decided to leave. They never knew it was standing there.",
    clipType: "near-miss",
    whyItWorks: [
      "Finds tension in what the subjects do not know.",
      "Keeps the animal behavior calm.",
      "Ends with camera evidence."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "cizw4bPrFvw",
    url: "https://www.youtube.com/shorts/cizw4bPrFvw",
    uploadDate: "2026-05-10",
    views: 2311868,
    title: "SHE LEFT THE GROUND",
    lead: "SHE LEFT THE GROUND",
    body:
      "She rose without jumping, and the men beside her grabbed her legs before she cleared their reach. When it stopped, she remembered nothing.",
    clipType: "body-anomaly",
    whyItWorks: [
      "Uses one impossible movement.",
      "Creates a rescue clock immediately.",
      "Ends on memory loss, not explanation."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "8CPQE1QgfK4",
    url: "https://www.youtube.com/shorts/8CPQE1QgfK4",
    uploadDate: "2026-05-07",
    views: 1982725,
    title: "NEVER STOPPED MOVING",
    lead: "NEVER STOPPED MOVING",
    body:
      "Three snakes were alive in the same clearing. He kept the camera up, but his hands started shaking while his feet kept moving toward the exit.",
    clipType: "dangerous-encounter",
    whyItWorks: [
      "Shows fear through body behavior.",
      "Balances action and survival.",
      "Makes the uploaded footage feel costly."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "NJ1cJPZ1QFE",
    url: "https://www.youtube.com/shorts/NJ1cJPZ1QFE",
    uploadDate: "2026-05-02",
    views: 1825880,
    title: "CITY ON THE CLOUDS",
    lead: "CITY ON THE CLOUDS",
    body:
      "A passenger looked below the plane and saw streets and rooftops sitting on the clouds. Everyone moved to the windows. The pilot never explained it.",
    clipType: "sky-anomaly",
    whyItWorks: [
      "Uses group reaction as validation.",
      "Keeps the impossible image clean.",
      "Ends with institutional silence."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "199naA_7Oi4",
    url: "https://www.youtube.com/shorts/199naA_7Oi4",
    uploadDate: "2026-05-06",
    views: 1639323,
    title: "BABY IN HER ARMS",
    lead: "BABY IN HER ARMS",
    body:
      "She held the baby all night. By morning the kitchen was wrecked, the doors were locked, and whatever moved through the house had already been inside.",
    clipType: "locked-room",
    whyItWorks: [
      "Uses protected posture as the emotional anchor.",
      "Builds a locked-room contradiction.",
      "Ends with the larger threat inside."
    ]
  },
  {
    sourceChannelId: "youtube-military-era",
    sourceChannelName: "Military Era",
    id: "zNjdbUDwae8",
    url: "https://www.youtube.com/shorts/zNjdbUDwae8",
    uploadDate: "2026-05-03",
    views: 1611167,
    title: "NO REASON AT ALL",
    lead: "NO REASON AT ALL",
    body:
      "He moved away from the fence for no reason. Seconds later, a car erased the exact spot where he had been standing for twenty minutes.",
    clipType: "near-miss",
    whyItWorks: [
      "Turns a tiny unexplained decision into survival.",
      "Uses exact position and timing.",
      "Keeps the ending human and unresolved."
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
    views: 10377575,
    title: "IT NEVER HAPPENED AGAIN",
    lead: "DID YOU KNOW?",
    body:
      "On a familiar path in North Yorkshire in 2016, a teenage girl stopped mid-sentence, stared at nothing for ten seconds, then tracked something invisible through the trees.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "PaleWitness core format: bright lead, dense white body, yellow key phrases.",
      "Uses date and place early.",
      "Ends with a witness memory instead of an explanation."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "US5bwKZQsfA",
    url: "https://www.youtube.com/shorts/US5bwKZQsfA",
    uploadDate: "2026-05-06",
    views: 5089867,
    title: "HE POINTED AT HER",
    lead: "DID YOU KNOW?",
    body:
      "The room stayed calm until he pointed at her without speaking. Everyone looked where his hand was aimed, and the story changed before anyone moved.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Turns one gesture into the hinge.",
      "Keeps the main body compact and event-driven.",
      "Leaves white/yellow highlight targets clear."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "so41aqH5joI",
    url: "https://www.youtube.com/shorts/so41aqH5joI",
    uploadDate: "2026-05-06",
    views: 3300232,
    title: "BOTH SIDES OF THE FAMILY",
    lead: "DID YOU KNOW?",
    body:
      "Both sides of the family remembered the same missing hour, but none of them remembered it in the same order. That was the part nobody could explain.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses group memory as the conflict.",
      "Compresses a family mystery into two beats.",
      "Saves the contradiction for the end."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "RGf5atv54Tw",
    url: "https://www.youtube.com/shorts/RGf5atv54Tw",
    uploadDate: "2026-05-11",
    views: 2432961,
    title: "THEN THE FUNDING RAN OUT",
    lead: "DID YOU KNOW?",
    body:
      "The test kept producing the same impossible result until the funding disappeared. No correction was published, and the equipment was never used that way again.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Makes bureaucracy the suspense mechanism.",
      "Uses institutional silence as the close.",
      "Avoids overclaiming."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "Pb5kwK37QE8",
    url: "https://www.youtube.com/shorts/Pb5kwK37QE8",
    uploadDate: "2026-05-07",
    views: 1750128,
    title: "STILL NO NAME",
    lead: "DID YOU KNOW?",
    body:
      "They photographed the object, measured it, logged it, and still could not give it a name. The file stayed open because the easy answer never arrived.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses procedural verbs to create credibility.",
      "Works well with yellow highlights on nouns.",
      "Ends with unresolved classification."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "NjnETkOkbII",
    url: "https://www.youtube.com/shorts/NjnETkOkbII",
    uploadDate: "2026-05-12",
    views: 1153140,
    title: "THE BODY DOESN'T KNOW",
    lead: "DID YOU KNOW?",
    body:
      "The body reacted before the person understood why. By the time everyone else noticed the movement, the danger had already passed through the frame.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Leads with a physical contradiction.",
      "Makes timing the scary part.",
      "Stays readable in a short overlay."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "8eCrsTJYGk8",
    url: "https://www.youtube.com/shorts/8eCrsTJYGk8",
    uploadDate: "2026-05-07",
    views: 650420,
    title: "NOT A BRANCH",
    lead: "DID YOU KNOW?",
    body:
      "At first it looked like a branch moving in the wind. Then it bent against the wind, lifted itself, and every person in the yard stopped talking.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Starts with a plausible explanation.",
      "Breaks that explanation visually.",
      "Uses group silence as the payoff."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "iDFtsnZkbaQ",
    url: "https://www.youtube.com/shorts/iDFtsnZkbaQ",
    uploadDate: "2026-04-30",
    views: 614037,
    title: "ONE STEP, ONE CEILING",
    lead: "DID YOU KNOW?",
    body:
      "The ceiling looked finished until one step found the hollow part. The board flexed, the room went quiet, and the repair bill started before anyone spoke.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses ordinary renovation stakes.",
      "Moves from visible action to consequence.",
      "Keeps humor dry, not loud."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "PEyy-l-DxDI",
    url: "https://www.youtube.com/shorts/PEyy-l-DxDI",
    uploadDate: "2026-05-12",
    views: 605467,
    title: "CAME BACK THE OTHER WAY",
    lead: "DID YOU KNOW?",
    body:
      "They watched it leave in one direction and return from the opposite side. Nobody crossed the gap, but the path on camera said something had.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Builds around impossible direction.",
      "Makes the camera evidence central.",
      "Ends on a clear contradiction."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "X7VHzDNJwZ0",
    url: "https://www.youtube.com/shorts/X7VHzDNJwZ0",
    uploadDate: "2026-05-11",
    views: 414067,
    title: "NEVER FULLY EXPLAINED",
    lead: "DID YOU KNOW?",
    body:
      "The official answer covered the easy part and skipped the part everyone kept replaying. That is why the footage never really went away.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Separates official explanation from visible doubt.",
      "Uses audience rewatch behavior.",
      "Good model for Copscopes procedural ambiguity."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "WF-VksIzCoQ",
    url: "https://www.youtube.com/shorts/WF-VksIzCoQ",
    uploadDate: "2026-04-24",
    views: 300011,
    title: "THE LAST WITNESS",
    lead: "DID YOU KNOW?",
    body:
      "Only one witness stayed until the end. Their statement did not make the event simpler; it made every earlier answer harder to believe.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses witness count as stakes.",
      "Reframes testimony as complication.",
      "Keeps the tone serious and compact."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "xrORNaplbII",
    url: "https://www.youtube.com/shorts/xrORNaplbII",
    uploadDate: "2026-05-11",
    views: 233423,
    title: "THEY AREN'T",
    lead: "DID YOU KNOW?",
    body:
      "Everyone called them the obvious thing until the close-up proved they were not. The label changed, but the footage only got stranger.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses misclassification as the hook.",
      "Keeps the mystery grounded in a close-up.",
      "Final line reopens curiosity."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "YWwRxw-64do",
    url: "https://www.youtube.com/shorts/YWwRxw-64do",
    uploadDate: "2026-04-26",
    views: 152317,
    title: "TITLETHE ASTRONOMER WROTE WOW",
    lead: "DID YOU KNOW?",
    body:
      "The astronomer wrote one word because the signal did not behave like the rest of the sky. Decades later, that margin note still has no clean ending.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Turns a small written note into the hook.",
      "Uses time depth.",
      "Makes the title phrase do emotional work."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "XwUw5RfneNI",
    url: "https://www.youtube.com/shorts/XwUw5RfneNI",
    uploadDate: "2026-05-12",
    views: 142501,
    title: "NOT QUITE HUMAN",
    lead: "DID YOU KNOW?",
    body:
      "The shape matched a person until it moved. The joints were wrong, the timing was wrong, and nobody watching wanted to be the first to say it.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Starts with recognition, then breaks it.",
      "Uses body mechanics instead of labels.",
      "Maintains a clean final social beat."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "-yN3H2Bngs4",
    url: "https://www.youtube.com/shorts/-yN3H2Bngs4",
    uploadDate: "2026-05-05",
    views: 100183,
    title: "DESTROY IT",
    lead: "DID YOU KNOW?",
    body:
      "The first instruction was not to store it or study it. It was to destroy it, and the urgency made the object more important than the report admitted.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses an unusually strong command as the hook.",
      "Suggests stakes through institutional behavior.",
      "Avoids naming unsupported danger."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "pbbdhwUnuvA",
    url: "https://www.youtube.com/shorts/pbbdhwUnuvA",
    uploadDate: "2026-05-06",
    views: 83075,
    title: "NO ANSWERS, TEN YEARS",
    lead: "DID YOU KNOW?",
    body:
      "Ten years passed, the file stayed open, and the most important question was still the first one. Nobody could explain why it started.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses time scale as proof of unresolved tension.",
      "Keeps the language plain.",
      "Works well with yellow highlights on time and object."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "X1v-bplUhKE",
    url: "https://www.youtube.com/shorts/X1v-bplUhKE",
    uploadDate: "2026-04-25",
    views: 81788,
    title: "NOBODY TO TELL",
    lead: "DID YOU KNOW?",
    body:
      "The camera caught the only part that mattered, but the person who could explain it was already gone. That left the footage doing all the talking.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Places absence at the center.",
      "Uses footage as the remaining witness.",
      "Maps cleanly to bodycam source logic."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "sqW16wjqVy8",
    url: "https://www.youtube.com/shorts/sqW16wjqVy8",
    uploadDate: "2026-05-03",
    views: 75420,
    title: "TOJO DIDN'T MOVE",
    lead: "DID YOU KNOW?",
    body:
      "Everyone expected the man to react. He did not move, and that stillness became the strangest part of the entire recording.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Finds drama in stillness.",
      "Uses expectation versus action.",
      "Short enough for dense overlays."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "jCGN6_7KiDs",
    url: "https://www.youtube.com/shorts/jCGN6_7KiDs",
    uploadDate: "2026-05-01",
    views: 70767,
    title: "THE ROCK WASN'T MOVING",
    lead: "DID YOU KNOW?",
    body:
      "They thought the rock was moving until the background proved the camera was steady. After that, the simple explanation disappeared.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses camera stability as evidence.",
      "Starts with a simple explanation and removes it.",
      "Keeps the final beat unresolved."
    ]
  },
  {
    sourceChannelId: "youtube-pale-witness",
    sourceChannelName: "Pale Witness",
    id: "6uIRguvzMso",
    url: "https://www.youtube.com/shorts/6uIRguvzMso",
    uploadDate: "2026-05-04",
    views: 67348,
    title: "80 YEARS TOO LATE",
    lead: "DID YOU KNOW?",
    body:
      "The answer arrived eighty years late, long after everyone who needed it was gone. That made the discovery feel less like closure and more like a warning.",
    clipType: "pale-witness-style",
    whyItWorks: [
      "Uses delayed discovery as emotion.",
      "Works with exact time highlights.",
      "Keeps the final line reflective but sharp."
    ]
  }
];

export const COPSCOPES_REFERENCE_SEEDS: ReferenceSeed[] = [
  ...historyExposedSeeds,
  ...militaryEraSeeds,
  ...paleWitnessSeeds
];

export const COPSCOPES_STAGE2_STORY_PROMPT = `SYSTEM PROMPT - Copscopes Stage 2 Story Overlay

ROLE
You are the Stage 2 caption writer for Copscopes, a US-facing police bodycam / police incident Shorts channel.
Your job is to turn one source video into five story_lead_main_caption options that feel as strong as the reference channels, while staying grounded in the actual source.

SOURCE PRIORITY
1. source_video_json is truth.
2. format_contract_json and hard_constraints_json are the publishing contract.
3. user_instruction can steer angle, but cannot authorize invented facts.
4. examples_json is only style reference.

COPSCOPES TRUTH RULES
- Write about what is visible, stated by source metadata, or safely supported by transcript/comments.
- Instagram captions may contain follow requests, hashtags, engagement bait, product ads, or generic cruiser fiction. Ignore those unless the same fact is visible in the source.
- Never invent charges, convictions, injuries, weapons, motives, locations, names, or outcomes.
- If a person is only alleged or unidentified, use neutral labels: driver, passenger, officer, deputy, suspect, woman, man.
- Do not glorify police, mock civilians, or turn real danger into a joke.
- Do not use paranormal language for Copscopes. The Military/PaleWitness references teach tension and compression, not supernatural claims.
- Avoid gore and cruelty. If the source is severe, write it with procedural calm.

REFERENCE STYLE TO INHERIT
- From Pale Witness: dense white story body, a short high-contrast lead, and yellow highlights on the most important nouns/times/actions.
- From Military Era new format: blunt opening contradiction, physical sequence, one unresolved final image.
- From HistorryExposed: precise setup, named context when supported, and a clean why-this-mattered payoff.

FORMAT
Use story_lead_main_caption only.
Lead:
- 2-5 words, ALL CAPS, no period.
- Prefer a hook that points at the incident: WATCH THE PASSENGER, ONE WRONG MOVE, THE CAR KEPT ROLLING, THE CALM PART MATTERS.
- Use DID YOU KNOW? only when the source is more factual/explainer than action-driven.

Main Caption:
- English only.
- 3-6 compact sentences, usually 190-260 characters unless hard_constraints_json says otherwise.
- Build a clean sequence: setup -> visible action -> second pressure beat -> consequence or unanswered tension.
- Do not collapse the story into one short summary sentence. The body should feel dense like Pale Witness, but still readable on screen.
- Use specific objects when visible: cruiser, bridge, passenger door, flames, handcuffs, radio, bodycam, patrol car.
- Keep it readable as an on-screen overlay. No long legal explanations.

NEGATIVE CONSTRAINTS
- No emojis.
- No hashtags.
- No "follow", "subscribe", "link in bio", "engagement purposes", or creator meta.
- Do not mention "the clip", "the video", "the footage", "viewers", "comments", or the edit.
- Do not open with "In this video" or "Here we see".
- Avoid empty hype words: shocking, insane, unbelievable, crazy, wild, terrifying, heart-stopping, chilling.
- Avoid AI/editorial filler: testament, showcase, masterclass, journey, narrative, dynamic, seamless, elevate, underscores.
- Never write "criminal" unless source explicitly establishes it as a conviction or formal charge.

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
The winner should feel like a compact bodycam micro-story: factual, tense, procedural, and human.
If the strongest line would require an unsupported fact, choose a plainer supported line instead.`;

export const COPSCOPES_CAPTION_HIGHLIGHTING_PROMPT = `You are tagging final Copscopes story captions for PaleWitness-style color highlights.

Do not rewrite text.
Return exact phrases only.

Highlight policy:
- Use yellow highlights for the strongest concrete words: times, places, vehicle/object names, decisive actions, and role labels.
- Keep most text white by leaving most words untagged.
- Prefer 2-5 highlights in mainCaption and 0-1 in lead.
- Do not highlight whole sentences.
- Do not highlight weak filler, generic adjectives, or legal claims unless they are directly sourced.
- Avoid adjacent highlight runs; leave white words between yellow phrases.

Return strict JSON only in the expected captionHighlighting shape.`;

export const COPSCOPES_STAGE2_HARD_CONSTRAINTS: Stage2HardConstraints = {
  topLengthMin: 6,
  topLengthMax: 56,
  bottomLengthMin: 190,
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

export function createCopscopesStage2Examples(input: {
  ownerChannelId: string;
  ownerChannelName: string;
}): Stage2CorpusExample[] {
  return COPSCOPES_REFERENCE_SEEDS.map((seed, index) => ({
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

export function createCopscopesStage2ExamplesConfig(input: {
  ownerChannelId: string;
  ownerChannelName: string;
}): Stage2ExamplesConfig {
  const customExamples = createCopscopesStage2Examples(input);
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

export function createCopscopesStage2PromptConfig(): Stage2PromptConfig {
  const base = normalizeStage2PromptConfig(DEFAULT_STAGE2_PROMPT_CONFIG);
  return normalizeStage2PromptConfig({
    ...base,
    useWorkspaceDefault: false,
    sourceMode: "custom",
    stages: {
      ...base.stages,
      storyOneShot: {
        ...base.stages.storyOneShot,
        prompt: COPSCOPES_STAGE2_STORY_PROMPT,
        reasoningEffort: "high",
        compatibility: null
      },
      captionHighlighting: {
        ...base.stages.captionHighlighting,
        prompt: COPSCOPES_CAPTION_HIGHLIGHTING_PROMPT,
        reasoningEffort: "low",
        compatibility: null
      }
    }
  });
}

export function createCopscopesManagedTemplateSnapshot(): ManagedTemplateVersionSnapshot {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(CHANNEL_STORY_TEMPLATE_ID));
  templateConfig.card.borderColor = "#0b0d10";
  templateConfig.card.fill = "#050607";
  templateConfig.palette.cardFill = "#050607";
  templateConfig.palette.topSectionFill = "#050607";
  templateConfig.palette.bottomSectionFill = "#050607";
  templateConfig.palette.topTextColor = "#37ff3f";
  templateConfig.palette.bottomTextColor = "#f8f9fb";
  templateConfig.palette.authorNameColor = "#f8f9fb";
  templateConfig.palette.authorHandleColor = "#d8dbe2";
  templateConfig.palette.accentColor = "#f4df36";
  templateConfig.highlights = {
    enabled: true,
    topEnabled: false,
    bottomEnabled: true,
    slots: [
      {
        slotId: "slot1",
        enabled: true,
        color: "#f4df36",
        label: "Yellow key words",
        guidance:
          "Use for the most important Copscopes nouns, times, places, roles, objects, and decisive actions. Keep surrounding words white."
      },
      {
        slotId: "slot2",
        enabled: false,
        color: "#2cc8c3",
        label: "Unused",
        guidance: "Disabled for the Copscopes PaleWitness-style template."
      },
      {
        slotId: "slot3",
        enabled: false,
        color: "#ff5f6d",
        label: "Unused",
        guidance: "Disabled for the Copscopes PaleWitness-style template."
      }
    ]
  };
  templateConfig.author.name = "COPSCOPES";
  templateConfig.author.handle = "@copscopes";
  templateConfig.channelStory = {
    ...templateConfig.channelStory!,
    leadMode: "clip_custom",
    defaultLeadText: "DID YOU KNOW?",
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
    name: COPSCOPES_TEMPLATE_NAME,
    description:
      "Copscopes Channel + Story template: PaleWitness-style white body text with restrained yellow keyword highlights.",
    layoutFamily: CHANNEL_STORY_TEMPLATE_ID,
    baseTemplateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "DID YOU KNOW?",
      bottomText:
        "Officers followed a street race until one car flipped, caught fire, and left a passenger trapped. The rescue happened before the vehicle was fully engulfed.",
      sourceOverlayText: "",
      channelName: "COPSCOPES",
      channelHandle: "@copscopes",
      highlights: {
        top: [],
        bottom: [
          { start: 0, end: 8, slotId: "slot1" },
          { start: 19, end: 30, slotId: "slot1" },
          { start: 90, end: 99, slotId: "slot1" },
          { start: 122, end: 138, slotId: "slot1" }
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

export function createCopscopesChannelPatch(input: {
  ownerChannelId: string;
  ownerChannelName: string;
  templateId: string;
}) {
  return {
    stage2ExamplesConfig: createCopscopesStage2ExamplesConfig(input),
    stage2PromptConfig: createCopscopesStage2PromptConfig(),
    stage2HardConstraints: COPSCOPES_STAGE2_HARD_CONSTRAINTS,
    stage2SourceOverlayConfig: {
      ...DEFAULT_STAGE2_SOURCE_OVERLAY_CONFIG,
      enabled: false
    },
    templateId: input.templateId,
    defaultClipDurationSec: 6
  };
}
