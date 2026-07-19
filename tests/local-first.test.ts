import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  acceptLocalFirstHandoff,
  beginLocalFirstHandoff,
  buildLocalFirstChildEnvironment,
  createLocalFirstManifest,
  validateLocalFirstRuntime,
  type LocalFirstRuntimeIdentity
} from "../lib/local-first-contract";
import {
  createLocalFirstHandoff,
  getLocalFirstPaths,
  readLocalFirstManifest,
  recoverLocalFirstJobs,
  writeLocalFirstManifest
} from "../lib/local-first-state";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextQueuedStage3JobForWorker,
  enqueueStage3Job,
  enqueueStage3JobWithOutcome
} from "../lib/stage3-job-store";
import { resolveStage3LocalSchedulerLimits } from "../lib/stage3-local-scheduler";

const RUNTIME: LocalFirstRuntimeIdentity = {
  gitRevision: "0123456789abcdef",
  lockfileSha256: "f".repeat(64),
  nodeMajor: 22
};

async function makePortableState(machineId = "mac-mini"): Promise<{
  root: string;
  dataDir: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-local-first-test-"));
  const paths = getLocalFirstPaths(root);
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = paths.dataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, stage3_execution_target, created_at, updated_at) VALUES (?, ?, ?, 'local', ?, ?)").run(
    "w1",
    "Test workspace",
    "test-workspace",
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("u1", "owner@example.com", "hash", "Owner", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, ?)"
  ).run(newId(), "w1", "u1", stamp, stamp);
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  if (previousAppDataDir === undefined) {
    delete process.env.APP_DATA_DIR;
  } else {
    process.env.APP_DATA_DIR = previousAppDataDir;
  }
  await writeLocalFirstManifest(
    root,
    createLocalFirstManifest({ machineId, runtime: RUNTIME, now: stamp })
  );
  return { root, dataDir: paths.dataDir };
}

async function removePortableState(root: string): Promise<void> {
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  await rm(root, { recursive: true, force: true });
}

test("local-first child environment removes Render from the production video path", () => {
  const env = buildLocalFirstChildEnvironment({
    base: {
      NODE_ENV: "test",
      RENDER: "true",
      RENDER_API_KEY: "must-not-propagate",
      RENDER_SERVICE_ID: "srv-test",
      CLIPS_REMOTE_API_ORIGIN: "https://unavailable.invalid"
    },
    stateDir: "/portable/clips",
    machineDir: "/local/mac-mini",
    port: 3210
  });
  assert.equal(env.RENDER, undefined);
  assert.equal(env.RENDER_API_KEY, undefined);
  assert.equal(env.RENDER_SERVICE_ID, undefined);
  assert.equal(env.CLIPS_REMOTE_API_ORIGIN, undefined);
  assert.equal(env.CLIPS_APP_URL, "http://127.0.0.1:3210");
  assert.equal(env.STAGE3_ALLOW_HOST_EXECUTION, "0");
  assert.equal(env.STAGE3_DEFAULT_EXECUTION_TARGET, "local");
  assert.equal(env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS, "1");
});

test("local preview and render queue/claim without Render or a remote control plane", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-local-queue-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRender = process.env.RENDER;
  const previousRemote = process.env.CLIPS_REMOTE_API_ORIGIN;
  process.env.APP_DATA_DIR = root;
  process.env.RENDER = "true";
  process.env.CLIPS_REMOTE_API_ORIGIN = "https://unavailable.invalid";
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    const db = getDb();
    const stamp = nowIso();
    db.prepare("INSERT INTO workspaces (id, name, slug, stage3_execution_target, created_at, updated_at) VALUES (?, ?, ?, 'local', ?, ?)").run(
      "w1",
      "Local",
      "local",
      stamp,
      stamp
    );
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("u1", "local@example.com", "hash", "Local", "active", stamp, stamp);
    const preview = enqueueStage3Job({
      workspaceId: "w1",
      userId: "u1",
      kind: "preview",
      executionTarget: "local",
      dedupeKey: "preview:video-1:r1",
      payloadJson: JSON.stringify({ workItemId: "video-1", revision: 1 })
    });
    const render = enqueueStage3JobWithOutcome({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render:video-1:r1",
      payloadJson: JSON.stringify({
        workItemId: "video-1",
        revision: 1,
        renderPlan: { targetDurationSec: 6 }
      })
    });
    const duplicate = enqueueStage3JobWithOutcome({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render:video-1:r1",
      payloadJson: JSON.stringify({
        workItemId: "video-1",
        revision: 1,
        renderPlan: { targetDurationSec: 6 }
      })
    });
    const claimedRender = claimNextQueuedStage3JobForWorker({
      workerId: "worker-local",
      workspaceId: "w1",
      userId: "u1",
      supportedKinds: ["render"],
      resourceProfiles: ["render-short"]
    });
    const claimedPreview = claimNextQueuedStage3JobForWorker({
      workerId: "worker-local",
      workspaceId: "w1",
      userId: "u1",
      supportedKinds: ["preview"],
      resourceProfiles: ["media"]
    });
    assert.equal(claimedRender?.id, render.job.id);
    assert.equal(claimedPreview?.id, preview.id);
    assert.equal(duplicate.outcome, "reused_in_flight");
    assert.equal(duplicate.job.id, render.job.id);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = previousRender;
    if (previousRemote === undefined) delete process.env.CLIPS_REMOTE_API_ORIGIN;
    else process.env.CLIPS_REMOTE_API_ORIGIN = previousRemote;
    await rm(root, { recursive: true, force: true });
  }
});

test("state/runtime mismatch is detected before active-machine start", () => {
  const manifest = createLocalFirstManifest({
    machineId: "mac-mini",
    runtime: RUNTIME
  });
  const issues = validateLocalFirstRuntime(manifest, {
    ...RUNTIME,
    gitRevision: "different",
    lockfileSha256: "0".repeat(64)
  });
  assert.deepEqual(
    new Set(issues.map((issue) => issue.code)),
    new Set(["git_revision_mismatch", "lockfile_mismatch"])
  );
});

test("handoff is fenced, targeted, checksummed, and cannot be produced twice", async () => {
  const source = await makePortableState();
  const transferDir = `${source.root}-transfer`;
  try {
    const previousAppDataDir = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = source.dataDir;
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    enqueueStage3Job({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render:handoff:r1",
      payloadJson: JSON.stringify({ workItemId: "handoff", revision: 1 })
    });
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;

    const created = await createLocalFirstHandoff({
      stateDir: source.root,
      machineId: "mac-mini",
      toMachineId: "macbook",
      outputDir: transferDir
    });
    const sourceManifest = await readLocalFirstManifest(source.root);
    assert.equal(sourceManifest.status, "handed_off");
    assert.equal(sourceManifest.owner, null);
    assert.equal(
      JSON.parse(await readFile(path.join(transferDir, "control", "manifest.json"), "utf8")).status,
      "handoff_pending"
    );
    const copiedDb = new DatabaseSync(path.join(transferDir, "data", "app.db"));
    const copiedRows = copiedDb.prepare(
      "SELECT id, status FROM stage3_jobs WHERE dedupe_key = ?"
    ).all("render:handoff:r1");
    copiedDb.close();
    assert.equal(copiedRows.length, 1);
    assert.equal((copiedRows[0] as { status: string }).status, "queued");
    await assert.rejects(
      createLocalFirstHandoff({
        stateDir: source.root,
        machineId: "mac-mini",
        toMachineId: "macbook",
        outputDir: `${transferDir}-duplicate`
      }),
      /not actively owned/
    );

    const pending = beginLocalFirstHandoff({
      manifest: createLocalFirstManifest({ machineId: "mac-mini", runtime: RUNTIME }),
      machineId: "mac-mini",
      toMachineId: "macbook",
      dataRoot: source.dataDir,
      token: created.token
    }).transferManifest;
    const accepted = acceptLocalFirstHandoff({
      manifest: pending,
      machineId: "macbook",
      token: created.token,
      runtime: RUNTIME
    });
    assert.equal(accepted.owner?.machineId, "macbook");
    assert.equal(accepted.owner?.epoch, 2);
    await assert.rejects(
      async () =>
        acceptLocalFirstHandoff({
          manifest: accepted,
          machineId: "macbook",
          token: created.token,
          runtime: RUNTIME
        }),
      /not awaiting/
    );
  } finally {
    await removePortableState(source.root);
    await rm(transferDir, { recursive: true, force: true });
  }
});

test("recovery agent requeues correctable local failures and preserves semantic failures", async () => {
  const state = await makePortableState();
  const db = new DatabaseSync(path.join(state.dataDir, "app.db"));
  const stamp = nowIso();
  try {
    const insert = db.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, resource_profile, status, execution_target, payload_json,
         error_code, error_message, recoverable, attempts, attempt_limit, created_at, updated_at, completed_at)
       VALUES (?, 'w1', 'u1', 'render', 'render-short', 'failed', 'local', '{}', ?, ?, 1, 3, 3, ?, ?, ?)`
    );
    insert.run(
      "recoverable",
      "worker_unavailable",
      "worker exited",
      stamp,
      stamp,
      stamp
    );
    insert.run(
      "semantic",
      "template_snapshot_drift",
      "template changed",
      stamp,
      stamp,
      stamp
    );
  } finally {
    db.close();
  }
  try {
    const result = await recoverLocalFirstJobs({
      stateDir: state.root,
      machineId: "mac-mini"
    });
    assert.deepEqual(result.requeuedJobIds, ["recoverable"]);
    const checked = new DatabaseSync(path.join(state.dataDir, "app.db"));
    const recoverable = checked.prepare(
      "SELECT status, attempts, error_code FROM stage3_jobs WHERE id = 'recoverable'"
    ).get() as { status: string; attempts: number; error_code: string | null };
    const semantic = checked.prepare(
      "SELECT status, error_code FROM stage3_jobs WHERE id = 'semantic'"
    ).get() as { status: string; error_code: string | null };
    checked.close();
    assert.deepEqual({ ...recoverable }, {
      status: "queued",
      attempts: 0,
      error_code: null
    });
    assert.deepEqual({ ...semantic }, {
      status: "failed",
      error_code: "template_snapshot_drift"
    });
  } finally {
    await removePortableState(state.root);
  }
});

test("local-first hard-caps the render lane at one even if legacy env asks for two", () => {
  const previousLocalFirst = process.env.CLIPS_LOCAL_FIRST;
  const previousShort = process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS;
  process.env.CLIPS_LOCAL_FIRST = "1";
  process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS = "2";
  try {
    assert.equal(resolveStage3LocalSchedulerLimits().shortRender, 1);
  } finally {
    if (previousLocalFirst === undefined) delete process.env.CLIPS_LOCAL_FIRST;
    else process.env.CLIPS_LOCAL_FIRST = previousLocalFirst;
    if (previousShort === undefined) {
      delete process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS;
    } else {
      process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS = previousShort;
    }
  }
});

test("Render blueprint remains optional and cannot execute hosted Stage 3 by default", async () => {
  const renderYaml = await readFile(path.join(process.cwd(), "render.yaml"), "utf8");
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  assert.match(renderYaml, /autoDeploy:\s*false/);
  assert.match(
    renderYaml,
    /key:\s*STAGE3_ALLOW_HOST_EXECUTION[\s\S]*?value:\s*"0"/
  );
  assert.doesNotMatch(packageJson.scripts?.["dev:prod-api"] ?? "", /onrender\.com/i);
});
