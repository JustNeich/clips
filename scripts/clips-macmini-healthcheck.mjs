#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

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
      maxBuffer: options.maxBuffer || 1024 * 1024,
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

export function parseMacTcpPortPressure(output) {
  const [rawCount, rawFirst, rawLast] = output.trim().split(/\s+/).map(Number);
  const capacity = rawLast - rawFirst + 1;
  if (
    !Number.isFinite(rawCount) || rawCount < 0 ||
    !Number.isFinite(rawFirst) || rawFirst < 0 ||
    !Number.isFinite(rawLast) || rawLast < rawFirst ||
    !Number.isFinite(capacity) || capacity <= 0
  ) {
    return null;
  }
  return { count: rawCount, first: rawFirst, last: rawLast, capacity, ratio: rawCount / capacity };
}

export function countMacTcpTimeWait(output) {
  return output.split(/\r?\n/).filter((line) => /\bTIME_WAIT\b/.test(line)).length;
}

export function findOrphanedStage3Browsers(output, homeDir) {
  const workerRoot = `${homeDir}/Library/Application Support/Clips Stage3 Worker`.toLowerCase();
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] }))
    .filter((record) => {
      const command = record.command.toLowerCase();
      const headless =
        command.includes("chrome-headless-shell") ||
        command.includes("headless_shell") ||
        command.includes("headless shell");
      const workerOwned = command.includes(workerRoot) || command.includes("/caches/remotion/");
      return record.parentPid === 1 && headless && workerOwned;
    });
}

function parseBoolean(value) {
  return value.trim().toLowerCase() === "true";
}

async function checkMacStability() {
  if (process.platform !== "darwin") {
    addCheck("mac-stability", "warn", "Mac stability checks are available only on macOS");
    return;
  }

  const tcp = await run(
    "/usr/sbin/sysctl",
    ["-n", "net.inet.tcp.pcbcount", "net.inet.ip.portrange.first", "net.inet.ip.portrange.last"]
  );
  const netstat = await run("/usr/sbin/netstat", ["-an", "-p", "tcp"], {
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024
  });
  const pressure = tcp.ok ? parseMacTcpPortPressure(tcp.stdout) : null;
  const timeWait = netstat.ok ? countMacTcpTimeWait(netstat.stdout) : null;
  if (!pressure) {
    addCheck("tcp-port-pressure", "warn", tcp.stderr || "TCP port metrics are unavailable");
  } else {
    const status = pressure.ratio >= 0.8 ? "fail" : pressure.ratio >= 0.5 ? "warn" : "ok";
    addCheck(
      "tcp-port-pressure",
      status,
      `pcb=${pressure.count}/${pressure.capacity} (${Math.round(pressure.ratio * 100)}%), TIME_WAIT=${timeWait ?? "unknown"}`
    );
  }

  const ps = await run("/bin/ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 });
  const orphanedBrowsers = ps.ok
    ? findOrphanedStage3Browsers(ps.stdout, process.env.HOME || "")
    : [];
  addCheck(
    "orphaned-stage3-browsers",
    !ps.ok || orphanedBrowsers.length > 0 ? "warn" : "ok",
    ps.ok ? `count=${orphanedBrowsers.length}` : ps.stderr
  );

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const plistPath = `${process.env.HOME || ""}/Library/LaunchAgents/com.clips.stage3-worker.plist`;
  if (existsSync(plistPath)) {
    const keepAlive = await run("/usr/libexec/PlistBuddy", ["-c", "Print :KeepAlive", plistPath]);
    const throttle = await run("/usr/libexec/PlistBuddy", ["-c", "Print :ThrottleInterval", plistPath]);
    const keepAliveEnabled = keepAlive.ok && parseBoolean(keepAlive.stdout);
    const throttleSec = throttle.ok ? Number(throttle.stdout) : 0;
    const safeSupervisor = !keepAliveEnabled || (Number.isFinite(throttleSec) && throttleSec >= 60);
    addCheck(
      "worker-launchd-restart-guard",
      safeSupervisor ? "ok" : "fail",
      `KeepAlive=${keepAlive.ok ? keepAlive.stdout : "unknown"}, ThrottleInterval=${throttle.ok ? throttle.stdout : "missing"}`
    );
    if (uid !== null) {
      const disabled = await run("/bin/launchctl", ["print-disabled", `gui/${uid}`]);
      const isDisabled = disabled.ok && /"com\.clips\.stage3-worker"\s*=>\s*disabled/.test(disabled.stdout);
      addCheck("worker-launchd-state", isDisabled ? "warn" : "ok", isDisabled ? "disabled" : "enabled");
    }
  } else {
    addCheck("worker-launchd-restart-guard", "warn", `${plistPath} is missing`);
  }

  for (const port of [22, 5900]) {
    const listener = await run("/usr/bin/nc", ["-z", "127.0.0.1", String(port)]);
    addCheck(`local-listener-${port}`, listener.ok ? "ok" : "fail", listener.ok ? "listening" : listener.stderr);
  }

  const route = await run("/sbin/route", ["-n", "get", "1.1.1.1"]);
  const routeInterface = route.ok ? route.stdout.match(/interface:\s*(\S+)/)?.[1] || "unknown" : "unknown";
  addCheck(
    "vpn-route",
    /^utun\d+$/.test(routeInterface) ? "ok" : "warn",
    route.ok ? `interface=${routeInterface}` : route.stderr
  );

  const workerLogPath = `${process.env.HOME || ""}/Library/Logs/Clips Stage3 Worker/stderr.log`;
  if (existsSync(workerLogPath)) {
    const bytes = statSync(workerLogPath).size;
    addCheck("worker-stderr-size", bytes >= 10 * 1024 * 1024 ? "warn" : "ok", `${bytes} bytes`);
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

export async function runMacMiniHealthcheck() {
  checks.length = 0;
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
  await checkMacStability();

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  console.log(JSON.stringify({ appUrl, checks }, null, 2));
  return failed.length > 0 ? 1 : warned.length > 0 ? 2 : 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === "clips-macmini-healthcheck.mjs") {
  void runMacMiniHealthcheck()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
