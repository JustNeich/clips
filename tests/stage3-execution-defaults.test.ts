import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as listChannelsRoute } from "../app/api/channels/route";
import { PATCH as patchWorkspaceRoute, GET as getWorkspaceRoute } from "../app/api/workspace/route";
import { POST as postStage3EditingProxyJob } from "../app/api/stage3/editing-proxy/jobs/route";
import { POST as postStage3PreviewJob } from "../app/api/stage3/preview/jobs/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { getDb } from "../lib/db/client";
import {
  getWorkspaceStage3ExecutionTarget,
  updateWorkspaceStage3ExecutionTarget,
  bootstrapOwner
} from "../lib/team-store";
import { resolveStage3Execution } from "../lib/stage3-execution";
import {
  buildStage3EditingProxyDedupeKey
} from "../lib/stage3-editing-proxy-service";
import { buildStage3PreviewDedupeKey } from "../lib/stage3-preview-service";
import { completeStage3Job, enqueueStage3Job, finishStage3Job } from "../lib/stage3-job-store";
import { setStage3JobProcessorForTests } from "../lib/stage3-job-runtime";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-execution-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobProcessorOverride__?: unknown }).__clipsStage3JobProcessorOverride__;
  process.env.APP_DATA_DIR = appDataDir;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsStage3JobProcessorOverride__?: unknown }).__clipsStage3JobProcessorOverride__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function withStage3Env<T>(
  overrides: Partial<Record<"STAGE3_DEFAULT_EXECUTION_TARGET" | "STAGE3_ALLOW_HOST_EXECUTION", string>>,
  run: () => Promise<T>
): Promise<T> {
  const previousDefaultTarget = process.env.STAGE3_DEFAULT_EXECUTION_TARGET;
  const previousAllowHost = process.env.STAGE3_ALLOW_HOST_EXECUTION;
  if (overrides.STAGE3_DEFAULT_EXECUTION_TARGET === undefined) {
    delete process.env.STAGE3_DEFAULT_EXECUTION_TARGET;
  } else {
    process.env.STAGE3_DEFAULT_EXECUTION_TARGET = overrides.STAGE3_DEFAULT_EXECUTION_TARGET;
  }
  if (overrides.STAGE3_ALLOW_HOST_EXECUTION === undefined) {
    delete process.env.STAGE3_ALLOW_HOST_EXECUTION;
  } else {
    process.env.STAGE3_ALLOW_HOST_EXECUTION = overrides.STAGE3_ALLOW_HOST_EXECUTION;
  }

  try {
    return await run();
  } finally {
    if (previousDefaultTarget === undefined) {
      delete process.env.STAGE3_DEFAULT_EXECUTION_TARGET;
    } else {
      process.env.STAGE3_DEFAULT_EXECUTION_TARGET = previousDefaultTarget;
    }
    if (previousAllowHost === undefined) {
      delete process.env.STAGE3_ALLOW_HOST_EXECUTION;
    } else {
      process.env.STAGE3_ALLOW_HOST_EXECUTION = previousAllowHost;
    }
  }
}

test("workspace Stage 3 execution defaults seed from env and normalize invalid stored values", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "host",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      await withIsolatedAppData(async () => {
        const owner = await bootstrapOwner({
          workspaceName: "Stage3 Execution Seed",
          email: "owner@example.com",
          password: "Password123!",
          displayName: "Owner"
        });
        assert.equal(owner.workspace.stage3ExecutionTarget, "host");
        assert.equal(getWorkspaceStage3ExecutionTarget(owner.workspace.id), "host");

        const db = getDb();
        db.prepare("UPDATE workspaces SET stage3_execution_target = ? WHERE id = ?").run(
          "bogus",
          owner.workspace.id
        );

        assert.equal(getWorkspaceStage3ExecutionTarget(owner.workspace.id), "host");
        const repaired = db
          .prepare("SELECT stage3_execution_target FROM workspaces WHERE id = ?")
          .get(owner.workspace.id) as { stage3_execution_target: string };
        assert.equal(repaired.stage3_execution_target, "host");
      });
    }
  );
});

test("stage3 execution resolver reports configured, resolved, and gated capabilities", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      const local = resolveStage3Execution("local");
      assert.equal(local.configuredTarget, "local");
      assert.equal(local.resolvedTarget, "local");
      assert.equal(local.capabilities.hostAvailable, true);
    }
  );

  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "0"
    },
    async () => {
      const hostConfigured = resolveStage3Execution("host");
      assert.equal(hostConfigured.configuredTarget, "host");
      assert.equal(hostConfigured.resolvedTarget, "local");
      assert.equal(hostConfigured.capabilities.hostAvailable, false);

      const envFallback = resolveStage3Execution(null);
      assert.equal(envFallback.configuredTarget, "local");
      assert.equal(envFallback.resolvedTarget, "local");
    }
  );
});

test("workspace API exposes and persists Stage 3 execution defaults", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      await withIsolatedAppData(async () => {
        const owner = await bootstrapOwner({
          workspaceName: "Workspace Stage3 API",
          email: "owner-api@example.com",
          password: "Password123!",
          displayName: "Owner"
        });
        const cookie = `${APP_SESSION_COOKIE}=${owner.sessionToken}`;

        const initialResponse = await getWorkspaceRoute(
          new Request("http://localhost/api/workspace", {
            headers: { cookie }
          })
        );
        const initialBody = (await initialResponse.json()) as {
          stage3ExecutionTarget?: string;
          resolvedStage3ExecutionTarget?: string;
          stage3ExecutionCapabilities?: { hostAvailable?: boolean; localAvailable?: boolean };
        };
        assert.equal(initialResponse.status, 200);
        assert.equal(initialBody.stage3ExecutionTarget, "local");
        assert.equal(initialBody.resolvedStage3ExecutionTarget, "local");
        assert.equal(initialBody.stage3ExecutionCapabilities?.hostAvailable, true);

        const patchResponse = await patchWorkspaceRoute(
          new Request("http://localhost/api/workspace", {
            method: "PATCH",
            headers: {
              cookie,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ stage3ExecutionTarget: "host" })
          })
        );
        const patchBody = (await patchResponse.json()) as {
          stage3ExecutionTarget?: string;
          resolvedStage3ExecutionTarget?: string;
        };
        assert.equal(patchResponse.status, 200);
        assert.equal(patchBody.stage3ExecutionTarget, "host");
        assert.equal(patchBody.resolvedStage3ExecutionTarget, "host");
        assert.equal(getWorkspaceStage3ExecutionTarget(owner.workspace.id), "host");

        await withStage3Env(
          {
            STAGE3_DEFAULT_EXECUTION_TARGET: "local",
            STAGE3_ALLOW_HOST_EXECUTION: "0"
          },
          async () => {
            const rejectedResponse = await patchWorkspaceRoute(
              new Request("http://localhost/api/workspace", {
                method: "PATCH",
                headers: {
                  cookie,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ stage3ExecutionTarget: "host" })
              })
            );
            const rejectedBody = (await rejectedResponse.json()) as { error?: string };
            assert.equal(rejectedResponse.status, 400);
            assert.match(rejectedBody.error ?? "", /Stage 3/i);
          }
        );
      });
    }
  );
});

test("channels API mirrors workspace Stage 3 execution defaults for page refresh hydration", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      await withIsolatedAppData(async () => {
        const owner = await bootstrapOwner({
          workspaceName: "Channels Workspace Stage3",
          email: "owner-channels@example.com",
          password: "Password123!",
          displayName: "Owner"
        });
        updateWorkspaceStage3ExecutionTarget(owner.workspace.id, "host");

        const response = await listChannelsRoute(
          new Request("http://localhost/api/channels", {
            headers: {
              cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
            }
          })
        );
        const body = (await response.json()) as {
          workspaceStage3ExecutionTarget?: string;
          workspaceResolvedStage3ExecutionTarget?: string;
          workspaceStage3ExecutionCapabilities?: { hostAvailable?: boolean };
        };

        assert.equal(response.status, 200);
        assert.equal(body.workspaceStage3ExecutionTarget, "host");
        assert.equal(body.workspaceResolvedStage3ExecutionTarget, "host");
        assert.equal(body.workspaceStage3ExecutionCapabilities?.hostAvailable, true);
      });
    }
  );
});

test("preview job route uses workspace Stage 3 host mode without local worker gating", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      await withIsolatedAppData(async () => {
        const owner = await bootstrapOwner({
          workspaceName: "Stage3 Host Route",
          email: "owner-route@example.com",
          password: "Password123!",
          displayName: "Owner"
        });
        updateWorkspaceStage3ExecutionTarget(owner.workspace.id, "host");
        setStage3JobProcessorForTests(async (job) => {
          completeStage3Job(job.id, { resultJson: JSON.stringify({ ok: true }) });
        });

        const response = await postStage3PreviewJob(
          new Request("http://localhost/api/stage3/preview/jobs", {
            method: "POST",
            headers: {
              cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sourceUrl: "https://www.youtube.com/shorts/abc123xyz00"
            })
          })
        );
        const body = (await response.json()) as {
          job?: { executionTarget?: string; status?: string };
        };

        assert.equal(response.status, 202);
        assert.equal(body.job?.executionTarget, "host");
        assert.match(body.job?.status ?? "", /queued|running|completed/);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  );
});

test("Stage 3 proxy and preview routes return conflict for terminal failed dedupe jobs", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      await withIsolatedAppData(async () => {
        const owner = await bootstrapOwner({
          workspaceName: "Stage3 Terminal Dedupe",
          email: "owner-terminal@example.com",
          password: "Password123!",
          displayName: "Owner"
        });
        updateWorkspaceStage3ExecutionTarget(owner.workspace.id, "host");
        const sourceUrl = "https://www.youtube.com/shorts/abc123xyz00";
        const authHeaders = {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`,
          "Content-Type": "application/json"
        };

        const seedFailedJob = (input: {
          kind: "editing-proxy" | "preview" | "render";
          dedupeKey: string | null;
          payload: unknown;
          errorCode: string;
          errorMessage: string;
        }) => {
          const job = enqueueStage3Job({
            workspaceId: owner.workspace.id,
            userId: owner.user.id,
            kind: input.kind,
            executionTarget: "host",
            dedupeKey: input.dedupeKey,
            payloadJson: JSON.stringify(input.payload)
          });
          finishStage3Job(job.id, {
            status: "failed",
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            recoverable: true
          });
          getDb().prepare("UPDATE stage3_jobs SET attempts = attempt_limit WHERE id = ?").run(job.id);
          return job;
        };

        const editingProxyJob = seedFailedJob({
          kind: "editing-proxy",
          dedupeKey: await buildStage3EditingProxyDedupeKey(
            { sourceUrl },
            { workspaceId: owner.workspace.id, userId: owner.user.id }
          ),
          payload: { sourceUrl },
          errorCode: "editing_proxy_timeout",
          errorMessage: "Terminal editing-proxy failure."
        });
        const editingProxyResponse = await postStage3EditingProxyJob(
          new Request("http://localhost/api/stage3/editing-proxy/jobs", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ sourceUrl })
          })
        );
        const editingProxyBody = (await editingProxyResponse.json()) as { jobId?: string; message?: string };
        assert.equal(editingProxyResponse.status, 409);
        assert.equal(editingProxyBody.jobId, editingProxyJob.id);
        assert.equal(editingProxyBody.message, "Terminal editing-proxy failure.");

        const previewJob = seedFailedJob({
          kind: "preview",
          dedupeKey: await buildStage3PreviewDedupeKey(
            { sourceUrl },
            { workspaceId: owner.workspace.id, userId: owner.user.id }
          ),
          payload: { sourceUrl },
          errorCode: "preview_timeout",
          errorMessage: "Terminal preview failure."
        });
        const previewResponse = await postStage3PreviewJob(
          new Request("http://localhost/api/stage3/preview/jobs", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ sourceUrl })
          })
        );
        const previewBody = (await previewResponse.json()) as { jobId?: string; message?: string };
        assert.equal(previewResponse.status, 409);
        assert.equal(previewBody.jobId, previewJob.id);
        assert.equal(previewBody.message, "Terminal preview failure.");
      });
    }
  );
});

test("preview job route falls back to local when host mode is saved but temporarily disallowed", async () => {
  await withStage3Env(
    {
      STAGE3_DEFAULT_EXECUTION_TARGET: "local",
      STAGE3_ALLOW_HOST_EXECUTION: "1"
    },
    async () => {
      await withIsolatedAppData(async () => {
        const owner = await bootstrapOwner({
          workspaceName: "Stage3 Local Fallback",
          email: "owner-fallback@example.com",
          password: "Password123!",
          displayName: "Owner"
        });
        updateWorkspaceStage3ExecutionTarget(owner.workspace.id, "host");

        await withStage3Env(
          {
            STAGE3_DEFAULT_EXECUTION_TARGET: "local",
            STAGE3_ALLOW_HOST_EXECUTION: "0"
          },
          async () => {
            const response = await postStage3PreviewJob(
              new Request("http://localhost/api/stage3/preview/jobs", {
                method: "POST",
                headers: {
                  cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  sourceUrl: "https://www.youtube.com/shorts/abc123xyz00"
                })
              })
            );
            const body = (await response.json()) as { message?: string };
            assert.equal(response.status, 503);
            assert.equal(response.headers.get("x-stage3-worker-update-required"), "1");
            assert.match(body.message ?? "", /executor/i);
          }
        );
      });
    }
  );
});

test("Stage 3 preview dedupe separates channels and visible snapshots", async () => {
  const scope = { workspaceId: "workspace-1", userId: "owner-1" };
  const base = {
    sourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    channelId: "channel-a",
    renderPlan: {
      authorName: "First channel",
      authorHandle: "@first_channel",
      avatarAssetId: "avatar-a"
    },
    snapshot: {
      topText: "FIRST CHANNEL",
      bottomText: "Exact preview text for the first channel.",
      captionHighlights: { top: [], bottom: [] }
    }
  };

  const same = await buildStage3PreviewDedupeKey(base, scope);
  const sameReordered = await buildStage3PreviewDedupeKey(
    {
      ...base,
      renderPlan: {
        avatarAssetId: base.renderPlan.avatarAssetId,
        authorHandle: base.renderPlan.authorHandle,
        authorName: base.renderPlan.authorName
      },
      snapshot: {
        captionHighlights: base.snapshot.captionHighlights,
        bottomText: base.snapshot.bottomText,
        topText: base.snapshot.topText
      }
    },
    scope
  );
  const otherChannel = await buildStage3PreviewDedupeKey({ ...base, channelId: "channel-b" }, scope);
  const otherText = await buildStage3PreviewDedupeKey(
    { ...base, snapshot: { ...base.snapshot, bottomText: "A different visible result." } },
    scope
  );

  assert.equal(same, sameReordered);
  assert.notEqual(same, otherChannel);
  assert.notEqual(same, otherText);
});
