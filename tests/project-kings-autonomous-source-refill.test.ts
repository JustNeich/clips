import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createProjectKingsLocalSourceDownloadProvider,
  createProjectKingsLocalMediaEvidenceProvider,
  projectKingsRefillFetchWithRetry,
  ProjectKingsSourceRefillHttpError
} from "../lib/project-kings/source-refill-adapters";
import {
  hashProjectKingsDiscoveredSourceCandidate,
  runProjectKingsAutonomousSourceRefill,
  type ProjectKingsDiscoveredSourceCandidate,
  type ProjectKingsExtractedSourceEvidence,
  type ProjectKingsSourceBufferRuntimeSnapshot,
  type ProjectKingsSourceDiscoveryProvider
} from "../lib/project-kings/source-refill-contour";
import {
  FileProjectKingsSourceRefillLedgerStore,
  verifyProjectKingsSourceRefillLedger
} from "../lib/project-kings/source-refill-ledger";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "../lib/project-kings/pilot-production-profiles";
import { calculateProductionProfileHash } from "../lib/project-kings/pilot-profile-store";
import { runProjectKingsSourceFitAssessment } from "../lib/project-kings/source-fit-assessment-runner";
import type {
  ProductionAgentAttemptTelemetry,
  ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";
import type { ProductionReadyAgentRouteManifest } from "../lib/project-kings/production-model-route-manifest";
import {
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourcePolicyApproval
} from "../lib/project-kings/source-rights-sensitive-policy";

const CAPTURED_AT = "2026-07-10T12:00:00.000Z";
const execFileAsync = promisify(execFile);
const PROFILE_KEYS = Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha256(value: string | Uint8Array | unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" || value instanceof Uint8Array
      ? value
      : JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function selection(role: "source_policy" | "source_fit"): ProductionAgentModelSelection {
  const sampleSize = role === "source_policy" ? 30 : 3;
  const requiresVision = role === "source_policy";
  const route = (routeId: string, fallbackRouteId: string) => ({
    route: {
      routeId,
      provider: "codex",
      model: routeId,
      capabilities: {
        vision: requiresVision,
        jsonSchema: true,
        reasoningEfforts: ["low"] as const,
        timeoutMs: 90_000,
        fallbackRouteIds: [fallbackRouteId]
      }
    },
    benchmark: {
      benchmarkVersion: `${role}-benchmark-v1`,
      routeId,
      reasoningEffort: "low" as const,
      sampleSize,
      qualityScore: 1,
      schemaSuccessRate: 1,
      p95LatencyMs: 1_000,
      meanCost: 1,
      costUnit: "codex_credits" as const
    }
  });
  return {
    primary: route(`${role}-primary`, `${role}-fallback`),
    fallback: route(`${role}-fallback`, `${role}-primary`),
    policy: {
      requiresVision,
      requiresJsonSchema: true,
      minimumReasoning: "low",
      minimumContextTokens: 0,
      minimumSampleSize: sampleSize,
      minimumQualityScore: 1,
      minimumSchemaSuccessRate: 1,
      maximumP95LatencyMs: 90_000
    }
  };
}

function successfulAttempt(
  role: "source_policy" | "source_fit",
  candidateId: string
): ProductionAgentAttemptTelemetry {
  return {
    schemaVersion: 1,
    attempt: 1,
    role,
    routeId: `${role}-primary`,
    provider: "codex",
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    benchmarkVersion: `${role}-benchmark-v1`,
    timeoutMs: 90_000,
    startedAt: CAPTURED_AT,
    durationMs: 1_000,
    promptSha256: sha256(`prompt:${role}:${candidateId}`),
    outputSha256: sha256(`output:${role}:${candidateId}`),
    usage: {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 20,
      reasoningOutputTokens: 5
    },
    outcome: "passed",
    error: null
  };
}

function manifest(): ProductionReadyAgentRouteManifest {
  return {
    schemaVersion: 3,
    manifestId: "project-kings-routes-test-v3",
    createdAt: CAPTURED_AT,
    manifestSha256: sha256("manifest"),
    selections: {
      source_policy: selection("source_policy"),
      source_fit: selection("source_fit")
    },
    evidence: {}
  } as unknown as ProductionReadyAgentRouteManifest;
}

const approval = createProjectKingsSourcePolicyApproval({
  approvalId: "source-refill-test-approval",
  ownerPrincipalId: "owner-test",
  ownerAuthorizationEvidenceSha256: sha256("owner-approval"),
  approvedAt: CAPTURED_AT
});

function runtime(counts: Partial<Record<ProjectKingsPilotProfileKey, number>> = {}): ProjectKingsSourceBufferRuntimeSnapshot {
  return {
    schemaVersion: "project-kings-source-buffer-runtime-v1",
    workspaceId: "workspace-source-refill-test",
    ready: PROFILE_KEYS.every((key) => (counts[key] ?? 5) >= 6),
    sourcePolicyApproval: approval,
    sourcePolicyApprovalSha256: approval.approvalSha256,
    channels: PROFILE_KEYS.map((profileKey) => {
      const qualifiedAvailable = counts[profileKey] ?? 5;
      return {
        profileKey,
        channelId: PROJECT_KINGS_PILOT_PROFILES[profileKey].profileId,
        qualifiedAvailable,
        refill: {
          shouldRefill: qualifiedAvailable < 6,
          readyBufferMin: 6,
          readyBufferCap: 12,
          candidateAttemptBudget: 9,
          candidatesToRequest: qualifiedAvailable < 6
            ? Math.min(9, 12 - qualifiedAvailable)
            : 0
        },
        candidates: []
      };
    })
  };
}

function donor(profileKey: ProjectKingsPilotProfileKey): string {
  if (profileKey === "dark-joy-boy") return "kodyantle";
  if (profileKey === "light-kingdom") return "learnaifaster";
  return "copscopes";
}

function candidate(profileKey: ProjectKingsPilotProfileKey, index: number): ProjectKingsDiscoveredSourceCandidate {
  const shortcode = `${profileKey.replace(/[^a-z0-9]/g, "")}${index}`;
  const payload = {
    candidateId: `${profileKey}-candidate-${index}`,
    profileKey,
    provider: "instagram" as const,
    route: "instagram_donor_pool" as const,
    donorUsername: donor(profileKey),
    sourceUrl: `https://www.instagram.com/reel/${shortcode}/`,
    canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
    caption: `Visible event ${profileKey} ${index}`,
    provisionalStoryEventId: `provisional-${profileKey}-${index}`
  };
  return {
    ...payload,
    discoveryEvidenceSha256: hashProjectKingsDiscoveredSourceCandidate(payload)
  };
}

function discoveryProvider(input: {
  blockedProfile?: ProjectKingsPilotProfileKey;
  candidateCount?: number;
  onStart?: (profileKey: ProjectKingsPilotProfileKey) => void;
  onEnd?: (profileKey: ProjectKingsPilotProfileKey) => void;
} = {}): ProjectKingsSourceDiscoveryProvider {
  return {
    providerId: "instagram-test",
    strategy: "instagram",
    async discover(request) {
      input.onStart?.(request.profileKey);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (request.profileKey === input.blockedProfile) {
        input.onEnd?.(request.profileKey);
        throw new Error("HTTP 403 from the isolated test provider");
      }
      const candidates = Array.from(
        { length: Math.min(request.targetCandidateCount, input.candidateCount ?? 9) },
        (_, index) => candidate(request.profileKey, index + 1)
      );
      input.onEnd?.(request.profileKey);
      return {
        candidates,
        issues: [],
        evidenceSha256: sha256(candidates)
      };
    }
  };
}

function extracted(candidateValue: ProjectKingsDiscoveredSourceCandidate): ProjectKingsExtractedSourceEvidence {
  const contentSha256 = sha256(`media:${candidateValue.candidateId}`);
  const base = `/repo/.data/${candidateValue.candidateId}`;
  return {
    candidateId: candidateValue.candidateId,
    mediaPath: `${base}.mp4`,
    media: {
      relativePath: `.data/${candidateValue.candidateId}.mp4`,
      sizeBytes: 10_000,
      contentSha256,
      durationMs: 10_000,
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      decodeComplete: true,
      decodeError: null
    },
    ocr: { artifactId: "source-ocr", filePath: `${base}-ocr.txt`, sha256: sha256("ocr") },
    asr: { artifactId: "source-asr", filePath: `${base}-asr.txt`, sha256: sha256("asr") },
    sourceFitArtifacts: [
      { id: "frame", kind: "key_frame", mediaType: "image", filePath: `${base}.jpg`, sha256: sha256("frame") },
      { id: "source-ocr", kind: "ocr", mediaType: "text", filePath: `${base}-ocr.txt`, sha256: sha256("ocr") },
      { id: "source-asr", kind: "transcript", mediaType: "text", filePath: `${base}-asr.txt`, sha256: sha256("asr") }
    ],
    extractionEvidenceSha256: sha256(`extract:${candidateValue.candidateId}`)
  };
}

async function runFixture(input: {
  root: string;
  runtime?: ProjectKingsSourceBufferRuntimeSnapshot;
  provider?: ProjectKingsSourceDiscoveryProvider;
  providers?: readonly ProjectKingsSourceDiscoveryProvider[];
  eventForCandidate?: (candidate: ProjectKingsDiscoveredSourceCandidate) => string;
  contentForCandidate?: (candidate: ProjectKingsDiscoveredSourceCandidate) => string;
  onCandidateStart?: (profileKey: ProjectKingsPilotProfileKey) => void;
  onCandidateEnd?: (profileKey: ProjectKingsPilotProfileKey) => void;
}) {
  let uploadCalls = 0;
  let downloadCalls = 0;
  const result = await runProjectKingsAutonomousSourceRefill({
    mode: "shadow",
    logicalDate: "2026-07-10",
    capturedAt: CAPTURED_AT,
    runtime: input.runtime ?? runtime(),
    routeManifest: manifest(),
    ledger: new FileProjectKingsSourceRefillLedgerStore(path.join(input.root, "ledger.json")),
    discoveryProviders: input.providers ?? [input.provider ?? discoveryProvider()],
    downloadProvider: {
      async download({ candidate: candidateValue }) {
        downloadCalls += 1;
        input.onCandidateStart?.(candidateValue.profileKey);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return {
          candidateId: candidateValue.candidateId,
          sourceUrl: candidateValue.sourceUrl,
          mediaPath: `/repo/.data/${candidateValue.candidateId}.mp4`,
          acquisitionPath: "public_ephemeral",
          acquisitionEvidenceSha256: sha256(`download:${candidateValue.candidateId}`)
        };
      }
    },
    mediaEvidenceProvider: {
      async extract({ candidate: candidateValue }) {
        const value = extracted(candidateValue);
        input.onCandidateEnd?.(candidateValue.profileKey);
        return input.contentForCandidate
          ? { ...value, media: { ...value.media, contentSha256: input.contentForCandidate(candidateValue) } }
          : value;
      }
    },
    policyAssessor: {
      async assess({ candidate: candidateValue, extracted: extractedValue }) {
        const upstreamEvidenceSha256 = sha256(`policy:${candidateValue.candidateId}`);
        return {
          assessment: createProjectKingsSensitiveContentAssessment({
            candidateId: candidateValue.candidateId,
            contentSha256: extractedValue.media.contentSha256,
            upstreamEvidenceSha256,
            signals: {
              graphicViolence: "absent",
              unsupportedAllegation: "absent",
              minorInSensitiveIncident: "absent",
              realisticPoliticalOrPublicFigureDeepfake: "absent"
            }
          }),
          attemptEvidenceSha256: upstreamEvidenceSha256,
          attempts: [successfulAttempt("source_policy", candidateValue.candidateId)]
        };
      }
    },
    sourceFitAssessor: {
      async assess({ candidate: candidateValue, extracted: extractedValue, liveInventorySha256 }) {
        const storyEventId = input.eventForCandidate?.(candidateValue) ??
          `event-${candidateValue.profileKey}-${candidateValue.candidateId.split("-").at(-1)}`;
        const output = {
          decision: "PASS" as const,
          candidateId: candidateValue.candidateId,
          storyEventId,
          conceptMatch: true,
          factualFit: true,
          duplicateVideo: false,
          duplicateEvent: false,
          sourceUsable: true,
          reason: "All exact source-fit gates passed in the test fixture.",
          factualClaims: []
        };
        return {
          attestation: {
            candidateId: candidateValue.candidateId,
            profileKey: candidateValue.profileKey,
            sourceUrl: candidateValue.sourceUrl,
            contentSha256: extractedValue.media.contentSha256,
            profileHash: calculateProductionProfileHash(
              PROJECT_KINGS_PILOT_PROFILES[candidateValue.profileKey]
            ),
            liveInventorySha256,
            agentAttemptId: `attempt-${candidateValue.candidateId}`,
            model: "test-model",
            reasoningLevel: "low",
            promptSha256: sha256(`prompt:${candidateValue.candidateId}`),
            artifactSetSha256: sha256(`artifacts:${candidateValue.candidateId}`),
            rawOutputSha256: sha256(`raw:${candidateValue.candidateId}`),
            outputSha256: sha256(output),
            finishedAt: CAPTURED_AT,
            output
          },
          attempts: [successfulAttempt("source_fit", candidateValue.candidateId)]
        };
      }
    },
    uploadProvider: {
      async upload() {
        uploadCalls += 1;
        throw new Error("Shadow mode must never call upload.");
      }
    }
  });
  return { result, uploadCalls, downloadCalls };
}

test("shadow refill runs channels in parallel, candidates sequentially, and fills below six toward twelve", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-refill-"));
  let activeDiscovery = 0;
  let maxActiveDiscovery = 0;
  const activeByProfile = new Map<ProjectKingsPilotProfileKey, number>();
  let maxActivePerProfile = 0;
  try {
    const fixture = await runFixture({
      root,
      provider: discoveryProvider({
        onStart: () => {
          activeDiscovery += 1;
          maxActiveDiscovery = Math.max(maxActiveDiscovery, activeDiscovery);
        },
        onEnd: () => { activeDiscovery -= 1; }
      }),
      onCandidateStart: (profileKey) => {
        const active = (activeByProfile.get(profileKey) ?? 0) + 1;
        activeByProfile.set(profileKey, active);
        maxActivePerProfile = Math.max(maxActivePerProfile, active);
      },
      onCandidateEnd: (profileKey) => {
        activeByProfile.set(profileKey, (activeByProfile.get(profileKey) ?? 1) - 1);
      }
    });
    assert.equal(fixture.result.status, "complete");
    assert.equal(fixture.downloadCalls, 21);
    assert.equal(fixture.uploadCalls, 0);
    assert.ok(fixture.result.channels.every((channel) =>
      channel.attempts === 7 && channel.qualified === 7 && channel.uploaded === 0
    ));
    assert.ok(maxActiveDiscovery > 1, "different channels should discover in parallel");
    assert.equal(maxActivePerProfile, 1, "one profile must process only one Instagram candidate at a time");
    const ledger = JSON.parse(await readFile(path.join(root, "ledger.json"), "utf8"));
    verifyProjectKingsSourceRefillLedger(ledger);
    const firstCandidate = ledger.requests[0].channels[0].candidates[0];
    assert.deepEqual(
      firstCandidate.agentAttempts.map((attempt: { role: string }) => attempt.role),
      ["source_policy", "source_fit"]
    );
    for (const attempt of firstCandidate.agentAttempts) {
      assert.equal(attempt.model, "gpt-5.4-mini");
      assert.equal(attempt.reasoningLevel, "low");
      assert.equal(attempt.durationMs, 1_000);
      assert.equal(attempt.inputTokens, 100);
      assert.equal(attempt.costUnit, "codex_credits");
      assert.equal(attempt.costSource, "rate_card");
      assert.equal(attempt.outcome, "passed");
    }
    assert.equal((await stat(path.join(root, "ledger.json"))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate content and duplicate event consume the bounded budget without entering the qualified buffer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-dedupe-"));
  try {
    const base = runtime({ "dark-joy-boy": 5, "light-kingdom": 6, "copscopes-x2e": 6 });
    const knownHash = sha256("known-content");
    const dark = base.channels.find((channel) => channel.profileKey === "dark-joy-boy")!;
    const runtimeWithKnown: ProjectKingsSourceBufferRuntimeSnapshot = {
      ...base,
      channels: base.channels.map((channel) => channel.profileKey === "dark-joy-boy"
        ? {
            ...dark,
            candidates: [{
              id: "known",
              canonicalUrl: "https://www.instagram.com/reel/known/",
              contentSha256: knownHash,
              eventFingerprint: "event-known",
              rightsStatus: "owner_approved_source_pool",
              status: "available",
              qualificationStatus: "qualified"
            }]
          }
        : channel)
    };
    const fixture = await runFixture({
      root,
      runtime: runtimeWithKnown,
      provider: discoveryProvider({ candidateCount: 9 }),
      contentForCandidate: (value) => value.candidateId.endsWith("-1")
        ? knownHash
        : sha256(`media:${value.candidateId}`),
      eventForCandidate: (value) => value.candidateId.endsWith("-2")
        ? "event-known"
        : `event-${value.candidateId}`
    });
    const darkResult = fixture.result.channels.find((channel) => channel.profileKey === "dark-joy-boy")!;
    assert.equal(fixture.result.status, "complete");
    assert.equal(darkResult.attempts, 9);
    assert.equal(darkResult.qualified, 7);
    const ledger = JSON.parse(await readFile(path.join(root, "ledger.json"), "utf8"));
    const candidates = ledger.requests[0].channels.find(
      (channel: { profileKey: string }) => channel.profileKey === "dark-joy-boy"
    ).candidates;
    assert.equal(candidates.filter((entry: { stage: string }) => entry.stage === "duplicate_rejected").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one discovery failure blocks only that channel while other channels finish", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-isolation-"));
  try {
    const fixture = await runFixture({
      root,
      provider: discoveryProvider({ blockedProfile: "light-kingdom" })
    });
    assert.equal(fixture.result.status, "partial");
    assert.equal(
      fixture.result.channels.find((channel) => channel.profileKey === "light-kingdom")?.blockerCode,
      "source_discovery_exhausted"
    );
    assert.equal(
      fixture.result.channels.find((channel) => channel.profileKey === "dark-joy-boy")?.status,
      "complete"
    );
    assert.equal(
      fixture.result.channels.find((channel) => channel.profileKey === "copscopes-x2e")?.status,
      "complete"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider fallback order continues to YouTube Ask only for the profile explicitly designated by policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-provider-fallback-"));
  const calls: string[] = [];
  try {
    const instagram: ProjectKingsSourceDiscoveryProvider = {
      providerId: "instagram-failing-test",
      strategy: "instagram",
      async discover(request) {
        calls.push(`instagram:${request.profileKey}`);
        throw new Error("HTTP 429 exhausted");
      }
    };
    const youtube: ProjectKingsSourceDiscoveryProvider = {
      providerId: "youtube-ask-test",
      strategy: "youtube_ask",
      async discover(request) {
        calls.push(`youtube_ask:${request.profileKey}`);
        const candidates = Array.from({ length: request.targetCandidateCount }, (_, index) => {
          const videoId = `LightAsk${index + 1}`;
          const payload = {
            candidateId: `light-youtube-${index + 1}`,
            profileKey: request.profileKey,
            provider: "youtube_ask" as const,
            route: "youtube_ask_v3" as const,
            donorUsername: null,
            sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
            canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
            caption: `Visible AI fiction event ${index + 1}`,
            provisionalStoryEventId: `provisional-light-youtube-${index + 1}`
          };
          return {
            ...payload,
            discoveryEvidenceSha256: hashProjectKingsDiscoveredSourceCandidate(payload)
          };
        });
        return { candidates, issues: [], evidenceSha256: sha256(candidates) };
      }
    };
    const fixture = await runFixture({
      root,
      runtime: runtime({ "dark-joy-boy": 6, "light-kingdom": 5, "copscopes-x2e": 6 }),
      providers: [instagram, youtube]
    });
    assert.equal(fixture.result.status, "complete");
    assert.deepEqual(calls, ["instagram:light-kingdom", "youtube_ask:light-kingdom"]);
    assert.equal(
      fixture.result.channels.find((channel) => channel.profileKey === "light-kingdom")?.qualified,
      7
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completed request is restart-safe and does not rediscover or reprocess candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-restart-"));
  try {
    const first = await runFixture({ root });
    let discoveryCalls = 0;
    const second = await runFixture({
      root,
      provider: discoveryProvider({
        onStart: () => { discoveryCalls += 1; }
      })
    });
    assert.equal(second.result.requestId, first.result.requestId);
    assert.equal(second.downloadCalls, 0);
    assert.equal(discoveryCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart resumes a non-terminal ledger candidate without consuming a new attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-stage-resume-"));
  try {
    const first = await runFixture({ root });
    const store = new FileProjectKingsSourceRefillLedgerStore(path.join(root, "ledger.json"));
    await store.mutateRequest(first.result.requestId, (request) => ({
      ...request,
      status: "partial",
      channels: request.channels.map((channel) => {
        if (channel.profileKey !== "dark-joy-boy") return channel;
        return {
          ...channel,
          status: "running",
          qualified: channel.qualified - 1,
          candidates: channel.candidates.map((entry, index) =>
            index === 0 ? { ...entry, stage: "media_extracted" as const } : entry
          )
        };
      })
    }));
    const resumed = await runFixture({ root });
    const dark = resumed.result.channels.find((channel) => channel.profileKey === "dark-joy-boy")!;
    assert.equal(resumed.result.requestId, first.result.requestId);
    assert.equal(dark.status, "complete");
    assert.equal(dark.attempts, 7);
    assert.equal(dark.qualified, 7);
    assert.equal(resumed.downloadCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refill fails closed before discovery when a production schema-v2/v3 model manifest is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-manifest-"));
  try {
    let discoveries = 0;
    await assert.rejects(
      () => runProjectKingsAutonomousSourceRefill({
        mode: "dry_run",
        logicalDate: "2026-07-10",
        capturedAt: CAPTURED_AT,
        runtime: runtime(),
        routeManifest: { schemaVersion: 1 } as unknown as ProductionReadyAgentRouteManifest,
        ledger: new FileProjectKingsSourceRefillLedgerStore(path.join(root, "ledger.json")),
        discoveryProviders: [{
          ...discoveryProvider(),
          async discover(input) {
            discoveries += 1;
            return discoveryProvider().discover(input);
          }
        }],
        downloadProvider: { async download() { throw new Error("must not run"); } },
        mediaEvidenceProvider: { async extract() { throw new Error("must not run"); } },
        policyAssessor: { async assess() { throw new Error("must not run"); } },
        sourceFitAssessor: { async assess() { throw new Error("must not run"); } },
        uploadProvider: { async upload() { throw new Error("must not run"); } }
      }),
      /schema-v2\/v3 route manifest/i
    );
    assert.equal(discoveries, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP adapter retries 429/5xx, but 401/403 and ordinary 4xx fail immediately", async () => {
  const statuses = [429, 502, 200];
  const sleeps: number[] = [];
  const response = await projectKingsRefillFetchWithRetry({
    url: "https://clips.example.test/api",
    init: { method: "GET" },
    sleep: async (delayMs) => { sleeps.push(delayMs); },
    fetchImpl: async () => new Response("{}", { status: statuses.shift() })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(sleeps, [500, 1_000]);

  for (const statusCode of [401, 403, 404]) {
    let calls = 0;
    await assert.rejects(
      () => projectKingsRefillFetchWithRetry({
        url: "https://clips.example.test/api",
        init: { method: "GET" },
        sleep: async () => assert.fail("non-retryable status must not sleep"),
        fetchImpl: async () => {
          calls += 1;
          return new Response("blocked", { status: statusCode });
        }
      }),
      (error) => error instanceof ProjectKingsSourceRefillHttpError &&
        error.status === statusCode &&
        error.code === (statusCode === 404 ? "http_error" : "auth_blocked")
    );
    assert.equal(calls, 1);
  }
});

test("Instagram download uses public path first and owner Clips/CDP only as explicit auth fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-auth-fallback-"));
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    const calls: string[] = [];
    const provider = createProjectKingsLocalSourceDownloadProvider({
      repoRoot: root,
      cdpOrigin: "http://127.0.0.1:52376",
      runCommand: async ({ command, args }) => {
        calls.push(command);
        if (command === "yt-dlp") throw new Error("HTTP Error 403: Forbidden; login required");
        const outputIndex = args.indexOf("--output");
        const relativeOutput = args[outputIndex + 1]!;
        const output = path.join(root, relativeOutput);
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, Buffer.alloc(2_048, 7));
        return { stdout: "{}", stderr: "" };
      }
    });
    const downloaded = await provider.download({
      requestId: "request-one",
      candidate: candidate("dark-joy-boy", 1)
    });
    assert.deepEqual(calls, ["yt-dlp", process.execPath]);
    assert.equal(downloaded.acquisitionPath, "owner_clips_cdp_fallback");
    assert.match(downloaded.acquisitionEvidenceSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful public download never opens the owner Clips/CDP fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-public-download-"));
  try {
    const calls: string[] = [];
    const provider = createProjectKingsLocalSourceDownloadProvider({
      repoRoot: root,
      cdpOrigin: "http://127.0.0.1:52376",
      runCommand: async ({ command, args }) => {
        calls.push(command);
        const output = args[args.indexOf("--output") + 1]!;
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, Buffer.alloc(2_048, 3));
        return { stdout: "", stderr: "" };
      }
    });
    const downloaded = await provider.download({
      requestId: "request-public",
      candidate: candidate("dark-joy-boy", 2)
    });
    assert.deepEqual(calls, ["yt-dlp"]);
    assert.equal(downloaded.acquisitionPath, "public_ephemeral");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local media adapter fully decodes MP4 and creates exact OCR/ASR/key-frame evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-media-evidence-"));
  try {
    const mediaPath = path.join(root, ".data/project-kings/source-refill/request/media.mp4");
    await mkdir(path.dirname(mediaPath), { recursive: true });
    await execFileAsync("ffmpeg", [
      "-nostdin", "-v", "error",
      "-f", "lavfi", "-i", "color=c=blue:s=320x568:d=1",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-movflags", "+faststart", "-y", mediaPath
    ], { timeout: 60_000 });
    const adapter = createProjectKingsLocalMediaEvidenceProvider({
      repoRoot: root,
      runCommand: async ({ command, args }) => {
        if (command === "ffmpeg") {
          const framePath = args.at(-1)!;
          await writeFile(framePath, Buffer.from(`frame:${framePath}`));
          return { stdout: "", stderr: "" };
        }
        if (command === "tesseract") {
          return { stdout: "VISIBLE DONOR TEXT", stderr: "" };
        }
        if (command === "whisper") {
          const outputRoot = args[args.indexOf("--output_dir") + 1]!;
          await mkdir(outputRoot, { recursive: true });
          await writeFile(path.join(outputRoot, "media.txt"), "Spoken source words.\n");
          return { stdout: "", stderr: "" };
        }
        throw new Error(`Unexpected command ${command}`);
      }
    });
    const candidateValue = candidate("dark-joy-boy", 1);
    const result = await adapter.extract({
      requestId: "request-media",
      candidate: candidateValue,
      downloaded: {
        candidateId: candidateValue.candidateId,
        sourceUrl: candidateValue.sourceUrl,
        mediaPath,
        acquisitionPath: "public_ephemeral",
        acquisitionEvidenceSha256: sha256("download")
      }
    });
    assert.equal(result.media.decodeComplete, true);
    assert.equal(result.sourceFitArtifacts.filter((entry) => entry.kind === "key_frame").length, 5);
    assert.match(await readFile(result.ocr.filePath, "utf8"), /VISIBLE DONOR TEXT/);
    assert.match(await readFile(result.asr.filePath, "utf8"), /Spoken source words/);
    assert.match(result.extractionEvidenceSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Source Fit runner binds exact concept/media/OCR/ASR artifacts to the benchmarked selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-source-fit-runner-"));
  try {
    const mediaPath = path.join(root, "media.mp4");
    const framePath = path.join(root, "frame.jpg");
    const ocrPath = path.join(root, "ocr.txt");
    const asrPath = path.join(root, "asr.txt");
    await writeFile(mediaPath, "exact-media-bytes");
    await writeFile(framePath, "exact-frame");
    await writeFile(ocrPath, "visible words");
    await writeFile(asrPath, "spoken words");
    const contentSha256 = sha256(await readFile(mediaPath));
    let invocations = 0;
    const result = await runProjectKingsSourceFitAssessment({
      repoRoot: root,
      runId: "source-fit-runner-test",
      candidateId: "candidate-source-fit-runner",
      profileKey: "dark-joy-boy",
      sourceUrl: "https://www.instagram.com/reel/sourcefitrunner/",
      provisionalStoryEventId: "provisional-source-fit-runner",
      media: {
        relativePath: "media.mp4",
        sizeBytes: 17,
        contentSha256,
        durationMs: 1_000,
        width: 320,
        height: 568,
        videoCodec: "h264",
        audioCodec: "aac",
        decodeComplete: true,
        decodeError: null
      },
      mediaPath,
      liveInventorySha256: sha256("inventory"),
      knownSourceSha256: [],
      knownStoryEventIds: [],
      discoveryEvidence: { donor: "kodyantle" },
      artifacts: [
        { id: "frame", kind: "key_frame", mediaType: "image", filePath: framePath, sha256: sha256(await readFile(framePath)) },
        { id: "ocr", kind: "ocr", mediaType: "text", filePath: ocrPath, sha256: sha256(await readFile(ocrPath)) },
        { id: "asr", kind: "transcript", mediaType: "text", filePath: asrPath, sha256: sha256(await readFile(asrPath)) }
      ],
      selection: selection("source_fit"),
      invoker: async (invocation) => {
        invocations += 1;
        assert.equal(invocation.role, "source_fit");
        assert.equal(invocation.route.routeId, "source_fit-primary");
        assert.ok(invocation.packet.artifacts.some((artifact) => artifact.kind === "concept_contract"));
        assert.ok(invocation.packet.artifacts.some((artifact) => artifact.kind === "ocr"));
        assert.ok(invocation.packet.artifacts.some((artifact) => artifact.kind === "transcript"));
        return {
          rawOutput: JSON.stringify({
            decision: "PASS",
            candidateId: "candidate-source-fit-runner",
            storyEventId: "event-source-fit-runner",
            conceptMatch: true,
            factualFit: true,
            duplicateVideo: false,
            duplicateEvent: false,
            sourceUsable: true,
            reason: "Exact packet passes all Source Fit gates.",
            factualClaims: []
          }),
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningOutputTokens: 5
          }
        };
      }
    });
    assert.equal(invocations, 1);
    assert.equal(result.output.decision, "PASS");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempt.model, "source_fit-primary");
    assert.equal(result.attestation.liveInventorySha256, sha256("inventory"));
    assert.match(result.packetBindingSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
