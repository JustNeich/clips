#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_APP_URL = "https://clips-vy11.onrender.com";
const DEFAULT_TOKEN_PATH = "~/.codex/secrets/clips_copscopes_control_token";
const EXPECTED_GRID = {
  timezone: "Europe/Moscow",
  firstSlotLocalTime: "21:15",
  dailySlotCount: 3,
  slotIntervalMinutes: 15,
  autoQueueEnabled: true
};

function parseArgs(argv) {
  const result = {
    appUrl: process.env.CLIPS_APP_URL || DEFAULT_APP_URL,
    tokenPath: process.env.CLIPS_TOKEN_PATH || DEFAULT_TOKEN_PATH,
    channelUsername: "copscopes",
    limit: 3,
    attemptBudget: 8,
    dryRun: false,
    repairSchedule: true,
    pretty: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      return argv[index];
    };
    if (arg === "--app-url") {
      result.appUrl = next();
    } else if (arg === "--token-path") {
      result.tokenPath = next();
    } else if (arg === "--channel-username") {
      result.channelUsername = next();
    } else if (arg === "--limit") {
      result.limit = Number.parseInt(next(), 10);
    } else if (arg === "--attempt-budget") {
      result.attemptBudget = Number.parseInt(next(), 10);
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--no-repair-schedule") {
      result.repairSchedule = false;
    } else if (arg === "--json") {
      result.pretty = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  result.appUrl = result.appUrl.replace(/\/+$/, "");
  result.limit = Math.max(1, Math.min(3, Number.isFinite(result.limit) ? result.limit : 3));
  result.attemptBudget = Math.max(result.limit, Math.min(12, Number.isFinite(result.attemptBudget) ? result.attemptBudget : 8));
  return result;
}

function expandHome(filePath) {
  return filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
}

function readToken(tokenPath) {
  const resolved = expandHome(tokenPath);
  const token = fs.readFileSync(resolved, "utf8").trim();
  if (!token) {
    throw new Error(`Control token file is empty: ${resolved}`);
  }
  return { token, tokenPath: resolved };
}

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError ?? new Error(`Request failed: ${url}`);
}

function createControlCaller(config, token) {
  return (tool, input = {}, attempts = 2) =>
    fetchJson(
      `${config.appUrl}/api/admin/control/copscopes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tool, input })
      },
      attempts
    );
}

function activeCategory(categories) {
  return Array.isArray(categories) ? categories.find((category) => category.status === "active") ?? null : null;
}

function assertPublishPreflight(status) {
  const publishing = status.publishing ?? {};
  if (publishing.gridMatchesExpected !== true) {
    throw new Error(`CopScopes publish grid does not match ${JSON.stringify(EXPECTED_GRID)}.`);
  }
  if (publishing.integration?.ready !== true) {
    throw new Error(
      `CopScopes YouTube publishing is not ready: ${publishing.integration?.status ?? "unknown"}${
        publishing.integration?.lastError ? ` (${publishing.integration.lastError})` : ""
      }`
    );
  }
  const category = activeCategory(status.categories);
  if (!category) {
    throw new Error("CopScopes source pool has no active category.");
  }
  if ((category.availableCount ?? 0) <= 0) {
    throw new Error(`Active CopScopes category is exhausted or empty: ${category.slug}.`);
  }
  return category;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const ledger = [];
  const { token, tokenPath } = readToken(config.tokenPath);
  const control = createControlCaller(config, token);

  const health = await fetchJson(`${config.appUrl}/api/health`, {}, 3);
  ledger.push({ step: "health", status: "passed", health });

  let status = await control("clips_control_get_channel_status", {
    channelUsername: config.channelUsername,
    poolLimit: 20,
    publicationsLimit: 20
  });
  ledger.push({
    step: "channel_status",
    status: "passed",
    gridMatchesExpected: status.publishing?.gridMatchesExpected,
    integrationReady: status.publishing?.integration?.ready
  });

  if (status.publishing?.gridMatchesExpected !== true && config.repairSchedule) {
    const repaired = await control("clips_control_set_publish_schedule", {
      channelUsername: config.channelUsername,
      ...EXPECTED_GRID
    });
    ledger.push({
      step: "repair_publish_grid",
      status: "passed",
      previousSettings: repaired.previousSettings,
      settings: repaired.publishing?.settings
    });
    status = await control("clips_control_get_channel_status", {
      channelUsername: config.channelUsername,
      poolLimit: 20,
      publicationsLimit: 20
    });
  }

  const category = assertPublishPreflight(status);
  ledger.push({
    step: "preflight",
    status: "passed",
    activeCategory: category.slug,
    availableCount: category.availableCount
  });

  const selection = await control("clips_control_run_daily_pool", {
    channelUsername: config.channelUsername,
    limit: config.limit,
    attemptBudget: config.attemptBudget,
    dryRun: true
  });
  ledger.push({
    step: "selection_dry_run",
    status: "passed",
    selected: selection.selected?.map((item) => item.shortcode) ?? [],
    selectedCount: selection.selected?.length ?? 0
  });

  let liveRun = null;
  if (!config.dryRun) {
    liveRun = await control("clips_control_run_daily_pool", {
      channelUsername: config.channelUsername,
      limit: config.limit,
      attemptBudget: config.attemptBudget,
      dryRun: false
    }, 1);
    ledger.push({
      step: "live_run",
      status: liveRun.queuedCount > 0 ? "passed" : "blocked",
      runId: liveRun.runId,
      runStatus: liveRun.status,
      queuedCount: liveRun.queuedCount,
      reviewedCount: liveRun.reviewedCount,
      failedCount: liveRun.failedCount
    });
    if (liveRun.exhausted) {
      throw new Error(`Active CopScopes category exhausted: ${liveRun.categorySlug}.`);
    }
    if ((liveRun.queuedCount ?? 0) <= 0) {
      throw new Error(`CopScopes live run did not queue any render jobs. runId=${liveRun.runId ?? "none"}`);
    }
  }

  const finalStatus = await control("clips_control_get_channel_status", {
    channelUsername: config.channelUsername,
    poolLimit: 20,
    publicationsLimit: 20
  });

  const report = {
    ok: true,
    startedAt,
    completedAt: new Date().toISOString(),
    appUrl: config.appUrl,
    tokenPath,
    channel: finalStatus.channel,
    activeCategory: activeCategory(finalStatus.categories),
    publishing: finalStatus.publishing,
    dryRun: config.dryRun,
    selection,
    liveRun,
    ledger
  };
  console.log(JSON.stringify(report, null, config.pretty ? 2 : 0));
}

main().catch((error) => {
  const report = {
    ok: false,
    completedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error)
  };
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
