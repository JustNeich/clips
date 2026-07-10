import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants, createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  PRODUCTION_AGENT_OUTPUT_SCHEMAS,
  validateProductionAgentOutput,
  validateProductionAgentPacket,
  type ProductionAgentArtifact,
  type VisionQaOutput,
  type VisionQaPacket
} from "./production-agent-contracts";
import {
  createCodexProductionAgentInvoker,
  runProductionSemanticAgent,
  type ProductionAgentInvoker
} from "./production-agent-runtime";
import {
  loadFrozenProductionAgentRouteManifest,
  parseFrozenProductionAgentRouteManifest,
  type FrozenProductionAgentRouteManifest
} from "./production-model-route-manifest";
import {
  calculateBlindSafeVisionQaContextPacketSha256,
  calculateBlindVisionQaJudgeInvocationEvidenceSha256,
  calculateBlindVisionQaJudgeRequestSha256,
  calculateBlindVisionQaJudgeVerdictSha256,
  type BlindSafeArtifactReference,
  type BlindVisionQaJudge,
  type BlindVisionQaJudgeInput,
  type BlindVisionQaJudgeResult
} from "./vision-qa-eval";

const execFileAsync = promisify(execFile);

export const ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION =
  "project-kings-isolated-vision-qa-judge-v1" as const;
export const DEFAULT_ISOLATED_VISION_QA_ADAPTER_ID =
  "project-kings-blind-vision-qa-separate-process-v1";

export type IsolatedVisionQaJudgeEnvelope = Readonly<{
  schemaVersion: typeof ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION;
  request: BlindVisionQaJudgeInput;
  requestSha256: string;
  routeManifestSha256: string;
  adapter: Readonly<{
    adapterId: string;
    adapterSha256: string;
  }>;
}>;

export type IsolatedVisionQaAdapterIdentity = Readonly<{
  executionBoundary: "separate_process";
  adapterId: string;
  adapterSha256: string;
  attestationSha256: string;
}>;

export type ExecuteIsolatedVisionQaEnvelopeInput = Readonly<{
  envelope: IsolatedVisionQaJudgeEnvelope;
  manifest: FrozenProductionAgentRouteManifest;
  workingDirectory: string;
  invoker: ProductionAgentInvoker;
}>;

type ChildProcessExecutor = (input: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<{ stdout: string; stderr: string }>;

type UnknownRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as UnknownRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string | Uint8Array | unknown): string {
  const payload = typeof value === "string" || value instanceof Uint8Array ? value : stableJson(value);
  return createHash("sha256").update(payload).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256.`);
  }
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function assertBlindRequestContainsNoPrivilegedContext(request: unknown): void {
  const value = record(request, "envelope.request");
  exactKeys(value, [
    "blindCaseToken", "channelId", "templateSha256", "conceptId", "artifact", "frames",
    "contextPacket", "contextPacketSha256"
  ], "envelope.request");
  const context = record(value.contextPacket, "envelope.request.contextPacket");
  exactKeys(context, [
    "schemaVersion", "conceptContract", "template", "source", "brief", "factualEvidence",
    "duplicateLedger", "bannedWords"
  ], "envelope.request.contextPacket");
  const serialized = stableJson(request);
  if (/groundTruthClass|ground_truth|sealed-recipes|defect_recipe|injectionRecipe|annotations|adjudication/.test(serialized)) {
    throw new Error("Isolated judge request contains privileged corpus labels, recipes, reviews or adjudication.");
  }
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Unknown error"))
    .replace(/\s+/g, " ").trim().slice(0, 1_000);
}

function selectedFrames<T>(values: readonly T[], maximum: number): T[] {
  if (values.length <= maximum) return [...values];
  const indexes = new Set<number>();
  for (let index = 0; index < maximum; index += 1) {
    indexes.add(Math.round(index * (values.length - 1) / (maximum - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => values[index]!);
}

async function copyVerifiedReference(input: {
  reference: BlindSafeArtifactReference;
  destinationRoot: string;
  index: number;
  extension: string;
}): Promise<BlindSafeArtifactReference> {
  const actual = await sha256File(input.reference.filePath).catch(() => null);
  if (actual !== input.reference.sha256) throw new Error("Blind judge input artifact hash changed before isolation.");
  const filePath = path.join(input.destinationRoot, `a${String(input.index).padStart(3, "0")}${input.extension}`);
  await fs.copyFile(input.reference.filePath, filePath, fsConstants.COPYFILE_EXCL);
  return { filePath, sha256: input.reference.sha256 };
}

async function stageBlindRequest(input: {
  request: BlindVisionQaJudgeInput;
  destinationRoot: string;
}): Promise<BlindVisionQaJudgeInput> {
  if (calculateBlindSafeVisionQaContextPacketSha256(input.request.contextPacket) !== input.request.contextPacketSha256) {
    throw new Error("Blind context packet hash changed before process isolation.");
  }
  let artifactIndex = 1;
  const finalArtifact = await copyVerifiedReference({
    reference: input.request.artifact,
    destinationRoot: input.destinationRoot,
    index: artifactIndex++,
    extension: ".mp4"
  });
  const outputFrames = [];
  for (const frame of input.request.frames) {
    const staged = await copyVerifiedReference({
      reference: frame,
      destinationRoot: input.destinationRoot,
      index: artifactIndex++,
      extension: ".png"
    });
    outputFrames.push({ ...frame, filePath: staged.filePath });
  }
  const templateReference = await copyVerifiedReference({
    reference: input.request.contextPacket.template.reference,
    destinationRoot: input.destinationRoot,
    index: artifactIndex++,
    extension: ".png"
  });
  const sourceArtifact = await copyVerifiedReference({
    reference: input.request.contextPacket.source.artifact,
    destinationRoot: input.destinationRoot,
    index: artifactIndex++,
    extension: ".mp4"
  });
  const sourceFrames = [];
  for (const frame of input.request.contextPacket.source.frames) {
    const staged = await copyVerifiedReference({
      reference: frame,
      destinationRoot: input.destinationRoot,
      index: artifactIndex++,
      extension: ".png"
    });
    sourceFrames.push({ ...frame, filePath: staged.filePath });
  }
  const staged: BlindVisionQaJudgeInput = {
    ...input.request,
    artifact: finalArtifact,
    frames: outputFrames,
    contextPacket: {
      ...input.request.contextPacket,
      template: { ...input.request.contextPacket.template, reference: templateReference },
      source: {
        ...input.request.contextPacket.source,
        artifact: sourceArtifact,
        frames: sourceFrames
      }
    }
  };
  if (
    calculateBlindSafeVisionQaContextPacketSha256(staged.contextPacket) !== staged.contextPacketSha256 ||
    calculateBlindVisionQaJudgeRequestSha256(staged) !== calculateBlindVisionQaJudgeRequestSha256(input.request)
  ) {
    throw new Error("Opaque path staging changed the logical blind request hash.");
  }
  return staged;
}

export async function inspectIsolatedVisionQaJudgeAdapter(input: {
  adapterPath: string;
  adapterId?: string;
  implementationPaths?: readonly string[];
}): Promise<IsolatedVisionQaAdapterIdentity> {
  const adapterPath = path.resolve(input.adapterPath);
  const repoRoot = path.resolve(path.dirname(adapterPath), "..");
  const implementationPaths = input.implementationPaths?.length
    ? input.implementationPaths.map((filePath) => path.resolve(filePath))
    : [
        adapterPath,
        path.join(repoRoot, "lib/project-kings/vision-qa-isolated-judge.ts"),
        path.join(repoRoot, "lib/project-kings/vision-qa-eval.ts"),
        path.join(repoRoot, "lib/project-kings/production-agent-contracts.ts"),
        path.join(repoRoot, "lib/project-kings/production-agent-runtime.ts"),
        path.join(repoRoot, "lib/project-kings/production-model-route-manifest.ts")
      ];
  if (!implementationPaths.includes(adapterPath)) implementationPaths.unshift(adapterPath);
  const implementation = [];
  for (const filePath of [...new Set(implementationPaths)].sort()) {
    implementation.push({
      path: path.relative(repoRoot, filePath),
      sha256: await sha256File(filePath)
    });
  }
  const adapterSha256 = sha256({
    protocol: ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION,
    implementation
  });
  const adapterId = input.adapterId?.trim() || DEFAULT_ISOLATED_VISION_QA_ADAPTER_ID;
  return {
    executionBoundary: "separate_process",
    adapterId,
    adapterSha256,
    attestationSha256: sha256({
      protocol: ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION,
      executionBoundary: "separate_process",
      adapterId,
      adapterSha256
    })
  };
}

export function parseIsolatedVisionQaJudgeEnvelope(raw: unknown): IsolatedVisionQaJudgeEnvelope {
  const value = record(raw, "envelope");
  exactKeys(value, ["schemaVersion", "request", "requestSha256", "routeManifestSha256", "adapter"], "envelope");
  if (value.schemaVersion !== ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION) throw new Error("Isolated judge protocol is unsupported.");
  const adapter = record(value.adapter, "envelope.adapter");
  exactKeys(adapter, ["adapterId", "adapterSha256"], "envelope.adapter");
  if (typeof adapter.adapterId !== "string" || !adapter.adapterId.trim()) throw new Error("adapterId is required.");
  assertSha(adapter.adapterSha256, "adapterSha256");
  assertSha(value.requestSha256, "requestSha256");
  assertSha(value.routeManifestSha256, "routeManifestSha256");
  assertBlindRequestContainsNoPrivilegedContext(value.request);
  const request = value.request as BlindVisionQaJudgeInput;
  if (calculateBlindVisionQaJudgeRequestSha256(request) !== value.requestSha256) {
    throw new Error("Isolated judge request hash mismatch.");
  }
  if (calculateBlindSafeVisionQaContextPacketSha256(request.contextPacket) !== request.contextPacketSha256) {
    throw new Error("Isolated judge context packet hash mismatch.");
  }
  return {
    schemaVersion: ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION,
    request,
    requestSha256: value.requestSha256,
    routeManifestSha256: value.routeManifestSha256,
    adapter: { adapterId: adapter.adapterId.trim(), adapterSha256: adapter.adapterSha256 }
  };
}

async function writeJsonArtifact(input: {
  root: string;
  id: string;
  kind: ProductionAgentArtifact["kind"];
  value: unknown;
}): Promise<ProductionAgentArtifact> {
  const filePath = path.join(input.root, `${input.id}.json`);
  const content = `${JSON.stringify(input.value, null, 2)}\n`;
  await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  return { id: input.id, kind: input.kind, mediaType: "json", path: filePath, sha256: sha256(content) };
}

async function buildProductionPacket(input: {
  request: BlindVisionQaJudgeInput;
  workingDirectory: string;
}): Promise<VisionQaPacket> {
  const request = input.request;
  const artifacts: ProductionAgentArtifact[] = [
    await writeJsonArtifact({
      root: input.workingDirectory,
      id: "context-01",
      kind: "concept_contract",
      value: request.contextPacket.conceptContract
    }),
    await writeJsonArtifact({
      root: input.workingDirectory,
      id: "context-02",
      kind: "source_metadata",
      value: {
        templateSha256: request.contextPacket.template.templateSha256,
        layoutKind: request.contextPacket.template.layoutKind,
        frame: request.contextPacket.template.frame,
        mediaViewport: request.contextPacket.template.mediaViewport,
        authorizedTemplateText: request.contextPacket.template.authorizedText
      }
    }),
    await writeJsonArtifact({
      root: input.workingDirectory,
      id: "context-03",
      kind: "caption_brief",
      value: {
        sourceSha256: request.contextPacket.source.artifact.sha256,
        sourceCrop: request.contextPacket.source.crop,
        brief: request.contextPacket.brief,
        duplicateLedger: request.contextPacket.duplicateLedger,
        bannedWords: request.contextPacket.bannedWords
      }
    }),
    await writeJsonArtifact({
      root: input.workingDirectory,
      id: "context-04",
      kind: "factual_evidence",
      value: request.contextPacket.factualEvidence
    }),
    {
      id: "template-reference",
      kind: "key_frame",
      mediaType: "image",
      path: request.contextPacket.template.reference.filePath,
      sha256: request.contextPacket.template.reference.sha256
    }
  ];
  for (const [index, frame] of selectedFrames(request.frames, 8).entries()) {
    artifacts.push({
      id: `output-frame-${index + 1}`,
      kind: "preview_frame",
      mediaType: "image",
      path: frame.filePath,
      sha256: frame.sha256
    });
  }
  for (const [index, frame] of selectedFrames(request.contextPacket.source.frames, 6).entries()) {
    artifacts.push({
      id: `source-frame-${index + 1}`,
      kind: "key_frame",
      mediaType: "image",
      path: frame.filePath,
      sha256: frame.sha256
    });
  }
  const packet: VisionQaPacket = {
    schemaVersion: "production-agent-packet-v1",
    role: "vision_qa",
    runId: `blind-${request.blindCaseToken.slice(0, 24)}`,
    itemId: request.blindCaseToken,
    channelId: request.channelId,
    profileVersion: "vision-qa-blind-context-v1",
    task: {
      templateSha256: request.templateSha256,
      conceptId: request.conceptId,
      sourceSha256: request.contextPacket.source.artifact.sha256,
      previewSha256: request.artifact.sha256,
      knownSourceSha256: request.contextPacket.duplicateLedger.knownSourceSha256,
      knownStoryEventIds: request.contextPacket.duplicateLedger.knownStoryEventIds
    },
    artifacts
  };
  return validateProductionAgentPacket("vision_qa", packet);
}

async function verifyEnvelopeFiles(request: BlindVisionQaJudgeInput): Promise<void> {
  const references: BlindSafeArtifactReference[] = [
    request.artifact,
    ...request.frames,
    request.contextPacket.template.reference,
    request.contextPacket.source.artifact,
    ...request.contextPacket.source.frames
  ];
  for (const reference of references) {
    if ((await sha256File(reference.filePath).catch(() => null)) !== reference.sha256) {
      throw new Error("Isolated blind request contains a missing or hash-mismatched artifact.");
    }
  }
}

export async function executeIsolatedVisionQaJudgeEnvelope(
  input: ExecuteIsolatedVisionQaEnvelopeInput
): Promise<BlindVisionQaJudgeResult> {
  const envelope = parseIsolatedVisionQaJudgeEnvelope(input.envelope);
  if (envelope.routeManifestSha256 !== input.manifest.manifestSha256) {
    throw new Error("Frozen Vision QA route manifest hash mismatch.");
  }
  const reparsedManifest = parseFrozenProductionAgentRouteManifest(input.manifest);
  if (reparsedManifest.manifestSha256 !== input.manifest.manifestSha256) throw new Error("Frozen route manifest changed.");
  await verifyEnvelopeFiles(envelope.request);
  const packet = await buildProductionPacket({ request: envelope.request, workingDirectory: input.workingDirectory });
  const run = await runProductionSemanticAgent({
    role: "vision_qa",
    packet,
    selection: input.manifest.selections.vision_qa,
    invoker: input.invoker,
    maxAttempts: 1
  });
  const primary = input.manifest.selections.vision_qa.primary;
  if (run.selectedRouteId !== primary.route.routeId) throw new Error("Isolated judge escaped the frozen primary Vision QA route.");
  const verdict = validateProductionAgentOutput("vision_qa", run.output) as VisionQaOutput;
  const provenance: BlindVisionQaJudgeResult["provenance"] = {
    invocationId: sha256({
      requestSha256: envelope.requestSha256,
      verdictSha256: calculateBlindVisionQaJudgeVerdictSha256(verdict),
      manifestSha256: input.manifest.manifestSha256,
      adapterSha256: envelope.adapter.adapterSha256
    }).slice(0, 40),
    routeId: primary.route.routeId,
    model: primary.route.model,
    reasoningEffort: primary.benchmark.reasoningEffort,
    executionBoundary: "separate_process",
    adapterId: envelope.adapter.adapterId,
    adapterSha256: envelope.adapter.adapterSha256,
    routeManifestSha256: input.manifest.manifestSha256,
    routeBenchmarkEvidenceSha256: input.manifest.evidence.vision_qa.evidenceSha256,
    requestSha256: envelope.requestSha256,
    verdictSha256: calculateBlindVisionQaJudgeVerdictSha256(verdict)
  };
  return {
    verdict,
    provenance,
    invocationEvidenceSha256: calculateBlindVisionQaJudgeInvocationEvidenceSha256(provenance)
  };
}

async function defaultChildProcessExecutor(input: Parameters<ChildProcessExecutor>[0]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env,
    timeout: input.timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  });
  return { stdout, stderr };
}

export function createSeparateProcessBlindVisionQaJudge(options: {
  repoRoot: string;
  adapterCliPath: string;
  routeManifestPath: string;
  codexHome: string;
  adapterIdentity: IsolatedVisionQaAdapterIdentity;
  tempRoot?: string;
  nodeExecutable?: string;
  processExecutor?: ChildProcessExecutor;
}): BlindVisionQaJudge {
  return async (request) => {
    const actualIdentity = await inspectIsolatedVisionQaJudgeAdapter({
      adapterPath: options.adapterCliPath,
      adapterId: options.adapterIdentity.adapterId
    });
    if (stableJson(actualIdentity) !== stableJson(options.adapterIdentity)) {
      throw new Error("Isolated Vision QA adapter identity changed before invocation.");
    }
    const manifest = await loadFrozenProductionAgentRouteManifest({
      repoCwd: options.repoRoot,
      manifestPath: options.routeManifestPath
    });
    const tempRoot = path.resolve(options.tempRoot ?? os.tmpdir());
    await fs.mkdir(tempRoot, { recursive: true });
    const isolatedRoot = await fs.mkdtemp(path.join(tempRoot, `qa-${randomUUID().replace(/-/g, "")}-`));
    const requestPath = path.join(isolatedRoot, "i.json");
    const outputPath = path.join(isolatedRoot, "o.json");
    const stagedManifestPath = path.join(isolatedRoot, "m.json");
    try {
      const stagedRequest = await stageBlindRequest({ request, destinationRoot: isolatedRoot });
      const envelope: IsolatedVisionQaJudgeEnvelope = {
        schemaVersion: ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION,
        request: stagedRequest,
        requestSha256: calculateBlindVisionQaJudgeRequestSha256(stagedRequest),
        routeManifestSha256: manifest.manifestSha256,
        adapter: {
          adapterId: actualIdentity.adapterId,
          adapterSha256: actualIdentity.adapterSha256
        }
      };
      await Promise.all([
        fs.writeFile(requestPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
        fs.writeFile(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
      ]);
      const execute = options.processExecutor ?? defaultChildProcessExecutor;
      await execute({
        executable: options.nodeExecutable ?? process.execPath,
        args: [
          "--import", "tsx", path.resolve(options.adapterCliPath),
          "--request", requestPath,
          "--output", outputPath,
          "--manifest", stagedManifestPath,
          "--codex-home", path.resolve(options.codexHome),
          "--adapter-id", actualIdentity.adapterId,
          "--adapter-sha256", actualIdentity.adapterSha256
        ],
        cwd: isolatedRoot,
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: isolatedRoot,
          LANG: process.env.LANG ?? "C.UTF-8"
        },
        timeoutMs: manifest.selections.vision_qa.primary.route.capabilities.timeoutMs + 60_000
      });
      const result = JSON.parse(await fs.readFile(outputPath, "utf8")) as BlindVisionQaJudgeResult;
      assertSha(result.invocationEvidenceSha256, "invocationEvidenceSha256");
      const verdict = validateProductionAgentOutput("vision_qa", result.verdict);
      const primary = manifest.selections.vision_qa.primary;
      if (
        result.provenance.requestSha256 !== envelope.requestSha256 ||
        result.provenance.verdictSha256 !== calculateBlindVisionQaJudgeVerdictSha256(verdict) ||
        result.provenance.routeId !== primary.route.routeId ||
        result.provenance.model !== primary.route.model ||
        result.provenance.reasoningEffort !== primary.benchmark.reasoningEffort ||
        result.provenance.routeManifestSha256 !== manifest.manifestSha256 ||
        result.provenance.routeBenchmarkEvidenceSha256 !== manifest.evidence.vision_qa.evidenceSha256 ||
        result.provenance.adapterId !== actualIdentity.adapterId ||
        result.provenance.adapterSha256 !== actualIdentity.adapterSha256 ||
        result.provenance.executionBoundary !== "separate_process" ||
        result.invocationEvidenceSha256 !== calculateBlindVisionQaJudgeInvocationEvidenceSha256(result.provenance)
      ) {
        throw new Error("Separate-process Vision QA result provenance is invalid.");
      }
      return result;
    } catch (error) {
      throw new Error(`Separate-process Vision QA failed closed: ${normalizeError(error)}`);
    } finally {
      await fs.rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

export async function runIsolatedVisionQaJudgeCli(input: {
  requestPath: string;
  outputPath: string;
  manifestPath: string;
  codexHome: string;
  adapterPath: string;
  adapterId: string;
  expectedAdapterSha256: string;
}): Promise<void> {
  const actualIdentity = await inspectIsolatedVisionQaJudgeAdapter({
    adapterPath: input.adapterPath,
    adapterId: input.adapterId
  });
  const actualAdapterSha256 = actualIdentity.adapterSha256;
  if (actualAdapterSha256 !== input.expectedAdapterSha256) throw new Error("Adapter implementation SHA-256 mismatch.");
  const envelope = parseIsolatedVisionQaJudgeEnvelope(JSON.parse(await fs.readFile(input.requestPath, "utf8")));
  if (envelope.adapter.adapterId !== input.adapterId || envelope.adapter.adapterSha256 !== actualAdapterSha256) {
    throw new Error("Adapter identity does not match the isolated request envelope.");
  }
  const manifest = await loadFrozenProductionAgentRouteManifest({
    repoCwd: path.dirname(input.manifestPath),
    manifestPath: input.manifestPath
  });
  const workingDirectory = path.dirname(input.requestPath);
  const invoker = createCodexProductionAgentInvoker({
    repoCwd: workingDirectory,
    codexHome: input.codexHome,
    tempRoot: path.join(workingDirectory, ".agent")
  });
  const result = await executeIsolatedVisionQaJudgeEnvelope({
    envelope,
    manifest,
    workingDirectory,
    invoker
  });
  await fs.writeFile(input.outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export const ISOLATED_VISION_QA_OUTPUT_SCHEMA = PRODUCTION_AGENT_OUTPUT_SCHEMAS.vision_qa;
