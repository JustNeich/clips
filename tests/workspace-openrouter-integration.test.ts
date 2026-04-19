import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb } from "../lib/db/client";
import {
  DEFAULT_OPENROUTER_CAPTION_MODEL,
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  normalizeStage2CaptionProviderConfig
} from "../lib/stage2-caption-provider";
import {
  bootstrapOwner,
  getWorkspaceOpenRouterApiKey,
  getWorkspaceOpenRouterIntegration,
  getWorkspaceStage2CaptionProviderConfig,
  updateWorkspaceStage2CaptionProviderConfig,
  upsertWorkspaceOpenRouterIntegration
} from "../lib/team-store";
import { mutateWorkspaceOpenRouterIntegration } from "../lib/workspace-openrouter";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-workspace-openrouter-test-"));
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

test("team-store persists OpenRouter integration encrypted and gates provider switching", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "OpenRouter Captions",
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
          provider: "openrouter",
          anthropicModel: "claude-opus-4-6",
          openrouterModel: "anthropic/claude-opus-4.7"
        }),
      /OpenRouter captions недоступны/
    );

    const apiKey = "sk-or-v1-1234567890abcdef";
    const connectedAt = "2026-04-19T12:00:00.000Z";
    const integration = upsertWorkspaceOpenRouterIntegration({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      status: "connected",
      apiKey,
      lastError: null,
      connectedAt
    });

    assert.equal(integration.status, "connected");
    assert.equal(integration.apiKeyHint, "sk-or-v1-123...cdef");
    assert.equal(getWorkspaceOpenRouterApiKey(owner.workspace.id), apiKey);
    assert.equal(getWorkspaceOpenRouterIntegration(owner.workspace.id)?.status, "connected");

    const row = getDb()
      .prepare(
        "SELECT encrypted_api_key_json FROM workspace_openrouter_integrations WHERE workspace_id = ? LIMIT 1"
      )
      .get(owner.workspace.id) as { encrypted_api_key_json?: string } | undefined;
    assert.equal(typeof row?.encrypted_api_key_json, "string");
    assert.equal(row?.encrypted_api_key_json?.includes(apiKey), false);

    const updated = updateWorkspaceStage2CaptionProviderConfig(owner.workspace.id, {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });

    assert.deepEqual(updated.stage2CaptionProviderConfig, {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });
    assert.deepEqual(getWorkspaceStage2CaptionProviderConfig(owner.workspace.id), {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });
  });
});

test("normalizeStage2CaptionProviderConfig fills the default OpenRouter model", () => {
  assert.deepEqual(
    normalizeStage2CaptionProviderConfig({
      provider: "openrouter"
    }),
    {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: DEFAULT_OPENROUTER_CAPTION_MODEL
    }
  );
});

test("disconnecting OpenRouter demotes the workspace caption provider back to Shared Codex", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "OpenRouter Disconnect",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    upsertWorkspaceOpenRouterIntegration({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      status: "connected",
      apiKey: "sk-or-v1-1234567890abcdef",
      lastError: null,
      connectedAt: "2026-04-19T12:00:00.000Z"
    });
    updateWorkspaceStage2CaptionProviderConfig(owner.workspace.id, {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });

    const integration = await mutateWorkspaceOpenRouterIntegration({
      auth: owner,
      action: "disconnect"
    });

    assert.equal(integration.status, "disconnected");
    assert.equal(getWorkspaceOpenRouterApiKey(owner.workspace.id), null);
    assert.equal(getWorkspaceOpenRouterIntegration(owner.workspace.id)?.status, "disconnected");
    assert.deepEqual(getWorkspaceStage2CaptionProviderConfig(owner.workspace.id), {
      provider: "codex",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    });
  });
});
