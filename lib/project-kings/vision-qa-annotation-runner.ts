import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import {
  calculateBlindSafeVisionQaContextPacketSha256,
  calculateBlindVisionQaJudgeRequestSha256,
  type BlindSafeArtifactReference,
  type BlindVisionQaJudgeInput,
  type VisionQaReviewerProvenance
} from "./vision-qa-eval";

export const VISION_QA_ANNOTATION_CAMPAIGN_VERSION =
  "project-kings-vision-qa-annotation-campaign-v1" as const;
export const VISION_QA_ANNOTATION_PACKET_VERSION =
  "project-kings-vision-qa-annotation-packet-v1" as const;
export const VISION_QA_ANNOTATION_LEDGER_VERSION =
  "project-kings-vision-qa-annotation-ledger-v1" as const;

export type VisionQaAnnotationReviewerIdentity = Readonly<{
  reviewerId: string;
  reviewerKind: "human" | "model";
  provider: string;
  model: string | null;
  routeId: string | null;
  reasoningEffort: string | null;
  isolationBoundary: "independent_human" | "separate_process";
  independenceKey: string;
  identityEvidenceSha256: string;
}>;

export type VisionQaAnnotationCampaignManifest = Readonly<{
  schemaVersion: typeof VISION_QA_ANNOTATION_CAMPAIGN_VERSION;
  campaignId: string;
  corpusManifestSha256: string;
  createdAt: string;
  reviewers: readonly [VisionQaAnnotationReviewerIdentity, VisionQaAnnotationReviewerIdentity];
  adjudicator: VisionQaAnnotationReviewerIdentity;
  caseRequestSha256: readonly string[];
  packetSha256: readonly [string, string, string];
  groundTruthPresent: false;
  annotationCount: 0;
  adjudicationCount: 0;
  manifestSha256: string;
}>;

export type VisionQaAnnotationPacket = Readonly<{
  schemaVersion: typeof VISION_QA_ANNOTATION_PACKET_VERSION;
  packetId: string;
  campaignId: string;
  role: "reviewer";
  assignedIdentity: VisionQaAnnotationReviewerIdentity;
  rubricVersion: string;
  cases: readonly Readonly<{
    blindCaseToken: string;
    requestSha256: string;
    request: BlindVisionQaJudgeInput;
  }>[];
  forbiddenContext: readonly ["ground_truth", "defect_recipe", "other_reviews", "adjudication"];
  packetSha256: string;
}>;

export type VisionQaAdjudicationAssignmentPacket = Readonly<{
  schemaVersion: typeof VISION_QA_ANNOTATION_PACKET_VERSION;
  packetId: string;
  campaignId: string;
  role: "adjudicator";
  assignedIdentity: VisionQaAnnotationReviewerIdentity;
  rubricVersion: string;
  state: "awaiting_two_independent_annotations";
  expectedCaseRequestSha256: readonly string[];
  includedAnnotations: readonly [];
  includedGroundTruth: false;
  packetSha256: string;
}>;

export type VisionQaAnnotationLedgerEvent = Readonly<{
  schemaVersion: typeof VISION_QA_ANNOTATION_LEDGER_VERSION;
  sequence: number;
  eventId: string;
  eventType: "campaign_created" | "review_packet_issued" | "adjudication_assignment_issued";
  actorId: "system";
  payloadSha256: string;
  previousEventSha256: string | null;
  createdAt: string;
  eventSha256: string;
}>;

export type CreateVisionQaAnnotationCampaignInput = Readonly<{
  outputRoot: string;
  campaignId: string;
  corpusManifestSha256: string;
  createdAt: string;
  rubricVersion: string;
  reviewers: readonly [VisionQaAnnotationReviewerIdentity, VisionQaAnnotationReviewerIdentity];
  adjudicator: VisionQaAnnotationReviewerIdentity;
  cases: readonly BlindVisionQaJudgeInput[];
}>;

export type CreatedVisionQaAnnotationCampaign = Readonly<{
  root: string;
  manifestPath: string;
  ledgerPath: string;
  reviewerPacketPaths: readonly [string, string];
  adjudicationAssignmentPath: string;
  manifest: VisionQaAnnotationCampaignManifest;
}>;

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

function assertSha(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be lowercase SHA-256.`);
}

function validateIdentity(identity: VisionQaAnnotationReviewerIdentity, label: string): VisionQaAnnotationReviewerIdentity {
  if (!identity.reviewerId.trim() || !identity.provider.trim() || !identity.independenceKey.trim()) {
    throw new Error(`${label} identity fields are incomplete.`);
  }
  assertSha(identity.identityEvidenceSha256, `${label}.identityEvidenceSha256`);
  if (identity.reviewerKind === "model") {
    if (!identity.model?.trim() || !identity.routeId?.trim() || !identity.reasoningEffort?.trim() ||
        identity.isolationBoundary !== "separate_process") {
      throw new Error(`${label} model identity requires route, model, reasoning and separate-process isolation.`);
    }
  } else if (
    identity.reviewerKind !== "human" || identity.model !== null || identity.routeId !== null ||
    identity.reasoningEffort !== null || identity.isolationBoundary !== "independent_human"
  ) {
    throw new Error(`${label} human identity is inconsistent.`);
  }
  return structuredClone(identity);
}

function assertIndependentRoster(input: {
  reviewers: readonly [VisionQaAnnotationReviewerIdentity, VisionQaAnnotationReviewerIdentity];
  adjudicator: VisionQaAnnotationReviewerIdentity;
}): void {
  const identities = [...input.reviewers, input.adjudicator];
  for (const [index, identity] of identities.entries()) validateIdentity(identity, `identity[${index}]`);
  for (const [field, values] of [
    ["reviewerId", identities.map((identity) => identity.reviewerId)],
    ["independenceKey", identities.map((identity) => identity.independenceKey)],
    ["identityEvidenceSha256", identities.map((identity) => identity.identityEvidenceSha256)]
  ] as const) {
    if (new Set(values).size !== identities.length) throw new Error(`Annotation roster ${field} values must be independent.`);
  }
}

async function verifyBlindCaseFiles(request: BlindVisionQaJudgeInput): Promise<void> {
  if (calculateBlindSafeVisionQaContextPacketSha256(request.contextPacket) !== request.contextPacketSha256) {
    throw new Error("Annotation case context packet hash mismatch.");
  }
  const references: BlindSafeArtifactReference[] = [
    request.artifact,
    ...request.frames,
    request.contextPacket.template.reference,
    request.contextPacket.source.artifact,
    ...request.contextPacket.source.frames
  ];
  for (const reference of references) {
    if ((await sha256File(reference.filePath).catch(() => null)) !== reference.sha256) {
      throw new Error("Annotation case contains a missing or hash-mismatched artifact.");
    }
  }
  const serialized = stableJson(request);
  if (/groundTruthClass|ground_truth|sealed-recipes|defect_recipe|injectionRecipe|annotations|adjudication/.test(serialized)) {
    throw new Error("Annotation case leaks ground truth, a defect recipe, another review, or adjudication.");
  }
}

function packetWithHash<T extends UnknownRecord>(value: T): T & { packetSha256: string } {
  return { ...value, packetSha256: sha256(value) };
}

export function verifyVisionQaAnnotationPacket(
  packet: VisionQaAnnotationPacket | VisionQaAdjudicationAssignmentPacket
): void {
  if (packet.schemaVersion !== VISION_QA_ANNOTATION_PACKET_VERSION) throw new Error("Annotation packet version is unsupported.");
  assertSha(packet.packetSha256, "packetSha256");
  const { packetSha256, ...withoutHash } = packet;
  if (sha256(withoutHash) !== packetSha256) throw new Error("Annotation packet hash mismatch.");
  if (packet.role === "reviewer") {
    if (packet.cases.length < 1 || packet.forbiddenContext.join(",") !==
      "ground_truth,defect_recipe,other_reviews,adjudication") {
      throw new Error("Reviewer packet blindness contract is incomplete.");
    }
    for (const entry of packet.cases) {
      if (calculateBlindVisionQaJudgeRequestSha256(entry.request) !== entry.requestSha256) {
        throw new Error("Reviewer packet case request hash mismatch.");
      }
    }
  } else if (
    packet.state !== "awaiting_two_independent_annotations" ||
    packet.includedAnnotations.length !== 0 || packet.includedGroundTruth !== false
  ) {
    throw new Error("Adjudication assignment must remain closed until two independent annotations exist.");
  }
}

export function verifyVisionQaAnnotationCampaignManifest(
  manifest: VisionQaAnnotationCampaignManifest
): void {
  if (manifest.schemaVersion !== VISION_QA_ANNOTATION_CAMPAIGN_VERSION ||
      manifest.groundTruthPresent !== false || manifest.annotationCount !== 0 || manifest.adjudicationCount !== 0) {
    throw new Error("Annotation campaign manifest is not an empty blind-review skeleton.");
  }
  assertIndependentRoster({ reviewers: manifest.reviewers, adjudicator: manifest.adjudicator });
  assertSha(manifest.manifestSha256, "manifestSha256");
  const { manifestSha256, ...withoutHash } = manifest;
  if (sha256(withoutHash) !== manifestSha256) throw new Error("Annotation campaign manifest hash mismatch.");
}

function ledgerEvent(input: Omit<VisionQaAnnotationLedgerEvent, "schemaVersion" | "eventId" | "eventSha256">): VisionQaAnnotationLedgerEvent {
  const payload = {
    schemaVersion: VISION_QA_ANNOTATION_LEDGER_VERSION,
    ...input,
    eventId: sha256({
      sequence: input.sequence,
      eventType: input.eventType,
      payloadSha256: input.payloadSha256,
      previousEventSha256: input.previousEventSha256
    }).slice(0, 32)
  } as const;
  return { ...payload, eventSha256: sha256(payload) };
}

export function verifyVisionQaAnnotationLedger(events: readonly VisionQaAnnotationLedgerEvent[]): void {
  if (events.length < 1) throw new Error("Annotation provenance ledger is empty.");
  let previous: string | null = null;
  for (const [index, event] of events.entries()) {
    if (event.schemaVersion !== VISION_QA_ANNOTATION_LEDGER_VERSION || event.sequence !== index + 1 ||
        event.previousEventSha256 !== previous) {
      throw new Error("Annotation provenance ledger sequence or chain is invalid.");
    }
    const { eventSha256, ...withoutHash } = event;
    if (sha256(withoutHash) !== eventSha256) throw new Error("Annotation provenance ledger event hash mismatch.");
    previous = event.eventSha256;
  }
}

async function writeExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o444
  });
}

export async function createVisionQaAnnotationCampaign(
  input: CreateVisionQaAnnotationCampaignInput
): Promise<CreatedVisionQaAnnotationCampaign> {
  if (!input.campaignId.trim() || !input.rubricVersion.trim()) throw new Error("Campaign and rubric identities are required.");
  assertSha(input.corpusManifestSha256, "corpusManifestSha256");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO timestamp.");
  if (input.cases.length < 1) throw new Error("Annotation campaign requires at least one blind case.");
  assertIndependentRoster(input);
  const caseRequestSha256: string[] = [];
  const caseTokens = new Set<string>();
  for (const request of input.cases) {
    if (caseTokens.has(request.blindCaseToken)) throw new Error("Annotation campaign contains duplicate blind case tokens.");
    caseTokens.add(request.blindCaseToken);
    await verifyBlindCaseFiles(request);
    caseRequestSha256.push(calculateBlindVisionQaJudgeRequestSha256(request));
  }
  const outputRoot = path.resolve(input.outputRoot);
  await fs.mkdir(outputRoot, { recursive: true });
  const campaignRoot = path.join(outputRoot, sha256(`annotation-campaign:${input.campaignId}`).slice(0, 32));
  const packetsRoot = path.join(campaignRoot, "packets");
  if (await fs.stat(campaignRoot).catch(() => null)) {
    throw new Error("Annotation campaign already exists; packets and provenance ledger are append-only.");
  }
  let campaignCreated = false;
  try {
    await fs.mkdir(campaignRoot, { recursive: false });
    campaignCreated = true;
    await fs.mkdir(packetsRoot, { recursive: false });
  } catch (error) {
    if (campaignCreated) await fs.rm(campaignRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const reviewerPackets = input.reviewers.map((identity, index) => packetWithHash({
    schemaVersion: VISION_QA_ANNOTATION_PACKET_VERSION,
    packetId: sha256(`review-packet:${input.campaignId}:${identity.reviewerId}`).slice(0, 32),
    campaignId: input.campaignId,
    role: "reviewer" as const,
    assignedIdentity: identity,
    rubricVersion: input.rubricVersion,
    cases: input.cases.map((request, caseIndex) => ({
      blindCaseToken: request.blindCaseToken,
      requestSha256: caseRequestSha256[caseIndex]!,
      request
    })),
    forbiddenContext: ["ground_truth", "defect_recipe", "other_reviews", "adjudication"] as const
  })) as unknown as [VisionQaAnnotationPacket, VisionQaAnnotationPacket];
  const adjudicationAssignment = packetWithHash({
    schemaVersion: VISION_QA_ANNOTATION_PACKET_VERSION,
    packetId: sha256(`adjudication-packet:${input.campaignId}:${input.adjudicator.reviewerId}`).slice(0, 32),
    campaignId: input.campaignId,
    role: "adjudicator" as const,
    assignedIdentity: input.adjudicator,
    rubricVersion: input.rubricVersion,
    state: "awaiting_two_independent_annotations" as const,
    expectedCaseRequestSha256: caseRequestSha256,
    includedAnnotations: [] as const,
    includedGroundTruth: false as const
  }) as VisionQaAdjudicationAssignmentPacket;
  const packets = [...reviewerPackets, adjudicationAssignment] as const;
  const packetPaths = packets.map((packet) => path.join(packetsRoot, `${packet.packetId}.json`));
  const manifestWithoutHash = {
    schemaVersion: VISION_QA_ANNOTATION_CAMPAIGN_VERSION,
    campaignId: input.campaignId,
    corpusManifestSha256: input.corpusManifestSha256,
    createdAt: input.createdAt,
    reviewers: input.reviewers,
    adjudicator: input.adjudicator,
    caseRequestSha256,
    packetSha256: packets.map((packet) => packet.packetSha256) as [string, string, string],
    groundTruthPresent: false as const,
    annotationCount: 0 as const,
    adjudicationCount: 0 as const
  };
  const manifest: VisionQaAnnotationCampaignManifest = {
    ...manifestWithoutHash,
    manifestSha256: sha256(manifestWithoutHash)
  };
  verifyVisionQaAnnotationPacket(reviewerPackets[0]);
  verifyVisionQaAnnotationPacket(reviewerPackets[1]);
  verifyVisionQaAnnotationPacket(adjudicationAssignment);
  verifyVisionQaAnnotationCampaignManifest(manifest);
  const manifestPath = path.join(campaignRoot, "manifest.json");
  const ledgerPath = path.join(campaignRoot, "provenance.jsonl");
  const events: VisionQaAnnotationLedgerEvent[] = [];
  const appendEvent = (eventType: VisionQaAnnotationLedgerEvent["eventType"], payloadSha256: string) => {
    events.push(ledgerEvent({
      sequence: events.length + 1,
      eventType,
      actorId: "system",
      payloadSha256,
      previousEventSha256: events.at(-1)?.eventSha256 ?? null,
      createdAt: input.createdAt
    }));
  };
  appendEvent("campaign_created", manifest.manifestSha256);
  appendEvent("review_packet_issued", reviewerPackets[0].packetSha256);
  appendEvent("review_packet_issued", reviewerPackets[1].packetSha256);
  appendEvent("adjudication_assignment_issued", adjudicationAssignment.packetSha256);
  verifyVisionQaAnnotationLedger(events);
  try {
    await writeExclusiveJson(manifestPath, manifest);
    for (const [index, packet] of packets.entries()) await writeExclusiveJson(packetPaths[index]!, packet);
    await fs.writeFile(ledgerPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o444
    });
  } catch (error) {
    await fs.rm(campaignRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    root: campaignRoot,
    manifestPath,
    ledgerPath,
    reviewerPacketPaths: [packetPaths[0]!, packetPaths[1]!],
    adjudicationAssignmentPath: packetPaths[2]!,
    manifest
  };
}

export function reviewerProvenanceMatchesIdentity(input: {
  provenance: VisionQaReviewerProvenance;
  identity: VisionQaAnnotationReviewerIdentity;
}): boolean {
  return input.provenance.reviewerKind === input.identity.reviewerKind &&
    input.provenance.provider === input.identity.provider &&
    input.provenance.model === input.identity.model &&
    input.provenance.routeId === input.identity.routeId &&
    input.provenance.reasoningEffort === input.identity.reasoningEffort &&
    input.provenance.isolationBoundary === input.identity.isolationBoundary &&
    input.provenance.independenceKey === input.identity.independenceKey &&
    /^[a-f0-9]{64}$/.test(input.provenance.invocationEvidenceSha256);
}
