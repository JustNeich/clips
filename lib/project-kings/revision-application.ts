import { createHash } from "node:crypto";

import type { Stage3StateSnapshot } from "../../app/components/types";
import type {
  CaptionOutput,
  MontagePlannerOutput,
  ProductionAgentArtifact,
  RevisionOutput
} from "./production-agent-contracts";
import type {
  ProductionDefectCode,
  ProductionQualityDefect
} from "../production-quality-gate";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ABSOLUTE_REVISIONS = 5;
const MAX_VISUAL_REVISIONS = 3;

const TEXT_DEFECTS = new Set<ProductionDefectCode>([
  "missing_hook",
  "missing_action",
  "missing_payoff",
  "factual_claim_unverified",
  "banned_word"
]);

const VISUAL_DEFECTS = new Set<ProductionDefectCode>([
  "main_event_lost",
  "unsafe_crop"
]);

export type RevisionCaptionState = CaptionOutput & {
  top: string;
  bottom: string;
};

export type RevisionApplicationArtifact = Pick<
  ProductionAgentArtifact,
  "id" | "kind" | "sha256"
>;

export type RevisionApplicationAction = Extract<
  RevisionOutput["action"],
  "deterministic_repair" | "targeted_regenerate" | "targeted_visual_revision"
>;

export function buildDeterministicRevisionPlan(input: {
  action: RevisionApplicationAction;
  defects: readonly ProductionQualityDefect[];
}): RevisionOutput {
  const isVisual = input.action === "targeted_visual_revision";
  const allowedCodes = isVisual ? VISUAL_DEFECTS : TEXT_DEFECTS;
  const artifactId = isVisual ? "montage-plan" : "caption-brief";
  const changes = [...new Set(
    input.defects
      .map((defect) => defect.code)
      .filter((code) => allowedCodes.has(code))
  )].map((defectCode) => ({
    defectCode,
    instruction: isVisual
      ? `Apply the bounded focus correction for ${defectCode}.`
      : `Apply the bounded text correction for ${defectCode}.`,
    artifactId
  }));
  if (changes.length === 0) {
    throw new RevisionApplicationError(
      "invalid_binding",
      `Deterministic ${input.action} has no compatible structured defect.`
    );
  }
  return {
    action: input.action,
    resumeState: isVisual ? "preview_ready" : "brief_ready",
    changes,
    reason: `Deterministic revision policy selected ${input.action} from structured quality defects.`
  };
}

export type RevisionApplicationOperation =
  | {
      kind: "rewrite_caption";
      defectCode: ProductionDefectCode;
      artifactId: string;
      fields: Array<"top" | "bottom" | "hook" | "caption" | "title" | "factualClaims">;
    }
  | {
      kind: "adjust_focus";
      defectCode: ProductionDefectCode;
      artifactId: string;
      from: { focusX: number; focusY: number };
      to: { focusX: number; focusY: number };
    };

export type RevisionApplicationLedgerEntry = {
  entryId: string;
  attemptNo: number;
  visualAttemptNo: number | null;
  action: RevisionApplicationAction;
  revisionOutputSha256: string;
  revisionBindingSha256: string;
  defectBindings: Array<{
    code: ProductionDefectCode;
    severity: ProductionQualityDefect["severity"];
    messageSha256: string;
  }>;
  artifactBindings: RevisionApplicationArtifact[];
  instructionSha256: string[];
  operations: RevisionApplicationOperation[];
  before: {
    captionSha256: string;
    montageSha256: string;
    settingsSha256: string;
  };
  after: {
    captionSha256: string;
    montageSha256: string;
    settingsSha256: string | null;
  };
};

export type RevisionApplicationLedger = {
  schemaVersion: "project-kings-revision-ledger-v1";
  entries: RevisionApplicationLedgerEntry[];
};

export type RevisionApplicationTextBounds = {
  topMin: number;
  topMax: number;
  bottomMin: number;
  bottomMax: number;
  bannedWords: readonly string[];
};

export class RevisionApplicationError extends Error {
  readonly code:
    | "invalid_ledger"
    | "invalid_revision"
    | "invalid_binding"
    | "budget_exhausted"
    | "no_effect"
    | "duplicate_application";

  constructor(code: RevisionApplicationError["code"], message: string) {
    super(message);
    this.name = "RevisionApplicationError";
    this.code = code;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function hashRevisionApplicationValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RevisionApplicationError("invalid_ledger", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireHash(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new RevisionApplicationError("invalid_ledger", `${label} must be a SHA-256 hash.`);
  }
  return value;
}

function assertLedger(value: RevisionApplicationLedger): void {
  if (value.schemaVersion !== "project-kings-revision-ledger-v1" || !Array.isArray(value.entries)) {
    throw new RevisionApplicationError("invalid_ledger", "Revision ledger header is invalid.");
  }
  if (value.entries.length > MAX_ABSOLUTE_REVISIONS) {
    throw new RevisionApplicationError("invalid_ledger", "Revision ledger exceeds the absolute budget.");
  }
  const entryIds = new Set<string>();
  const bindings = new Set<string>();
  const settingsHashes = new Set<string>();
  let visualCount = 0;
  value.entries.forEach((entry, index) => {
    const record = requireRecord(entry, `entries[${index}]`);
    if (
      typeof record.entryId !== "string" ||
      !record.entryId ||
      record.attemptNo !== index + 1 ||
      !["deterministic_repair", "targeted_regenerate", "targeted_visual_revision"].includes(
        String(record.action)
      )
    ) {
      throw new RevisionApplicationError("invalid_ledger", `entries[${index}] identity is invalid.`);
    }
    if (entryIds.has(entry.entryId)) {
      throw new RevisionApplicationError("invalid_ledger", "Revision ledger repeats an entry id.");
    }
    entryIds.add(entry.entryId);
    requireHash(entry.revisionOutputSha256, `entries[${index}].revisionOutputSha256`);
    requireHash(entry.revisionBindingSha256, `entries[${index}].revisionBindingSha256`);
    requireHash(entry.before?.captionSha256, `entries[${index}].before.captionSha256`);
    requireHash(entry.before?.montageSha256, `entries[${index}].before.montageSha256`);
    requireHash(entry.before?.settingsSha256, `entries[${index}].before.settingsSha256`);
    requireHash(entry.after?.captionSha256, `entries[${index}].after.captionSha256`);
    requireHash(entry.after?.montageSha256, `entries[${index}].after.montageSha256`);
    requireHash(entry.after?.settingsSha256, `entries[${index}].after.settingsSha256`, true);
    if (index < value.entries.length - 1 && entry.after.settingsSha256 === null) {
      throw new RevisionApplicationError("invalid_ledger", "Only the latest revision may await snapshot binding.");
    }
    if (entry.after.settingsSha256) {
      if (settingsHashes.has(entry.after.settingsSha256)) {
        throw new RevisionApplicationError("invalid_ledger", "Revision ledger repeats a settings snapshot.");
      }
      settingsHashes.add(entry.after.settingsSha256);
    }
    if (
      !Array.isArray(entry.defectBindings) ||
      !entry.defectBindings.length ||
      !Array.isArray(entry.artifactBindings) ||
      !entry.artifactBindings.length ||
      !Array.isArray(entry.operations) ||
      !entry.operations.length
    ) {
      throw new RevisionApplicationError("invalid_ledger", `entries[${index}] evidence is incomplete.`);
    }
    const defectKeys = new Set<string>();
    for (const defect of entry.defectBindings) {
      if (
        !defect ||
        typeof defect !== "object" ||
        !["critical", "major", "minor"].includes(defect.severity) ||
        (!TEXT_DEFECTS.has(defect.code) && !VISUAL_DEFECTS.has(defect.code))
      ) {
        throw new RevisionApplicationError("invalid_ledger", `entries[${index}] has an invalid defect binding.`);
      }
      requireHash(defect.messageSha256, `entries[${index}].defectBindings.messageSha256`);
      defectKeys.add(defect.code);
    }
    const artifactIds = new Set<string>();
    for (const artifact of entry.artifactBindings) {
      if (
        !artifact ||
        typeof artifact.id !== "string" ||
        !artifact.id ||
        !["caption_brief", "montage_plan"].includes(artifact.kind)
      ) {
        throw new RevisionApplicationError("invalid_ledger", `entries[${index}] has an invalid artifact binding.`);
      }
      requireHash(artifact.sha256, `entries[${index}].artifactBindings.sha256`);
      artifactIds.add(artifact.id);
    }
    if (
      !Array.isArray(entry.instructionSha256) ||
      entry.instructionSha256.length !== entry.operations.length
    ) {
      throw new RevisionApplicationError("invalid_ledger", `entries[${index}] instruction evidence is invalid.`);
    }
    entry.instructionSha256.forEach((hash, instructionIndex) =>
      requireHash(hash, `entries[${index}].instructionSha256[${instructionIndex}]`)
    );
    const operationBindings = entry.operations.map((operation, operationIndex) => {
      if (
        !operation ||
        !defectKeys.has(operation.defectCode) ||
        !artifactIds.has(operation.artifactId) ||
        (entry.action === "targeted_visual_revision" && operation.kind !== "adjust_focus") ||
        (entry.action !== "targeted_visual_revision" && operation.kind !== "rewrite_caption")
      ) {
        throw new RevisionApplicationError("invalid_ledger", `entries[${index}].operations[${operationIndex}] is invalid.`);
      }
      return { defectCode: operation.defectCode, artifactId: operation.artifactId };
    });
    const expectedBinding = hashRevisionApplicationValue({
      action: entry.action,
      defects: entry.defectBindings,
      artifacts: entry.artifactBindings,
      changes: operationBindings
    });
    if (
      expectedBinding !== entry.revisionBindingSha256 ||
      entry.entryId !== `revision-${expectedBinding.slice(0, 24)}`
    ) {
      throw new RevisionApplicationError("invalid_ledger", `entries[${index}] binding hash is stale.`);
    }
    if (
      (entry.action === "targeted_visual_revision" &&
        entry.before.captionSha256 !== entry.after.captionSha256) ||
      (entry.action !== "targeted_visual_revision" &&
        entry.before.montageSha256 !== entry.after.montageSha256) ||
      (entry.after.settingsSha256 !== null &&
        entry.before.settingsSha256 === entry.after.settingsSha256)
    ) {
      throw new RevisionApplicationError("invalid_ledger", `entries[${index}] target hashes contradict its action.`);
    }
    if (bindings.has(entry.revisionBindingSha256)) {
      throw new RevisionApplicationError("invalid_ledger", "Revision ledger repeats an application binding.");
    }
    bindings.add(entry.revisionBindingSha256);
    if (entry.action === "targeted_visual_revision") {
      visualCount += 1;
      if (entry.visualAttemptNo !== visualCount || visualCount > MAX_VISUAL_REVISIONS) {
        throw new RevisionApplicationError("invalid_ledger", "Visual revision sequence is invalid.");
      }
    } else if (entry.visualAttemptNo !== null) {
      throw new RevisionApplicationError("invalid_ledger", "Text revision cannot carry a visual attempt number.");
    }
  });
}

export function createEmptyRevisionApplicationLedger(): RevisionApplicationLedger {
  return { schemaVersion: "project-kings-revision-ledger-v1", entries: [] };
}

export function parseRevisionApplicationLedger(value: unknown): RevisionApplicationLedger {
  const record = requireRecord(value, "revision ledger");
  const ledger = {
    schemaVersion: record.schemaVersion,
    entries: record.entries
  } as RevisionApplicationLedger;
  assertLedger(ledger);
  return structuredClone(ledger);
}

function validateTextBounds(bounds: RevisionApplicationTextBounds): void {
  for (const [label, min, max] of [
    ["top", bounds.topMin, bounds.topMax],
    ["bottom", bounds.bottomMin, bounds.bottomMax]
  ] as const) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
      throw new RevisionApplicationError("invalid_revision", `${label} text bounds are invalid.`);
    }
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fitText(value: string, min: number, max: number): string {
  let next = normalizeText(value);
  if (next.length > max) {
    next = next.slice(0, max).replace(/\s+\S*$/, "").trim() || next.slice(0, max);
  }
  if (next.length < min) next = next.padEnd(min, ".");
  return next.slice(0, max);
}

function distinctText(
  current: string,
  candidates: readonly string[],
  min: number,
  max: number
): string {
  for (const candidate of candidates) {
    const fitted = fitText(candidate, min, max);
    if (fitted !== current) return fitted;
  }
  for (const marker of ["WATCH", "LOOK", "SEE", "NOW"]) {
    const fitted = fitText(`${marker} ${current}`, min, max);
    if (fitted !== current) return fitted;
  }
  throw new RevisionApplicationError("no_effect", "Bounded caption revision could not change the target text.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBannedWords(value: string, bannedWords: readonly string[]): string {
  return bannedWords.reduce((text, word) => {
    const normalized = word.trim();
    if (!normalized) return text;
    return text.replace(new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "giu"), " ");
  }, value).replace(/\s+/g, " ").trim();
}

function applyTextRevision(input: {
  action: "deterministic_repair" | "targeted_regenerate";
  caption: RevisionCaptionState;
  defectCodes: readonly ProductionDefectCode[];
  bounds: RevisionApplicationTextBounds;
  seed: string;
}): RevisionCaptionState {
  validateTextBounds(input.bounds);
  const before = structuredClone(input.caption);
  const next = structuredClone(input.caption);
  const bannedWords = [...new Set([...input.bounds.bannedWords, ...input.caption.bannedWordsFound])]
    .map((word) => word.trim())
    .filter(Boolean);

  if (input.action === "targeted_regenerate") {
    const reverse = Number.parseInt(input.seed.slice(0, 2), 16) % 2 === 1;
    const topCandidates = reverse
      ? [`${next.payoff}: ${next.hook}`, `${next.action}: ${next.hook}`]
      : [`${next.action}: ${next.hook}`, `${next.payoff}: ${next.hook}`];
    const bottomCandidates = reverse
      ? [`${next.payoff}. ${next.action}.`, `${next.action}. ${next.payoff}.`]
      : [`${next.action}. ${next.payoff}.`, `${next.payoff}. ${next.action}.`];
    next.top = distinctText(next.top, topCandidates, input.bounds.topMin, input.bounds.topMax);
    next.bottom = distinctText(
      next.bottom,
      bottomCandidates,
      input.bounds.bottomMin,
      input.bounds.bottomMax
    );
    next.hook = next.top;
    next.caption = next.bottom;
    next.title = distinctText(next.title, [next.payoff, next.action, next.hook], 3, 120);
  } else {
    for (const code of input.defectCodes) {
      if (code === "missing_hook") {
        next.top = distinctText(
          next.top,
          [`WATCH ${next.hook}`, `LOOK: ${next.action}`],
          input.bounds.topMin,
          input.bounds.topMax
        );
        next.hook = next.top;
      } else if (code === "missing_action") {
        next.bottom = distinctText(
          next.bottom,
          [`${next.action}. ${next.caption}`, `${next.action}. ${next.payoff}.`],
          input.bounds.bottomMin,
          input.bounds.bottomMax
        );
        next.caption = next.bottom;
      } else if (code === "missing_payoff") {
        next.bottom = distinctText(
          next.bottom,
          [`${next.caption} ${next.payoff}.`, `${next.action}. ${next.payoff}.`],
          input.bounds.bottomMin,
          input.bounds.bottomMax
        );
        next.caption = next.bottom;
      } else if (code === "factual_claim_unverified") {
        next.bottom = distinctText(
          next.bottom,
          [`${next.action}. ${next.payoff}.`, `${next.payoff}.`],
          input.bounds.bottomMin,
          input.bounds.bottomMax
        );
        next.caption = next.bottom;
        next.factualClaims = [];
      } else if (code === "banned_word") {
        next.top = fitText(stripBannedWords(next.top, bannedWords), input.bounds.topMin, input.bounds.topMax);
        next.bottom = fitText(
          stripBannedWords(next.bottom, bannedWords),
          input.bounds.bottomMin,
          input.bounds.bottomMax
        );
        next.hook = stripBannedWords(next.hook, bannedWords);
        next.caption = stripBannedWords(next.caption, bannedWords);
      }
    }
  }

  next.top = fitText(stripBannedWords(next.top, bannedWords), input.bounds.topMin, input.bounds.topMax);
  next.bottom = fitText(
    stripBannedWords(next.bottom, bannedWords),
    input.bounds.bottomMin,
    input.bounds.bottomMax
  );
  next.hook = stripBannedWords(next.hook, bannedWords) || next.top;
  next.caption = stripBannedWords(next.caption, bannedWords) || next.bottom;
  next.action = stripBannedWords(next.action, bannedWords);
  next.payoff = stripBannedWords(next.payoff, bannedWords);
  next.title = stripBannedWords(next.title, bannedWords);
  next.bannedWordsFound = [];

  const visibleText = [next.top, next.bottom, next.hook, next.caption].join(" ").toLocaleLowerCase();
  if (bannedWords.some((word) => visibleText.includes(word.toLocaleLowerCase()))) {
    throw new RevisionApplicationError("invalid_revision", "Text revision retained a banned word.");
  }
  if (hashRevisionApplicationValue(next) === hashRevisionApplicationValue(before)) {
    throw new RevisionApplicationError("no_effect", "Text revision produced an identical caption input.");
  }
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function adjustAxis(value: number, delta: number): number {
  const forward = Number(clamp(value + delta, 0.05, 0.95).toFixed(4));
  if (forward !== value) return forward;
  const backward = Number(clamp(value - delta, 0.05, 0.95).toFixed(4));
  if (backward !== value) return backward;
  throw new RevisionApplicationError("no_effect", "Visual revision could not move a bounded focus axis.");
}

function applyVisualRevision(input: {
  montage: MontagePlannerOutput;
  visualAttemptNo: number;
  seed: string;
  defectCodes: readonly ProductionDefectCode[];
}): MontagePlannerOutput {
  const currentX = input.montage.crop.focusX;
  const currentY = input.montage.crop.focusY;
  if (
    !Number.isFinite(currentX) ||
    !Number.isFinite(currentY) ||
    currentX < 0 ||
    currentX > 1 ||
    currentY < 0 ||
    currentY > 1
  ) {
    throw new RevisionApplicationError("invalid_revision", "Montage focus is outside normalized bounds.");
  }
  const magnitude = 0.06 + input.visualAttemptNo * 0.03;
  const xDirection = Number.parseInt(input.seed.slice(0, 2), 16) % 2 === 0 ? 1 : -1;
  const yDirection = Number.parseInt(input.seed.slice(2, 4), 16) % 2 === 0 ? 1 : -1;
  const focusX = adjustAxis(currentX, magnitude * xDirection);
  const focusY = adjustAxis(currentY, magnitude * yDirection);
  return {
    ...input.montage,
    crop: {
      focusX,
      focusY,
      reason: `Bounded focus revision ${input.visualAttemptNo} for ${input.defectCodes.join(", ")}.`
    }
  };
}

function targetedAction(action: RevisionOutput["action"]): RevisionApplicationAction {
  if (
    action !== "deterministic_repair" &&
    action !== "targeted_regenerate" &&
    action !== "targeted_visual_revision"
  ) {
    throw new RevisionApplicationError("invalid_revision", `${action} is not an applicable revision action.`);
  }
  return action;
}

export function countRevisionApplications(ledger: RevisionApplicationLedger): {
  total: number;
  text: number;
  visual: number;
} {
  assertLedger(ledger);
  return {
    total: ledger.entries.length,
    text: ledger.entries.filter((entry) => entry.action !== "targeted_visual_revision").length,
    visual: ledger.entries.filter((entry) => entry.action === "targeted_visual_revision").length
  };
}

export function applyPersistedRevision(input: {
  revision: RevisionOutput;
  defects: readonly ProductionQualityDefect[];
  artifacts: readonly RevisionApplicationArtifact[];
  caption: RevisionCaptionState;
  montage: MontagePlannerOutput;
  ledger: RevisionApplicationLedger;
  attemptNo: number;
  previousSettingsSha256: string;
  textBounds: RevisionApplicationTextBounds;
}): {
  caption: RevisionCaptionState;
  montage: MontagePlannerOutput;
  ledger: RevisionApplicationLedger;
  entry: RevisionApplicationLedgerEntry;
} {
  assertLedger(input.ledger);
  const action = targetedAction(input.revision.action);
  const counts = countRevisionApplications(input.ledger);
  if (
    !Number.isInteger(input.attemptNo) ||
    input.attemptNo !== counts.total + 1 ||
    input.attemptNo > MAX_ABSOLUTE_REVISIONS
  ) {
    throw new RevisionApplicationError("budget_exhausted", "Absolute five-revision budget is exhausted or discontinuous.");
  }
  const visualAttemptNo = action === "targeted_visual_revision" ? counts.visual + 1 : null;
  if (visualAttemptNo !== null && visualAttemptNo > MAX_VISUAL_REVISIONS) {
    throw new RevisionApplicationError("budget_exhausted", "Three visual revisions are already exhausted.");
  }
  if (action === "deterministic_repair" && input.ledger.entries.some((entry) => entry.action === action)) {
    throw new RevisionApplicationError("budget_exhausted", "Deterministic text repair is allowed only once.");
  }
  if (action === "targeted_regenerate" && input.ledger.entries.some((entry) => entry.action === action)) {
    throw new RevisionApplicationError("budget_exhausted", "Targeted text regeneration is allowed only once.");
  }
  if (!SHA256_PATTERN.test(input.previousSettingsSha256)) {
    throw new RevisionApplicationError("invalid_binding", "Previous settings hash is missing or invalid.");
  }
  if (!input.revision.changes.length) {
    throw new RevisionApplicationError("invalid_revision", "Targeted revision has no changes.");
  }

  const defectsByCode = new Map<ProductionDefectCode, ProductionQualityDefect[]>();
  input.defects.forEach((defect) => {
    defectsByCode.set(defect.code, [...(defectsByCode.get(defect.code) ?? []), defect]);
  });
  const artifacts = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const expectedKind = action === "targeted_visual_revision" ? "montage_plan" : "caption_brief";
  const allowedCodes = action === "targeted_visual_revision" ? VISUAL_DEFECTS : TEXT_DEFECTS;
  const seenChanges = new Set<string>();
  for (const [index, change] of input.revision.changes.entries()) {
    if (!defectsByCode.has(change.defectCode) || !allowedCodes.has(change.defectCode)) {
      throw new RevisionApplicationError(
        "invalid_binding",
        `Revision change ${index} is not bound to an allowed existing defect.`
      );
    }
    if (!change.artifactId) {
      throw new RevisionApplicationError("invalid_binding", `Revision change ${index} has no target artifact.`);
    }
    const artifact = artifacts.get(change.artifactId);
    if (!artifact || artifact.kind !== expectedKind || !SHA256_PATTERN.test(artifact.sha256)) {
      throw new RevisionApplicationError(
        "invalid_binding",
        `Revision change ${index} does not target the allowed ${expectedKind} artifact.`
      );
    }
    const key = `${change.defectCode}:${change.artifactId}`;
    if (seenChanges.has(key)) {
      throw new RevisionApplicationError("invalid_revision", `Revision change ${index} duplicates another change.`);
    }
    seenChanges.add(key);
  }

  const defectBindings = [...new Map(
    input.revision.changes.flatMap((change) =>
      (defectsByCode.get(change.defectCode) ?? []).map((defect) => [
        `${defect.code}:${defect.message}`,
        {
          code: defect.code,
          severity: defect.severity,
          messageSha256: hashRevisionApplicationValue(defect.message)
        }
      ] as const)
    )
  ).values()];
  const artifactBindings = [...new Map(
    input.revision.changes.map((change) => {
      const artifact = artifacts.get(change.artifactId!)!;
      return [artifact.id, artifact] as const;
    })
  ).values()].map((artifact) => ({ ...artifact }));
  const revisionBindingSha256 = hashRevisionApplicationValue({
    action,
    defects: defectBindings,
    artifacts: artifactBindings,
    changes: input.revision.changes.map((change) => ({
      defectCode: change.defectCode,
      artifactId: change.artifactId
    }))
  });
  if (input.ledger.entries.some((entry) => entry.revisionBindingSha256 === revisionBindingSha256)) {
    throw new RevisionApplicationError(
      "duplicate_application",
      "The same defect/artifact revision binding was already applied."
    );
  }

  const defectCodes = [...new Set(input.revision.changes.map((change) => change.defectCode))];
  let caption = structuredClone(input.caption);
  let montage = structuredClone(input.montage);
  const operations: RevisionApplicationOperation[] = [];
  if (action === "targeted_visual_revision") {
    const before = { focusX: montage.crop.focusX, focusY: montage.crop.focusY };
    montage = applyVisualRevision({
      montage,
      visualAttemptNo: visualAttemptNo!,
      seed: revisionBindingSha256,
      defectCodes
    });
    for (const change of input.revision.changes) {
      operations.push({
        kind: "adjust_focus",
        defectCode: change.defectCode,
        artifactId: change.artifactId!,
        from: before,
        to: { focusX: montage.crop.focusX, focusY: montage.crop.focusY }
      });
    }
  } else {
    caption = applyTextRevision({
      action,
      caption,
      defectCodes,
      bounds: input.textBounds,
      seed: revisionBindingSha256
    });
    for (const change of input.revision.changes) {
      operations.push({
        kind: "rewrite_caption",
        defectCode: change.defectCode,
        artifactId: change.artifactId!,
        fields:
          action === "targeted_regenerate"
            ? ["top", "bottom", "hook", "caption", "title"]
            : change.defectCode === "missing_hook"
              ? ["top", "hook"]
              : change.defectCode === "factual_claim_unverified"
                ? ["bottom", "caption", "factualClaims"]
                : change.defectCode === "banned_word"
                  ? ["top", "bottom", "hook", "caption"]
                : ["bottom", "caption"]
      });
    }
  }

  const beforeCaptionSha256 = hashRevisionApplicationValue(input.caption);
  const beforeMontageSha256 = hashRevisionApplicationValue(input.montage);
  const afterCaptionSha256 = hashRevisionApplicationValue(caption);
  const afterMontageSha256 = hashRevisionApplicationValue(montage);
  if (
    (action === "targeted_visual_revision" && beforeMontageSha256 === afterMontageSha256) ||
    (action !== "targeted_visual_revision" && beforeCaptionSha256 === afterCaptionSha256)
  ) {
    throw new RevisionApplicationError("no_effect", "Revision did not change its exact target input.");
  }
  const revisionOutputSha256 = hashRevisionApplicationValue(input.revision);
  const entry: RevisionApplicationLedgerEntry = {
    entryId: `revision-${revisionBindingSha256.slice(0, 24)}`,
    attemptNo: input.attemptNo,
    visualAttemptNo,
    action,
    revisionOutputSha256,
    revisionBindingSha256,
    defectBindings,
    artifactBindings,
    instructionSha256: input.revision.changes.map((change) =>
      hashRevisionApplicationValue(change.instruction)
    ),
    operations,
    before: {
      captionSha256: beforeCaptionSha256,
      montageSha256: beforeMontageSha256,
      settingsSha256: input.previousSettingsSha256
    },
    after: {
      captionSha256: afterCaptionSha256,
      montageSha256: afterMontageSha256,
      settingsSha256: null
    }
  };
  const ledger = {
    schemaVersion: "project-kings-revision-ledger-v1" as const,
    entries: [...structuredClone(input.ledger.entries), entry]
  };
  assertLedger(ledger);
  return { caption, montage, ledger, entry };
}

export function applyRevisionLedgerToSnapshot(input: {
  ledger: RevisionApplicationLedger;
  entryId: string;
  caption: RevisionCaptionState;
  montage: MontagePlannerOutput;
  snapshot: Stage3StateSnapshot;
}): {
  snapshot: Stage3StateSnapshot;
  settingsSha256: string;
  ledger: RevisionApplicationLedger;
  entry: RevisionApplicationLedgerEntry;
} {
  assertLedger(input.ledger);
  const entryIndex = input.ledger.entries.findIndex((entry) => entry.entryId === input.entryId);
  if (entryIndex < 0 || entryIndex !== input.ledger.entries.length - 1) {
    throw new RevisionApplicationError("invalid_binding", "Snapshot revision must use the latest ledger entry.");
  }
  const entry = input.ledger.entries[entryIndex]!;
  if (
    hashRevisionApplicationValue(input.caption) !== entry.after.captionSha256 ||
    hashRevisionApplicationValue(input.montage) !== entry.after.montageSha256
  ) {
    throw new RevisionApplicationError("invalid_binding", "Persisted caption/montage no longer match the revision ledger.");
  }
  const snapshot: Stage3StateSnapshot = {
    ...input.snapshot,
    topText: input.caption.top,
    bottomText: input.caption.bottom,
    captionHighlights: { top: [], bottom: [] },
    focusX: input.montage.crop.focusX,
    focusY: input.montage.crop.focusY,
    renderPlan: {
      ...input.snapshot.renderPlan,
      focusX: input.montage.crop.focusX,
      segments: input.snapshot.renderPlan.segments.map((segment) => ({
        ...segment,
        focusX: input.montage.crop.focusX,
        focusY: input.montage.crop.focusY
      }))
    }
  };
  const settingsSha256 = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  if (settingsSha256 === entry.before.settingsSha256) {
    throw new RevisionApplicationError("no_effect", "Revision would enqueue an identical Stage 3 settings snapshot.");
  }
  if (
    input.ledger.entries
      .slice(0, entryIndex)
      .some((previous) => previous.after.settingsSha256 === settingsSha256)
  ) {
    throw new RevisionApplicationError(
      "duplicate_application",
      "Revision would repeat a previously rendered settings snapshot."
    );
  }
  if (entry.after.settingsSha256 && entry.after.settingsSha256 !== settingsSha256) {
    throw new RevisionApplicationError("invalid_binding", "Revision settings hash changed after it was recorded.");
  }
  const ledger = structuredClone(input.ledger);
  ledger.entries[entryIndex] = {
    ...ledger.entries[entryIndex]!,
    after: { ...ledger.entries[entryIndex]!.after, settingsSha256 }
  };
  assertLedger(ledger);
  return { snapshot, settingsSha256, ledger, entry: ledger.entries[entryIndex]! };
}
