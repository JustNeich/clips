#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const args = {
    email: "",
    skipStart: false
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--email") {
      args.email = argv[index + 1]?.trim() || "";
      index += 1;
    } else if (arg === "--skip-start") {
      args.skipStart = true;
    }
  }
  return args;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit"
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

function forwardSignals(child) {
  const forward = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
}

const args = parseArgs(process.argv);
if (!args.email) {
  throw new Error("Pass --email user@example.com.");
}

const removal = await run(process.execPath, [
  "scripts/remove-workspace-member-by-email.mjs",
  "--email",
  args.email,
  "--yes"
]);
if (removal.code !== 0) {
  process.exit(removal.code ?? 1);
}
if (args.skipStart) {
  process.exit(0);
}

mkdirSync(process.env.APP_DATA_DIR?.trim() || (process.env.RENDER ? "/var/data/app" : ".data"), {
  recursive: true
});
mkdirSync(process.env.CODEX_SESSIONS_DIR?.trim() || (process.env.RENDER ? "/var/data/codex-sessions" : ".data/codex-sessions"), {
  recursive: true
});

const port = process.env.PORT?.trim() || "10000";
const server = spawn("npx", ["next", "start", "-H", "0.0.0.0", "-p", port], {
  env: process.env,
  stdio: "inherit"
});
forwardSignals(server);

const result = await new Promise((resolve) => {
  server.on("close", (code, signal) => resolve({ code, signal }));
});
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.code ?? 0);
