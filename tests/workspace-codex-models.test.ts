import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  getWorkspaceCodexModelOptionsForStage,
  normalizeWorkspaceCodexModelConfig,
  resolveWorkspaceCodexModelConfig
} from "../lib/workspace-codex-models";
import {
  bootstrapOwner,
  getWorkspaceCodexModelConfig,
  updateWorkspaceCodexModelConfig
} from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-workspace-codex-models-test-"));
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

test("resolveWorkspaceCodexModelConfig keeps text-only stages on deploy Spark but protects multimodal routes", () => {
  const resolved = resolveWorkspaceCodexModelConfig({
    config: DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
    deployStage2Model: "gpt-5.3-codex-spark",
    deployStage2SeoModel: null,
    deployStage3Model: null
  });

  assert.equal(resolved.analyzer, "gpt-5.4");
  assert.equal(resolved.styleDiscovery, "gpt-5.4");
  assert.equal(resolved.selector, "gpt-5.3-codex-spark");
  assert.equal(resolved.writer, "gpt-5.3-codex-spark");
  assert.equal(resolved.critic, "gpt-5.3-codex-spark");
  assert.equal(resolved.rewriter, "gpt-5.3-codex-spark");
  assert.equal(resolved.finalSelector, "gpt-5.3-codex-spark");
  assert.equal(resolved.titles, "gpt-5.3-codex-spark");
  assert.equal(resolved.seo, "gpt-5.3-codex-spark");
  assert.equal(resolved.regenerate, "gpt-5.3-codex-spark");
  assert.equal(resolved.stage3Planner, "gpt-5.2");
});

test("normalizeWorkspaceCodexModelConfig migrates legacy stage2Pipeline safely into per-substage settings", () => {
  const normalized = normalizeWorkspaceCodexModelConfig({
    stage2Pipeline: "gpt-5.3-codex-spark",
    stage2Seo: "gpt-5.4-mini",
    stage3Planner: "gpt-5.4"
  });

  assert.equal(normalized.analyzer, "deploy_default");
  assert.equal(normalized.styleDiscovery, "deploy_default");
  assert.equal(normalized.selector, "gpt-5.3-codex-spark");
  assert.equal(normalized.writer, "gpt-5.3-codex-spark");
  assert.equal(normalized.critic, "gpt-5.3-codex-spark");
  assert.equal(normalized.rewriter, "gpt-5.3-codex-spark");
  assert.equal(normalized.finalSelector, "gpt-5.3-codex-spark");
  assert.equal(normalized.titles, "gpt-5.3-codex-spark");
  assert.equal(normalized.regenerate, "gpt-5.3-codex-spark");
  assert.equal(normalized.seo, "gpt-5.4-mini");
  assert.equal(normalized.stage3Planner, "gpt-5.4");
});

test("getWorkspaceCodexModelOptionsForStage hides Spark on multimodal stages only", () => {
  assert.deepEqual(
    getWorkspaceCodexModelOptionsForStage("analyzer").map((option) => option.value),
    ["gpt-5.4", "gpt-5.4-mini"]
  );
  assert.deepEqual(
    getWorkspaceCodexModelOptionsForStage("styleDiscovery").map((option) => option.value),
    ["gpt-5.4", "gpt-5.4-mini"]
  );
  assert.deepEqual(
    getWorkspaceCodexModelOptionsForStage("writer").map((option) => option.value),
    ["gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.4-mini"]
  );
});

test("team-store persists workspace codex model config overrides in per-substage format", async () => {
  await withIsolatedAppData(async () => {
    const auth = await bootstrapOwner({
      workspaceName: "Codex Models",
      email: "owner@example.com",
      password: "password123",
      displayName: "Owner"
    });

    assert.deepEqual(
      getWorkspaceCodexModelConfig(auth.workspace.id),
      DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG
    );

    const updated = updateWorkspaceCodexModelConfig(auth.workspace.id, {
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.4-mini",
      qualityCourt: "gpt-5.3-codex-spark",
      targetedRepair: "gpt-5.4-mini",
      captionTranslation: "gpt-5.4-mini",
      titleWriter: "gpt-5.4",
      analyzer: "gpt-5.4-mini",
      selector: "gpt-5.3-codex-spark",
      writer: "gpt-5.4",
      critic: "gpt-5.3-codex-spark",
      rewriter: "gpt-5.4-mini",
      finalSelector: "gpt-5.4",
      titles: "gpt-5.3-codex-spark",
      seo: "gpt-5.4-mini",
      regenerate: "gpt-5.3-codex-spark",
      styleDiscovery: "gpt-5.4",
      stage3Planner: "gpt-5.4-mini"
    });

    assert.deepEqual(updated.codexModelConfig, {
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.4-mini",
      qualityCourt: "gpt-5.3-codex-spark",
      targetedRepair: "gpt-5.4-mini",
      captionTranslation: "gpt-5.4-mini",
      titleWriter: "gpt-5.4",
      analyzer: "gpt-5.4-mini",
      selector: "gpt-5.3-codex-spark",
      writer: "gpt-5.4",
      critic: "gpt-5.3-codex-spark",
      rewriter: "gpt-5.4-mini",
      finalSelector: "gpt-5.4",
      titles: "gpt-5.3-codex-spark",
      seo: "gpt-5.4-mini",
      regenerate: "gpt-5.3-codex-spark",
      styleDiscovery: "gpt-5.4",
      stage3Planner: "gpt-5.4-mini"
    });
    assert.deepEqual(getWorkspaceCodexModelConfig(auth.workspace.id), updated.codexModelConfig);
  });
});
