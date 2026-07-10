#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CDP = "http://127.0.0.1:52376";
const CLIPS_ORIGIN = "https://clips-vy11.onrender.com";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgument(name) {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeOutputPath(configured) {
  const output = path.resolve(REPO_ROOT, configured);
  const relative = path.relative(REPO_ROOT, output);
  const allowedRoots = ["source-candidates", "source-refill"].map((directory) =>
    `.data${path.sep}project-kings${path.sep}${directory}${path.sep}`
  );
  if (
    !allowedRoots.some((root) => relative.startsWith(root)) ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(output).toLowerCase() !== ".mp4"
  ) {
    throw new Error(
      "--output must be an MP4 inside .data/project-kings/source-candidates/ or .data/project-kings/source-refill/."
    );
  }
  return { output, relative };
}

function validateSourceUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)) {
    throw new Error("Only HTTPS Instagram source URLs are accepted.");
  }
  if (!/^\/reel\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error("Source URL must identify one Instagram Reel.");
  }
  url.search = "";
  url.hash = "";
  url.hostname = "www.instagram.com";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

class CdpSession {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket open timed out.")), 5_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket connection failed."));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`CDP command failed: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out.`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function authenticatedClipsHeaders(cdpOrigin) {
  const response = await fetch(`${cdpOrigin.replace(/\/$/, "")}/json/list`, {
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error(`CDP target discovery failed with HTTP ${response.status}.`);
  const targets = await response.json();
  const target = targets.find((entry) =>
    entry.type === "page" && entry.url === `${CLIPS_ORIGIN}/` && entry.webSocketDebuggerUrl
  );
  if (!target) throw new Error("Authenticated Clips owner page is not open in the configured CDP browser.");
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    const [{ cookies }, evaluated] = await Promise.all([
      session.command("Network.getCookies", { urls: [`${CLIPS_ORIGIN}/`] }),
      session.command("Runtime.evaluate", {
        expression: "navigator.userAgent",
        returnByValue: true
      })
    ]);
    const relevant = cookies.filter((cookie) =>
      cookie.domain === "clips-vy11.onrender.com" || cookie.domain === ".clips-vy11.onrender.com"
    );
    if (!relevant.length) throw new Error("Clips owner page has no authenticated session cookies.");
    return {
      Cookie: relevant.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      "User-Agent": evaluated.result?.value || "Mozilla/5.0"
    };
  } finally {
    session.close();
  }
}

const sourceUrl = validateSourceUrl(requiredArgument("--url"));
const { output, relative } = safeOutputPath(requiredArgument("--output"));
const cdpOrigin = argument("--cdp")?.trim() || DEFAULT_CDP;
await access(output).then(
  () => Promise.reject(new Error(`Output already exists: ${relative}`)),
  () => undefined
);
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.partial-${process.pid}`;

try {
  const authHeaders = await authenticatedClipsHeaders(cdpOrigin);
  const response = await fetch(`${CLIPS_ORIGIN}/api/download`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Origin: CLIPS_ORIGIN,
      Referer: `${CLIPS_ORIGIN}/`
    },
    body: JSON.stringify({ url: sourceUrl }),
    signal: AbortSignal.timeout(6 * 60_000)
  });
  if (!response.ok || !response.body) {
    const failure = (await response.text()).slice(0, 1_000);
    throw new Error(`Clips source download failed with HTTP ${response.status}: ${failure}`);
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("video/mp4")) {
    throw new Error(`Clips returned unexpected content type: ${response.headers.get("content-type") ?? "missing"}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
  const details = await stat(temporary);
  if (details.size < 1_024) throw new Error("Downloaded MP4 is unexpectedly small.");
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(temporary));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await rename(temporary, output);
  process.stdout.write(`${JSON.stringify({
    sourceUrl,
    relativePath: relative,
    bytes: details.size,
    sha256,
    provider: response.headers.get("x-source-provider") ?? "unknown"
  })}\n`);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
