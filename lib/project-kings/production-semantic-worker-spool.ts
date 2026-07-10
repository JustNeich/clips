import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  validateProductionSemanticJobResult,
  type ProductionSemanticJobPayload,
  type ProductionSemanticJobResult
} from "./production-semantic-job-contract";

type SpoolEnvelope = Readonly<{
  schemaVersion: "project-kings-semantic-result-spool-v1";
  jobIdSha256: string;
  payloadSha256: string;
  result: ProductionSemanticJobResult;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function spoolPath(root: string, jobId: string): string {
  return path.join(root, `${sha256(jobId)}.json`);
}

async function ensurePrivateSpoolRoot(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.stat(root);
  if (!stat.isDirectory() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw new Error("Production semantic result spool must be a private 0700 directory.");
  }
}

export async function persistProductionSemanticResultSpool(input: {
  spoolRoot: string;
  jobId: string;
  payload: ProductionSemanticJobPayload;
  result: ProductionSemanticJobResult;
}): Promise<string> {
  const result = validateProductionSemanticJobResult(input.result, input.payload);
  const envelope: SpoolEnvelope = {
    schemaVersion: "project-kings-semantic-result-spool-v1",
    jobIdSha256: sha256(input.jobId),
    payloadSha256: input.payload.payloadSha256,
    result
  };
  await ensurePrivateSpoolRoot(input.spoolRoot);
  const destination = spoolPath(input.spoolRoot, input.jobId);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, destination);
  const directory = await fs.open(input.spoolRoot, "r").catch(() => null);
  try {
    await directory?.sync();
  } finally {
    await directory?.close();
  }
  return destination;
}

export async function readProductionSemanticResultSpool(input: {
  spoolRoot: string;
  jobId: string;
  payload: ProductionSemanticJobPayload;
}): Promise<ProductionSemanticJobResult | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(spoolPath(input.spoolRoot, input.jobId), "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const envelope = parsed as Partial<SpoolEnvelope>;
  if (
    envelope.schemaVersion !== "project-kings-semantic-result-spool-v1" ||
    envelope.jobIdSha256 !== sha256(input.jobId) ||
    envelope.payloadSha256 !== input.payload.payloadSha256 ||
    !envelope.result
  ) {
    return null;
  }
  try {
    return validateProductionSemanticJobResult(envelope.result, input.payload);
  } catch {
    return null;
  }
}

export async function removeProductionSemanticResultSpool(input: {
  spoolRoot: string;
  jobId: string;
}): Promise<void> {
  await fs.rm(spoolPath(input.spoolRoot, input.jobId), { force: true });
}

export async function quarantineInvalidProductionSemanticResultSpool(input: {
  spoolRoot: string;
  jobId: string;
}): Promise<void> {
  const current = spoolPath(input.spoolRoot, input.jobId);
  const quarantined = `${current}.invalid-${Date.now()}`;
  await fs.rename(current, quarantined).catch(() => undefined);
}
