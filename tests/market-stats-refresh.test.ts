import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_STALENESS_MINUTES,
  buildRefreshPlan,
  parseArgs
} from "../scripts/market-stats-refresh.mjs";

test("parseArgs defaults and overrides", () => {
  assert.deepEqual(parseArgs([]), {
    maxStalenessMinutes: DEFAULT_MAX_STALENESS_MINUTES,
    workspaceId: "clips",
  });
  assert.deepEqual(parseArgs(["--workspace", "clips", "--max-staleness-minutes", "10"]), {
    maxStalenessMinutes: 10,
    workspaceId: "clips",
  });
  assert.throws(() => parseArgs(["--max-staleness-minutes", "-1"]), /non-negative/);
  assert.throws(() => parseArgs(["--bogus"]), /Unsupported argument/);
});

test("buildRefreshPlan resolves the sibling Mind repo by default", () => {
  const plan = buildRefreshPlan({
    env: {},
    homeDir: "/Users/op",
    repoRoot: "/work/Macedonian Imperium/clips automations",
  });
  assert.equal(plan.mindRoot, "/work/Macedonian Imperium/Mind");
  assert.equal(plan.launchdEnvPath, "/Users/op/.codex/environments/mind-market-launchd.env.sh");
  assert.match(plan.laneCommand, /--cohort young/);
  assert.match(plan.laneCommand, new RegExp(`--max-staleness-minutes ${DEFAULT_MAX_STALENESS_MINUTES}`));
  assert.match(plan.laneCommand, /^source '\/Users\/op\/\.codex\/environments\/mind-market-launchd\.env\.sh' && /);
});

test("buildRefreshPlan honors MIND_REPO_ROOT and MIND_MARKET_ENV_FILE", () => {
  const plan = buildRefreshPlan({
    env: {
      MIND_MARKET_ENV_FILE: "/custom/market.env.sh",
      MIND_REPO_ROOT: "/custom/Mind",
    },
    homeDir: "/Users/op",
    repoRoot: "/anywhere",
  });
  assert.equal(plan.mindRoot, "/custom/Mind");
  assert.equal(plan.launchdEnvPath, "/custom/market.env.sh");
});
