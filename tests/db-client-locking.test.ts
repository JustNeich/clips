import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDb } from "../lib/db/client";

test("app db waits for short inter-process SQLite write locks", { concurrency: false }, async () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousBusyTimeout = process.env.APP_DB_BUSY_TIMEOUT_MS;
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-db-lock-test-"));

  process.env.APP_DATA_DIR = appDataDir;
  process.env.APP_DB_BUSY_TIMEOUT_MS = "3000";

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_DATA_DIR: appDataDir,
        APP_DB_BUSY_TIMEOUT_MS: "3000"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.stdin.end(`
      import dbClient from "./lib/db/client.ts";
      const { getDb } = dbClient;
      try {
        getDb().prepare("SELECT COUNT(*) AS count FROM workspaces").get();
        console.log("child-ok");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
      }
    `);

    await new Promise((resolve) => setTimeout(resolve, 500));
    db.exec("ROLLBACK");

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("close", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    assert.match(stdout, /child-ok/);
    assert.doesNotMatch(stderr, /database is locked/i);
  } finally {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The test normally rolls back before waiting for the child.
    }
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousBusyTimeout === undefined) {
      delete process.env.APP_DB_BUSY_TIMEOUT_MS;
    } else {
      process.env.APP_DB_BUSY_TIMEOUT_MS = previousBusyTimeout;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
});
