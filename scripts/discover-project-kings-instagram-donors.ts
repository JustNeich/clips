#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  PROJECT_KINGS_INSTAGRAM_DONOR_POLICY,
  discoverProjectKingsInstagramDonors,
  verifyProjectKingsInstagramDiscoveryPacket,
  type ProjectKingsInstagramDiscoveryProfileKey,
  type ProjectKingsInstagramFetch
} from "../lib/project-kings/instagram-donor-discovery";

type CliOptions = Readonly<{
  outputPath: string;
  knownUrlsPath: string | null;
  profileKeys: readonly ProjectKingsInstagramDiscoveryProfileKey[] | undefined;
  capturedAt: string | undefined;
  pagesPerDonor: number | undefined;
  itemsPerDonor: number | undefined;
  pageSize: number | undefined;
  timeoutMs: number | undefined;
  maxAttempts: number | undefined;
  maxResponseBytes: number | undefined;
}>;

export type ProjectKingsInstagramDiscoveryCliDependencies = Readonly<{
  fetchImpl?: ProjectKingsInstagramFetch;
  sleep?: (delayMs: number) => Promise<void>;
  stdout?: (line: string) => void;
}>;

export const PROJECT_KINGS_INSTAGRAM_DISCOVERY_CLI_NAME =
  "discover-project-kings-instagram-donors" as const;

function optionValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}

export function parseProjectKingsInstagramDiscoveryCliArgs(args: readonly string[]): CliOptions {
  let outputPath: string | null = null;
  let knownUrlsPath: string | null = null;
  let profileKeys: ProjectKingsInstagramDiscoveryProfileKey[] | undefined;
  let capturedAt: string | undefined;
  let pagesPerDonor: number | undefined;
  let itemsPerDonor: number | undefined;
  let pageSize: number | undefined;
  let timeoutMs: number | undefined;
  let maxAttempts: number | undefined;
  let maxResponseBytes: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") outputPath = optionValue(args, index++, arg);
    else if (arg === "--known-urls") knownUrlsPath = optionValue(args, index++, arg);
    else if (arg === "--captured-at") capturedAt = optionValue(args, index++, arg);
    else if (arg === "--pages-per-donor") {
      pagesPerDonor = positiveInteger(optionValue(args, index++, arg), arg);
    } else if (arg === "--items-per-donor") {
      itemsPerDonor = positiveInteger(optionValue(args, index++, arg), arg);
    } else if (arg === "--page-size") pageSize = positiveInteger(optionValue(args, index++, arg), arg);
    else if (arg === "--timeout-ms") timeoutMs = positiveInteger(optionValue(args, index++, arg), arg);
    else if (arg === "--max-attempts") {
      maxAttempts = positiveInteger(optionValue(args, index++, arg), arg);
    } else if (arg === "--max-response-bytes") {
      maxResponseBytes = positiveInteger(optionValue(args, index++, arg), arg);
    } else if (arg === "--profiles") {
      const raw = optionValue(args, index++, arg);
      const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
      for (const value of values) {
        if (!Object.hasOwn(PROJECT_KINGS_INSTAGRAM_DONOR_POLICY, value)) {
          throw new Error(`Unsupported Project Kings profile: ${value}.`);
        }
      }
      profileKeys = values as ProjectKingsInstagramDiscoveryProfileKey[];
    } else {
      throw new Error(`Unsupported argument: ${arg ?? ""}.`);
    }
  }
  if (!outputPath) throw new Error("--output is required.");
  return {
    outputPath: path.resolve(outputPath),
    knownUrlsPath: knownUrlsPath ? path.resolve(knownUrlsPath) : null,
    profileKeys,
    capturedAt,
    pagesPerDonor,
    itemsPerDonor,
    pageSize,
    timeoutMs,
    maxAttempts,
    maxResponseBytes
  };
}

async function readKnownUrls(filePath: string | null): Promise<string[]> {
  if (!filePath) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new Error("Known-URLs file is not valid JSON.");
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray(
      (parsed as { knownCanonicalUrls?: unknown }).knownCanonicalUrls
    )
      ? (parsed as { knownCanonicalUrls: unknown[] }).knownCanonicalUrls
      : null;
  if (!values || !values.every((value) => typeof value === "string")) {
    throw new Error("Known-URLs file must be a JSON string array or { knownCanonicalUrls: string[] }.");
  }
  return values as string[];
}

async function writePacketAtomically(outputPath: string, payload: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function runProjectKingsInstagramDiscoveryCli(
  args: readonly string[],
  dependencies: ProjectKingsInstagramDiscoveryCliDependencies = {}
): Promise<Readonly<{
  outputPath: string;
  evidenceSha256: string;
  candidateCount: number;
  issueCount: number;
}>> {
  const options = parseProjectKingsInstagramDiscoveryCliArgs(args);
  const packet = await discoverProjectKingsInstagramDonors({
    profileKeys: options.profileKeys,
    knownCanonicalUrls: await readKnownUrls(options.knownUrlsPath),
    capturedAt: options.capturedAt,
    pagesPerDonor: options.pagesPerDonor,
    itemsPerDonor: options.itemsPerDonor,
    pageSize: options.pageSize,
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    maxResponseBytes: options.maxResponseBytes,
    fetchImpl: dependencies.fetchImpl,
    sleep: dependencies.sleep
  });
  verifyProjectKingsInstagramDiscoveryPacket(packet);
  await writePacketAtomically(options.outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  const result = {
    outputPath: options.outputPath,
    evidenceSha256: packet.evidenceSha256,
    candidateCount: packet.summary.candidateCount,
    issueCount: packet.summary.issueCount
  };
  (dependencies.stdout ?? ((line: string) => process.stdout.write(`${line}\n`)))(JSON.stringify(result));
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runProjectKingsInstagramDiscoveryCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Project Kings Instagram discovery failed: ${message}\n`);
    process.exitCode = 1;
  });
}
