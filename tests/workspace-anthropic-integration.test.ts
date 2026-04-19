import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb } from "../lib/db/client";
import {
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  parseStage2CaptionProviderConfigJson
} from "../lib/stage2-caption-provider";
import {
  bootstrapOwner,
  getWorkspaceAnthropicApiKey,
  getWorkspaceAnthropicIntegration,
  getWorkspaceStage2CaptionProviderConfig,
  updateWorkspaceStage2CaptionProviderConfig,
  upsertWorkspaceAnthropicIntegration
} from "../lib/team-store";
import { mutateWorkspaceAnthropicIntegration } from "../lib/workspace-anthropic";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-workspace-anthropic-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  process.env.APP_DATA_DIR = appDataDir;

  try {
    return await run();
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

test("team-store persists Anthropic integration encrypted and gates provider switching", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Anthropic Captions",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    assert.deepEqual(
      getWorkspaceStage2CaptionProviderConfig(owner.workspace.id),
      DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG
    );

    assert.throws(
      () =>
        updateWorkspaceStage2CaptionProviderConfig(owner.workspace.id, {
          provider: "anthropic",
          anthropicModel: "claude-opus-4-6",
          openrouterModel: "anthropic/claude-opus-4.7"
        }),
      /Anthropic captions недоступны/
    );

    const apiKey = "sk-ant-api03-1234567890abcdef";
    const connectedAt = "2026-04-19T12:00:00.000Z";
    const integration = upsertWorkspaceAnthropicIntegration({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      status: "connected",
      apiKey,
      lastError: null,
      connectedAt
    });

    assert.equal(integration.status, "connected");
    assert.equal(integration.apiKeyHint, "sk-ant-api03...cdef");
    assert.equal(getWorkspaceAnthropicApiKey(owner.workspace.id), apiKey);
    assert.equal(getWorkspaceAnthropicIntegration(owner.workspace.id)?.status, "connected");

    const row = getDb()
      .prepare(
        "SELECT encrypted_api_key_json FROM workspace_anthropic_integrations WHERE workspace_id = ? LIMIT 1"
      )
      .get(owner.workspace.id) as { encrypted_api_key_json?: string } | undefined;
    assert.equal(typeof row?.encrypted_api_key_json, "string");
    assert.equal(row?.encrypted_api_key_json?.includes(apiKey), false);

    const updated = updateWorkspaceStage2CaptionProviderConfig(owner.workspace.id, {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });

    assert.deepEqual(updated.stage2CaptionProviderConfig, {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });
    assert.deepEqual(getWorkspaceStage2CaptionProviderConfig(owner.workspace.id), {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });
  });
});

test("parseStage2CaptionProviderConfigJson falls back safely on invalid JSON", () => {
  assert.deepEqual(parseStage2CaptionProviderConfigJson("{"), DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG);
});

test("disconnecting Anthropic demotes the workspace caption provider back to Shared Codex", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Anthropic Disconnect",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    upsertWorkspaceAnthropicIntegration({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      status: "connected",
      apiKey: "sk-ant-api03-1234567890abcdef",
      lastError: null,
      connectedAt: "2026-04-19T12:00:00.000Z"
    });
    updateWorkspaceStage2CaptionProviderConfig(owner.workspace.id, {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });

    const integration = await mutateWorkspaceAnthropicIntegration({
      auth: owner,
      action: "disconnect"
    });

    assert.equal(integration.status, "disconnected");
    assert.equal(getWorkspaceAnthropicApiKey(owner.workspace.id), null);
    assert.equal(getWorkspaceAnthropicIntegration(owner.workspace.id)?.status, "disconnected");
    assert.deepEqual(getWorkspaceStage2CaptionProviderConfig(owner.workspace.id), {
      provider: "codex",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });
  });
});
