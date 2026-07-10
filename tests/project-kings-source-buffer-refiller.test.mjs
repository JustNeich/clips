import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SourceBufferRefillerError,
  acquireRefillerLock,
  createRefillerLogger,
  loadFrozenSourceBufferEvidence,
  loadSourceBufferRefillerConfig,
  readRefillerHealth,
  readSourceBufferRuntime,
  redactRefillerSecrets,
  releaseRefillerLock,
  tickSourceBufferRefiller,
  writeRefillerHealth
} from "../scripts/run-project-kings-source-buffer-refiller.mjs";

const PROFILE_KEYS = ["dark-joy-boy", "light-kingdom", "copscopes-x2e"];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function evidenceCandidate(profileKey, suffix) {
  const contentSha256 = createHash("sha256").update(`${profileKey}-${suffix}`).digest("hex");
  const approvalSha256 = createHash("sha256").update("synthetic-policy-approval").digest("hex");
  const designationEvidenceSha256 = createHash("sha256")
    .update(`designation:${profileKey}-${suffix}`)
    .digest("hex");
  const sensitiveAssessmentSha256 = createHash("sha256")
    .update(`assessment:${profileKey}-${suffix}`)
    .digest("hex");
  return {
    candidateId: `${profileKey}-${suffix}`,
    canonicalUrl: `https://www.instagram.com/reel/${profileKey}-${suffix}/`,
    qualificationStatus: "qualified",
    rightsStatus: "owner_approved_source_pool",
    qualificationEvidence: {
      schemaVersion: "project-kings-source-qualification-v2",
      contentSha256,
      eventFingerprint: `${profileKey}-event-${suffix}`,
      sourcePolicy: {
        discoveryState: "frozen_catalog",
        policyVersion: "project-kings-source-rights-sensitive-policy-v2",
        policySha256: "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39",
        approvalSha256,
        designationEvidenceSha256,
        sensitiveAssessmentSha256,
        policyVerdict: {
          disposition: "pass",
          eligibleForSourceFit: true,
          policySha256: "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39",
          policyApprovalSha256: approvalSha256,
          sourceDesignationEvidenceSha256: designationEvidenceSha256,
          sensitiveAssessmentSha256
        }
      }
    },
    localMedia: { selected: { relativePath: `.data/${profileKey}-${suffix}.mp4` } }
  };
}

function evidenceFixture(candidatesPerProfile = 1) {
  const payload = {
    schemaVersion: "project-kings-source-buffer-readiness-v1",
    capturedAt: "2026-07-10T00:00:00.000Z",
    channels: PROFILE_KEYS.map((profileKey) => ({
      profileKey,
      candidates: Array.from({ length: candidatesPerProfile }, (_, index) => evidenceCandidate(profileKey, index + 1))
    }))
  };
  const evidenceSha256 = createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
  return { ...payload, evidenceSha256 };
}

function runtimeFixture(counts = [6, 6, 6], candidates = {}) {
  return {
    schemaVersion: "project-kings-source-buffer-runtime-v1",
    ready: counts.every((count) => count >= 6),
    channels: PROFILE_KEYS.map((profileKey, index) => ({
      profileKey,
      channelId: `channel-${index}`,
      qualifiedAvailable: counts[index],
      refill: {
        shouldRefill: counts[index] < 6,
        readyBufferMin: 6,
        readyBufferCap: 12,
        candidateAttemptBudget: 9,
        candidatesToRequest: counts[index] < 6 ? 9 : 0
      },
      candidates: candidates[profileKey] ?? []
    }))
  };
}

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async text() { return JSON.stringify(payload); }
  };
}

function baseConfig(overrides = {}) {
  return {
    repoRoot: "/repo",
    configPath: "/config/refiller.env",
    authEnvPath: "/config/clips.env",
    appUrl: "https://clips.example.test",
    token: "machine-secret-token",
    armed: true,
    evidencePath: "/repo/evidence.json",
    pollIntervalMs: 60_000,
    blockedBackoffMs: 300_000,
    httpTimeoutMs: 30_000,
    maxHttpAttempts: 3,
    stateDir: "/state",
    statePath: "/state/health.json",
    lockPath: "/state/refiller.lock",
    killSwitchPath: "/state/DISABLED",
    ...overrides
  };
}

test("config loads private auth and a repository-bound frozen evidence path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "refiller-config-"));
  const repoRoot = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  try {
    await mkdir(path.join(homeDir, ".config", "assistant"), { recursive: true });
    await mkdir(path.join(repoRoot, "evidence"), { recursive: true });
    const evidencePath = path.join(repoRoot, "evidence", "ready.json");
    const authPath = path.join(homeDir, ".config", "assistant", "clips.env");
    const configPath = path.join(homeDir, ".config", "assistant", "refiller.env");
    await writeFile(evidencePath, JSON.stringify(evidenceFixture()));
    await writeFile(authPath, "CLIPS_APP_URL=https://clips.example.test\nCLIPS_MCP_TOKEN=secret\n", { mode: 0o600 });
    await writeFile(configPath, [
      `CLIPS_MCP_ENV_FILE=${authPath}`,
      "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_ARMED=1",
      "PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH=evidence/ready.json"
    ].join("\n"), { mode: 0o600 });
    const config = await loadSourceBufferRefillerConfig({ configPath, homeDir, repoRoot });
    assert.equal(config.armed, true);
    assert.equal(config.evidencePath, evidencePath);
    assert.equal(config.token, "secret");
    await chmod(authPath, 0o644);
    await assert.rejects(
      () => loadSourceBufferRefillerConfig({ configPath, homeDir, repoRoot }),
      (error) => error instanceof SourceBufferRefillerError && error.code === "env_file_permissions"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frozen evidence hash is verified before any sync", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "refiller-evidence-"));
  const evidencePath = path.join(root, "evidence.json");
  try {
    const evidence = evidenceFixture();
    await writeFile(evidencePath, JSON.stringify(evidence));
    assert.equal((await loadFrozenSourceBufferEvidence(evidencePath)).evidenceSha256, evidence.evidenceSha256);
    await writeFile(evidencePath, JSON.stringify({ ...evidence, capturedAt: "changed" }));
    await assert.rejects(
      () => loadFrozenSourceBufferEvidence(evidencePath),
      (error) => error instanceof SourceBufferRefillerError && error.code === "source_evidence_hash_mismatch"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime GET retries only 429/5xx within the bounded budget", async () => {
  const statuses = [429, 502, 200];
  const sleeps = [];
  const result = await readSourceBufferRuntime({
    appUrl: "https://clips.example.test",
    token: "secret",
    maxAttempts: 3,
    random: () => 0,
    sleep: async (delayMs) => { sleeps.push(delayMs); },
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://clips.example.test/api/admin/project-kings/source-buffer");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, "Bearer secret");
      const status = statuses.shift();
      return response(status, status === 200 ? runtimeFixture() : { error: `temporary-${status}` });
    }
  });
  assert.equal(result.ready, true);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test("runtime GET treats 401/403 as immediate fail-closed blockers", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    let captured;
    await assert.rejects(
      () => readSourceBufferRuntime({
        appUrl: "https://clips.example.test",
        token: "secret",
        maxAttempts: 3,
        sleep: async () => assert.fail("auth failure must not retry"),
        fetchImpl: async () => {
          calls += 1;
          return response(status, { error: `secret auth ${status}` });
        }
      }),
      (error) => {
        captured = error;
        return error instanceof SourceBufferRefillerError && error.code === "machine_auth_blocked";
      }
    );
    assert.equal(calls, 1);
    assert.equal(captured.message.includes("secret"), false);
  }
});

test("kill switch and disarmed state perform no GET or sync", async () => {
  for (const scenario of [
    { config: baseConfig(), exists: true, status: "disabled" },
    { config: baseConfig({ armed: false }), exists: false, status: "disarmed" }
  ]) {
    let reads = 0;
    let syncs = 0;
    const health = await tickSourceBufferRefiller({
      config: scenario.config,
      state: {},
      fileExists: async () => scenario.exists,
      loadEvidence: async () => evidenceFixture(),
      readRuntime: async () => { reads += 1; },
      sync: async () => { syncs += 1; }
    });
    assert.equal(health.status, scenario.status);
    assert.equal(reads, 0);
    assert.equal(syncs, 0);
  }
});

test("ready 6/6/6 buffer skips sync", async () => {
  let syncs = 0;
  const health = await tickSourceBufferRefiller({
    config: baseConfig(),
    state: {},
    fileExists: async () => false,
    loadEvidence: async () => evidenceFixture(),
    readRuntime: async () => runtimeFixture([6, 6, 6]),
    sync: async () => { syncs += 1; }
  });
  assert.equal(health.status, "ready");
  assert.equal(health.ready, true);
  assert.equal(syncs, 0);
});

test("a deficit invokes the checked-in sync contract once", async () => {
  let syncInput;
  const health = await tickSourceBufferRefiller({
    config: baseConfig(),
    state: {},
    fileExists: async () => false,
    loadEvidence: async () => evidenceFixture(),
    readRuntime: async () => runtimeFixture([5, 6, 6]),
    sync: async (input) => {
      syncInput = input;
      return {
        ready: true,
        attempted: 1,
        created: 1,
        existing: 0,
        channels: [
          { profileKey: "dark-joy-boy", qualifiedAvailable: 6, deficit: 0 },
          { profileKey: "light-kingdom", qualifiedAvailable: 6, deficit: 0 },
          { profileKey: "copscopes-x2e", qualifiedAvailable: 6, deficit: 0 }
        ]
      };
    }
  });
  assert.deepEqual(syncInput, {
    evidencePath: "/repo/evidence.json",
    runtime: { appUrl: "https://clips.example.test", token: "machine-secret-token" }
  });
  assert.equal(health.status, "ready");
  assert.deepEqual(health.sync, { attempted: 1, created: 1, existing: 0 });
  assert.equal(JSON.stringify(health).includes("machine-secret-token"), false);
});

test("exhausted frozen evidence reports exact source_catalog_exhausted without upload", async () => {
  const candidate = evidenceCandidate("dark-joy-boy", 1);
  let syncs = 0;
  const health = await tickSourceBufferRefiller({
    config: baseConfig(),
    state: {},
    fileExists: async () => false,
    loadEvidence: async () => evidenceFixture(),
    readRuntime: async () => runtimeFixture([5, 6, 6], {
      "dark-joy-boy": [{
        canonicalUrl: candidate.canonicalUrl,
        contentSha256: candidate.qualificationEvidence.contentSha256,
        eventFingerprint: candidate.qualificationEvidence.eventFingerprint
      }]
    }),
    sync: async () => { syncs += 1; }
  });
  assert.equal(health.status, "blocked");
  assert.equal(health.blockerCode, "source_catalog_exhausted");
  assert.equal(health.blocker, "source_catalog_exhausted");
  assert.equal(syncs, 0);
});

test("a partial sync ends in exact exhaustion and identical next tick does not upload-loop", async () => {
  let syncs = 0;
  const common = {
    config: baseConfig(),
    fileExists: async () => false,
    loadEvidence: async () => evidenceFixture(),
    readRuntime: async () => runtimeFixture([4, 6, 6]),
    sync: async () => {
      syncs += 1;
      return {
        ready: false,
        attempted: 1,
        created: 1,
        existing: 0,
        channels: [
          { profileKey: "dark-joy-boy", qualifiedAvailable: 5, deficit: 1 },
          { profileKey: "light-kingdom", qualifiedAvailable: 6, deficit: 0 },
          { profileKey: "copscopes-x2e", qualifiedAvailable: 6, deficit: 0 }
        ]
      };
    }
  };
  const first = await tickSourceBufferRefiller({ ...common, state: {} });
  assert.equal(first.blockerCode, "source_catalog_exhausted");
  const second = await tickSourceBufferRefiller({
    ...common,
    state: first,
    readRuntime: async () => runtimeFixture([5, 6, 6], {
      "dark-joy-boy": [{
        canonicalUrl: evidenceCandidate("dark-joy-boy", 1).canonicalUrl,
        contentSha256: evidenceCandidate("dark-joy-boy", 1).qualificationEvidence.contentSha256,
        eventFingerprint: evidenceCandidate("dark-joy-boy", 1).qualificationEvidence.eventFingerprint
      }]
    })
  });
  assert.equal(second.blockerCode, "source_catalog_exhausted");
  assert.equal(syncs, 1);
});

test("an oversized frozen catalog is bounded by sync instead of blocking refill", async () => {
  let syncs = 0;
  const health = await tickSourceBufferRefiller({
    config: baseConfig(),
    state: {},
    fileExists: async () => false,
    loadEvidence: async () => evidenceFixture(13),
    readRuntime: async () => runtimeFixture([0, 6, 6]),
    sync: async () => {
      syncs += 1;
      return {
        ready: true,
        attempted: 12,
        created: 12,
        existing: 0,
        channels: [
          { profileKey: "dark-joy-boy", qualifiedAvailable: 12, deficit: 0 },
          { profileKey: "light-kingdom", qualifiedAvailable: 6, deficit: 0 },
          { profileKey: "copscopes-x2e", qualifiedAvailable: 6, deficit: 0 }
        ]
      };
    }
  });
  assert.equal(health.status, "ready");
  assert.equal(health.blockerCode, null);
  assert.equal(syncs, 1);
});

test("post-sync cap violation is fail-visible and stops further work", async () => {
  const health = await tickSourceBufferRefiller({
    config: baseConfig(),
    state: {},
    fileExists: async () => false,
    loadEvidence: async () => evidenceFixture(),
    readRuntime: async () => runtimeFixture([5, 6, 6]),
    sync: async () => ({
      ready: true,
      attempted: 1,
      created: 1,
      existing: 0,
      channels: [
        { profileKey: "dark-joy-boy", qualifiedAvailable: 13, deficit: 0 },
        { profileKey: "light-kingdom", qualifiedAvailable: 6, deficit: 0 },
        { profileKey: "copscopes-x2e", qualifiedAvailable: 6, deficit: 0 }
      ]
    })
  });
  assert.equal(health.blockerCode, "source_buffer_cap_exceeded");
  assert.equal(health.status, "blocked");
});

test("health file is 0600, credential-free and rejects secret-like fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "refiller-health-"));
  const statePath = path.join(root, "state", "health.json");
  try {
    const health = await tickSourceBufferRefiller({
      config: baseConfig(),
      state: {},
      fileExists: async () => false,
      loadEvidence: async () => evidenceFixture(),
      readRuntime: async () => runtimeFixture()
    });
    await writeRefillerHealth(statePath, health);
    assert.deepEqual(await readRefillerHealth(statePath), health);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    assert.equal((await readFile(statePath, "utf8")).includes("machine-secret-token"), false);
    await assert.rejects(
      () => writeRefillerHealth(statePath, { ...health, token: "forbidden" }),
      (error) => error instanceof SourceBufferRefillerError && error.code === "state_contains_credential"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("logs redact machine secrets and local lock is single-owner", async () => {
  const secret = "machine-secret-token";
  assert.equal(redactRefillerSecrets(`Bearer ${secret} ${secret}`, [secret]), "Bearer [REDACTED] [REDACTED]");
  const lines = [];
  const logger = createRefillerLogger({ secrets: [secret], write: (line) => lines.push(line) });
  logger("failure", { message: secret, authorization: `Bearer ${secret}` });
  assert.equal(lines.join("\n").includes(secret), false);

  const root = await mkdtemp(path.join(os.tmpdir(), "refiller-lock-"));
  try {
    const lock = await acquireRefillerLock(path.join(root, "refiller.lock"));
    await assert.rejects(
      () => acquireRefillerLock(lock.lockPath),
      (error) => error instanceof SourceBufferRefillerError && error.code === "refiller_already_running"
    );
    assert.equal(await releaseRefillerLock(lock), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
