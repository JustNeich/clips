#!/usr/bin/env node

import { chmod, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import profileStoreModule from "../lib/project-kings/pilot-profile-store";

import {
  createProjectKingsHttpSourceUploadProvider,
  createProjectKingsInstagramDiscoveryProvider,
  createProjectKingsLocalMediaEvidenceProvider,
  createProjectKingsLocalSourceDownloadProvider,
  createProjectKingsSourceFitAssessor,
  createProjectKingsSourcePolicyAssessor,
  loadProjectKingsSourceRefillSemanticRuntime,
  readProjectKingsSourceBufferRuntime
} from "../lib/project-kings/source-refill-adapters";
import {
  runProjectKingsAutonomousSourceRefill
} from "../lib/project-kings/source-refill-contour";
import {
  FileProjectKingsSourceRefillLedgerStore,
  type ProjectKingsSourceRefillMode
} from "../lib/project-kings/source-refill-ledger";

const {
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID,
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256
} = profileStoreModule;

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_CONFIG = path.join(
  os.homedir(),
  ".config/assistant/project-kings-source-buffer-refiller.env"
);

type Env = Record<string, string>;

function parseEnv(raw: string): Env {
  const output: Env = {};
  for (const sourceLine of raw.split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Source-refill config contains a malformed line.");
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error("Source-refill config key is invalid.");
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function homePath(value: string): string {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

async function privateEnv(filePath: string): Promise<Env> {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile()) throw new Error(`Private source-refill config is missing: ${filePath}.`);
  if ((details.mode & 0o777) !== 0o600) throw new Error(`Private source-refill config must use mode 0600: ${filePath}.`);
  return parseEnv(await readFile(filePath, "utf8"));
}

function argument(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function flag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

function modeFrom(argv: readonly string[]): ProjectKingsSourceRefillMode {
  const value = argument(argv, "--mode") ?? "dry_run";
  if (!(["dry_run", "shadow", "execute"] as const).includes(value as ProjectKingsSourceRefillMode)) {
    throw new Error("--mode must be dry_run, shadow or execute.");
  }
  return value as ProjectKingsSourceRefillMode;
}

function canonicalAppUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("CLIPS_APP_URL must use HTTPS or loopback HTTP.");
  }
  return url.toString().replace(/\/+$/, "");
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const configPath = path.resolve(homePath(argument(argv, "--config") ?? DEFAULT_CONFIG));
  const config = await privateEnv(configPath);
  const authPathRaw = config.CLIPS_MCP_ENV_FILE;
  if (!authPathRaw) throw new Error("CLIPS_MCP_ENV_FILE is required.");
  const authPath = path.resolve(homePath(authPathRaw));
  const auth = await privateEnv(authPath);
  const token = auth.CLIPS_MCP_TOKEN?.trim();
  if (!token) throw new Error("CLIPS_MCP_TOKEN is missing from the private machine credential file.");
  const mode = modeFrom(argv);
  if (
    mode === "execute" &&
    (!flag(argv, "--allow-upload") || config.PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED !== "1")
  ) {
    throw new Error(
      "Execute mode requires both --allow-upload and PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1."
    );
  }
  const appUrl = canonicalAppUrl(auth.CLIPS_APP_URL ?? "https://clips-vy11.onrender.com");
  const stateDir = path.resolve(homePath(
    config.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR ??
      path.join(
        os.homedir(),
        "Library/Application Support/com.zoro.clips-project-kings-source-buffer-refiller"
      )
  ));
  const ledgerPath = path.join(stateDir, "autonomous-refill-ledger.json");
  const manifestPath = config.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH?.trim() || null;
  const { manifest, invoker } = await loadProjectKingsSourceRefillSemanticRuntime({
    repoRoot: REPO_ROOT,
    manifestPath,
    codexHome: config.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex")
  });
  if (
    manifest.manifestId !== PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID ||
    manifest.manifestSha256 !== PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256
  ) {
    throw new Error("Autonomous source refill requires the exact active Project Kings v4 route manifest.");
  }
  const runtime = await readProjectKingsSourceBufferRuntime({ appUrl, token });
  const capturedAt = new Date().toISOString();
  const result = await runProjectKingsAutonomousSourceRefill({
    mode,
    logicalDate: capturedAt.slice(0, 10),
    capturedAt,
    runtime,
    routeManifest: manifest,
    ledger: new FileProjectKingsSourceRefillLedgerStore(ledgerPath),
    discoveryProviders: [createProjectKingsInstagramDiscoveryProvider()],
    downloadProvider: createProjectKingsLocalSourceDownloadProvider({
      repoRoot: REPO_ROOT,
      cdpOrigin: config.PROJECT_KINGS_CLIPS_CDP_ORIGIN?.trim() || null
    }),
    mediaEvidenceProvider: createProjectKingsLocalMediaEvidenceProvider({
      repoRoot: REPO_ROOT,
      whisperModel: config.PROJECT_KINGS_SOURCE_REFILL_WHISPER_MODEL?.trim() || "tiny"
    }),
    policyAssessor: createProjectKingsSourcePolicyAssessor({ repoRoot: REPO_ROOT, invoker }),
    sourceFitAssessor: createProjectKingsSourceFitAssessor({ repoRoot: REPO_ROOT, invoker }),
    uploadProvider: createProjectKingsHttpSourceUploadProvider({ appUrl, token })
  });
  await chmod(path.dirname(ledgerPath), 0o700).catch(() => undefined);
  process.stdout.write(`${JSON.stringify({
    ...result,
    ledgerPath: path.relative(REPO_ROOT, ledgerPath).startsWith("..")
      ? "[PRIVATE_STATE_DIR]/autonomous-refill-ledger.json"
      : path.relative(REPO_ROOT, ledgerPath)
  }, null, 2)}\n`);
  if (result.status === "blocked" || result.status === "partial") process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    scope: "project-kings-autonomous-source-refill",
    status: "blocked",
    error: (error instanceof Error ? error.message : String(error))
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/(cookie|token|authorization)=?[^\s,;]*/gi, "$1=[REDACTED]")
  })}\n`);
  process.exitCode = 1;
});
