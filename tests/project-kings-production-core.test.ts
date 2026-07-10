import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTemplateSha,
  ChannelProductionProfileValidationError,
  collectUniqueStoryEventIds,
  defineChannelProductionProfile,
  validateChannelProductionProfile,
  validateConceptContract
} from "../lib/project-kings/channel-production-profile";
import {
  COPSCOPES_PROJECT_KINGS_PROFILE,
  COPSCOPES_TEMPLATE_SHA
} from "../lib/project-kings/copscopes-production-profile";
import {
  DARK_JOY_BOY_PROJECT_KINGS_PROFILE,
  INFAMOUS_SHARED_TEMPLATE_SHA,
  LIGHT_KINGDOM_PROJECT_KINGS_PROFILE,
  PROJECT_KINGS_PILOT_PROFILES
} from "../lib/project-kings/pilot-production-profiles";
import {
  defineModelRegistry,
  MODEL_REASONING_EFFORTS,
  ModelSelectionError,
  PROJECT_KINGS_V1_MODEL_REGISTRY,
  selectBenchmarkedModelRoutes,
  type ModelBenchmarkResult,
  type ModelReasoningEffort,
  type ModelRouteDefinition,
  type ModelSelectionPolicy
} from "../lib/project-kings/model-routing";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function clonePilotProfile(): UnknownRecord {
  return structuredClone(COPSCOPES_PROJECT_KINGS_PROFILE) as unknown as UnknownRecord;
}

function benchmark(input: Partial<ModelBenchmarkResult> & Pick<ModelBenchmarkResult, "routeId">): ModelBenchmarkResult {
  return {
    benchmarkVersion: "project-kings-benchmark-v1",
    reasoningEffort: "high",
    sampleSize: 30,
    qualityScore: 0.95,
    schemaSuccessRate: 1,
    p95LatencyMs: 5_000,
    meanCost: 0.01,
    costUnit: "usd",
    ...input
  };
}

const DEFAULT_SELECTION_POLICY: ModelSelectionPolicy = {
  requiresVision: true,
  requiresJsonSchema: true,
  minimumReasoning: "high",
  minimumContextTokens: 0,
  minimumSampleSize: 20,
  minimumQualityScore: 0.9,
  minimumSchemaSuccessRate: 0.99,
  maximumP95LatencyMs: 10_000
};

function syntheticRoute(input: {
  routeId: string;
  fallbackRouteIds: string[];
  reasoningEfforts?: ModelReasoningEffort[];
}): ModelRouteDefinition {
  return {
    routeId: input.routeId,
    provider: "test-provider",
    model: input.routeId,
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoningEfforts: input.reasoningEfforts ?? [...MODEL_REASONING_EFFORTS],
      contextWindowTokens: 128_000,
      cost: {
        source: "benchmark-required",
        costUnit: null,
        inputPerMillionTokens: null,
        cachedInputPerMillionTokens: null,
        outputPerMillionTokens: null
      },
      timeoutMs: 60_000,
      fallbackRouteIds: input.fallbackRouteIds
    },
    evidence: ["synthetic focused-test fixture"]
  };
}

test("all three live pilot profiles are valid, immutable, and bound to exact channel-template identities", () => {
  for (const profile of Object.values(PROJECT_KINGS_PILOT_PROFILES)) {
    assert.deepEqual(validateChannelProductionProfile(profile), []);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.concept.axes), true);
    assert.equal(Object.isFrozen(profile.publication.slots), true);
  }
  assert.deepEqual(Object.keys(PROJECT_KINGS_PILOT_PROFILES), [
    "dark-joy-boy",
    "light-kingdom",
    "copscopes-x2e"
  ]);
  assert.equal(DARK_JOY_BOY_PROJECT_KINGS_PROFILE.profileId, "4b59c5cf412e4c07b192f3312361c2eb");
  assert.equal(DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, "UCwO37rtHMhHX8caUr5Rc0Bw");
  assert.equal(DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.titleAdvisory, "Tiger the Apex");
  assert.equal(DARK_JOY_BOY_PROJECT_KINGS_PROFILE.templateIdentity.templateSha, INFAMOUS_SHARED_TEMPLATE_SHA);
  assert.equal(LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.profileId, "43923d42c1c0495282f29d4c6e09b0b4");
  assert.equal(LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.youtube.channelId, "UC0LWZYpYuYAWK55WmvDqxbg");
  assert.equal(LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.templateIdentity.templateSha, INFAMOUS_SHARED_TEMPLATE_SHA);
  assert.equal(COPSCOPES_PROJECT_KINGS_PROFILE.profileId, "6187aeeea7bd47188e08089c5916edc1");
  assert.equal(COPSCOPES_PROJECT_KINGS_PROFILE.youtube.channelId, "UCJhBMXXQ5GrTbrhqjwT1leg");
  assert.equal(COPSCOPES_PROJECT_KINGS_PROFILE.youtube.titleAdvisory, "lessie potirl");
  assert.equal(COPSCOPES_PROJECT_KINGS_PROFILE.templateIdentity.channelId, "6187aeeea7bd47188e08089c5916edc1");
  assert.equal(COPSCOPES_PROJECT_KINGS_PROFILE.templateIdentity.templateSha, COPSCOPES_TEMPLATE_SHA);
  assert.deepEqual(
    DARK_JOY_BOY_PROJECT_KINGS_PROFILE.publication.slots.map((slot) => slot.localTime),
    ["21:00", "21:15", "21:30", "21:45"]
  );
  assert.deepEqual(
    LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.publication.slots.map((slot) => slot.localTime),
    ["21:00", "21:15", "21:30", "21:45"]
  );
  assert.deepEqual(
    COPSCOPES_PROJECT_KINGS_PROFILE.publication.slots.map((slot) => slot.localTime),
    ["21:15", "21:30", "21:45"]
  );
  assert.equal(
    collectUniqueStoryEventIds(COPSCOPES_PROJECT_KINGS_PROFILE.concept.positiveExamples).length,
    7,
    "two Farmington Reels describe one incident and must not inflate the continuity buffer"
  );
});

test("template SHA calculation is deterministic and key-order independent", () => {
  assert.equal(
    calculateTemplateSha({ nested: { second: 2, first: 1 }, name: "template" }),
    calculateTemplateSha({ name: "template", nested: { first: 1, second: 2 } })
  );
});

test("YouTube identity uses the stable channel id while the title remains advisory", () => {
  const renamed = clonePilotProfile();
  asRecord(renamed.youtube).titleAdvisory = "COP SCOPES RENAMED";
  assert.deepEqual(validateChannelProductionProfile(renamed), []);

  const handleIdentity = clonePilotProfile();
  asRecord(handleIdentity.youtube).channelId = "@copscopes-x2e";
  assert.ok(
    validateChannelProductionProfile(handleIdentity).some(
      (issue) => issue.code === "invalid_youtube_channel_id"
    )
  );
});

test("profile accepts credential references only and rejects embedded secrets", () => {
  const rawCredential = clonePilotProfile();
  asRecord(rawCredential.credentialRefs).youtubePublishing = "ya29.raw-oauth-token";
  assert.ok(
    validateChannelProductionProfile(rawCredential).some(
      (issue) => issue.code === "invalid_credential_reference"
    )
  );

  const embeddedSecret = clonePilotProfile();
  embeddedSecret.apiKey = "raw-secret";
  assert.ok(
    validateChannelProductionProfile(embeddedSecret).some((issue) => issue.code === "embedded_secret")
  );
});

test("concept contract rejects v1 artifacts and prevents YouTube from widening Instagram boundaries", () => {
  const legacy = clonePilotProfile();
  asRecord(legacy.concept).contractVersion = "v1";
  assert.ok(validateConceptContract(legacy.concept).some((issue) => issue.code === "legacy_concept_contract"));

  const youtubePositive = clonePilotProfile();
  const concept = asRecord(youtubePositive.concept);
  const positiveExamples = asArray(concept.positiveExamples);
  asRecord(positiveExamples[0]).url = "https://www.youtube.com/shorts/example";
  assert.ok(
    validateConceptContract(concept).some((issue) => issue.code === "non_instagram_evidence")
  );

  const widened = clonePilotProfile();
  asRecord(asRecord(widened.concept).evidenceBoundary).youtubeCanWidenCategory = true;
  assert.ok(
    validateConceptContract(widened.concept).some(
      (issue) => issue.code === "youtube_boundary_widening_forbidden"
    )
  );
});

test("lighter, pyramids, fall of Rome, and a nuclear test cannot collapse into one broad channel", () => {
  const broadHistory = clonePilotProfile();
  const concept = asRecord(broadHistory.concept);
  concept.conceptShape = "broad";
  concept.label = "Forgotten events and artifacts with a shock fact";
  concept.inclusions = [
    "A recovered historical lighter.",
    "The construction of ancient pyramids.",
    "The fall of the Roman Empire.",
    "A twentieth-century nuclear weapons test."
  ];

  const issues = validateConceptContract(concept);
  assert.ok(issues.some((issue) => issue.code === "non_channel_concept"));
  assert.throws(
    () => defineChannelProductionProfile(broadHistory),
    ChannelProductionProfileValidationError
  );
});

test("three reposts of one late-Nazi trial count as one unique story event", () => {
  const reposts = [
    { storyEventId: "trial-josef-schuetz" },
    { storyEventId: "trial-josef-schuetz" },
    { storyEventId: "trial-josef-schuetz" }
  ];
  assert.deepEqual(collectUniqueStoryEventIds(reposts), ["trial-josef-schuetz"]);
});

test("a concept with only one unique event cannot become an active daily profile", () => {
  const oneVideo = clonePilotProfile();
  const concept = asRecord(oneVideo.concept);
  concept.conceptShape = "channel";
  for (const example of asArray(concept.positiveExamples)) {
    asRecord(example).storyEventId = "trial-josef-schuetz";
  }
  asRecord(concept.continuityBuffer).uniqueStoryEventIds = ["trial-josef-schuetz"];

  const issues = validateChannelProductionProfile(oneVideo);
  assert.ok(issues.some((issue) => issue.code === "invalid_list_size"));
  assert.throws(() => defineChannelProductionProfile(oneVideo), ChannelProductionProfileValidationError);
});

test("continuity buffer enforces 6 through 12 unique proven events", () => {
  const duplicateBuffer = clonePilotProfile();
  asRecord(asRecord(duplicateBuffer.concept).continuityBuffer).uniqueStoryEventIds = [
    "event-farmington-street-race-burning-car-rescue",
    "event-farmington-street-race-burning-car-rescue",
    "event-nashville-officer-involved-shooting",
    "event-wakefield-motorcycle-stop-flight",
    "event-el-paso-vehicle-approach-arrest",
    "event-marysville-drive-through-stop"
  ];
  assert.ok(
    validateChannelProductionProfile(duplicateBuffer).some((issue) => issue.code === "duplicate_items")
  );

  const overfull = clonePilotProfile();
  asRecord(asRecord(overfull.concept).continuityBuffer).uniqueStoryEventIds = Array.from(
    { length: 13 },
    (_, index) => `event-${index}`
  );
  assert.ok(
    validateChannelProductionProfile(overfull).some((issue) => issue.code === "invalid_list_size")
  );
});

test("Project Kings registry records only availability-verified Codex vision routes", () => {
  const models = PROJECT_KINGS_V1_MODEL_REGISTRY.routes.map((route) => route.model);
  assert.deepEqual(models, ["gpt-5.4", "gpt-5.4-mini", "gpt-5.6-luna"]);
  for (const route of PROJECT_KINGS_V1_MODEL_REGISTRY.routes) {
    assert.equal(route.capabilities.vision, true);
    assert.equal(route.capabilities.jsonSchema, true);
    assert.deepEqual(route.capabilities.reasoningEfforts, MODEL_REASONING_EFFORTS);
    assert.equal(route.capabilities.contextWindowTokens, null);
    assert.equal(route.capabilities.cost.source, "benchmark-required");
    assert.equal(route.capabilities.timeoutMs, 480_000);
    if (route.model === "gpt-5.6-luna") {
      // gpt-5.6-luna is registered only with recorded live availability probes
      // (2026-07-10, codex-cli 0.144.1: text, --image, and --output-schema).
      assert.ok(route.evidence.some((entry) => entry.includes("live probe")));
      assert.ok(route.evidence.some((entry) => entry.includes("--image")));
      assert.ok(route.evidence.some((entry) => entry.includes("--output-schema")));
      assert.ok(route.evidence.some((entry) => entry.includes("rate card")));
    } else {
      assert.ok(route.evidence.some((entry) => entry.includes("workspace-codex-models")));
    }
  }
});

test("benchmark selection chooses faster route when its cost is less than 10 percent higher", () => {
  const selection = selectBenchmarkedModelRoutes({
    registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
    policy: DEFAULT_SELECTION_POLICY,
    benchmarks: [
      benchmark({ routeId: "codex:gpt-5.4", meanCost: 0.01, p95LatencyMs: 8_000 }),
      benchmark({ routeId: "codex:gpt-5.4-mini", meanCost: 0.0105, p95LatencyMs: 2_000 })
    ]
  });
  assert.equal(selection.primary.route.routeId, "codex:gpt-5.4-mini");
  assert.equal(selection.fallback.route.routeId, "codex:gpt-5.4");
  assert.equal(selection.fallbackMode, "distinct_route");
  assert.equal(Object.isFrozen(selection), true);
});

test("same-route reasoning fallback is used only when no distinct route qualifies and is labeled", () => {
  const lowFloorPolicy = { ...DEFAULT_SELECTION_POLICY, minimumReasoning: "low" as const };
  const selection = selectBenchmarkedModelRoutes({
    registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
    policy: lowFloorPolicy,
    benchmarks: [
      benchmark({ routeId: "codex:gpt-5.6-luna", reasoningEffort: "low", meanCost: 0.01, p95LatencyMs: 3_000 }),
      benchmark({ routeId: "codex:gpt-5.6-luna", reasoningEffort: "medium", meanCost: 0.02, p95LatencyMs: 6_000 })
    ]
  });
  assert.equal(selection.primary.route.routeId, "codex:gpt-5.6-luna");
  assert.equal(selection.primary.benchmark.reasoningEffort, "low");
  assert.equal(selection.fallback.route.routeId, "codex:gpt-5.6-luna");
  assert.equal(selection.fallback.benchmark.reasoningEffort, "medium");
  assert.equal(selection.fallbackMode, "same_route_reasoning");

  const distinct = selectBenchmarkedModelRoutes({
    registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
    policy: lowFloorPolicy,
    benchmarks: [
      benchmark({ routeId: "codex:gpt-5.6-luna", reasoningEffort: "low", meanCost: 0.01, p95LatencyMs: 3_000 }),
      benchmark({ routeId: "codex:gpt-5.6-luna", reasoningEffort: "medium", meanCost: 0.02, p95LatencyMs: 6_000 }),
      benchmark({ routeId: "codex:gpt-5.4-mini", reasoningEffort: "low", meanCost: 0.05, p95LatencyMs: 4_000 })
    ]
  });
  assert.equal(distinct.primary.route.routeId, "codex:gpt-5.6-luna");
  assert.equal(distinct.fallback.route.routeId, "codex:gpt-5.4-mini");
  assert.equal(distinct.fallbackMode, "distinct_route");
});

test("benchmark selection keeps the cheapest route when the cost difference is exactly 10 percent", () => {
  const selection = selectBenchmarkedModelRoutes({
    registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
    policy: DEFAULT_SELECTION_POLICY,
    benchmarks: [
      benchmark({ routeId: "codex:gpt-5.4", meanCost: 10, p95LatencyMs: 8_000 }),
      benchmark({ routeId: "codex:gpt-5.4-mini", meanCost: 11, p95LatencyMs: 2_000 })
    ]
  });
  assert.equal(selection.primary.route.routeId, "codex:gpt-5.4");
  assert.equal(selection.fallback.route.routeId, "codex:gpt-5.4-mini");
});

test("benchmark selection filters quality, schema success, and p95 latency", () => {
  const registry = defineModelRegistry([
    syntheticRoute({ routeId: "test:quality", fallbackRouteIds: ["test:schema"] }),
    syntheticRoute({ routeId: "test:schema", fallbackRouteIds: ["test:latency"] }),
    syntheticRoute({ routeId: "test:latency", fallbackRouteIds: ["test:quality"] })
  ]);
  assert.throws(
    () =>
      selectBenchmarkedModelRoutes({
        registry,
        policy: DEFAULT_SELECTION_POLICY,
        benchmarks: [
          benchmark({ routeId: "test:quality", qualityScore: 0.89 }),
          benchmark({ routeId: "test:schema", schemaSuccessRate: 0.98 }),
          benchmark({ routeId: "test:latency", p95LatencyMs: 10_001 })
        ]
      }),
    (error: unknown) => {
      assert.ok(error instanceof ModelSelectionError);
      assert.ok(error.rejections.some((entry) => entry.reason.includes("quality score")));
      assert.ok(error.rejections.some((entry) => entry.reason.includes("schema success")));
      assert.ok(error.rejections.some((entry) => entry.reason.includes("p95 latency")));
      return true;
    }
  );
});

test("benchmark selection enforces minimum reasoning and a distinct qualified fallback", () => {
  const lowOnlyRegistry = defineModelRegistry([
    syntheticRoute({
      routeId: "test:low-a",
      fallbackRouteIds: ["test:low-b"],
      reasoningEfforts: ["low"]
    }),
    syntheticRoute({
      routeId: "test:low-b",
      fallbackRouteIds: ["test:low-a"],
      reasoningEfforts: ["low"]
    })
  ]);
  assert.throws(
    () =>
      selectBenchmarkedModelRoutes({
        registry: lowOnlyRegistry,
        policy: DEFAULT_SELECTION_POLICY,
        benchmarks: [
          benchmark({ routeId: "test:low-a", reasoningEffort: "low" }),
          benchmark({ routeId: "test:low-b", reasoningEffort: "low" })
        ]
      }),
    ModelSelectionError
  );

  assert.throws(
    () =>
      selectBenchmarkedModelRoutes({
        registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
        policy: DEFAULT_SELECTION_POLICY,
        benchmarks: [benchmark({ routeId: "codex:gpt-5.4" })]
      }),
    (error: unknown) => {
      assert.ok(error instanceof ModelSelectionError);
      assert.match(error.message, /no distinct benchmark-qualified fallback/i);
      return true;
    }
  );
});

test("unknown context limits fail closed when a stage declares a minimum context requirement", () => {
  assert.throws(
    () =>
      selectBenchmarkedModelRoutes({
        registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
        policy: {
          ...DEFAULT_SELECTION_POLICY,
          minimumContextTokens: 32_000
        },
        benchmarks: [
          benchmark({ routeId: "codex:gpt-5.4" }),
          benchmark({ routeId: "codex:gpt-5.4-mini" })
        ]
      }),
    (error: unknown) => {
      assert.ok(error instanceof ModelSelectionError);
      assert.ok(error.rejections.every((entry) => entry.reason.includes("context window")));
      return true;
    }
  );
});
