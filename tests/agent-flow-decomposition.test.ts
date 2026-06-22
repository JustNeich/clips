import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { POST as ownerControlRoute } from "../app/api/admin/control/route";
import { GET as getDecompositionFrame } from "../app/api/admin/source-decomposition/[chatId]/frames/[index]/route";
import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { createMcpMachineCredential } from "../lib/mcp-machine-credential-store";
import { runSourceDecomposition } from "../lib/source-decomposition-runtime";
import { getSourceMediaCacheKey } from "../lib/source-media-cache";
import { bootstrapOwner } from "../lib/team-store";

const execFileAsync = promisify(execFile);

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-agent-decomp-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run(appDataDir);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function makeTestClip(filePath: string, seconds: number): Promise<void> {
  // A short solid-color clip with a silent audio track, generated locally.
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=blue:s=320x240:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    filePath
  ]);
}

function postOwnerControl(token: string, body: unknown): Promise<Response> {
  return ownerControlRoute(
    new Request("http://localhost/api/admin/control", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

test("agent decomposition extracts frames + meta, exposes them via the agent read tool and frame endpoint", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Agent Flow",
      email: "agent-owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Agent Channel",
      username: "agent-channel"
    });
    const sourceUrl = "https://youtube.com/watch?v=agent-decomp-1";
    const chat = await createOrGetChatByUrl(sourceUrl, channel.id);

    const clipPath = path.join(appDataDir, "agent-source.mp4");
    await makeTestClip(clipPath, 4);

    const record = await runSourceDecomposition({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      sourceKey: getSourceMediaCacheKey(sourceUrl),
      sourceUrl,
      sourcePath: clipPath,
      commentsPayload: {
        title: "Agent source",
        totalComments: 1,
        topComments: [{ id: "c1", author: "viewer", text: "great clip", likes: 9, postedAt: null }],
        allComments: [{ id: "c1", author: "viewer", text: "great clip", likes: 9, postedAt: null }]
      }
    });

    assert.ok(record, "decomposition record should be persisted");
    assert.ok(record!.artifact.frames.length > 0, "1fps frames should be extracted");
    assert.equal(record!.artifact.meta.frameCount, record!.artifact.frames.length);
    assert.ok((record!.artifact.meta.durationSec ?? 0) > 0, "meta should carry a duration");
    assert.equal(record!.artifact.comments.length, 1);
    // Whisper is opt-in; default run must NOT transcribe and must degrade honestly.
    assert.equal(record!.artifact.subtitles.available, false);
    assert.ok(record!.artifact.subtitles.skippedReason, "subtitles skip reason should be present");
    // Frames live in the isolated agent-decomposition tree, NOT the human source cache.
    assert.ok(record!.framesDir.includes("agent-decomposition"));
    assert.ok(!record!.framesDir.includes("source-media-cache"));

    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "macmini-agent"
    });

    // Read tool returns the agent-shaped contract.
    const readResponse = await postOwnerControl(machine.secret, {
      tool: "clips_flow_get_source_decomposition",
      input: { chatId: chat.id }
    });
    assert.equal(readResponse.status, 200);
    const payload = (await readResponse.json()) as {
      sourceKey: string;
      comments: unknown[];
      frames: Array<{ timestampSec: number; imageUrl: string; description: string }>;
      subtitles: { available: boolean; segments: unknown[] };
      meta: { durationSec: number | null; frameCount: number; extractedAt: string };
    };
    assert.equal(payload.sourceKey, record!.artifact.sourceKey);
    assert.ok(payload.frames.length > 0);
    assert.ok(payload.frames[0]!.imageUrl.includes("/api/admin/source-decomposition/"));
    assert.ok(typeof payload.frames[0]!.description === "string");
    assert.equal(payload.subtitles.available, false);
    assert.ok(payload.meta.frameCount > 0);

    // A frame image is fetchable by the agent.
    const frameResponse = await getDecompositionFrame(
      new Request(payload.frames[0]!.imageUrl, {
        headers: { authorization: `Bearer ${machine.secret}` }
      }),
      { params: Promise.resolve({ chatId: chat.id, index: "0" }) }
    );
    assert.equal(frameResponse.status, 200);
    assert.equal(frameResponse.headers.get("Content-Type"), "image/jpeg");
    const bytes = new Uint8Array(await frameResponse.arrayBuffer());
    assert.ok(bytes.byteLength > 0, "frame image should have bytes");
  });
});

test("agent pipeline create tool dry-run plans decomposition without touching the human pipeline", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Agent Flow Dry",
      email: "agent-owner-dry@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Agent Channel",
      username: "agent-channel-dry"
    });
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "macmini-agent"
    });
    void appDataDir;

    const response = await postOwnerControl(machine.secret, {
      tool: "clips_owner_run_agent_pipeline",
      input: {
        channelUsername: "agent-channel-dry",
        sourceUrl: "https://youtube.com/watch?v=agent-decomp-dry",
        dryRun: true
      }
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { dryRun: boolean; planned: string[] };
    assert.equal(payload.dryRun, true);
    assert.ok(payload.planned.includes("enqueue_source_job_with_decomposition"));
  });
});
