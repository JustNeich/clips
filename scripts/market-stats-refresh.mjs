#!/usr/bin/env node
// Pre-production market freshness hook (MI v2 cross-repo contract).
//
// A channel production run must decide off market data that is at most ~1h
// old. This wrapper invokes the Mind repo's stats lane (videos.list batch
// refresh + RSS discovery + signals rebuild) with a marker-freshness gate:
// when the hourly launchd lane already ran recently it is an instant no-op,
// otherwise it refreshes in-place (~1-2 min young cohort).
//
// The lane needs the shared launchd env (state root + YT API key); we source
// it through zsh exactly like the launchd jobs do. Production callers treat
// this step as best-effort: the Zoro King agent's daily_brief freshness gate
// (canDecide) is the hard guard at decision time, not this hook.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_MAX_STALENESS_MINUTES = 50;

export function buildRefreshPlan({
  env = process.env,
  homeDir = os.homedir(),
  maxStalenessMinutes = DEFAULT_MAX_STALENESS_MINUTES,
  repoRoot = REPO_ROOT,
  workspaceId = "clips",
} = {}) {
  const mindRoot = path.resolve(
    (env.MIND_REPO_ROOT || "").trim() || path.join(repoRoot, "..", "Mind"),
  );
  const laneScript = path.join(mindRoot, "scripts", "run-market-stats-lane.mjs");
  const launchdEnvPath = (env.MIND_MARKET_ENV_FILE || "").trim()
    || path.join(homeDir, ".codex", "environments", "mind-market-launchd.env.sh");
  const laneCommand = [
    `source '${launchdEnvPath}'`,
    `cd '${mindRoot}'`,
    `node '${laneScript}' --workspace ${workspaceId} --cohort young --max-staleness-minutes ${maxStalenessMinutes}`,
  ].join(" && ");
  return { laneCommand, laneScript, launchdEnvPath, maxStalenessMinutes, mindRoot, workspaceId };
}

export function parseArgs(argv) {
  let maxStalenessMinutes = DEFAULT_MAX_STALENESS_MINUTES;
  let workspaceId = "clips";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace") {
      workspaceId = (argv[index + 1] || "").trim() || workspaceId;
      index += 1;
      continue;
    }
    if (argument === "--max-staleness-minutes") {
      maxStalenessMinutes = Number.parseInt((argv[index + 1] || "").trim(), 10);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  if (!Number.isFinite(maxStalenessMinutes) || maxStalenessMinutes < 0) {
    throw new Error("--max-staleness-minutes must be a non-negative integer.");
  }
  return { maxStalenessMinutes, workspaceId };
}

export function runMarketStatsRefresh({ argv = [], spawn = spawnSync } = {}) {
  const { maxStalenessMinutes, workspaceId } = parseArgs(argv);
  const plan = buildRefreshPlan({ maxStalenessMinutes, workspaceId });

  if (!fs.existsSync(plan.laneScript)) {
    return {
      ok: false,
      reason: `Mind stats lane not found at ${plan.laneScript}; set MIND_REPO_ROOT`,
      plan,
    };
  }
  if (!fs.existsSync(plan.launchdEnvPath)) {
    return {
      ok: false,
      reason: `Market launchd env missing at ${plan.launchdEnvPath}; the lane would hit the wrong state root`,
      plan,
    };
  }

  const result = spawn("/bin/zsh", ["-lc", plan.laneCommand], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60 * 1000,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  // The lane streams step logs before printing its outcome JSON last; parse
  // from the LAST line-leading "{" so intermediate output cannot poison it.
  let laneOutcome = null;
  const candidates = [...stdout.matchAll(/^\{/gm)].map((match) => match.index).reverse();
  for (const start of candidates) {
    try {
      laneOutcome = JSON.parse(stdout.slice(start));
      break;
    } catch {
      laneOutcome = null;
    }
  }
  return {
    ok: result.status === 0,
    exitCode: result.status,
    laneStatus: laneOutcome?.status || null,
    laneOutcome,
    stderrExcerpt: result.status === 0 ? undefined : stderr.slice(0, 500),
    plan,
  };
}

async function main() {
  const outcome = runMarketStatsRefresh({ argv: process.argv.slice(2) });
  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
