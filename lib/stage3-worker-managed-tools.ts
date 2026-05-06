import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Stage3ManagedToolName = "ffmpeg" | "ffprobe" | "yt-dlp";
export type Stage3ManagedToolArchiveType = "file" | "tar.gz";
export type Stage3ManagedToolPlatform = "darwin-arm64" | "darwin-x64" | "win32-x64";

export type Stage3ManagedToolSpec = {
  url: string;
  sha256: string;
  type?: Stage3ManagedToolArchiveType;
  executablePath?: string;
};

export type Stage3ManagedToolManifest = {
  version: 1;
  platforms?: Partial<Record<Stage3ManagedToolPlatform, Partial<Record<Stage3ManagedToolName, Stage3ManagedToolSpec>>>>;
};

export type Stage3ManagedToolResult = {
  tool: Stage3ManagedToolName;
  status: "installed" | "already-present" | "not-configured";
  path: string | null;
};

type FetchLike = (url: string, init?: { cache?: "no-store" }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}>;

const TOOL_MANIFEST_PATH = "/stage3-worker/tool-manifest.json";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function detectStage3ManagedToolPlatform(): Stage3ManagedToolPlatform | null {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "darwin-x64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "win32-x64";
  }
  return null;
}

function defaultExecutableName(tool: Stage3ManagedToolName, platform: Stage3ManagedToolPlatform): string {
  if (platform === "win32-x64") {
    return tool === "yt-dlp" ? "yt-dlp.exe" : `${tool}.exe`;
  }
  return tool;
}

function defaultToolPath(toolsRoot: string, tool: Stage3ManagedToolName, platform: Stage3ManagedToolPlatform): string {
  const folder = tool === "ffprobe" ? "ffmpeg" : tool;
  return path.join(toolsRoot, folder, defaultExecutableName(tool, platform));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function downloadBytes(fetchImpl: FetchLike, url: string): Promise<Buffer> {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download managed Stage 3 worker tool ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function readManifest(fetchImpl: FetchLike, serverOrigin: string): Promise<Stage3ManagedToolManifest | null> {
  const response = await fetchImpl(`${normalizeOrigin(serverOrigin)}${TOOL_MANIFEST_PATH}`, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to read Stage 3 worker tool manifest: ${response.status}`);
  }
  const manifest = (await response.json()) as Stage3ManagedToolManifest;
  return manifest?.version === 1 ? manifest : null;
}

async function installFile(bytes: Buffer, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  await fs.chmod(destination, 0o755).catch(() => undefined);
}

async function installTarGz(bytes: Buffer, spec: Stage3ManagedToolSpec, destination: string): Promise<void> {
  if (!spec.executablePath?.trim()) {
    throw new Error("Managed Stage 3 worker tar.gz tool spec requires executablePath.");
  }
  const tmpRoot = await fs.mkdtemp(path.join(path.dirname(destination), ".download-"));
  const archivePath = path.join(tmpRoot, "tool.tar.gz");
  try {
    await fs.writeFile(archivePath, bytes);
    await execFileAsync(process.platform === "win32" ? "tar.exe" : "tar", ["-xzf", archivePath, "-C", tmpRoot]);
    const extractedPath = path.join(tmpRoot, spec.executablePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(extractedPath, destination);
    await fs.chmod(destination, 0o755).catch(() => undefined);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function ensureManagedStage3WorkerTools(input: {
  serverOrigin: string | null | undefined;
  toolsRoot: string;
  platform?: Stage3ManagedToolPlatform | null;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
}): Promise<Stage3ManagedToolResult[]> {
  const platform = input.platform ?? detectStage3ManagedToolPlatform();
  if (!input.serverOrigin?.trim() || !platform) {
    return [];
  }
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const manifest = await readManifest(fetchImpl, input.serverOrigin);
  const platformTools = platform ? manifest?.platforms?.[platform] : null;
  const toolNames: Stage3ManagedToolName[] = ["ffmpeg", "ffprobe", "yt-dlp"];
  const results: Stage3ManagedToolResult[] = [];

  for (const tool of toolNames) {
    const destination = defaultToolPath(input.toolsRoot, tool, platform);
    if (await fileExists(destination)) {
      results.push({ tool, status: "already-present", path: destination });
      continue;
    }

    const spec = platformTools?.[tool];
    if (!spec?.url?.trim() || !spec.sha256?.trim()) {
      results.push({ tool, status: "not-configured", path: null });
      continue;
    }

    input.log?.(`Downloading managed Stage 3 worker tool: ${tool}`);
    const bytes = await downloadBytes(fetchImpl, spec.url.trim());
    const actualHash = sha256(bytes);
    const expectedHash = spec.sha256.trim().toLowerCase();
    if (actualHash !== expectedHash) {
      throw new Error(
        `Managed Stage 3 worker tool ${tool} failed sha256 verification: expected ${expectedHash}, got ${actualHash}.`
      );
    }

    if ((spec.type ?? "file") === "tar.gz") {
      await installTarGz(bytes, spec, destination);
    } else {
      await installFile(bytes, destination);
    }
    results.push({ tool, status: "installed", path: destination });
  }

  return results;
}
