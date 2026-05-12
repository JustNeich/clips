import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { hashPassword } from "../../../../lib/auth/password";
import { saveChannelAssetFile } from "../../../../lib/channel-assets";
import {
  createChannel,
  createChannelAsset,
  listChannelAssets,
  listChannels,
  updateChannelById,
  type Channel
} from "../../../../lib/chat-history";
import { getDb, newId, nowIso } from "../../../../lib/db/client";
import {
  createManagedTemplate,
  listManagedTemplatesSync,
  updateManagedTemplate
} from "../../../../lib/managed-template-store";
import { getTemplateById } from "../../../../lib/stage3-template";
import {
  createInvite,
  getMembership,
  getWorkspace,
  listWorkspaceMembers
} from "../../../../lib/team-store";
import { setChannelAccess } from "../../../../lib/channel-access";
import type {
  Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../../../../lib/stage2-channel-config";
import type { Stage2PromptConfig } from "../../../../lib/stage2-pipeline";

const MARY_EMAIL = "lomiknj123@gmail.com";
const ACCEPT_INVITE_URL = "https://clips-vy11.onrender.com/accept-invite";

const COUNTRY_MATCHERS = [
  "the shop foreman",
  "shop foreman",
  "old man dusty",
  "martin the worker",
  "martintheworker",
  "ghostface facts",
  "ghostface science",
  "ghostface country",
  "ghostface workshop",
  "ghostfacecountry",
  "ghostfaceworkshop"
];

const EXAMPLES: Stage2CorpusExample[] = [
  {
    id: "martintheworker-jPXy11NCrRg",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "THE 1 KNOT EVERY GARDENER NEEDS",
    overlayTop:
      "This guy shows exactly how to lock down a garden line on a rusty nail in 3 seconds flat, keeping the string under full tension without ever dealing with annoying slack.",
    overlayBottom:
      "Every gardener needs to learn this 1 trick. That string is basically welded to the nail now, proving old-fashioned physics beats fancy gear.",
    transcript:
      "Garden line tension, string line knot, layout technique, masonry line security.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Martin priority example: ordinary work moment becomes practical country intelligence.",
      "Uses one dense visual setup, concrete object names, and a bottom lesson."
    ],
    qualityScore: 11
  },
  {
    id: "martintheworker-THeJKI99fRc",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "THE BEST CHEAP TOOL FOR GARDEN PESTS",
    overlayTop:
      "This little white trap uses 4 crosses of bait to draw flies in right before a hidden fan sucks them straight down into a clear plastic bin. At least 50 flies are stuck buzzing around at the bottom.",
    overlayBottom:
      "Every gardener knows you cannot fight flies with just a swatter. This 1 simple machine is the best cheap investment for the entire yard.",
    transcript: "Backyard garden suction trap, bait pattern, fan airflow, clear plastic bin.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Turns a simple yard gadget into a useful discovery.",
      "The hook is visual, specific, and easy to understand in one glance."
    ],
    qualityScore: 10.8
  },
  {
    id: "martintheworker-rvEPLkFcHVg",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "TURNING TRASH INTO FREE WINTER HEAT",
    overlayTop:
      "This guy found the ultimate winter cheat code by turning yard waste into high-density fuel pellets. These dry leaves get compressed until they are basically solid wood bricks for his home stove.",
    overlayBottom:
      "Forget paying for propane when you have an unlimited supply of fuel falling from trees. That is peak rural logic and it works.",
    transcript: "Homemade pellet mill, dry leaves, biomass fuel, home stove.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Practical rural payoff is clear before the viewer even hears audio.",
      "Bottom text gives the audience a strong reason to share."
    ],
    qualityScore: 10.7
  },
  {
    id: "martintheworker-xMr5u6lvQUY",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "LIVE BACKUP SENSOR ENGAGED NOW",
    overlayTop:
      "This guy shut the trunk of his brown car right on a green sack just to leave a farm bird staring at the pavement for a 50 mile highway trip. That passenger is rethinking every life choice.",
    overlayBottom:
      "Anyone who has hauled livestock knows how strange that setup is. Getting it secured on the first shot is pure backroad confidence.",
    transcript: "Rural transport improvisation, trunk, green sack, live cargo.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Frames an absurd rural moment as a confident work solution.",
      "The caption adds personality without losing the visual fact."
    ],
    qualityScore: 10.6
  },
  {
    id: "martintheworker-U96Aah3_pcc",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "RACING WING GETS ITS OFFICIAL PASSPORT STAMPED",
    overlayTop:
      "This guy is spreading a racing wing flat on a thick book just to roll a massive layer of red ink and serial numbers straight across the feathers like an official document.",
    overlayBottom:
      "You know this racer is valuable when the wing gets treated like a high-security passport so nobody can swap it mid race.",
    transcript: "Racing bird identification, wing stamp, red ink, official serial number.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Makes a niche rural practice feel high-stakes and instantly legible.",
      "The bottom line explains why the odd visual matters."
    ],
    qualityScore: 10.5
  },
  {
    id: "martintheworker-mWcJNVsTPDA",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "FARMER CHOPS TREE TO FREE WEDGED COW",
    overlayTop:
      "This farmer found his brown calf jammed completely solid between 2 pine trees and had to pull out the axe to start chopping the trunk away. No heavy machinery is fitting in there.",
    overlayBottom:
      "That calf just waits while this man burns serious calories swinging the axe. Farm animals always find a new way to test daily patience.",
    transcript: "Calf rescue, pine trees, axe work, farm problem solving.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Urgency is visible, simple, and grounded in a real farm problem.",
      "Bottom text adds relatable rural frustration."
    ],
    qualityScore: 10.4
  },
  {
    id: "martintheworker-6ucCWJg5PeM",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "OLD SCHOOL BLACKSMITHS DONT NEED SAFETY BOOTS",
    overlayTop:
      "This worker uses heavy iron tongs to submerge a massive glowing piece of forged metal into a cooling bath, sending boiling water splashing around his completely unprotected feet.",
    overlayBottom:
      "Any modern shop would demand 5 layers of fireproof gear for this job. These men grabbed their daily sandals and got right to work.",
    transcript: "Blacksmith cooling bath, forged metal, tongs, old-school shop work.",
    clipType: "workshop_skill",
    whyItWorks: [
      "Immediate danger creates retention without needing exaggeration.",
      "Compares old-school confidence with modern safety expectations."
    ],
    qualityScore: 10.3
  },
  {
    id: "martintheworker-YtgS4kSZiQA",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "MANUAL TRAFFIC CONTROL ON JUNGLE RAILS",
    overlayTop:
      "When 2 carts meet on this single jungle rail, this guy stands up, drags his wooden frame around the other ride, and places it right back on the metal tracks so both can pass safely.",
    overlayBottom:
      "That is the backwoods yield sign. You do not need a passing lane when the whole vehicle is light enough to drag around by hand.",
    transcript: "Single rail cart, manual passing, wooden frame, rural transport.",
    clipType: "country_working_hack",
    whyItWorks: [
      "Transforms a strange transport workaround into a clean system explanation.",
      "Bottom line gives the audience the joke and the logic at once."
    ],
    qualityScore: 10.2
  },
  {
    id: "martintheworker-asEmjzfkGCk",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "GUY PULLS LIVE DUCK FROM PELICAN BEAK",
    overlayTop:
      "This man grabbed the huge bill and emptied its throat pouch like he was checking a mailbox. You can see the exact moment the trapped animal realizes it just survived being lunch.",
    overlayBottom:
      "That is not a rescue mission, that is an eviction notice. The hunter is standing there absolutely furious about losing a free meal.",
    transcript: "Wildlife rescue, throat pouch, live animal pulled free, quick reaction.",
    clipType: "country_survival_moment",
    whyItWorks: [
      "The visual is bizarre, fast, and easy to retell.",
      "Bottom text gives the scene a clean comedic interpretation."
    ],
    qualityScore: 10.1
  },
  {
    id: "martintheworker-b5pW_CoOOi4",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "FARM HACKS GONE TOO FAR",
    overlayTop:
      "This guy created his own friction mill using a jacked-up tractor and an old tire. He keeps tossing 50 lb bags into the pinch point like losing an arm is not a concern.",
    overlayBottom:
      "That is the exact kind of country engineering that makes safety inspectors wake up sweating. Work smarter and try to keep both arms.",
    transcript: "Tractor tire friction mill, farm processing hack, dangerous pinch point.",
    clipType: "country_working_hack",
    whyItWorks: [
      "High-risk tool improvisation is visually sticky.",
      "Bottom line delivers the practical warning in the channel voice."
    ],
    qualityScore: 10
  },
  {
    id: "martintheworker-eDZAWdvvLA0",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "OLD SCHOOL CARPENTRY REQUIRES 0 FEAR",
    overlayTop:
      "This guy is feeding a massive timber beam through a tiny portable planer balanced on a step stool, ignoring every safety manual while burying the shop floor in wood chips.",
    overlayBottom:
      "Anyone who has run a planer knows that little machine is one bad knot away from launching. Pure stubbornness is keeping it together.",
    transcript: "Portable planer, oversized timber beam, wood chips, old-school carpentry.",
    clipType: "workshop_skill",
    whyItWorks: [
      "Big object versus small tool creates instant tension.",
      "The bottom text names the hidden risk for people who know tools."
    ],
    qualityScore: 9.9
  },
  {
    id: "martintheworker-Fn6zeHU1-b8",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "THE ULTIMATE ROWING TREADMILL",
    overlayTop:
      "This dragon boat crew is not waiting for the river to thaw to get reps in. They turned a circular concrete pit into a high-speed treadmill where every wooden paddle hit has to be perfect.",
    overlayBottom:
      "This happens when practice gets taken more seriously than the race. Those wooden paddles are putting in more work than a 50 hp motor.",
    transcript: "Training pit, rowing practice, circular current, team coordination.",
    clipType: "working_system",
    whyItWorks: [
      "Shows an unfamiliar training system with a clear physical principle.",
      "Bottom text makes the discipline feel extreme and admirable."
    ],
    qualityScore: 9.8
  },
  {
    id: "martintheworker-LZNsxRijG-4",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "THE MESSY REALITY OF POULTRY FARMING",
    overlayTop:
      "Someone built 1 slick conveyor system to pull all the cage waste out from under 3 stacked rows. She turns the metal crank and watches an absolutely insane amount pile up.",
    overlayBottom:
      "If you want to know where breakfast eggs come from, it starts with one person hauling dirt. That belt saves a massive amount of time.",
    transcript: "Poultry farm cleanup conveyor, stacked cages, manual crank, waste removal.",
    clipType: "country_working_system",
    whyItWorks: [
      "Uncomfortable but useful farm reality earns attention.",
      "Bottom text ties the visual to a daily product everyone understands."
    ],
    qualityScore: 9.7
  },
  {
    id: "martintheworker-q-DCL3lwLe8",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "1 BAD STEP DESTROYS THE TRUCK TIRES",
    overlayTop:
      "This driver is trusting the guy in sandals to hold the metal ramp down. The first two tires climb fine, but the spotter casually walks away and the heavy steel flips into the rear axles.",
    overlayBottom:
      "That helper turned a basic loading day into an insurance claim. You do not walk away from the ramp while the rig is still rolling.",
    transcript: "Truck loading ramp, spotter mistake, tire damage, heavy steel ramp.",
    clipType: "truck_work_mistake",
    whyItWorks: [
      "The mistake is visible before the payoff lands.",
      "Bottom text gives a simple rule viewers can repeat."
    ],
    qualityScore: 9.6
  },
  {
    id: "martintheworker-QZSgSCN0pgk",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "WHY FLEXIBLE HAMMER HANDLES ARE GENIUS",
    overlayTop:
      "This worker found out a flexible shaft on a sledgehammer delivers way more power than a stiff wooden handle ever could. One swing loads the bend and obliterates the concrete.",
    overlayBottom:
      "You can clearly see the kinetic energy stored in that handle. That is not just swinging a hammer, that is physics doing the hard work.",
    transcript: "Flexible hammer handle, kinetic energy, concrete breaking, tool physics.",
    clipType: "tool_physics",
    whyItWorks: [
      "Simple tool motion becomes a physics reveal.",
      "Bottom text converts the spectacle into a lesson."
    ],
    qualityScore: 9.5
  },
  {
    id: "martintheworker-GQffgHUGa08",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "FARMER BUILDS GENIUS PIPE STRIPPER",
    overlayTop:
      "This farmer found a way to strip irrigation connectors off the line without spending ten hours on his knees in the dirt. One smooth pull and the whole field's worth of plastic lets go.",
    overlayBottom:
      "Building a tool to do the work for you is the ultimate blue-collar flex. That is a lot of time saved for something that cost almost zero.",
    transcript: "Irrigation connector stripper, field plastic, handmade tool, time-saving farm hack.",
    clipType: "country_working_hack",
    whyItWorks: [
      "The visual payoff is a long continuous release.",
      "Bottom text makes the invention feel smart instead of merely strange."
    ],
    qualityScore: 9.4
  },
  {
    id: "martintheworker-5a_0s7loDb0",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "TEN FINGERS TO NINE",
    overlayTop:
      "This is either a genius-level physics trick or the fastest way to lose a finger at the machine shop. The way that metal sparks against skin makes every safety inspector start sweating.",
    overlayBottom:
      "That is real shop logic right there. If it does not burn through the bone, it is just a little heat. Man is built different.",
    transcript: "Machine shop sparks, hand technique, metal contact, risky demonstration.",
    clipType: "workshop_risk",
    whyItWorks: [
      "Strong physical danger keeps the viewer watching.",
      "Bottom text captures the personality of risky shop culture."
    ],
    qualityScore: 9.3
  },
  {
    id: "martintheworker-yqahPfhffVc",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "SLEDGEHAMMER VS PIPE NEVER ENDS WELL",
    overlayTop:
      "Watch this guy ignore every survival instinct and send a full-force swing into a structural pipe. He is one bad bounce away from turning demolition into a massive job site flood.",
    overlayBottom:
      "They even set up a little umbrella to keep him dry while he wrestles a pressurized underground problem. The priorities are incredible.",
    transcript: "Sledgehammer demolition, pipe strike, job site risk, pressure line.",
    clipType: "workshop_risk",
    whyItWorks: [
      "The audience can predict the danger before impact.",
      "Bottom text adds humor by pointing at the absurd setup detail."
    ],
    qualityScore: 9.2
  },
  {
    id: "martintheworker-Gg3uirs_Yo0",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "TRUCKING HACKS YOU NEED",
    overlayTop:
      "This driver found a way to save every drop of antifreeze by using the rope hook on his trailer as a pivot point. The heavy yellow jug is awkward, but the truck frame makes it easy.",
    overlayBottom:
      "That is the difference between a rookie and a veteran. He found a pivot point where everyone else just saw a piece of metal.",
    transcript: "Truck antifreeze pour, rope hook pivot, trailer frame, driver hack.",
    clipType: "truck_work_hack",
    whyItWorks: [
      "Small efficiency trick feels immediately useful.",
      "Bottom text rewards practical experience."
    ],
    qualityScore: 9.1
  },
  {
    id: "martintheworker-L2hjLULueOI",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@MartinTheWorker",
    sourceChannelName: "Martin The Worker",
    title: "HOW THE MEAT INDUSTRY FOOLS YOU",
    overlayTop:
      "He slides that green air nozzle right under the skin and suddenly that scrawny bird inflates into a premium grocery item. Next time you buy a massive roast, remember this exact video.",
    overlayBottom:
      "That is the food industry operating right in front of you. You end up paying top dollar for meat, water, and compressed shop air.",
    transcript: "Food processing, air nozzle, inflated poultry, grocery appearance.",
    clipType: "food_industry_reveal",
    whyItWorks: [
      "The reveal is simple, surprising, and tied to consumer suspicion.",
      "Bottom text gives a clear takeaway viewers can argue about."
    ],
    qualityScore: 9
  },
  {
    id: "ghostfacefacts-tQnKJGwJJC8",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "RUST MEANS COUNTDOWN.",
    overlayTop:
      "That rust on the chain is not cosmetic. It means the chain is stretching, skipping, and wearing the sprocket underneath it. One hard acceleration and a chain this neglected can snap at speed.",
    overlayBottom:
      "Lube buys time. It does not buy a new chain. If yours looks like this, the spray is not the fix. The replacement chain is.",
    transcript: "Rusty chain, sprocket wear, acceleration risk, maintenance warning.",
    clipType: "mechanic_warning",
    whyItWorks: [
      "GhostFace support example: short warning voice with concrete mechanical stakes.",
      "Direct problem, consequence, and fix in two compact blocks."
    ],
    qualityScore: 8.9
  },
  {
    id: "ghostfacefacts-G1iTO4aByGw",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "NOT SPRINGS. AIR BAGS.",
    overlayTop:
      "You think truck suspension is metal springs. On modern trucks it is not. It is this rubber bag filled with air, and when it fails, the truck sags to one side overnight with a full load on board.",
    overlayBottom:
      "That cracked bag next to it held a full load for years. New one goes in fast with the right jig. Without it, good luck.",
    transcript: "Truck air suspension, rubber bag, load support, repair jig.",
    clipType: "mechanic_fact",
    whyItWorks: [
      "Corrects a common assumption in the first line.",
      "Bottom text gives the repair reality and why the part matters."
    ],
    qualityScore: 8.8
  },
  {
    id: "ghostfacefacts-hkICgEK920g",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "THIS DECIDES YOUR ENGINE.",
    overlayTop:
      "This chrome unit decides whether your engine overheats or not. Most truck owners do not know it exists until it fails and the temperature gauge hits red on the highway.",
    overlayBottom:
      "It reads engine heat and decides when the fan engages. Cool engine, fan slow. Hot engine, full blast. When it fails, it picks one speed forever.",
    transcript: "Fan clutch, engine heat, truck cooling system, overheating risk.",
    clipType: "mechanic_fact",
    whyItWorks: [
      "Names a hidden part and ties it to an expensive consequence.",
      "Bottom text explains the mechanism in plain language."
    ],
    qualityScore: 8.7
  },
  {
    id: "ghostfacefacts-Wh-5MuMRbSc",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "WHY LIQUID NITROGEN CLEANS A DIRTY JAR IN SECONDS",
    overlayTop:
      "Liquid nitrogen hits minus 196. Moisture freezes, cracks, and ejects. Dirt shatters off the walls. The cold does not clean gently, it detonates the filth completely.",
    overlayBottom:
      "Someone spent twenty minutes scrubbing a jar last week. Apparently the real answer was liquid nitrogen and basic physics.",
    transcript: "Liquid nitrogen cleaning, thermal shock, frozen moisture, jar dirt removal.",
    clipType: "science_mechanic_fact",
    whyItWorks: [
      "Uses GhostFace's hard, compressed explanatory voice.",
      "Turns a cleaning visual into a sharp physics explanation."
    ],
    qualityScore: 8.6
  },
  {
    id: "ghostfacefacts-V8sK7nSZYwI",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "HOME BEFORE IT'S HOME.",
    overlayTop:
      "A driver spends more time in this cab than at home. So Volvo shakes it 500,000 times before anyone sleeps inside. That orange cab is still holding, and that is the whole point.",
    overlayBottom:
      "The truck is not certified until the rig says so. No shaker approval, no shipment. The badge means nothing until the test says it does.",
    transcript: "Truck cab durability test, shaker rig, Volvo FH16, certification.",
    clipType: "factory_test",
    whyItWorks: [
      "Connects an industrial test to the driver's daily life.",
      "Bottom text gives a clean certification rule."
    ],
    qualityScore: 8.5
  },
  {
    id: "ghostfacefacts-u-ppEoqHOM4",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "SCOOTER. 45HP. ECO MODE.",
    overlayTop:
      "This is a scooter. It makes 45 horsepower at 14,200 RPM. That is more specific power than a stock Ninja 400. No air filter, racing carburetor, and the owner calls it Eco Mode.",
    overlayBottom:
      "That exposed carb throat drinks air faster than your lungs ever could. It sounds exactly like you think it does.",
    transcript: "Modified scooter, high RPM engine, racing carburetor, exposed intake.",
    clipType: "mechanic_fact",
    whyItWorks: [
      "Numbers make the absurd modification feel real.",
      "Bottom text sells the sensory payoff."
    ],
    qualityScore: 8.4
  },
  {
    id: "ghostfacefacts-a8TKgD2ZQW8",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "WRONG TOOL. RIGHT NOW.",
    overlayTop:
      "That is an adjustable wrench clamped directly onto a brake rotor. Every trained mechanic just flinched. But the bike is on a gravel road, the pad is rubbing, and it still needs to run.",
    overlayBottom:
      "You do not get points for the right tool when it is 200 km away. This technique exists because the road does not care.",
    transcript: "Brake rotor roadside repair, adjustable wrench, gravel road, improvised fix.",
    clipType: "mechanic_warning",
    whyItWorks: [
      "Balances wrong-tool tension with real-world necessity.",
      "Bottom text gives the operating principle in a memorable line."
    ],
    qualityScore: 8.3
  },
  {
    id: "ghostfacefacts-sg--d0kD39c",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "BLUETOOTH TIRES. ALMOST.",
    overlayTop:
      "That tire is touching the wheel arch from the inside and the outside at the same time. One pothole away from wheels that disconnect wirelessly. The driver felt nothing. The car had opinions.",
    overlayBottom:
      "This happens when spacers push the wheel too far out and suspension compresses. Tire meets arch. Arch wins. Measure before you order.",
    transcript: "Wheel spacers, tire rub, suspension compression, fitment mistake.",
    clipType: "mechanic_warning",
    whyItWorks: [
      "Uses a comment-style joke without losing the mechanical explanation.",
      "Bottom text names the cause and the fix."
    ],
    qualityScore: 8.2
  },
  {
    id: "ghostfacefacts-gC7Th-1HoYY",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "WRONG TOOL. EXPENSIVE LESSON.",
    overlayTop:
      "That tool is supposed to cut the gear. It is not. The gear is harder than the cutter, so the cutter is being destroyed instead. Someone put a cheap insert on hardened steel and watched money disappear.",
    overlayBottom:
      "This happens in every shop. Wrong tool on hardened steel. The tool does not just fail, it makes the job three times more expensive.",
    transcript: "Hardened gear, carbide insert failure, machine shop mistake, tool cost.",
    clipType: "workshop_warning",
    whyItWorks: [
      "Expensive mistake is visible in real time.",
      "Bottom text converts a shop failure into a general rule."
    ],
    qualityScore: 8.1
  },
  {
    id: "ghostfacefacts--1BnwkLmbbU",
    ownerChannelId: "ghostface-country-pack",
    ownerChannelName: "Ghostface Country Pack",
    sourceChannelId: "@GhostFaceFacts",
    sourceChannelName: "Ghost Face Facts",
    title: "WHY THIS TINY WELD HOLDS MORE THAN YOU THINK",
    overlayTop:
      "That tiny weld holds a grown man's weight because molten steel fused at the molecular level. Size means nothing here. Fusion means everything.",
    overlayBottom:
      "Every bridge, trailer, frame, and shop rig depends on welds that small. Somewhere, one little bead is doing a terrifying amount of work.",
    transcript: "Small weld strength, metal fusion, structural load, shop fabrication.",
    clipType: "workshop_fact",
    whyItWorks: [
      "Makes a small visual feel massive by explaining the hidden load.",
      "Bottom text widens the fact into everyday infrastructure."
    ],
    qualityScore: 8
  }
];

const EXAMPLES_JSON = JSON.stringify(EXAMPLES, null, 2);

const STAGE2_EXAMPLES_CONFIG: Stage2ExamplesConfig = {
  version: 2,
  useWorkspaceDefault: false,
  sourceMode: "custom",
  customInputMode: "json",
  customExamplesJson: EXAMPLES_JSON,
  customExamplesText: "",
  customExamples: EXAMPLES
};

const HARD_CONSTRAINTS: Stage2HardConstraints = {
  topLengthMin: 60,
  topLengthMax: 240,
  bottomLengthMin: 45,
  bottomLengthMax: 190,
  bannedWords: [],
  bannedOpeners: []
};

const CHANNELS = [
  {
    name: "GHOSTFACE COUNTRY",
    username: "ghostfacecountry",
    templateName: "GHOSTFACE COUNTRY - Martin Worker Card",
    avatarPath: "public/ops/ghostface-country-avatar.png",
    systemPrompt:
      "Write English top/bottom Shorts captions for a Ghostface-branded country/workshop channel. Match Martin The Worker first: one dense visual top block, practical rural or tool truth, then a bottom block that turns the moment into a sharp lesson. Use GhostFace Facts only for tighter warning rhythm. Stay grounded in what the source video shows.",
    descriptionPrompt:
      "Classic Martin-style white card: large black top caption, raw work/farm/mechanic clip in the center, author row, then bottom caption. Theme: rural work, farm hacks, old-school tools, truck fixes, field repairs, and practical country intelligence. No fictional horror story tone."
  },
  {
    name: "GHOSTFACE WORKSHOP",
    username: "ghostfaceworkshop",
    templateName: "GHOSTFACE WORKSHOP - Martin Worker Card",
    avatarPath: "public/ops/ghostface-workshop-avatar.png",
    systemPrompt:
      "Write English top/bottom Shorts captions for a Ghostface-branded workshop/mechanic channel. Use Martin The Worker as the main style reference: physical tool action, concrete parts, practical consequence, and a bottom lesson. Borrow GhostFace Facts only for short mechanical warnings and crisp cause-effect phrasing.",
    descriptionPrompt:
      "Classic Martin-style white card: bold black top text, mechanical or shop clip in the middle, author row, then bottom lesson. Theme: tools, repairs, machine-shop mistakes, welding, engines, trucks, fabrication, and worksite physics. No supernatural storytelling."
  }
];

type ChannelSpec = (typeof CHANNELS)[number];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isCountryChannel(channel: Pick<Channel, "name" | "username">): boolean {
  const haystack = `${channel.name} ${channel.username}`.toLowerCase().replace(/[@_\-]+/g, " ");
  const compact = haystack.replace(/\s+/g, "");
  return COUNTRY_MATCHERS.some((matcher) => {
    const normalized = matcher.toLowerCase();
    return haystack.includes(normalized) || compact.includes(normalized.replace(/\s+/g, ""));
  });
}

async function ensurePlaceholderUser(emailRaw: string): Promise<{ id: string; created: boolean }> {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .get(email) as { id: string } | undefined;
  if (existing?.id) {
    return { id: existing.id, created: false };
  }

  const id = newId();
  const now = nowIso();
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, email, passwordHash, "Марья Ябанжи", "active", now, now);
  return { id, created: true };
}

async function createFreshInvite(input: {
  workspaceId: string;
  email: string;
  role: "redactor";
  createdByUserId: string;
}): Promise<{ token: string; expiresAt: string; email: string; role: "redactor" } | null> {
  const email = normalizeEmail(input.email);
  const existingMembership = getMembership(
    (getDb().prepare("SELECT id FROM users WHERE email = ? LIMIT 1").get(email) as { id: string } | undefined)?.id ?? "",
    input.workspaceId
  );
  if (existingMembership) {
    return null;
  }

  getDb()
    .prepare("DELETE FROM workspace_invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL")
    .run(input.workspaceId, email);
  const invite = await createInvite({
    workspaceId: input.workspaceId,
    email,
    role: input.role,
    createdByUserId: input.createdByUserId
  });
  return {
    token: invite.token,
    expiresAt: invite.expiresAt,
    email: invite.email,
    role: invite.role as "redactor"
  };
}

async function upsertTemplate(workspaceId: string, spec: ChannelSpec): Promise<string> {
  const existing = listManagedTemplatesSync(workspaceId).find((template) => template.name === spec.templateName);
  const base = clone(getTemplateById("science-card-v1"));
  base.author.name = spec.name;
  base.author.handle = `@${spec.username}`;
  base.card.radius = 12;
  base.card.borderWidth = 8;
  base.card.shadow = "0 4px 4px rgba(0,0,0,0.18)";
  base.palette.cardFill = "#ffffff";
  base.palette.topSectionFill = "#ffffff";
  base.palette.bottomSectionFill = "#ffffff";
  base.palette.topTextColor = "#000000";
  base.palette.bottomTextColor = "#0b0d10";
  base.palette.authorNameColor = "#000000";
  base.palette.authorHandleColor = "#acacac";
  base.typography.top.max = 56;
  base.typography.top.maxLines = 7;
  base.typography.bottom.max = 34;
  base.typography.bottom.maxLines = 4;

  const payload = {
    name: spec.templateName,
    description: "Martin The Worker-style classic white card for Ghostface country/workshop channels.",
    layoutFamily: "science-card-v1",
    baseTemplateId: "science-card-v1",
    content: {
      topText: EXAMPLES[0]?.overlayTop ?? "",
      bottomText: EXAMPLES[0]?.overlayBottom ?? "",
      channelName: spec.name,
      channelHandle: `@${spec.username}`,
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 0.34,
      avatarAsset: null,
      mediaAsset: null,
      backgroundAsset: null
    },
    templateConfig: base,
    shadowLayers: []
  };

  if (existing) {
    const updated = await updateManagedTemplate(existing.id, payload, { workspaceId });
    if (!updated) {
      throw new Error(`Failed to update template ${existing.id}`);
    }
    return updated.id;
  }

  const created = await createManagedTemplate(payload, { workspaceId });
  return created.id;
}

async function upsertAvatar(channel: Channel, spec: ChannelSpec): Promise<string> {
  const existing = (await listChannelAssets(channel.id, "avatar")).find((asset) =>
    asset.originalName.includes(spec.username)
  );
  const buffer = await fs.readFile(path.join(process.cwd(), spec.avatarPath));
  if (existing) {
    await saveChannelAssetFile({
      channelId: channel.id,
      assetId: existing.id,
      mimeType: "image/png",
      buffer
    });
    await updateChannelById(channel.id, { avatarAssetId: existing.id });
    return existing.id;
  }

  const assetId = newId();
  const saved = await saveChannelAssetFile({
    channelId: channel.id,
    assetId,
    mimeType: "image/png",
    buffer
  });
  const asset = await createChannelAsset({
    channelId: channel.id,
    kind: "avatar",
    fileName: saved.fileName,
    originalName: `${spec.username}-avatar.png`,
    mimeType: "image/png",
    sizeBytes: buffer.byteLength,
    assetId
  });
  await updateChannelById(channel.id, { avatarAssetId: asset.id });
  return asset.id;
}

function stage2PromptConfig(): Stage2PromptConfig {
  return {
    version: 5,
    useWorkspaceDefault: true,
    sourceMode: "system",
    stages: {} as Stage2PromptConfig["stages"]
  };
}

async function upsertChannel(workspaceId: string, ownerUserId: string, spec: ChannelSpec): Promise<{
  channel: Channel;
  templateId: string;
  avatarAssetId: string;
  created: boolean;
}> {
  const templateId = await upsertTemplate(workspaceId, spec);
  const channels = await listChannels(workspaceId);
  const existing = channels.find(
    (channel) =>
      channel.username.toLowerCase() === spec.username.toLowerCase() ||
      channel.name.toLowerCase() === spec.name.toLowerCase()
  );
  const patch = {
    name: spec.name,
    username: spec.username,
    systemPrompt: spec.systemPrompt,
    descriptionPrompt: spec.descriptionPrompt,
    examplesJson: EXAMPLES_JSON,
    stage2ExamplesConfig: STAGE2_EXAMPLES_CONFIG,
    stage2HardConstraints: HARD_CONSTRAINTS,
    stage2PromptConfig: stage2PromptConfig(),
    stage2SourceOverlayConfig: { enabled: false, prompt: "" },
    templateId,
    defaultClipDurationSec: 7
  };
  const channel = existing
    ? await updateChannelById(existing.id, patch)
    : await createChannel({ workspaceId, creatorUserId: ownerUserId, ...patch });
  const avatarAssetId = await upsertAvatar(channel, spec);
  const refreshed = (await listChannels(workspaceId)).find((item) => item.id === channel.id) ?? channel;
  return { channel: refreshed, templateId, avatarAssetId, created: !existing };
}

export async function POST(): Promise<NextResponse> {
  const workspace = getWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "Workspace is not initialized." }, { status: 500 });
  }

  const members = listWorkspaceMembers(workspace.id);
  const actor = members.find((member) => member.role === "owner") ?? members[0];
  if (!actor) {
    return NextResponse.json({ error: "Workspace has no members." }, { status: 500 });
  }

  const user = await ensurePlaceholderUser(MARY_EMAIL);
  const invite = await createFreshInvite({
    workspaceId: workspace.id,
    email: MARY_EMAIL,
    role: "redactor",
    createdByUserId: actor.user.id
  });

  const upserted = [];
  for (const spec of CHANNELS) {
    upserted.push(await upsertChannel(workspace.id, actor.user.id, spec));
  }

  const allChannels = await listChannels(workspace.id);
  const countryChannels = allChannels.filter(isCountryChannel);
  const granted = countryChannels.map((channel) =>
    setChannelAccess({
      channelId: channel.id,
      userId: user.id,
      grantedByUserId: actor.user.id
    })
  );

  return NextResponse.json({
    ok: true,
    mary: {
      email: normalizeEmail(MARY_EMAIL),
      userId: user.id,
      placeholderCreated: user.created,
      invite,
      acceptInviteUrl: ACCEPT_INVITE_URL,
      preGrantedAccessCount: granted.length
    },
    channels: upserted.map((item) => ({
      id: item.channel.id,
      name: item.channel.name,
      username: item.channel.username,
      created: item.created,
      templateId: item.templateId,
      avatarAssetId: item.avatarAssetId
    })),
    countryChannels: countryChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      username: channel.username,
      templateId: channel.templateId
    })),
    examples: {
      total: EXAMPLES.length,
      martin: EXAMPLES.filter((example) => example.sourceChannelId === "@MartinTheWorker").length,
      ghostface: EXAMPLES.filter((example) => example.sourceChannelId === "@GhostFaceFacts").length
    }
  });
}
