import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  ProductionStoreError,
  ackProductionOutbox,
  ackProductionOutboxAsSupersededGeneration,
  appendProductionOutbox,
  buildProductionOutboxDedupeKey,
  buildProductionPublicVerificationOutboxIntent,
  calculateChannelSourceQualificationEvidenceSha256,
  calculateQualityVerdictBindingSha256,
  cancelProductionRun,
  claimProductionItemLease,
  claimProductionOutbox,
  claimProductionRunLease,
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  createReplacementProductionItem,
  getLatestQualityVerdictForArtifact,
  getProductionItem,
  getProductionRunChannelCandidateAttemptCount,
  getProductionRun,
  isChannelSourceCandidateQualified,
  listChannelSourceCandidates,
  listProductionEvents,
  listProductionItems,
  listProductionOutbox,
  listProductionRunChannelAttemptedCandidateIds,
  listProductionRunChannels,
  recordAgentAttempt,
  recordPublicVerification,
  recordQualityVerdict,
  releaseChannelSourceCandidate,
  releaseProductionItemLease,
  releaseProductionRunLease,
  renewProductionItemLease,
  renewProductionRunLease,
  reserveChannelSourceCandidate,
  reserveChannelSourceCandidatesAtomically,
  retryProductionOutbox,
  transitionChannelSourceCandidateQualification,
  transitionProductionItem,
  transitionProductionRun,
  transitionProductionRunChannel,
  upsertChannelSourceCandidate,
  type ProductionItemRecord,
  type ProductionRunChannelRecord,
  type ProductionRunRecord
} from "../lib/portfolio-production-store";
import { reconcilePortfolioProductionRun } from "../lib/portfolio-production-orchestrator";
import { bootstrapOwner } from "../lib/team-store";

const HASH = {
  profile: "1".repeat(64),
  portfolio: "2".repeat(64),
  manifest: "3".repeat(64),
  template: "4".repeat(64),
  source: "5".repeat(64),
  preview: "6".repeat(64),
  settings: "7".repeat(64),
  final: "8".repeat(64),
  prompt: "9".repeat(64),
  output: "a".repeat(64),
  changedTemplate: "b".repeat(64),
  changedPreview: "c".repeat(64)
} as const;

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-store-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function seedPortfolio(input: { channelCount?: number; targetPerChannel?: number } = {}): Promise<{
  workspaceId: string;
  userId: string;
  channels: Array<{ id: string }>;
  run: ProductionRunRecord;
  runChannels: ProductionRunChannelRecord[];
}> {
  const owner = await bootstrapOwner({
    workspaceName: "Portfolio Store",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channels = [];
  const requestedCount = input.channelCount ?? 1;
  for (let index = 0; index < requestedCount; index += 1) {
    channels.push(await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: `Channel ${index + 1}`,
      username: `portfolio-${index + 1}`
    }));
  }
  const profiles = channels.map((channel, index) => createProductionProfile({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    version: 1,
    status: "active",
    profileHash: index === 0 ? HASH.profile : `${index + 2}`.repeat(64).slice(0, 64),
    expectedYoutubeChannelId: `UC-portfolio-${index + 1}`,
    expectedDestinationTitle: `Destination ${index + 1}`,
    templateId: `template-${index + 1}`,
    templateSnapshotSha256: HASH.template,
    publishPolicyId: "project-kings-daily-3x3-v1",
    qualityPolicyId: "quality-v1",
    modelRouteManifestId: "models-v1",
    modelRouteManifestSha256: "1".repeat(64),
    targetPerLogicalDay: input.targetPerChannel ?? 3,
    readyBufferMin: 6,
    readyBufferCap: 12,
    candidateAttemptBudget: 9,
    config: { channel: index + 1 },
    approvedAt: "2026-07-10T00:00:00.000Z",
    approvedByUserId: owner.user.id
  }));
  const created = createOrGetProductionRun({
    workspaceId: owner.workspace.id,
    portfolioProfileHash: HASH.portfolio,
    logicalDate: "2026-07-10",
    mode: "simulation",
    targetPerChannel: input.targetPerChannel ?? 3,
    manifestHash: HASH.manifest,
    manifest: { profileIds: profiles.map((profile) => profile.id) },
    idempotencyKey: "request-1",
    channels: profiles.map((profile) => ({
      channelId: profile.channelId,
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: profile.profileHash,
      expectedYoutubeChannelId: profile.expectedYoutubeChannelId
    }))
  });
  return {
    workspaceId: owner.workspace.id,
    userId: owner.user.id,
    channels,
    run: created.run,
    runChannels: listProductionRunChannels(created.run.id)
  };
}

function assertStoreError(code: ProductionStoreError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ProductionStoreError && error.code === code;
}

function createCandidate(input: { workspaceId: string; channelId: string; suffix: string; event?: string }) {
  const evidence = { donor: "test", qualifiedBy: "portfolio-store-fixture" };
  const discovered = upsertChannelSourceCandidate({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    provider: "instagram",
    sourceUrl: `https://www.instagram.com/reel/${input.suffix}/`,
    canonicalUrl: `https://www.instagram.com/reel/${input.suffix}/`,
    contentSha256: createHash("sha256").update(input.suffix).digest("hex"),
    eventFingerprint: input.event ?? `event-${input.suffix}`,
    categoryKey: "bodycam-incident",
    rightsStatus: "owner_approved_source_pool",
    evidence: { donor: "test" }
  }).candidate;
  return transitionChannelSourceCandidateQualification({
    candidateId: discovered.id,
    toStatus: "qualified",
    contentSha256: discovered.contentSha256,
    eventFingerprint: discovered.eventFingerprint,
    evidence
  });
}

function reserveAndIngest(input: {
  item: ProductionItemRecord;
  workspaceId: string;
  channelId: string;
  suffix: string;
}): ProductionItemRecord {
  const candidate = createCandidate(input);
  const reserved = reserveChannelSourceCandidate({
    candidateId: candidate.id,
    itemId: input.item.id,
    expectedItemVersion: input.item.version
  });
  return transitionProductionItem({
    itemId: reserved.item.id,
    expectedVersion: reserved.item.version,
    toState: "source_ingested",
    eventType: "source.ingested",
    patch: { sourceSha256: HASH.source }
  });
}

function recordCombinedPass(item: ProductionItemRecord, gateType: "source" | "preview" | "final", attemptNo = 1) {
  const artifactSha256 = gateType === "source"
    ? item.sourceSha256!
    : gateType === "preview"
      ? item.previewSha256!
      : item.finalArtifactSha256!;
  const bindingSha256 = calculateQualityVerdictBindingSha256({
    gateType,
    artifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256
  });
  const role = gateType === "source" ? "source_fit" : "vision_qa";
  const attempt = recordAgentAttempt({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    role,
    attemptNo,
    model: "quality-test-model",
    reasoningLevel: "none",
    promptHash: sha(`prompt:${gateType}:${attemptNo}`),
    qualityBindingSha256: bindingSha256,
    outputHash: sha(`output:${gateType}:${attemptNo}`),
    status: "passed",
    verdict: "pass",
    startedAt: "2026-07-10T00:00:00.000Z",
    finishedAt: "2026-07-10T00:00:00.001Z"
  });
  const common = {
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType,
    verdict: "pass" as const,
    attemptNo,
    artifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    defects: []
  };
  recordQualityVerdict({
    ...common,
    judgeKind: "deterministic",
    evidenceSha256: sha(`probe:${gateType}:${attemptNo}`),
    evidenceArtifactPath: `/quality-tests/${item.id}/${gateType}-probe-${attemptNo}.json`
  });
  recordQualityVerdict({
    ...common,
    judgeKind: gateType === "source" ? "semantic" : "vision",
    agentAttemptId: attempt.id,
    evidenceSha256: sha(`agent:${gateType}:${attemptNo}`),
    evidenceArtifactPath: `/quality-tests/${item.id}/${gateType}-agent-${attemptNo}.json`
  });
  return getLatestQualityVerdictForArtifact({
    productionItemId: item.id,
    gateType,
    judgeKind: "combined",
    artifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256
  })!;
}

function advanceToScheduled(input: {
  item: ProductionItemRecord;
  workspaceId: string;
  channelId: string;
  suffix: string;
  publicationId: string;
  youtubeVideoId?: string;
}): ProductionItemRecord {
  let item = reserveAndIngest(input);
  recordCombinedPass(item, "source");
  item = transitionProductionItem({
    itemId: item.id, expectedVersion: item.version, toState: "source_qualified", eventType: "source.qualified"
  });
  item = transitionProductionItem({
    itemId: item.id, expectedVersion: item.version, toState: "brief_ready", eventType: "brief.ready"
  });
  item = transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "preview_ready",
    eventType: "preview.ready",
    patch: { previewSha256: HASH.preview, templateSha256: HASH.template, settingsSha256: HASH.settings }
  });
  recordCombinedPass(item, "preview");
  item = transitionProductionItem({
    itemId: item.id, expectedVersion: item.version, toState: "preview_approved", eventType: "preview.approved"
  });
  item = transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "final_rendered",
    eventType: "final.rendered",
    patch: { finalArtifactSha256: HASH.final }
  });
  recordCombinedPass(item, "final", 2);
  item = transitionProductionItem({
    itemId: item.id, expectedVersion: item.version, toState: "final_approved", eventType: "final.approved"
  });
  return transitionProductionItem({
    itemId: item.id,
    expectedVersion: item.version,
    toState: "publication_scheduled",
    eventType: "publication.scheduled",
    patch: {
      publicationId: input.publicationId,
      ...(input.youtubeVideoId ? { youtubeVideoId: input.youtubeVideoId } : {})
    }
  });
}

test("additive schema, business idempotency, and append-only events are enforced", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ channelCount: 2 });
    const expectedTables = [
      "agent_attempts",
      "channel_source_candidates",
      "production_events",
      "production_items",
      "production_outbox",
      "production_profiles",
      "production_run_channels",
      "production_runs",
      "public_verifications",
      "quality_verdicts"
    ];
    const actualTables = (getDb().prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${expectedTables.map(() => "?").join(",")}) ORDER BY name`)
      .all(...expectedTables) as Array<{ name: string }>).map((row) => row.name);
    assert.deepEqual(actualTables, [...expectedTables].sort());
    assert.deepEqual(getDb().prepare("PRAGMA foreign_key_check").all(), []);
    const sourceColumns = (getDb().prepare("PRAGMA table_info(channel_source_candidates)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.ok(sourceColumns.includes("qualification_status"));
    assert.ok(sourceColumns.includes("qualification_evidence_sha256"));
    assert.equal(seeded.runChannels.length, 2);

    const profiles = seeded.runChannels.map((channel) => ({
      channelId: channel.channelId,
      profileId: channel.profileId,
      profileVersion: channel.profileVersion,
      profileHash: channel.profileHash,
      expectedYoutubeChannelId: channel.expectedYoutubeChannelId
    }));
    const replay = createOrGetProductionRun({
      workspaceId: seeded.workspaceId,
      portfolioProfileHash: HASH.portfolio,
      logicalDate: "2026-07-10",
      mode: "simulation",
      targetPerChannel: 3,
      manifestHash: HASH.manifest,
      manifest: { ignoredOnReplay: true },
      idempotencyKey: "a-second-transport-key",
      channels: profiles
    });
    assert.equal(replay.existing, true);
    assert.equal(replay.run.id, seeded.run.id);

    assert.throws(() => createOrGetProductionRun({
      workspaceId: seeded.workspaceId,
      portfolioProfileHash: "f".repeat(64),
      logicalDate: "2026-07-11",
      mode: "simulation",
      targetPerChannel: 3,
      manifestHash: HASH.manifest,
      manifest: {},
      idempotencyKey: "request-1",
      channels: profiles
    }), assertStoreError("idempotency_conflict"));

    const event = listProductionEvents({ runId: seeded.run.id })[0];
    assert.equal(event.eventType, "production.run.created");
    assert.throws(() => getDb().prepare("UPDATE production_events SET event_type = 'tampered' WHERE id = ?").run(event.id),
      /production_events_append_only/);
    assert.throws(() => getDb().prepare("DELETE FROM production_events WHERE id = ?").run(event.id),
      /production_events_append_only/);
  });
});

test("legacy run-status CHECK rebuild preserves items and durable outbox rows", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    const item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const originalOutbox = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "source_fit.requested",
      dedupeKey: "legacy-status-migration-source-fit",
      payload: { candidateId: "legacy-candidate" },
      maxAttempts: 3
    });
    const legacyDb = getDb();
    legacyDb.exec("PRAGMA foreign_keys = OFF");
    legacyDb.exec("BEGIN IMMEDIATE");
    legacyDb.exec(`CREATE TABLE production_runs_legacy (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, portfolio_profile_hash TEXT NOT NULL,
      logical_date TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('simulation', 'shadow', 'live')),
      status TEXT NOT NULL CHECK (status IN ('created', 'preflight', 'ready', 'running', 'waiting_public', 'completed', 'blocked', 'canceled', 'failed')),
      target_per_channel INTEGER NOT NULL, manifest_hash TEXT NOT NULL, manifest_json TEXT NOT NULL,
      request_idempotency_key TEXT, version INTEGER NOT NULL DEFAULT 1, lease_owner TEXT,
      lease_token TEXT, lease_expires_at TEXT, last_error TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE (workspace_id, portfolio_profile_hash, logical_date, mode),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE production_run_channels_legacy (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, workspace_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      profile_id TEXT NOT NULL, profile_version INTEGER NOT NULL, profile_hash TEXT NOT NULL,
      expected_youtube_channel_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'preflight', 'ready', 'running', 'waiting_public', 'completed', 'blocked', 'canceled', 'failed')),
      target_count INTEGER NOT NULL, public_verified_count INTEGER NOT NULL DEFAULT 0,
      next_slot_at TEXT, blocker_code TEXT, blocker_message TEXT, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE (run_id, channel_id),
      FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES production_profiles(id) ON DELETE RESTRICT
    );
    INSERT INTO production_runs_legacy
      SELECT * FROM production_runs;
    INSERT INTO production_run_channels_legacy
      SELECT * FROM production_run_channels;
    DROP TRIGGER IF EXISTS channel_publications_portfolio_ownership_fence;
    DROP TABLE production_run_channels;
    DROP TABLE production_runs;
    ALTER TABLE production_runs_legacy RENAME TO production_runs;
    ALTER TABLE production_run_channels_legacy RENAME TO production_run_channels;
    COMMIT;
    PRAGMA foreign_keys = ON;`);
    legacyDb.close();
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

    const migratedDb = getDb();
    const migratedRunSql = String((migratedDb.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'production_runs'"
    ).get() as { sql: string }).sql);
    assert.match(migratedRunSql, /cancel_requested/);
    assert.equal(getProductionItem(item.id)?.id, item.id);
    assert.equal(listProductionOutbox({ runId: seeded.run.id })
      .some((entry) => entry.id === originalOutbox.id && entry.dedupeKey === originalOutbox.dedupeKey), true);
    assert.deepEqual(migratedDb.prepare("PRAGMA foreign_key_check").all(), []);

    const canceled = cancelProductionRun({
      runId: seeded.run.id,
      expectedVersion: seeded.run.version,
      reason: "migration verification"
    });
    assert.equal(canceled.run.status, "cancel_requested");
  });
});

test("existing agent attempts and source candidates receive additive evidence columns", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const legacyDb = new DatabaseSync(path.join(process.env.APP_DATA_DIR!, "app.db"));
    legacyDb.exec(`CREATE TABLE agent_attempts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      production_item_id TEXT NOT NULL,
      role TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      model TEXT NOT NULL,
      reasoning_level TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      output_hash TEXT,
      artifact_ids_json TEXT NOT NULL,
      status TEXT NOT NULL,
      outcome TEXT,
      verdict TEXT,
      error_code TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_micros INTEGER,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL
    )`);
    legacyDb.exec(`CREATE TABLE channel_source_candidates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      source_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      content_sha256 TEXT,
      event_fingerprint TEXT,
      category_key TEXT NOT NULL,
      rights_status TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      reserved_item_id TEXT,
      reserved_at TEXT,
      consumed_at TEXT,
      quarantined_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO channel_source_candidates
      (id, workspace_id, channel_id, provider, source_url, canonical_url, category_key,
       rights_status, status, evidence_json, created_at, updated_at)
    VALUES
      ('legacy-source', 'legacy-workspace', 'legacy-channel', 'instagram',
       'https://instagram.com/reel/legacy', 'https://instagram.com/reel/legacy',
       'legacy-category', 'owner_approved_source_pool', 'available', '{}',
       '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z')`);
    legacyDb.close();

    const columns = (getDb().prepare("PRAGMA table_info(agent_attempts)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.ok(columns.includes("cached_input_tokens"));
    assert.ok(columns.includes("reasoning_output_tokens"));
    assert.ok(columns.includes("cost_unit"));
    assert.ok(columns.includes("quality_binding_sha256"));
    assert.ok(columns.includes("stage3_job_id"));
    assert.equal(
      (getDb().prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_attempts_stage3_job'"
      ).get() as { present?: number } | undefined)?.present,
      1
    );
    const sourceColumns = (getDb().prepare("PRAGMA table_info(channel_source_candidates)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.ok(sourceColumns.includes("qualification_status"));
    assert.ok(sourceColumns.includes("qualification_evidence_sha256"));
    const legacySource = getDb().prepare(`SELECT qualification_status AS qualificationStatus,
      qualification_evidence_sha256 AS qualificationEvidenceSha256
      FROM channel_source_candidates WHERE id = 'legacy-source'`).get() as {
        qualificationStatus: string;
        qualificationEvidenceSha256: string | null;
      };
    assert.equal(legacySource.qualificationStatus, "pending");
    assert.equal(legacySource.qualificationEvidenceSha256, null);
  });
});

test("legacy synthetic combined verdicts are invalidated by the evidence-binding migration", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    const item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const activeDb = (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb!;
    activeDb.close();
    delete (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb;
    const raw = new DatabaseSync(path.join(process.env.APP_DATA_DIR!, "app.db"));
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.exec(`DROP INDEX IF EXISTS idx_quality_verdicts_item_gate_hash;
      DROP TABLE quality_verdicts;
      CREATE TABLE quality_verdicts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        production_item_id TEXT NOT NULL,
        gate_type TEXT NOT NULL CHECK (gate_type IN ('source', 'preview', 'final')),
        judge_kind TEXT NOT NULL CHECK (judge_kind IN ('deterministic', 'vision', 'combined')),
        verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
        attempt_no INTEGER NOT NULL,
        artifact_sha256 TEXT NOT NULL,
        source_sha256 TEXT,
        preview_sha256 TEXT,
        template_sha256 TEXT,
        settings_sha256 TEXT,
        agent_attempt_id TEXT,
        defects_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (production_item_id, gate_type, judge_kind, artifact_sha256, attempt_no)
      );
      INSERT INTO quality_verdicts
        (id, workspace_id, run_id, production_item_id, gate_type, judge_kind, verdict, attempt_no,
         artifact_sha256, source_sha256, defects_json, created_at)
      VALUES
        ('legacy-deterministic', '${item.workspaceId}', '${item.runId}', '${item.id}', 'source',
         'deterministic', 'pass', 1, '${HASH.source}', '${HASH.source}', '[]', '2026-07-10T00:00:00.000Z'),
        ('legacy-combined', '${item.workspaceId}', '${item.runId}', '${item.id}', 'source',
         'combined', 'pass', 1, '${HASH.source}', '${HASH.source}', '[]', '2026-07-10T00:00:00.000Z');`);
    raw.close();

    const migrated = getDb();
    const columns = (migrated.prepare("PRAGMA table_info(quality_verdicts)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.ok(columns.includes("evidence_sha256"));
    assert.ok(columns.includes("evidence_artifact_path"));
    const table = migrated.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quality_verdicts'"
    ).get() as { sql: string };
    assert.match(table.sql, /'semantic'/);
    assert.doesNotMatch(table.sql, /'combined'/);
    assert.equal(
      Number((migrated.prepare("SELECT COUNT(*) AS count FROM quality_verdicts WHERE id = 'legacy-combined'").get() as { count: number }).count),
      0
    );
    const retained = migrated.prepare(
      "SELECT evidence_sha256 AS evidenceSha256 FROM quality_verdicts WHERE id = 'legacy-deterministic'"
    ).get() as { evidenceSha256: string | null };
    assert.equal(retained.evidenceSha256, null);
  });
});

test("legacy outbox rows migrate without data loss and remove the one-event-kind-per-item limit", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    const item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const original = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey: buildProductionOutboxDedupeKey("revision.requested", { attemptNo: 1 }),
      payload: { attemptNo: 1 },
      maxAttempts: 5,
      availableAt: "2026-07-10T00:00:00.000Z"
    });
    const activeDb = (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb!;
    activeDb.close();
    delete (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb;
    const raw = new DatabaseSync(path.join(process.env.APP_DATA_DIR!, "app.db"));
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.exec(`BEGIN IMMEDIATE;
      CREATE TABLE production_outbox_legacy (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        production_item_id TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT,
        UNIQUE (production_item_id, event_kind)
      );
      INSERT INTO production_outbox_legacy
        (id, workspace_id, run_id, channel_id, production_item_id, event_kind, payload_json,
         status, attempts, max_attempts, available_at, lease_owner, lease_token, lease_expires_at,
         last_error, created_at, updated_at, delivered_at)
      SELECT id, workspace_id, run_id, channel_id, production_item_id, event_kind, payload_json,
         status, attempts, max_attempts, available_at, lease_owner, lease_token, lease_expires_at,
         last_error, created_at, updated_at, delivered_at
      FROM production_outbox;
      DROP TABLE production_outbox;
      ALTER TABLE production_outbox_legacy RENAME TO production_outbox;
      COMMIT`);
    raw.close();

    const migrated = listProductionOutbox({ runId: item.runId, productionItemId: item.id });
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0]?.id, original.id);
    assert.equal(migrated[0]?.eventKind, original.eventKind);
    assert.deepEqual(migrated[0]?.payload, original.payload);
    assert.equal(migrated[0]?.maxAttempts, 5);
    assert.equal(migrated[0]?.dedupeKey, `revision.requested:legacy:${original.id}`);
    const second = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey: buildProductionOutboxDedupeKey("revision.requested", { attemptNo: 2 }),
      payload: { attemptNo: 2 }
    });
    assert.notEqual(second.id, original.id);
    assert.equal(listProductionOutbox({ runId: item.runId, productionItemId: item.id }).length, 2);
    assert.deepEqual(getDb().prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("source qualification is explicit, hash-bound, immutable, and fail-closed", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 2 });
    const firstItem = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const discovered = upsertChannelSourceCandidate({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      provider: "instagram",
      sourceUrl: "https://instagram.com/reel/discovered-source",
      canonicalUrl: "https://instagram.com/reel/discovered-source",
      categoryKey: "bodycam-incident",
      rightsStatus: "owner_approved_source_pool",
      evidence: { discoveredBy: "fixture" }
    }).candidate;
    assert.equal(discovered.qualificationStatus, "discovered");
    assert.equal(isChannelSourceCandidateQualified(discovered), false);
    assert.throws(() => reserveChannelSourceCandidate({
      candidateId: discovered.id,
      itemId: firstItem.id,
      expectedItemVersion: firstItem.version
    }), assertStoreError("source_conflict"));

    const pending = transitionChannelSourceCandidateQualification({
      candidateId: discovered.id,
      toStatus: "pending"
    });
    assert.equal(pending.qualificationStatus, "pending");
    assert.throws(() => reserveChannelSourceCandidate({
      candidateId: pending.id,
      itemId: firstItem.id,
      expectedItemVersion: firstItem.version
    }), assertStoreError("source_conflict"));
    assert.throws(() => transitionChannelSourceCandidateQualification({
      candidateId: discovered.id,
      toStatus: "qualified",
      contentSha256: sha("qualified-content"),
      eventFingerprint: "qualified-event",
      evidence: {}
    }), assertStoreError("invalid_input"));

    const qualificationEvidence = {
      decodePassed: true,
      sourceFitVerdict: "PASS",
      evidenceVersion: "source-qualification-v1"
    };
    const qualified = transitionChannelSourceCandidateQualification({
      candidateId: discovered.id,
      toStatus: "qualified",
      contentSha256: sha("qualified-content"),
      eventFingerprint: "qualified-event",
      evidence: qualificationEvidence
    });
    assert.equal(qualified.qualificationStatus, "qualified");
    assert.equal(
      qualified.qualificationEvidenceSha256,
      calculateChannelSourceQualificationEvidenceSha256(qualificationEvidence)
    );
    assert.equal(isChannelSourceCandidateQualified(qualified), true);
    assert.equal(transitionChannelSourceCandidateQualification({
      candidateId: qualified.id,
      toStatus: "qualified",
      contentSha256: qualified.contentSha256,
      eventFingerprint: qualified.eventFingerprint,
      evidence: qualificationEvidence
    }).id, qualified.id);
    const reserved = reserveChannelSourceCandidate({
      candidateId: qualified.id,
      itemId: firstItem.id,
      expectedItemVersion: firstItem.version
    });
    assert.equal(reserved.candidate.status, "reserved");
    assert.equal(reserved.candidate.qualificationStatus, "qualified");

    const secondItem = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 2
    });
    const tampered = createCandidate({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "tampered-evidence"
    });
    getDb().prepare("UPDATE channel_source_candidates SET evidence_json = '{}' WHERE id = ?").run(tampered.id);
    const rereadTampered = listChannelSourceCandidates({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id
    }).find((candidate) => candidate.id === tampered.id)!;
    assert.equal(isChannelSourceCandidateQualified(rereadTampered), false);
    assert.throws(() => reserveChannelSourceCandidate({
      candidateId: tampered.id,
      itemId: secondItem.id,
      expectedItemVersion: secondItem.version
    }), assertStoreError("source_conflict"));

    for (const terminalStatus of ["rejected", "quarantined"] as const) {
      const terminal = upsertChannelSourceCandidate({
        workspaceId: seeded.workspaceId,
        channelId: seeded.channels[0].id,
        provider: "instagram",
        sourceUrl: `https://instagram.com/reel/${terminalStatus}-source`,
        canonicalUrl: `https://instagram.com/reel/${terminalStatus}-source`,
        categoryKey: "bodycam-incident",
        rightsStatus: "owner_approved_source_pool",
        evidence: { discoveredBy: "fixture" }
      }).candidate;
      const closed = transitionChannelSourceCandidateQualification({
        candidateId: terminal.id,
        toStatus: terminalStatus,
        reason: `fixture ${terminalStatus}`
      });
      assert.equal(closed.status, terminalStatus);
      assert.equal(closed.qualificationStatus, terminalStatus);
      assert.equal(isChannelSourceCandidateQualified(closed), false);
      assert.throws(() => reserveChannelSourceCandidate({
        candidateId: closed.id,
        itemId: secondItem.id,
        expectedItemVersion: secondItem.version
      }), assertStoreError("source_conflict"));
      assert.throws(() => transitionChannelSourceCandidateQualification({
        candidateId: closed.id,
        toStatus: "pending"
      }), assertStoreError("source_conflict"));
    }
  });
});

test("run-channel source budget counts distinct candidates once and refuses candidate ten", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    let item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const candidates = Array.from({ length: 10 }, (_, index) => createCandidate({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: `budget-${index + 1}`
    }));

    for (const candidate of candidates.slice(0, 9)) {
      const reserved = reserveChannelSourceCandidate({
        candidateId: candidate.id,
        itemId: item.id,
        expectedItemVersion: item.version
      });
      item = releaseChannelSourceCandidate({
        candidateId: candidate.id,
        itemId: item.id,
        expectedItemVersion: reserved.item.version,
        reason: "candidate rejected by the bounded test"
      }).item;
    }

    assert.equal(getProductionRunChannelCandidateAttemptCount(seeded.runChannels[0].id), 9);
    assert.deepEqual(
      listProductionRunChannelAttemptedCandidateIds(seeded.runChannels[0].id),
      candidates.slice(0, 9).map((candidate) => candidate.id).sort()
    );
    assert.throws(() => reserveChannelSourceCandidate({
      candidateId: candidates[9]!.id,
      itemId: item.id,
      expectedItemVersion: item.version
    }), assertStoreError("source_budget_exhausted"));
    assert.equal(getProductionRunChannelCandidateAttemptCount(seeded.runChannels[0].id), 9);
  });
});

test("source reservation and source-ingest outbox commit atomically and roll back on duplicate dispatch", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 2 });
    const first = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    const firstCandidate = createCandidate({ workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, suffix: "atomic1" });
    const reserved = reserveChannelSourceCandidate({
      candidateId: firstCandidate.id,
      itemId: first.id,
      expectedItemVersion: first.version,
      outbox: { eventKind: "production.source.ingest", payload: { sourceCandidateId: firstCandidate.id } }
    });
    assert.equal(reserved.candidate.status, "reserved");
    assert.equal(reserved.item.sourceCandidateId, firstCandidate.id);
    assert.equal(reserved.item.version, 2);
    const replayedReservation = reserveChannelSourceCandidate({
      candidateId: firstCandidate.id,
      itemId: first.id,
      expectedItemVersion: first.version,
      outbox: { eventKind: "production.source.ingest", payload: { sourceCandidateId: firstCandidate.id } }
    });
    assert.equal(replayedReservation.item.version, reserved.item.version);
    assert.equal(
      listProductionEvents({ runId: seeded.run.id, productionItemId: first.id })
        .filter((event) => event.eventType === "production.source.reserved").length,
      1
    );

    const claimed = claimProductionOutbox({ owner: "dispatcher", leaseMs: 30_000, limit: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].productionItemId, first.id);
    const acknowledged = ackProductionOutbox({ outboxId: claimed[0].id, leaseToken: claimed[0].leaseToken! });
    assert.equal(acknowledged.status, "delivered");

    const second = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 2 });
    const secondCandidate = createCandidate({ workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, suffix: "atomic2" });
    getDb().prepare(`INSERT INTO production_outbox
      (id, workspace_id, run_id, channel_id, production_item_id, event_kind, dedupe_key, payload_json, status,
       attempts, max_attempts, available_at, created_at, updated_at)
      VALUES ('collision', ?, ?, ?, ?, 'production.source.ingest', ?, '{}', 'pending', 0, 3, ?, ?, ?)`) 
      .run(seeded.workspaceId, seeded.run.id, seeded.channels[0].id, second.id,
        buildProductionOutboxDedupeKey("production.source.ingest", { sourceCandidateId: secondCandidate.id }),
        "2026-07-10T00:00:00.000Z", "2026-07-10T00:00:00.000Z", "2026-07-10T00:00:00.000Z");
    assert.throws(() => reserveChannelSourceCandidate({
      candidateId: secondCandidate.id,
      itemId: second.id,
      expectedItemVersion: second.version,
      outbox: { eventKind: "production.source.ingest", payload: { sourceCandidateId: secondCandidate.id } }
    }), assertStoreError("idempotency_conflict"));
    assert.equal(getProductionItem(second.id)?.sourceCandidateId, null);
    assert.equal(getProductionItem(second.id)?.version, second.version);
    assert.equal(listChannelSourceCandidates({
      workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, status: "available"
    }).some((candidate) => candidate.id === secondCandidate.id), true);
  });
});

test("atomic source batch rolls back every reservation when one outbox intent conflicts", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 2 });
    const first = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const second = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 2
    });
    const firstCandidate = createCandidate({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "batch-atomic-1"
    });
    const secondCandidate = createCandidate({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "batch-atomic-2"
    });
    const secondPayload = { sourceCandidateId: secondCandidate.id };
    const secondDedupeKey = buildProductionOutboxDedupeKey("production.source.ingest", secondPayload);
    getDb().prepare(`INSERT INTO production_outbox
      (id, workspace_id, run_id, channel_id, production_item_id, event_kind, dedupe_key, payload_json, status,
       attempts, max_attempts, available_at, created_at, updated_at)
      VALUES ('batch-collision', ?, ?, ?, ?, 'production.source.ingest', ?, '{}', 'pending', 0, 3, ?, ?, ?)`)
      .run(
        seeded.workspaceId,
        seeded.run.id,
        seeded.channels[0].id,
        second.id,
        secondDedupeKey,
        "2026-07-10T00:00:00.000Z",
        "2026-07-10T00:00:00.000Z",
        "2026-07-10T00:00:00.000Z"
      );

    assert.throws(() => reserveChannelSourceCandidatesAtomically([
      {
        candidateId: firstCandidate.id,
        itemId: first.id,
        expectedItemVersion: first.version,
        outbox: {
          eventKind: "production.source.ingest",
          payload: { sourceCandidateId: firstCandidate.id }
        }
      },
      {
        candidateId: secondCandidate.id,
        itemId: second.id,
        expectedItemVersion: second.version,
        outbox: { eventKind: "production.source.ingest", payload: secondPayload }
      }
    ]), assertStoreError("idempotency_conflict"));

    assert.equal(getProductionItem(first.id)?.sourceCandidateId, null);
    assert.equal(getProductionItem(first.id)?.version, first.version);
    assert.equal(getProductionItem(second.id)?.sourceCandidateId, null);
    assert.equal(listProductionOutbox({ runId: seeded.run.id, productionItemId: first.id }).length, 0);
    assert.equal(listChannelSourceCandidates({
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      status: "available"
    }).filter((candidate) => candidate.id === firstCandidate.id || candidate.id === secondCandidate.id).length, 2);
  });
});

test("strict item transitions derive PASS from hash-bound independent evidence and invalidate stale approvals", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    let item = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    item = reserveAndIngest({ item, workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, suffix: "quality1" });

    assert.throws(() => transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "source_qualified", eventType: "source.qualified"
    }), assertStoreError("quality_gate_missing"));
    const sourcePass = recordCombinedPass(item, "source");
    const exactSourcePass = getLatestQualityVerdictForArtifact({
      productionItemId: item.id,
      gateType: "source",
      judgeKind: "combined",
      artifactSha256: item.sourceSha256!,
      sourceSha256: item.sourceSha256,
      previewSha256: item.previewSha256,
      templateSha256: item.templateSha256,
      settingsSha256: item.settingsSha256
    });
    assert.equal(exactSourcePass?.id, sourcePass.id);
    assert.equal(sourcePass.persisted, false);
    assert.equal(sourcePass.derivedFromVerdictIds.length, 2);
    assert.equal(
      Number((getDb().prepare("SELECT COUNT(*) AS count FROM quality_verdicts WHERE judge_kind = 'combined'").get() as { count: number }).count),
      0
    );
    item = transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "source_qualified", eventType: "source.qualified"
    });
    assert.throws(() => transitionProductionItem({
      itemId: item.id, expectedVersion: item.version - 1, toState: "brief_ready", eventType: "brief.ready"
    }), assertStoreError("stale_version"));
    item = transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "brief_ready", eventType: "brief.ready"
    });
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "preview_ready",
      eventType: "preview.ready",
      patch: { previewSha256: HASH.preview, templateSha256: HASH.template, settingsSha256: HASH.settings }
    });
    recordCombinedPass(item, "preview");
    item = transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "preview_approved", eventType: "preview.approved"
    });
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "rework",
      resumeState: "preview_ready",
      eventType: "preview.rework"
    });
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "preview_ready",
      eventType: "preview.rebuilt",
      patch: { previewSha256: HASH.changedPreview, templateSha256: HASH.changedTemplate }
    });
    assert.throws(() => transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "preview_approved", eventType: "preview.approved"
    }), assertStoreError("quality_gate_missing"));
    assert.equal(getLatestQualityVerdictForArtifact({
      productionItemId: item.id,
      gateType: "preview",
      judgeKind: "combined",
      artifactSha256: item.previewSha256!,
      sourceSha256: item.sourceSha256,
      previewSha256: item.previewSha256,
      templateSha256: item.templateSha256,
      settingsSha256: item.settingsSha256
    }), null);
    recordCombinedPass(item, "preview", 2);
    item = transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "preview_approved", eventType: "preview.approved"
    });
    assert.equal(item.state, "preview_approved");
    assert.throws(() => transitionProductionItem({
      itemId: item.id, expectedVersion: item.version, toState: "public_verified", eventType: "unsafe.clock_publish"
    }), assertStoreError("invalid_transition"));
  });
});

test("quality PASS rejects direct combined rows and forged or failed agent bindings", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    let item = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    item = reserveAndIngest({ item, workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, suffix: "quality-forgery" });
    const common = {
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      gateType: "source" as const,
      verdict: "pass" as const,
      artifactSha256: item.sourceSha256!,
      sourceSha256: item.sourceSha256,
      previewSha256: item.previewSha256,
      templateSha256: item.templateSha256,
      settingsSha256: item.settingsSha256,
      defects: []
    };
    recordQualityVerdict({
      ...common,
      judgeKind: "deterministic",
      attemptNo: 1,
      evidenceSha256: sha("exact-source-decode-probe"),
      evidenceArtifactPath: `/quality-tests/${item.id}/source-probe.json`
    });
    assert.throws(() => transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "source_qualified",
      eventType: "unsafe.deterministic_only"
    }), assertStoreError("quality_gate_missing"));

    const exactBinding = calculateQualityVerdictBindingSha256(common);
    const wrongBindingAttempt = recordAgentAttempt({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      role: "source_fit",
      attemptNo: 1,
      model: "fixture",
      reasoningLevel: "none",
      promptHash: sha("wrong-binding-prompt"),
      qualityBindingSha256: HASH.changedPreview,
      outputHash: sha("wrong-binding-output"),
      status: "passed",
      startedAt: "2026-07-10T00:00:00.000Z",
      finishedAt: "2026-07-10T00:00:00.001Z"
    });
    assert.throws(() => recordQualityVerdict({
      ...common,
      judgeKind: "semantic",
      attemptNo: 1,
      agentAttemptId: wrongBindingAttempt.id,
      evidenceSha256: sha("wrong-binding-evidence"),
      evidenceArtifactPath: `/quality-tests/${item.id}/wrong-binding.json`
    }), assertStoreError("invalid_input"));

    const failedAttempt = recordAgentAttempt({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      role: "source_fit",
      attemptNo: 2,
      model: "fixture",
      reasoningLevel: "none",
      promptHash: sha("failed-attempt-prompt"),
      qualityBindingSha256: exactBinding,
      outputHash: sha("failed-attempt-output"),
      status: "failed",
      startedAt: "2026-07-10T00:00:00.000Z",
      finishedAt: "2026-07-10T00:00:00.001Z"
    });
    assert.throws(() => recordQualityVerdict({
      ...common,
      judgeKind: "semantic",
      attemptNo: 2,
      agentAttemptId: failedAttempt.id,
      evidenceSha256: sha("failed-attempt-evidence"),
      evidenceArtifactPath: `/quality-tests/${item.id}/failed-attempt.json`
    }), assertStoreError("invalid_input"));

    const successfulAttempt = recordAgentAttempt({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      role: "source_fit",
      attemptNo: 3,
      model: "fixture",
      reasoningLevel: "none",
      promptHash: sha("successful-attempt-prompt"),
      qualityBindingSha256: exactBinding,
      outputHash: sha("successful-attempt-output"),
      status: "passed",
      startedAt: "2026-07-10T00:00:00.000Z",
      finishedAt: "2026-07-10T00:00:00.001Z"
    });
    assert.throws(() => recordQualityVerdict({
      ...common,
      judgeKind: "combined",
      attemptNo: 3,
      agentAttemptId: successfulAttempt.id,
      evidenceSha256: sha("synthetic-combined"),
      evidenceArtifactPath: `/quality-tests/${item.id}/synthetic-combined.json`
    } as unknown as Parameters<typeof recordQualityVerdict>[0]), assertStoreError("invalid_input"));
    recordQualityVerdict({
      ...common,
      judgeKind: "semantic",
      attemptNo: 3,
      agentAttemptId: successfulAttempt.id,
      evidenceSha256: sha("successful-source-fit-evidence"),
      evidenceArtifactPath: `/quality-tests/${item.id}/source-fit.json`
    });
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "source_qualified",
      eventType: "source.qualified"
    });
    assert.equal(item.state, "source_qualified");
  });
});

test("run/item leases are exclusive, renewable, token-bound, and do not change optimistic versions", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const item = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    const now = "2026-07-10T10:00:00.000Z";
    const runClaim = claimProductionRunLease({ runId: seeded.run.id, owner: "scheduler-a", leaseMs: 30_000, now });
    assert.ok(runClaim);
    assert.equal(claimProductionRunLease({ runId: seeded.run.id, owner: "scheduler-b", leaseMs: 30_000, now }), null);
    assert.throws(() => renewProductionRunLease({
      runId: seeded.run.id, leaseToken: "wrong", leaseMs: 30_000, now
    }), assertStoreError("lease_conflict"));
    const renewedRun = renewProductionRunLease({
      runId: seeded.run.id, leaseToken: runClaim.leaseToken, leaseMs: 60_000, now: "2026-07-10T10:00:10.000Z"
    });
    assert.equal(renewedRun.version, seeded.run.version);
    assert.equal(releaseProductionRunLease({ runId: seeded.run.id, leaseToken: runClaim.leaseToken }).leaseOwner, null);

    const itemClaim = claimProductionItemLease({ itemId: item.id, owner: "worker-a", leaseMs: 30_000, now });
    assert.ok(itemClaim);
    assert.equal(claimProductionItemLease({ itemId: item.id, owner: "worker-b", leaseMs: 30_000, now }), null);
    const renewedItem = renewProductionItemLease({
      itemId: item.id, leaseToken: itemClaim.leaseToken, leaseMs: 60_000, now: "2026-07-10T10:00:10.000Z"
    });
    assert.equal(renewedItem.version, item.version);
    assert.equal(releaseProductionItemLease({ itemId: item.id, leaseToken: itemClaim.leaseToken }).leaseOwner, null);
  });
});

test("outbox retries are bounded and require the exact active lease token", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const item = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    const candidate = createCandidate({ workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, suffix: "outbox1" });
    reserveChannelSourceCandidate({
      candidateId: candidate.id,
      itemId: item.id,
      expectedItemVersion: item.version,
      outbox: { eventKind: "production.source.ingest", payload: {}, maxAttempts: 2, availableAt: "2026-07-10T00:00:00.000Z" }
    });
    const first = claimProductionOutbox({
      owner: "dispatcher", leaseMs: 30_000, limit: 1, now: "2026-07-10T00:00:01.000Z"
    })[0];
    assert.equal(first.attempts, 1);
    assert.throws(() => retryProductionOutbox({
      outboxId: first.id, leaseToken: "wrong", error: "502", now: "2026-07-10T00:00:02.000Z"
    }), assertStoreError("lease_conflict"));
    const pending = retryProductionOutbox({
      outboxId: first.id,
      leaseToken: first.leaseToken!,
      error: "502",
      availableAt: "2026-07-10T00:00:03.000Z",
      now: "2026-07-10T00:00:02.000Z"
    });
    assert.equal(pending.status, "pending");
    const second = claimProductionOutbox({
      owner: "dispatcher", leaseMs: 30_000, limit: 1, now: "2026-07-10T00:00:04.000Z"
    })[0];
    assert.equal(second.attempts, 2);
    const dead = retryProductionOutbox({
      outboxId: second.id, leaseToken: second.leaseToken!, error: "still 502", now: "2026-07-10T00:00:05.000Z"
    });
    assert.equal(dead.status, "dead");
    assert.equal(claimProductionOutbox({
      owner: "dispatcher", leaseMs: 30_000, limit: 1, now: "2026-07-10T00:01:00.000Z"
    }).length, 0);
  });
});

test("a partially completed replacement supersedes its old claimed outbox only after the next generation exists", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    let item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const outbox = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "preview.requested",
      payload: { previewAttempt: 1 },
      maxAttempts: 3,
      availableAt: "2026-07-10T00:00:00.000Z"
    });
    const claimed = claimProductionOutbox({
      owner: "partial-replacement-test",
      leaseMs: 30_000,
      limit: 1,
      now: "2026-07-10T00:00:01.000Z"
    })[0]!;
    assert.equal(claimed.id, outbox.id);
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "replaced",
      eventType: "test.replacement.decided"
    });

    assert.equal(ackProductionOutboxAsSupersededGeneration({
      outboxId: claimed.id,
      leaseToken: claimed.leaseToken!,
      handlerError: "failure after terminal decision",
      now: "2026-07-10T00:00:02.000Z"
    }), null);
    assert.equal(listProductionOutbox({ runId: seeded.run.id })[0]?.status, "processing");

    const replacement = createReplacementProductionItem({
      replacedItemId: item.id,
      expectedVersion: item.version
    });
    const superseded = ackProductionOutboxAsSupersededGeneration({
      outboxId: claimed.id,
      leaseToken: claimed.leaseToken!,
      handlerError: "failure after terminal decision",
      now: "2026-07-10T00:00:03.000Z"
    });
    assert.equal(superseded?.outbox.status, "delivered");
    assert.equal(superseded?.replacementItem.id, replacement.id);
    assert.equal(superseded?.replacementItem.generation, 2);
    const fenceEvent = listProductionEvents({ runId: seeded.run.id }).find(
      (event) => event.eventType === "production.outbox.superseded_by_generation"
    );
    assert.equal(fenceEvent?.productionItemId, item.id);
    assert.equal(fenceEvent?.payload.replacementItemId, replacement.id);
  });
});

test("an exhausted cancellation poll never terminalizes an upload-unknown item and durably continues reconciliation", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    let item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    item = transitionProductionItem({
      itemId: item.id,
      expectedVersion: item.version,
      toState: "cancel_requested",
      eventType: "production.item.cancel_requested",
      outbox: {
        eventKind: "production.item.cancel_requested",
        payload: { reason: "test cancellation race" },
        maxAttempts: 1,
        availableAt: "2026-07-10T00:00:00.000Z"
      }
    });
    const claimed = claimProductionOutbox({
      owner: "cancel-reconciler",
      leaseMs: 30_000,
      limit: 1,
      now: "2026-07-10T00:00:01.000Z"
    })[0]!;
    const dead = retryProductionOutbox({
      outboxId: claimed.id,
      leaseToken: claimed.leaseToken!,
      error: "upload is still in progress",
      now: "2026-07-10T00:00:02.000Z"
    });

    assert.equal(dead.status, "dead");
    assert.equal(dead.deadLetterCode, "cancel_reconciliation_continues");
    assert.equal(getProductionItem(item.id)?.state, "cancel_requested");
    const outbox = listProductionOutbox({ runId: seeded.run.id });
    assert.equal(outbox.length, 2);
    const successor = outbox.find((entry) => entry.id !== claimed.id);
    assert.equal(successor?.eventKind, "production.item.cancel_requested");
    assert.equal(successor?.status, "pending");
    assert.equal(successor?.attempts, 0);
    assert.match(successor?.dedupeKey ?? "", new RegExp(claimed.id));
  });
});

test("public verification intent freezes one exact 24-hour deadline with the uploaded video identity", () => {
  const intent = buildProductionPublicVerificationOutboxIntent({
    publicationId: "publication-deadline-contract",
    youtubeVideoId: "youtube-video-deadline-contract",
    scheduledAt: "2040-01-01T00:00:00.000Z"
  });
  assert.deepEqual(intent, {
    eventKind: "public_verify.requested",
    payload: {
      publicationId: "publication-deadline-contract",
      youtubeVideoId: "youtube-video-deadline-contract",
      publicVerificationStartedAt: "2040-01-01T00:00:00.000Z",
      publicVerificationDeadlineAt: "2040-01-02T00:00:00.000Z"
    },
    availableAt: "2040-01-01T00:00:00.000Z",
    maxAttempts: 12
  });
});

test("public verification retry wake is clamped to the exact 24-hour deadline", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    const item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const event = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      ...buildProductionPublicVerificationOutboxIntent({
        publicationId: "publication-retry-wake",
        youtubeVideoId: "youtube-video-retry-wake",
        scheduledAt: "2040-01-01T00:00:00.000Z"
      }),
      maxAttempts: 2
    });
    const claimed = claimProductionOutbox({
      owner: "public-verifier",
      leaseMs: 30_000,
      limit: 1,
      now: "2040-01-01T23:59:58.000Z"
    })[0]!;
    assert.equal(claimed.id, event.id);
    const pending = retryProductionOutbox({
      outboxId: claimed.id,
      leaseToken: claimed.leaseToken!,
      error: "Public verification delayed: RSS_VIDEO_NOT_FOUND",
      availableAt: "2040-01-02T00:00:03.000Z",
      now: "2040-01-01T23:59:58.000Z"
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.availableAt, "2040-01-02T00:00:00.000Z");
  });
});

test("exhausted public verification windows continue with the same IDs before 24h and fail exactly at the deadline", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    let item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    item = advanceToScheduled({
      item,
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "public-deadline",
      publicationId: "publication-public-deadline",
      youtubeVideoId: "youtube-video-public-deadline"
    });
    const intent = buildProductionPublicVerificationOutboxIntent({
      publicationId: item.publicationId!,
      youtubeVideoId: item.youtubeVideoId!,
      scheduledAt: "2040-01-01T00:00:00.000Z"
    });
    const firstWindow = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      ...intent,
      maxAttempts: 1
    });
    const firstClaim = claimProductionOutbox({
      owner: "public-verifier",
      leaseMs: 30_000,
      limit: 1,
      now: "2040-01-01T00:00:01.000Z"
    })[0]!;
    assert.equal(firstClaim.id, firstWindow.id);
    const continued = retryProductionOutbox({
      outboxId: firstClaim.id,
      leaseToken: firstClaim.leaseToken!,
      error: "Public verification delayed: RSS_VIDEO_NOT_FOUND",
      now: "2040-01-01T00:00:02.000Z"
    });
    assert.equal(continued.status, "dead");
    assert.equal(continued.deadLetterCode, "public_verification_continues");

    const beforeDeadline = getProductionItem(item.id)!;
    assert.equal(beforeDeadline.state, "publication_scheduled");
    assert.equal(beforeDeadline.publicationId, item.publicationId);
    assert.equal(beforeDeadline.youtubeVideoId, item.youtubeVideoId);
    let outbox = listProductionOutbox({ runId: item.runId, productionItemId: item.id });
    assert.equal(outbox.length, 2);
    const successor = outbox.find((entry) => entry.id !== firstWindow.id)!;
    assert.equal(successor.eventKind, "public_verify.requested");
    assert.equal(successor.status, "pending");
    assert.equal(successor.payload.publicationId, item.publicationId);
    assert.equal(successor.payload.youtubeVideoId, item.youtubeVideoId);
    assert.equal(successor.payload.publicVerificationStartedAt, "2040-01-01T00:00:00.000Z");
    assert.equal(successor.payload.publicVerificationDeadlineAt, "2040-01-02T00:00:00.000Z");
    assert.equal(successor.payload.predecessorOutboxId, firstWindow.id);
    assert.equal(outbox.some((entry) => entry.eventKind === "publication.requested"), false);

    const deadlineClaim = claimProductionOutbox({
      owner: "public-verifier",
      leaseMs: 30_000,
      limit: 1,
      now: "2040-01-02T00:00:00.000Z"
    })[0]!;
    assert.equal(deadlineClaim.id, successor.id);
    const terminal = retryProductionOutbox({
      outboxId: deadlineClaim.id,
      leaseToken: deadlineClaim.leaseToken!,
      error: "Public verification deadline reached: RSS_VIDEO_NOT_FOUND",
      now: "2040-01-02T00:00:00.000Z"
    });
    assert.equal(terminal.status, "dead");
    assert.equal(terminal.deadLetterCode, "outbox_retry_exhausted");
    assert.equal(getProductionItem(item.id)?.state, "failed");
    assert.equal(getProductionItem(item.id)?.publicationId, item.publicationId);
    assert.equal(getProductionItem(item.id)?.youtubeVideoId, item.youtubeVideoId);
    outbox = listProductionOutbox({ runId: item.runId, productionItemId: item.id });
    assert.equal(outbox.length, 2);
    assert.equal(outbox.some((entry) => entry.eventKind === "publication.requested"), false);
    assert.ok(listProductionEvents({ runId: item.runId, productionItemId: item.id }).some(
      (event) => event.eventType === "production.item.public_verification_continues"
    ));
  });
});

test("an expired public verification lease at the 24-hour deadline terminalizes without another window", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    let item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    item = advanceToScheduled({
      item,
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "public-deadline-lease",
      publicationId: "publication-public-deadline-lease",
      youtubeVideoId: "youtube-video-public-deadline-lease"
    });
    const event = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      ...buildProductionPublicVerificationOutboxIntent({
        publicationId: item.publicationId!,
        youtubeVideoId: item.youtubeVideoId!,
        scheduledAt: "2040-01-01T00:00:00.000Z"
      })
    });
    const claimed = claimProductionOutbox({
      owner: "crashed-public-verifier",
      leaseMs: 500,
      limit: 1,
      now: "2040-01-01T23:59:59.000Z"
    })[0]!;
    assert.equal(claimed.id, event.id);
    assert.equal(claimProductionOutbox({
      owner: "deadline-watchdog",
      leaseMs: 30_000,
      limit: 1,
      now: "2040-01-02T00:00:00.000Z"
    }).length, 0);

    const outbox = listProductionOutbox({ runId: item.runId, productionItemId: item.id });
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0]?.status, "dead");
    assert.equal(outbox[0]?.deadLetterCode, "outbox_retry_exhausted");
    assert.equal(getProductionItem(item.id)?.state, "failed");
    assert.equal(getProductionItem(item.id)?.publicationId, item.publicationId);
    assert.equal(getProductionItem(item.id)?.youtubeVideoId, item.youtubeVideoId);
  });
});

test("immutable outbox dedupe permits second revision and final-render attempts while replaying one attempt idempotently", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    const item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const revisionPayload = {
      defects: [{ code: "crop_main_action_lost" }],
      expectedRevisionAction: "targeted_visual_revision"
    };
    const revisionOneKey = buildProductionOutboxDedupeKey("revision.requested", {
      gate: "preview",
      attemptNo: 1,
      previewSha256: HASH.preview
    });
    const revisionOne = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey: revisionOneKey,
      payload: revisionPayload
    });
    const revisionOneReplay = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey: revisionOneKey,
      payload: revisionPayload
    });
    assert.equal(revisionOneReplay.id, revisionOne.id);
    const revisionTwo = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey: buildProductionOutboxDedupeKey("revision.requested", {
        gate: "preview",
        attemptNo: 2,
        previewSha256: HASH.changedPreview
      }),
      payload: revisionPayload
    });
    assert.notEqual(revisionTwo.id, revisionOne.id);

    const finalOne = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "final_render.requested",
      dedupeKey: buildProductionOutboxDedupeKey("final_render.requested", {
        gate: "final_render",
        attemptNo: 1,
        approvalBindingSha256: HASH.preview
      }),
      payload: { approvalBindingSha256: HASH.preview }
    });
    const finalTwo = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "final_render.requested",
      dedupeKey: buildProductionOutboxDedupeKey("final_render.requested", {
        gate: "final_render",
        attemptNo: 2,
        approvalBindingSha256: HASH.changedPreview
      }),
      payload: { approvalBindingSha256: HASH.changedPreview }
    });
    assert.notEqual(finalTwo.id, finalOne.id);
    const outbox = listProductionOutbox({ runId: item.runId, productionItemId: item.id });
    assert.equal(outbox.length, 4);
    assert.equal(new Set(outbox.map((entry) => entry.dedupeKey)).size, 4);
    assert.throws(() => appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey: revisionOneKey,
      payload: { ...revisionPayload, expectedRevisionAction: "targeted_regenerate" }
    }), assertStoreError("idempotency_conflict"));
    assert.throws(() => getDb().prepare(
      "UPDATE production_outbox SET dedupe_key = 'tampered' WHERE id = ?"
    ).run(revisionOne.id), /production outbox intent is immutable/);
  });
});

test("an expired last outbox lease is dead-lettered and projected in the same watchdog transaction", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 1 });
    const item = createProductionItem({
      runId: seeded.run.id,
      runChannelId: seeded.runChannels[0].id,
      itemSlot: 1
    });
    const event = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "source_fit.requested",
      dedupeKey: buildProductionOutboxDedupeKey("source_fit.requested", { source: "lease-expiry" }),
      payload: { source: "lease-expiry" },
      maxAttempts: 1,
      availableAt: "2026-07-10T00:00:00.000Z"
    });
    const claimed = claimProductionOutbox({
      owner: "crashed-worker",
      leaseMs: 1_000,
      now: "2026-07-10T00:00:01.000Z"
    });
    assert.equal(claimed[0]?.id, event.id);
    assert.equal(claimProductionOutbox({
      owner: "watchdog",
      leaseMs: 1_000,
      now: "2026-07-10T00:00:02.001Z"
    }).length, 0);
    const dead = listProductionOutbox({ runId: item.runId, productionItemId: item.id })[0]!;
    assert.equal(dead.status, "dead");
    assert.equal(dead.deadLetterCode, "outbox_retry_exhausted");
    assert.ok(dead.projectedAt);
    assert.equal(getProductionItem(item.id)?.state, "failed");
  });
});

test("dead outbox projection classifies only its item and channel while the portfolio continues, then closes the run", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ channelCount: 2, targetPerChannel: 1 });
    let run = transitionProductionRun({
      runId: seeded.run.id,
      expectedVersion: seeded.run.version,
      toStatus: "preflight",
      eventType: "fixture.run.preflight"
    });
    run = transitionProductionRun({
      runId: run.id,
      expectedVersion: run.version,
      toStatus: "ready",
      eventType: "fixture.run.ready"
    });
    run = transitionProductionRun({
      runId: run.id,
      expectedVersion: run.version,
      toStatus: "running",
      eventType: "fixture.run.running"
    });
    for (const initialChannel of seeded.runChannels) {
      let channel = transitionProductionRunChannel({
        runChannelId: initialChannel.id,
        expectedVersion: initialChannel.version,
        toStatus: "preflight",
        eventType: "fixture.channel.preflight"
      });
      channel = transitionProductionRunChannel({
        runChannelId: channel.id,
        expectedVersion: channel.version,
        toStatus: "ready",
        eventType: "fixture.channel.ready"
      });
      transitionProductionRunChannel({
        runChannelId: channel.id,
        expectedVersion: channel.version,
        toStatus: "running",
        eventType: "fixture.channel.running"
      });
    }
    const items = seeded.runChannels.map((channel, index) => createProductionItem({
      runId: run.id,
      runChannelId: channel.id,
      itemSlot: 1,
      attemptBudget: 3 + index
    }));
    for (const [index, item] of items.entries()) {
      appendProductionOutbox({
        workspaceId: item.workspaceId,
        runId: item.runId,
        channelId: item.channelId,
        productionItemId: item.id,
        eventKind: "source_fit.requested",
        dedupeKey: buildProductionOutboxDedupeKey("source_fit.requested", {
          gate: "source_fit",
          source: index + 1
        }),
        payload: { source: index + 1 },
        maxAttempts: 1,
        availableAt: "2026-07-10T00:00:00.000Z"
      });
    }
    const firstClaim = claimProductionOutbox({
      owner: "dispatcher",
      leaseMs: 30_000,
      limit: 1,
      now: "2026-07-10T00:00:01.000Z"
    })[0]!;
    const firstDead = retryProductionOutbox({
      outboxId: firstClaim.id,
      leaseToken: firstClaim.leaseToken!,
      error: "OAuth 401: publication credential is unauthorized",
      now: "2026-07-10T00:00:02.000Z"
    });
    assert.equal(firstDead.status, "dead");
    assert.equal(firstDead.deadLetterCode, "outbox_policy_blocked");
    assert.ok(firstDead.projectedAt);
    assert.equal(getProductionItem(firstClaim.productionItemId)?.state, "policy_blocked");
    let channels = listProductionRunChannels(run.id);
    assert.equal(channels.find((channel) => channel.channelId === firstClaim.channelId)?.status, "blocked");
    assert.equal(channels.find((channel) => channel.channelId !== firstClaim.channelId)?.status, "running");
    assert.equal(getProductionRun(run.id)?.status, "running");

    const blockedChannelPending = appendProductionOutbox({
      workspaceId: items[0]!.workspaceId,
      runId: items[0]!.runId,
      channelId: firstClaim.channelId,
      productionItemId: firstClaim.productionItemId,
      eventKind: "brief.requested",
      dedupeKey: buildProductionOutboxDedupeKey("brief.requested", { blockedChannel: firstClaim.channelId }),
      payload: { blockedChannel: firstClaim.channelId },
      availableAt: "2026-07-10T00:00:00.000Z"
    });

    const secondClaim = claimProductionOutbox({
      owner: "dispatcher",
      leaseMs: 30_000,
      limit: 1,
      now: "2026-07-10T00:00:03.000Z"
    })[0]!;
    assert.notEqual(secondClaim.id, blockedChannelPending.id);
    assert.notEqual(secondClaim.channelId, firstClaim.channelId);
    assert.equal(listProductionOutbox({ runId: run.id }).find(
      (entry) => entry.id === blockedChannelPending.id
    )?.status, "pending");
    retryProductionOutbox({
      outboxId: secondClaim.id,
      leaseToken: secondClaim.leaseToken!,
      error: "provider 502 after bounded retries",
      now: "2026-07-10T00:00:04.000Z"
    });
    const reconciled = reconcilePortfolioProductionRun({
      runId: run.id,
      leaseOwner: "fixture-reconcile"
    });
    assert.equal(reconciled.run.status, "blocked");
    channels = listProductionRunChannels(run.id);
    assert.deepEqual(channels.map((channel) => channel.status).sort(), ["blocked", "failed"]);
  });
});

test("agent metrics and three-source public proof are durable; only exact evidence completes the item", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    let item = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    item = advanceToScheduled({
      item,
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "public1",
      publicationId: "publication-1",
      youtubeVideoId: "youtube-video-1"
    });
    const runningAttempt = recordAgentAttempt({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      role: "vision_qa",
      attemptNo: 3,
      model: "gpt-5.4-mini",
      reasoningLevel: "medium",
      promptHash: HASH.prompt,
      status: "running",
      startedAt: "2026-07-10T10:00:00.000Z"
    });
    const completedAttempt = recordAgentAttempt({
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      role: "vision_qa",
      attemptNo: 3,
      model: "gpt-5.4-mini",
      reasoningLevel: "medium",
      promptHash: HASH.prompt,
      outputHash: HASH.output,
      artifactIds: ["preview-1"],
      status: "passed",
      outcome: "pass",
      verdict: "pass",
      inputTokens: 100,
      outputTokens: 25,
      cachedInputTokens: 80,
      reasoningOutputTokens: 7,
      costMicros: 1234,
      costUnit: "codex_credits",
      durationMs: 750,
      startedAt: runningAttempt.startedAt,
      finishedAt: "2026-07-10T10:00:00.750Z"
    });
    assert.equal(completedAttempt.status, "passed");
    assert.equal(completedAttempt.inputTokens, 100);
    assert.equal(completedAttempt.outputTokens, 25);
    assert.equal(completedAttempt.cachedInputTokens, 80);
    assert.equal(completedAttempt.reasoningOutputTokens, 7);
    assert.equal(completedAttempt.costMicros, 1234);
    assert.equal(completedAttempt.costUnit, "codex_credits");

    const delayed = recordPublicVerification({
      productionItemId: item.id,
      expectedItemVersion: item.version,
      publicationId: item.publicationId!,
      expectedYoutubeChannelId: item.expectedYoutubeChannelId,
      youtubeVideoId: item.youtubeVideoId!,
      attemptNo: 1,
      clipsStatus: "scheduled",
      clipsMatches: true,
      rssSeen: false,
      shortsHttpStatus: 200,
      pagePlayable: true,
      pageCanonicalVideoId: item.youtubeVideoId,
      pageChannelId: item.expectedYoutubeChannelId,
      failureCode: "rss_lag",
      evidence: { rss: "not_seen" }
    });
    assert.equal(delayed.verification.verified, false);
    assert.equal(delayed.item.state, "publication_scheduled");
    assert.equal(delayed.item.version, item.version);

    assert.throws(() => recordPublicVerification({
      productionItemId: item.id,
      expectedItemVersion: item.version,
      publicationId: item.publicationId!,
      expectedYoutubeChannelId: "UC-wrong",
      youtubeVideoId: item.youtubeVideoId!,
      attemptNo: 2,
      clipsStatus: "published",
      clipsMatches: true,
      rssSeen: true,
      shortsHttpStatus: 200,
      pagePlayable: true,
      pageCanonicalVideoId: item.youtubeVideoId,
      pageChannelId: "UC-wrong",
      evidence: {}
    }), assertStoreError("external_effect_conflict"));

    const confirmed = recordPublicVerification({
      productionItemId: item.id,
      expectedItemVersion: item.version,
      publicationId: item.publicationId!,
      expectedYoutubeChannelId: item.expectedYoutubeChannelId,
      youtubeVideoId: item.youtubeVideoId!,
      attemptNo: 2,
      clipsStatus: "published",
      clipsMatches: true,
      rssSeen: true,
      shortsHttpStatus: 200,
      pagePlayable: true,
      pageCanonicalVideoId: item.youtubeVideoId,
      pageChannelId: item.expectedYoutubeChannelId,
      evidence: { clips: true, rss: true, page: true }
    });
    assert.equal(confirmed.verification.verified, true);
    assert.equal(confirmed.item.state, "public_verified");
    assert.equal(listProductionRunChannels(item.runId)[0].publicVerifiedCount, 1);
    assert.equal(listChannelSourceCandidates({
      workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, status: "consumed"
    }).length, 1);
  });
});

test("run cancellation requests safe work to stop but never masks an upload-started conflict", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ targetPerChannel: 3 });
    const safeItem = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 1 });
    let uploadItem = createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 2 });
    uploadItem = reserveAndIngest({
      item: uploadItem, workspaceId: seeded.workspaceId, channelId: seeded.channels[0].id, suffix: "cancel1"
    });
    uploadItem = transitionProductionItem({
      itemId: uploadItem.id,
      expectedVersion: uploadItem.version,
      toState: "rework",
      resumeState: "source_qualified",
      eventType: "upload.session.observed",
      patch: { uploadSessionUrl: "https://upload.youtube.test/session-1" }
    });
    const scheduledWithoutUpload = advanceToScheduled({
      item: createProductionItem({ runId: seeded.run.id, runChannelId: seeded.runChannels[0].id, itemSlot: 3 }),
      workspaceId: seeded.workspaceId,
      channelId: seeded.channels[0].id,
      suffix: "cancel-scheduled",
      publicationId: "publication-not-uploaded"
    });
    const canceled = cancelProductionRun({
      runId: seeded.run.id,
      expectedVersion: seeded.run.version,
      reason: "owner emergency stop"
    });
    assert.equal(canceled.run.status, "cancel_requested");
    assert.equal(canceled.run.completedAt, null);
    assert.deepEqual(canceled.canceledItemIds, [safeItem.id, uploadItem.id, scheduledWithoutUpload.id]);
    assert.deepEqual(canceled.conflicts, [
      { itemId: uploadItem.id, reason: "upload_started_or_outcome_unknown" },
      { itemId: scheduledWithoutUpload.id, reason: "upload_started_or_outcome_unknown" }
    ]);
    assert.equal(getProductionItem(safeItem.id)?.state, "cancel_requested");
    assert.equal(getProductionItem(uploadItem.id)?.state, "cancel_requested");
    assert.equal(getProductionItem(scheduledWithoutUpload.id)?.state, "cancel_requested");
    assert.equal(
      listProductionOutbox({ runId: seeded.run.id })
        .filter((event) => event.eventKind === "production.item.cancel_requested").length,
      3
    );
    assert.equal(listProductionItems({ runId: seeded.run.id }).length, 3);
  });
});
