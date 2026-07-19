#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const envFile = process.env.CLIPS_MCP_ENV_FILE || `${process.env.HOME || ""}/.config/assistant/clips-mcp.env`;
const appUrl = (process.env.CLIPS_APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const checks = [];

function addCheck(name, status, detail = "") {
  checks.push({ name, status, detail });
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout || 8000,
      cwd: options.cwd || process.cwd(),
      env: process.env
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.trim?.() || "",
      stderr: error.stderr?.trim?.() || error.message
    };
  }
}

async function loadEnvFile() {
  if (!existsSync(envFile)) {
    addCheck("env-file", "warn", `${envFile} is missing`);
    return;
  }
  const stat = statSync(envFile);
  const mode = stat.mode & 0o777;
  addCheck("env-file", mode === 0o600 ? "ok" : "warn", `${envFile} mode=${mode.toString(8)}`);
  const raw = await readFile(envFile, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

async function checkCommand(label, command, args) {
  const result = await run(command, args);
  addCheck(label, result.ok ? "ok" : "warn", result.ok ? result.stdout.split("\n")[0] : result.stderr);
}

async function checkNode() {
  const result = await run("node", ["--version"]);
  if (!result.ok) {
    addCheck("node", "warn", result.stderr);
    return;
  }
  const firstLine = result.stdout.split("\n")[0] || "";
  addCheck("node", /^v22\./.test(firstLine) ? "ok" : "warn", `${firstLine} (repo expects Node 22)`);
}

async function checkGithubSsh() {
  const result = await run("ssh", ["-T", "git@github.com"]);
  const detail = result.ok ? result.stdout : result.stderr;
  const authenticated = /successfully authenticated/i.test(detail);
  addCheck("github-ssh", result.ok || authenticated ? "ok" : "warn", detail);
}

async function checkHttp() {
  try {
    const health = await fetch(`${appUrl}/api/health`, { headers: { Accept: "application/json" } });
    addCheck("app-health", health.ok ? "ok" : "warn", `${appUrl}/api/health -> ${health.status}`);
  } catch (error) {
    addCheck("app-health", "warn", error instanceof Error ? error.message : String(error));
  }

  const token = process.env.CLIPS_MCP_TOKEN?.trim();
  if (!token) {
    addCheck("owner-mcp-token", "warn", "CLIPS_MCP_TOKEN is not loaded; owner MCP status skipped");
    return;
  }
  try {
    const response = await fetch(`${appUrl}/api/admin/control`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ tool: "clips_owner_status", input: {} })
    });
    addCheck("owner-mcp-status", response.ok ? "ok" : "fail", `POST /api/admin/control -> ${response.status}`);
  } catch (error) {
    addCheck("owner-mcp-status", "fail", error instanceof Error ? error.message : String(error));
  }
}

await loadEnvFile();
await checkNode();
await checkCommand("npm", "npm", ["--version"]);
await checkCommand("git-remote", "git", ["remote", "-v"]);
await checkCommand("gh-auth", "gh", ["auth", "status"]);
await checkGithubSsh();
await checkCommand("ffmpeg", "ffmpeg", ["-version"]);
await checkCommand("ffprobe", "ffprobe", ["-version"]);
await checkCommand("yt-dlp", "yt-dlp", ["--version"]);
await checkCommand("codex", "codex", ["--version"]);
await checkHttp();

const failed = checks.filter((check) => check.status === "fail");
const warned = checks.filter((check) => check.status === "warn");
console.log(JSON.stringify({ appUrl, checks }, null, 2));
process.exit(failed.length > 0 ? 1 : warned.length > 0 ? 2 : 0);
