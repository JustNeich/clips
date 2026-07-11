import { createHash } from "node:crypto";

import {
  parseProductionAgentOutput,
  type SourcePolicyOutput
} from "./production-agent-contracts";
import {
  canonicalizeProjectKingsSourceUrl,
  type ProjectKingsSourcePolicyCandidateArtifacts
} from "./source-buffer-readiness";
import {
  PROJECT_KINGS_SOURCE_POLICY,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  hashProjectKingsSourcePolicyArtifact
} from "./source-rights-sensitive-policy";

export const PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID =
  "codex:gpt-5.6-luna" as const;
export const PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT =
  "medium" as const;

export type ProjectKingsSourcePolicyReplayBinding = Readonly<{
  benchmarkCaseId: string;
  candidateId: string;
  profileKey: "dark-joy-boy" | "light-kingdom" | "copscopes-x2e";
  canonicalSourceUrl: string;
  contentSha256: string;
  provider: "instagram" | "youtube_ask";
  route: "instagram_donor_pool" | "youtube_ask_v3";
  donorUsername: string | null;
  upstreamDiscoveryEvidenceSha256: string;
}>;

export type ProjectKingsSourcePolicyBenchmarkReplayResult = Readonly<{
  schemaVersion: "project-kings-source-policy-benchmark-replay-v1";
  selectedRouteId: typeof PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID;
  reasoningEffort: typeof PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT;
  datasetSha256: string;
  datasetFileSha256: string;
  rawEvidenceSha256: string;
  bindingsSha256: string;
  artifacts: readonly ProjectKingsSourcePolicyCandidateArtifacts[];
  replayEvidenceSha256: string;
}>;

type UnknownRecord = Record<string, unknown>;

const SHA256 = /^[a-f0-9]{64}$/;
const PROFILES = ["dark-joy-boy", "light-kingdom", "copscopes-x2e"] as const;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} must contain exactly: ${required.join(", ")}.`);
  }
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label);
  if (!SHA256.test(result)) throw new Error(`${label} must be a lowercase SHA-256.`);
  return result;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] {
  if (!allowed.includes(value as T[number])) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

function hashBytes(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function payloadWithout(value: UnknownRecord, key: string): UnknownRecord {
  const payload = { ...value };
  delete payload[key];
  return payload;
}

function parseBindings(raw: unknown): readonly ProjectKingsSourcePolicyReplayBinding[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("replay bindings must be a non-empty JSON array.");
  }
  const seenCases = new Set<string>();
  const seenCandidates = new Set<string>();
  return raw.map((entry, index) => {
    const value = record(entry, `bindings[${index}]`);
    exactKeys(value, [
      "benchmarkCaseId",
      "candidateId",
      "profileKey",
      "canonicalSourceUrl",
      "contentSha256",
      "provider",
      "route",
      "donorUsername",
      "upstreamDiscoveryEvidenceSha256"
    ], `bindings[${index}]`);
    const benchmarkCaseId = text(value.benchmarkCaseId, `bindings[${index}].benchmarkCaseId`);
    const candidateId = text(value.candidateId, `bindings[${index}].candidateId`);
    if (seenCases.has(benchmarkCaseId)) throw new Error(`Duplicate replay case ${benchmarkCaseId}.`);
    if (seenCandidates.has(candidateId)) throw new Error(`Duplicate replay candidate ${candidateId}.`);
    seenCases.add(benchmarkCaseId);
    seenCandidates.add(candidateId);
    const profileKey = oneOf(value.profileKey, PROFILES, `bindings[${index}].profileKey`);
    const provider = oneOf(
      value.provider,
      ["instagram", "youtube_ask"] as const,
      `bindings[${index}].provider`
    );
    const route = oneOf(
      value.route,
      ["instagram_donor_pool", "youtube_ask_v3"] as const,
      `bindings[${index}].route`
    );
    const donorUsername = value.donorUsername === null
      ? null
      : text(value.donorUsername, `bindings[${index}].donorUsername`);
    if (donorUsername !== null && donorUsername !== donorUsername.toLowerCase()) {
      throw new Error(`bindings[${index}].donorUsername must already be lowercase.`);
    }
    const canonicalSourceUrl = text(
      value.canonicalSourceUrl,
      `bindings[${index}].canonicalSourceUrl`
    );
    if (canonicalizeProjectKingsSourceUrl(canonicalSourceUrl) !== canonicalSourceUrl) {
      throw new Error(`bindings[${index}].canonicalSourceUrl is not canonical.`);
    }
    const policyRoute = PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[profileKey];
    if (route === "instagram_donor_pool") {
      if (
        provider !== "instagram" ||
        donorUsername === null ||
        !(policyRoute.instagramDonors as readonly string[]).includes(donorUsername)
      ) {
        throw new Error(`bindings[${index}] is not an approved Instagram donor route.`);
      }
    } else if (provider !== "youtube_ask" || donorUsername !== null || !policyRoute.youtubeAsk) {
      throw new Error(`bindings[${index}] is not an approved YouTube Ask route.`);
    }
    return {
      benchmarkCaseId,
      candidateId,
      profileKey,
      canonicalSourceUrl,
      contentSha256: sha256(value.contentSha256, `bindings[${index}].contentSha256`),
      provider,
      route,
      donorUsername,
      upstreamDiscoveryEvidenceSha256: sha256(
        value.upstreamDiscoveryEvidenceSha256,
        `bindings[${index}].upstreamDiscoveryEvidenceSha256`
      )
    };
  });
}

export function replayProjectKingsSourcePolicyBenchmark(input: {
  dataset: unknown;
  datasetFileSha256: string;
  rawEvidence: unknown;
  bindings: unknown;
}): ProjectKingsSourcePolicyBenchmarkReplayResult {
  const dataset = record(input.dataset, "dataset");
  if (dataset.schemaVersion !== "project-kings-source-policy-dataset-v1") {
    throw new Error("Unsupported source-policy dataset schema.");
  }
  if (dataset.datasetVersion !== "real-30-v1") {
    throw new Error("Replay requires the frozen real-30-v1 source-policy dataset.");
  }
  if (
    dataset.policyVersion !== PROJECT_KINGS_SOURCE_POLICY_VERSION ||
    dataset.policySha256 !== PROJECT_KINGS_SOURCE_POLICY_SHA256
  ) {
    throw new Error("Source-policy dataset is not bound to the active policy.");
  }
  const datasetSha256 = sha256(dataset.datasetSha256, "dataset.datasetSha256");
  if (
    hashProjectKingsSourcePolicyArtifact(payloadWithout(dataset, "datasetSha256")) !==
    datasetSha256
  ) {
    throw new Error("Source-policy dataset hash mismatch.");
  }
  const datasetFileSha256 = sha256(input.datasetFileSha256, "datasetFileSha256");
  const rawEvidence = record(input.rawEvidence, "raw evidence");
  if (
    rawEvidence.schemaVersion !== "project-kings-source-policy-model-raw-evidence-v1" ||
    rawEvidence.benchmarkVersion !== "project-kings-source-policy-real-30-2026-07-10-v9" ||
    rawEvidence.stageRole !== "source_policy" ||
    rawEvidence.outcome !== "pass"
  ) {
    throw new Error("Raw evidence is not a successful source_policy benchmark.");
  }
  const rawEvidenceSha256 = sha256(rawEvidence.rawEvidenceSha256, "raw evidence.rawEvidenceSha256");
  if (
    hashProjectKingsSourcePolicyArtifact(payloadWithout(rawEvidence, "rawEvidenceSha256")) !==
    rawEvidenceSha256
  ) {
    throw new Error("Raw source-policy evidence hash mismatch.");
  }
  if (rawEvidence.datasetSha256 !== datasetFileSha256) {
    throw new Error("Raw evidence is not bound to these exact dataset-file bytes.");
  }
  if (!Array.isArray(dataset.cases) || !Array.isArray(rawEvidence.calls)) {
    throw new Error("Dataset cases and raw calls must be arrays.");
  }
  if (rawEvidence.callCount !== rawEvidence.calls.length) {
    throw new Error("Raw evidence callCount does not match calls.");
  }

  const datasetCases = new Map<string, {
    profileKey: ProjectKingsSourcePolicyReplayBinding["profileKey"];
    canonicalSourceUrl: string;
    contentSha256: string;
    caseBindingSha256: string;
  }>();
  for (const [index, rawCase] of dataset.cases.entries()) {
    const datasetCase = record(rawCase, `dataset.cases[${index}]`);
    const caseBindingSha256 = sha256(
      datasetCase.caseBindingSha256,
      `dataset.cases[${index}].caseBindingSha256`
    );
    if (
      hashProjectKingsSourcePolicyArtifact(payloadWithout(datasetCase, "caseBindingSha256")) !==
      caseBindingSha256
    ) {
      throw new Error(`dataset.cases[${index}] binding hash mismatch.`);
    }
    const caseId = text(datasetCase.caseId, `dataset.cases[${index}].caseId`);
    if (datasetCases.has(caseId)) throw new Error(`Duplicate dataset case ${caseId}.`);
    datasetCases.set(caseId, {
      profileKey: oneOf(datasetCase.profileKey, PROFILES, `${caseId}.profileKey`),
      canonicalSourceUrl: canonicalizeProjectKingsSourceUrl(
        text(datasetCase.sourceUrl, `${caseId}.sourceUrl`)
      ),
      contentSha256: sha256(datasetCase.contentSha256, `${caseId}.contentSha256`),
      caseBindingSha256
    });
  }

  const selectedCalls = new Map<string, {
    promptSha256: string;
    outputSha256: string;
    output: SourcePolicyOutput;
  }>();
  for (const [index, rawCall] of rawEvidence.calls.entries()) {
    const call = record(rawCall, `raw evidence.calls[${index}]`);
    if (
      call.routeId !== PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID ||
      call.reasoningEffort !== PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT
    ) {
      continue;
    }
    if (call.model !== "gpt-5.6-luna" || call.outcome !== "returned") {
      throw new Error(`Selected raw call ${index} has the wrong model or outcome.`);
    }
    const caseId = text(call.caseId, `raw evidence.calls[${index}].caseId`);
    if (selectedCalls.has(caseId)) throw new Error(`Duplicate selected raw call for ${caseId}.`);
    const rawOutput = text(call.rawOutput, `raw evidence.calls[${index}].rawOutput`);
    const outputSha256 = sha256(call.outputSha256, `raw evidence.calls[${index}].outputSha256`);
    if (hashBytes(rawOutput) !== outputSha256) {
      throw new Error(`Selected raw call ${caseId} output hash mismatch.`);
    }
    const output = parseProductionAgentOutput("source_policy", rawOutput);
    const datasetCase = datasetCases.get(caseId);
    if (
      !datasetCase ||
      output.candidateId !== caseId ||
      output.contentSha256 !== datasetCase.contentSha256
    ) {
      throw new Error(`Selected raw call ${caseId} is not bound to its dataset case.`);
    }
    selectedCalls.set(caseId, {
      promptSha256: sha256(call.promptSha256, `raw evidence.calls[${index}].promptSha256`),
      outputSha256,
      output
    });
  }
  if (selectedCalls.size !== datasetCases.size) {
    throw new Error(
      `Expected exactly one ${PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID}/` +
      `${PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT} call for every dataset case.`
    );
  }

  const bindings = parseBindings(input.bindings);
  const artifacts = bindings.map((binding) => {
    const datasetCase = datasetCases.get(binding.benchmarkCaseId);
    const call = selectedCalls.get(binding.benchmarkCaseId);
    if (!datasetCase || !call) {
      throw new Error(`Replay binding targets unknown case ${binding.benchmarkCaseId}.`);
    }
    if (
      binding.profileKey !== datasetCase.profileKey ||
      binding.canonicalSourceUrl !== datasetCase.canonicalSourceUrl ||
      binding.contentSha256 !== datasetCase.contentSha256
    ) {
      throw new Error(
        `Replay binding ${binding.benchmarkCaseId} must match exact profileKey + canonicalSourceUrl + contentSha256.`
      );
    }
    const designation = createProjectKingsSourceDesignationEvidence({
      candidateId: binding.candidateId,
      profileKey: binding.profileKey,
      provider: binding.provider,
      route: binding.route,
      donorUsername: binding.donorUsername,
      canonicalSourceUrl: binding.canonicalSourceUrl,
      rightsEvidenceStatus: "covered_by_approved_source_policy",
      upstreamDiscoveryEvidenceSha256: binding.upstreamDiscoveryEvidenceSha256
    });
    const upstreamEvidenceSha256 = hashProjectKingsSourcePolicyArtifact({
      replayVersion: "project-kings-source-policy-benchmark-replay-v1",
      datasetSha256,
      datasetCaseBindingSha256: datasetCase.caseBindingSha256,
      rawEvidenceSha256,
      selectedRouteId: PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID,
      reasoningEffort: PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT,
      promptSha256: call.promptSha256,
      outputSha256: call.outputSha256
    });
    const sensitiveAssessment = createProjectKingsSensitiveContentAssessment({
      candidateId: binding.candidateId,
      contentSha256: binding.contentSha256,
      upstreamEvidenceSha256,
      signals: call.output.signals
    });
    return Object.freeze({
      candidateId: binding.candidateId,
      discoveryState: "frozen_catalog" as const,
      designation,
      sensitiveAssessment
    });
  });
  const payload = {
    schemaVersion: "project-kings-source-policy-benchmark-replay-v1" as const,
    selectedRouteId: PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID,
    reasoningEffort: PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT,
    datasetSha256,
    datasetFileSha256,
    rawEvidenceSha256,
    bindingsSha256: hashProjectKingsSourcePolicyArtifact(bindings),
    artifacts: Object.freeze(artifacts)
  };
  return Object.freeze({
    ...payload,
    replayEvidenceSha256: hashProjectKingsSourcePolicyArtifact(payload)
  });
}
