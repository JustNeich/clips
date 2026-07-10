#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultEvidencePath = path.join(
  repoRoot,
  "docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10-v7.json"
);
const SOURCE_QUALIFICATION_V2 = "project-kings-source-qualification-v2";
const SOURCE_POLICY_V2 = "project-kings-source-rights-sensitive-policy-v2";
const SOURCE_POLICY_SHA256 =
  "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39";
const SHA256 = /^[a-f0-9]{64}$/;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function parseEnvText(raw) {
  const output = {};
  for (const rawLine of String(raw).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const source = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = source.indexOf("=");
    if (separator <= 0) throw new Error("Machine environment contains a malformed line.");
    const key = source.slice(0, separator).trim();
    let value = source.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function resolveHome(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

async function loadRuntimeConfig() {
  const envPath = resolveHome(
    argument("--env") ?? process.env.CLIPS_MCP_ENV_FILE ??
      path.join(os.homedir(), ".config/assistant/clips-mcp.env")
  );
  let fileEnv = {};
  try {
    fileEnv = parseEnvText(await readFile(envPath, "utf8"));
  } catch (error) {
    if (!process.env.CLIPS_MCP_TOKEN) throw error;
  }
  const appUrl = (process.env.CLIPS_APP_URL ?? fileEnv.CLIPS_APP_URL ?? "https://clips-vy11.onrender.com")
    .trim()
    .replace(/\/+$/, "");
  const token = (process.env.CLIPS_MCP_TOKEN ?? fileEnv.CLIPS_MCP_TOKEN ?? "").trim();
  if (!token) throw new Error("CLIPS_MCP_TOKEN is required.");
  if (!appUrl.startsWith("https://") && !appUrl.startsWith("http://127.0.0.1")) {
    throw new Error("CLIPS_APP_URL must use HTTPS (or loopback for tests).");
  }
  return { appUrl, token };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function retryableStatus(status) {
  return status === 429 || status === 408 || status >= 500;
}

async function readRuntime(input) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${input.appUrl}/api/admin/project-kings/source-buffer`, {
        headers: { Authorization: `Bearer ${input.token}` },
        signal: AbortSignal.timeout(30_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      if (!retryableStatus(response.status)) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
  throw lastError ?? new Error("Source-buffer runtime read failed.");
}

async function postCandidate(input) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const body = new FormData();
      body.set("profileKey", input.profileKey);
      body.set("sourceBufferEvidenceSha256", input.sourceBufferEvidenceSha256);
      body.set("qualificationEvidence", JSON.stringify(input.qualificationEvidence));
      body.set("file", new Blob([input.bytes], { type: "video/mp4" }), input.fileName);
      const response = await fetch(`${input.appUrl}/api/admin/project-kings/source-buffer`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.token}` },
        body,
        signal: AbortSignal.timeout(10 * 60_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      if (!retryableStatus(response.status)) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < 3) {
      const delayMs = 1_000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError ?? new Error("Source-buffer upload failed.");
}

function hasProductionPolicyVerdict(candidate) {
  if (candidate?.qualificationStatus !== "qualified") return false;
  const qualification = candidate.qualificationEvidence;
  const sourcePolicy = qualification?.sourcePolicy;
  const verdict = sourcePolicy?.policyVerdict;
  if (
    qualification?.schemaVersion !== SOURCE_QUALIFICATION_V2 ||
    sourcePolicy?.policyVersion !== SOURCE_POLICY_V2 ||
    sourcePolicy?.policySha256 !== SOURCE_POLICY_SHA256 ||
    sourcePolicy?.discoveryState !== "frozen_catalog" ||
    verdict?.disposition !== "pass" ||
    verdict?.eligibleForSourceFit !== true ||
    verdict?.policySha256 !== SOURCE_POLICY_SHA256 ||
    verdict?.policyApprovalSha256 !== sourcePolicy?.approvalSha256 ||
    verdict?.sourceDesignationEvidenceSha256 !== sourcePolicy?.designationEvidenceSha256 ||
    verdict?.sensitiveAssessmentSha256 !== sourcePolicy?.sensitiveAssessmentSha256 ||
    ![
      sourcePolicy?.approvalSha256,
      sourcePolicy?.designationEvidenceSha256,
      sourcePolicy?.sensitiveAssessmentSha256,
      verdict?.verdictSha256
    ].every((value) => SHA256.test(value ?? ""))
  ) {
    throw new Error(
      `Qualified source ${candidate?.candidateId ?? "unknown"} lacks an exact PASS policy_verdict v2.`
    );
  }
  return true;
}

export function selectProjectKingsSourceBufferUploads(evidence, runtimeSnapshot) {
  const runtimeByProfile = new Map(runtimeSnapshot.channels.map((channel) => [channel.profileKey, channel]));
  return evidence.channels.flatMap((channel) => {
    const runtimeChannel = runtimeByProfile.get(channel.profileKey);
    if (!runtimeChannel?.refill?.shouldRefill) return [];
    const available = Number(runtimeChannel.qualifiedAvailable) || 0;
    const cap = Number(runtimeChannel.refill.readyBufferCap) || 12;
    const capRoom = Math.max(0, cap - available);
    return channel.candidates
      .filter((candidate) =>
        hasProductionPolicyVerdict(candidate) &&
        candidate.rightsStatus === "owner_approved_source_pool" &&
        candidate.localMedia?.selected
      )
      .filter((candidate) => !runtimeChannel.candidates.some((stored) =>
        stored.canonicalUrl === candidate.canonicalUrl ||
        stored.contentSha256 === candidate.qualificationEvidence.contentSha256 ||
        stored.eventFingerprint === candidate.qualificationEvidence.eventFingerprint
      ))
      .slice(0, capRoom)
      .map((candidate) => ({ profileKey: channel.profileKey, candidate }));
  });
}

export async function syncProjectKingsSourceBuffer(input = {}) {
  const evidencePath = path.resolve(input.evidencePath ?? argument("--evidence") ?? defaultEvidencePath);
  const runtime = input.runtime ?? await loadRuntimeConfig();
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (evidence.schemaVersion !== "project-kings-source-buffer-readiness-v1") {
    throw new Error("Unsupported Project Kings source-buffer evidence version.");
  }
  const before = await readRuntime(runtime);
  const candidates = selectProjectKingsSourceBufferUploads(evidence, before);
  const results = [];
  for (const { profileKey, candidate } of candidates) {
    const relativePath = candidate.localMedia.selected.relativePath;
    const filePath = path.resolve(repoRoot, relativePath);
    const boundary = path.relative(repoRoot, filePath);
    if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
      throw new Error(`Source artifact escapes repository root: ${relativePath}`);
    }
    const bytes = await readFile(filePath);
    if (sha256(bytes) !== candidate.qualificationEvidence.contentSha256) {
      throw new Error(`Local source hash drifted before upload: ${candidate.candidateId}`);
    }
    const response = await postCandidate({
      ...runtime,
      profileKey,
      sourceBufferEvidenceSha256: evidence.evidenceSha256,
      qualificationEvidence: candidate.qualificationEvidence,
      bytes,
      fileName: `${candidate.candidateId}.mp4`
    });
    results.push({
      candidateId: candidate.candidateId,
      profileKey,
      created: response.created === true,
      durableCandidateId: response.candidate?.id ?? null
    });
  }
  const after = await readRuntime(runtime);
  return {
    schemaVersion: "project-kings-source-buffer-sync-result-v1",
    evidencePath: path.relative(repoRoot, evidencePath),
    sourceBufferEvidenceSha256: evidence.evidenceSha256,
    attempted: results.length,
    created: results.filter((entry) => entry.created).length,
    existing: results.filter((entry) => !entry.created).length,
    ready: after.ready === true,
    channels: after.channels.map((channel) => ({
      profileKey: channel.profileKey,
      qualifiedAvailable: channel.qualifiedAvailable,
      deficit: Math.max(0, channel.refill.readyBufferMin - channel.qualifiedAvailable)
    })),
    results
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncProjectKingsSourceBuffer()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ready) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        scope: "project-kings-source-buffer-sync",
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      })}\n`);
      process.exitCode = 1;
    });
}
