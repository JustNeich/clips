import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Stage3Operation,
  Stage3StateSnapshot,
  Stage3Version
} from "../app/components/types";
import { getAppDataDir } from "./app-paths";

export type Stage3GoalType =
  | "focusOnly"
  | "crop"
  | "zoom"
  | "timing"
  | "fragments"
  | "color"
  | "stabilization"
  | "audio"
  | "text"
  | "unknown";

export type Stage3SessionStatus = "running" | "completed" | "partiallyApplied" | "failed";

export type Stage3IterationStopReason =
  | "targetScoreReached"
  | "maxIterationsReached"
  | "minGainReached"
  | "safety"
  | "noProgress"
  | "plannerFailure"
  | "rollbackCreated"
  | "userStop";

export type Stage3IterationScores = {
  quality: number;
  goalFit: number;
  safety: number;
  stepGain: number;
  total: number;
};

export type Stage3IterationPlan = {
  rationale: string;
  strategy: "heuristic" | "llm" | "fallback";
  hypothesis: string;
  operations: Stage3Operation[];
  magnitudes: number[];
  expected?: Record<string, unknown>;
};

export type Stage3IterationRecord = {
  id: string;
  sessionId: string;
  iterationIndex: number;
  beforeVersionId: string;
  afterVersionId: string;
  plan: Stage3IterationPlan;
  appliedOps: Stage3Operation[];
  scores: Stage3IterationScores;
  judgeNotes: string;
  stoppedReason: Stage3IterationStopReason | null;
  createdAt: string;
  timings: {
    planMs?: number;
    executeMs?: number;
    judgeMs?: number;
    totalMs?: number;
  };
};

export type Stage3MessageRole = "user" | "assistant_auto" | "assistant_summary";

export type Stage3MessageRecord = {
  id: string;
  sessionId: string;
  role: Stage3MessageRole;
  text: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type Stage3VersionRecord = {
  id: string;
  sessionId: string;
  parentVersionId: string | null;
  iterationIndex: number;
  source: "agent.auto" | "rollback";
  transformConfig: Stage3StateSnapshot;
  diffSummary: string[];
  rationale: string;
  createdAt: string;
};

export type Stage3SessionRecord = {
  id: string;
  projectId: string;
  mediaId: string;
  goalText: string;
  status: Stage3SessionStatus;
  goalType: Stage3GoalType;
  targetScore: number;
  minGain: number;
  maxIterations: number;
  operationBudget: number;
  createdAt: string;
  updatedAt: string;
  lastPlanSummary: string | null;
  stagnationCount: number;
  currentVersionId: string | null;
  bestVersionId: string | null;
};

export type Stage3IdempotencyRecord = {
  key: string;
  sessionId: string;
  projectId: string;
  mediaId: string;
  goalHash: string;
  createdAt: string;
  updatedAt: string;
  result: {
    finalVersionId: string;
    bestVersionId: string;
    status: Stage3SessionStatus;
    scoreHistory: number[];
    beforeVersionId?: string;
    firstIterationIndex?: number;
    lastIterationIndex?: number;
  };
};

type Stage3Store = {
  version: 1;
  sessions: Stage3SessionRecord[];
  iterations: Stage3IterationRecord[];
  versions: Stage3VersionRecord[];
  messages: Stage3MessageRecord[];
  idempotency: Stage3IdempotencyRecord[];
};

type CreateSessionInput = {
  projectId: string;
  mediaId: string;
  goalText: string;
  goalType: Stage3GoalType;
  targetScore: number;
  minGain: number;
  maxIterations: number;
  operationBudget: number;
};

type CreateVersionInput = {
  sessionId: string;
  parentVersionId: string | null;
  iterationIndex: number;
  source: "agent.auto" | "rollback";
  transformConfig: Stage3StateSnapshot;
  diffSummary: string[];
  rationale: string;
};

type CreateIterationInput = {
  sessionId: string;
  iterationIndex: number;
  beforeVersionId: string;
  afterVersionId: string;
  plan: Stage3IterationPlan;
  appliedOps: Stage3Operation[];
  scores: Stage3IterationScores;
  judgeNotes: string;
  stoppedReason: Stage3IterationStopReason | null;
  timings: {
    planMs?: number;
    executeMs?: number;
    judgeMs?: number;
    totalMs?: number;
  };
};

type CreateMessageInput = {
  sessionId: string;
  role: Stage3MessageRole;
  text: string;
  payload?: Record<string, unknown> | null;
};

type UpdateSessionPatch = Partial<
  Pick<
    Stage3SessionRecord,
    | "status"
    | "lastPlanSummary"
    | "stagnationCount"
    | "currentVersionId"
    | "bestVersionId"
    | "goalText"
    | "goalType"
    | "targetScore"
    | "minGain"
    | "maxIterations"
    | "operationBudget"
  >
>;

export type Stage3TimelinePayload = {
  session: Stage3SessionRecord;
  versions: Stage3VersionRecord[];
  iterations: Stage3IterationRecord[];
  messages: Stage3MessageRecord[];
};

const DATA_DIR = getAppDataDir();
const STORE_PATH = path.join(DATA_DIR, "stage3-sessions.json");

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clampSigned01 = (value: number): number => Math.max(-1, Math.min(1, value));
const nowIso = () => new Date().toISOString();

let storeLock: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(task: () => Promise<T>): Promise<T> {
  const taskPromise = storeLock
    .then(async () => task())
    .catch((error) => {
      throw error;
    });
  storeLock = taskPromise.then(
    () => undefined,
    () => undefined
  );
  return taskPromise;
}

function normalizeGoalType(value: unknown): Stage3GoalType {
  const valid: Stage3GoalType[] = [
    "focusOnly",
    "crop",
    "zoom",
    "timing",
    "fragments",
    "color",
    "stabilization",
    "audio",
    "text",
    "unknown"
  ];
  if (typeof value === "string" && valid.includes(value as Stage3GoalType)) {
    return value as Stage3GoalType;
  }
  return "unknown";
}

function normalizeStatus(value: unknown): Stage3SessionStatus {
  if (value === "completed" || value === "partiallyApplied" || value === "failed") {
    return value;
  }
  return "running";
}

function normalizeScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp01(value);
  }
  return 0;
}

function normalizeOperationList(value: unknown): Stage3Operation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => item && typeof item === "object") as Stage3Operation[];
}

function normalizePlanRecord(value: unknown): Stage3IterationPlan {
  if (!value || typeof value !== "object") {
    return {
      rationale: "unknown",
      strategy: "fallback",
      hypothesis: "fallback",
      operations: [],
      magnitudes: []
    };
  }
  const candidate = value as Partial<Stage3IterationPlan>;
  const operations = normalizeOperationList(candidate.operations);
  const magnitudes = Array.isArray(candidate.magnitudes)
    ? candidate.magnitudes.filter((item) => typeof item === "number" && Number.isFinite(item))
    : [];
  return {
    rationale:
      typeof candidate.rationale === "string" && candidate.rationale.trim()
        ? candidate.rationale.trim()
        : "unknown",
    strategy:
      candidate.strategy === "llm"
        ? "llm"
        : candidate.strategy === "fallback"
          ? "fallback"
          : "heuristic",
    hypothesis:
      typeof candidate.hypothesis === "string" && candidate.hypothesis.trim()
        ? candidate.hypothesis
        : "fallback",
    operations,
    magnitudes,
    expected:
      candidate.expected && typeof candidate.expected === "object"
        ? (candidate.expected as Record<string, unknown>)
        : undefined
  };
}

function normalizeVersionRecord(value: unknown): Stage3VersionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<Stage3VersionRecord>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return null;
  }
  if (typeof candidate.sessionId !== "string") {
    return null;
  }
  if (!candidate.transformConfig || typeof candidate.transformConfig !== "object") {
    return null;
  }
  const diffSummary = Array.isArray(candidate.diffSummary)
    ? candidate.diffSummary.map((item) => String(item))
    : [];

  return {
    id: candidate.id,
    sessionId: candidate.sessionId,
    parentVersionId:
      candidate.parentVersionId === null || typeof candidate.parentVersionId === "string"
        ? candidate.parentVersionId
        : null,
    iterationIndex:
      typeof candidate.iterationIndex === "number" && Number.isFinite(candidate.iterationIndex)
        ? Math.max(0, Math.floor(candidate.iterationIndex))
        : 0,
    source: candidate.source === "rollback" ? "rollback" : "agent.auto",
    transformConfig: candidate.transformConfig as Stage3StateSnapshot,
    diffSummary,
    rationale: typeof candidate.rationale === "string" ? candidate.rationale : "n/a",
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : nowIso()
  };
}

function normalizeIterationRecord(value: unknown): Stage3IterationRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<Stage3IterationRecord>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return null;
  }
  if (typeof candidate.sessionId !== "string" || !candidate.sessionId) {
    return null;
  }

  const iterationIndex =
    typeof candidate.iterationIndex === "number" && Number.isFinite(candidate.iterationIndex)
      ? Math.max(1, Math.floor(candidate.iterationIndex))
      : 1;

  const scoresValue =
    candidate.scores && typeof candidate.scores === "object" ? (candidate.scores as Partial<Stage3IterationScores>) : null;
  if (!scoresValue) {
    return null;
  }
  const stepGainCandidate = (scoresValue as { stepGain?: unknown }).stepGain;
  const stepGain =
    typeof stepGainCandidate === "number" && Number.isFinite(stepGainCandidate)
      ? stepGainCandidate
      : 0;

  return {
    id: candidate.id,
    sessionId: candidate.sessionId,
    iterationIndex,
    beforeVersionId: typeof candidate.beforeVersionId === "string" ? candidate.beforeVersionId : "",
    afterVersionId: typeof candidate.afterVersionId === "string" ? candidate.afterVersionId : "",
    plan: normalizePlanRecord(candidate.plan),
    appliedOps: normalizeOperationList(candidate.appliedOps),
    scores: {
      quality: normalizeScore((scoresValue as { quality?: unknown }).quality),
      goalFit: normalizeScore((scoresValue as { goalFit?: unknown }).goalFit),
      safety: normalizeScore((scoresValue as { safety?: unknown }).safety),
      stepGain: clampSigned01(stepGain),
      total: normalizeScore((scoresValue as { total?: unknown }).total)
    },
    judgeNotes: typeof candidate.judgeNotes === "string" ? candidate.judgeNotes : "",
    stoppedReason:
      candidate.stoppedReason === "targetScoreReached" ||
      candidate.stoppedReason === "maxIterationsReached" ||
      candidate.stoppedReason === "minGainReached" ||
      candidate.stoppedReason === "safety" ||
      candidate.stoppedReason === "noProgress" ||
      candidate.stoppedReason === "plannerFailure" ||
      candidate.stoppedReason === "rollbackCreated" ||
      candidate.stoppedReason === "userStop"
        ? candidate.stoppedReason
        : null,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : nowIso(),
    timings:
      candidate.timings && typeof candidate.timings === "object"
        ? (candidate.timings as Stage3IterationRecord["timings"])
        : {}
  };
}

function normalizeMessageRecord(value: unknown): Stage3MessageRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<Stage3MessageRecord>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.role !== "string" ||
    typeof candidate.text !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }
  const role = candidate.role as Stage3MessageRole;
  if (role !== "user" && role !== "assistant_auto" && role !== "assistant_summary") {
    return null;
  }

  return {
    id: candidate.id,
    sessionId: candidate.sessionId,
    role,
    text: candidate.text,
    payload: candidate.payload && typeof candidate.payload === "object" ? (candidate.payload as Record<string, unknown>) : null,
    createdAt: candidate.createdAt
  };
}

function normalizeSessionRecord(value: unknown): Stage3SessionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<Stage3SessionRecord>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return null;
  }
  if (typeof candidate.projectId !== "string" || !candidate.projectId.trim()) {
    return null;
  }
  if (typeof candidate.mediaId !== "string" || !candidate.mediaId.trim()) {
    return null;
  }
  if (typeof candidate.goalText !== "string" || !candidate.goalText.trim()) {
    return null;
  }

  const targetScore =
    typeof candidate.targetScore === "number" && Number.isFinite(candidate.targetScore)
      ? clamp01(candidate.targetScore)
      : 0.82;
  const minGain =
    typeof candidate.minGain === "number" && Number.isFinite(candidate.minGain)
      ? candidate.minGain
      : 0.04;
  const maxIterations =
    typeof candidate.maxIterations === "number" && Number.isFinite(candidate.maxIterations)
      ? Math.max(1, Math.floor(candidate.maxIterations))
      : 5;
  const operationBudget =
    typeof candidate.operationBudget === "number" && Number.isFinite(candidate.operationBudget)
      ? Math.max(1, Math.floor(candidate.operationBudget))
      : 2;

  return {
    id: candidate.id,
    projectId: candidate.projectId,
    mediaId: candidate.mediaId,
    goalText: candidate.goalText,
    status: normalizeStatus(candidate.status),
    goalType: normalizeGoalType(candidate.goalType),
    targetScore,
    minGain,
    maxIterations,
    operationBudget,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : nowIso(),
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
        ? candidate.updatedAt
        : nowIso(),
    lastPlanSummary:
      typeof candidate.lastPlanSummary === "string" && candidate.lastPlanSummary.trim()
        ? candidate.lastPlanSummary
        : null,
    stagnationCount:
      typeof candidate.stagnationCount === "number" && Number.isFinite(candidate.stagnationCount)
        ? Math.max(0, Math.floor(candidate.stagnationCount))
        : 0,
    currentVersionId:
      typeof candidate.currentVersionId === "string" && candidate.currentVersionId.trim()
        ? candidate.currentVersionId
        : null,
    bestVersionId:
      typeof candidate.bestVersionId === "string" && candidate.bestVersionId.trim()
        ? candidate.bestVersionId
        : null
  };
}

async function ensureStoreExists(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const initial: Stage3Store = {
      version: 1,
      sessions: [],
      iterations: [],
      versions: [],
      messages: [],
      idempotency: []
    };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

function sanitizeStore(parsedUnknown: unknown): Stage3Store {
  const parsed = (parsedUnknown ?? {}) as Partial<Stage3Store>;

  const sessions = Array.isArray(parsed.sessions)
    ? parsed.sessions
        .map((item) => normalizeSessionRecord(item))
        .filter((item): item is Stage3SessionRecord => Boolean(item))
    : [];

  const iterations = Array.isArray(parsed.iterations)
    ? parsed.iterations
        .map((item) => normalizeIterationRecord(item))
        .filter((item): item is Stage3IterationRecord => Boolean(item))
    : [];

  const versions = Array.isArray(parsed.versions)
    ? parsed.versions
        .map((item) => normalizeVersionRecord(item))
        .filter((item): item is Stage3VersionRecord => Boolean(item))
    : [];
  const messages = Array.isArray(parsed.messages)
    ? parsed.messages
        .map(normalizeMessageRecord)
        .filter((item): item is Stage3MessageRecord => Boolean(item))
    : [];

  const idempotency = Array.isArray(parsed.idempotency)
    ? parsed.idempotency
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const candidate = item as Partial<Stage3IdempotencyRecord>;
          if (
            typeof candidate.key !== "string" ||
            typeof candidate.sessionId !== "string" ||
            typeof candidate.projectId !== "string" ||
            typeof candidate.mediaId !== "string" ||
            typeof candidate.goalHash !== "string" ||
            !candidate.result ||
            typeof candidate.result !== "object"
          ) {
            return null;
          }
          const result = candidate.result as Partial<Stage3IdempotencyRecord["result"]>;
          if (
            !Array.isArray(result.scoreHistory) ||
            typeof result.finalVersionId !== "string" ||
            typeof result.bestVersionId !== "string"
          ) {
            return null;
          }
          const normalizedResult: Stage3IdempotencyRecord["result"] = {
            finalVersionId: result.finalVersionId,
            bestVersionId: result.bestVersionId,
            status: normalizeStatus(result.status),
            scoreHistory: result.scoreHistory
              .map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? clamp01(entry) : null))
              .filter((entry): entry is number => entry !== null)
          };

          if (typeof result.beforeVersionId === "string" && result.beforeVersionId.trim()) {
            normalizedResult.beforeVersionId = result.beforeVersionId;
          }
          if (typeof result.firstIterationIndex === "number" && Number.isFinite(result.firstIterationIndex)) {
            normalizedResult.firstIterationIndex = Math.max(1, Math.floor(result.firstIterationIndex));
          }
          if (typeof result.lastIterationIndex === "number" && Number.isFinite(result.lastIterationIndex)) {
            normalizedResult.lastIterationIndex = Math.max(1, Math.floor(result.lastIterationIndex));
          }

          return {
            key: candidate.key,
            sessionId: candidate.sessionId,
            projectId: candidate.projectId,
            mediaId: candidate.mediaId,
            goalHash: candidate.goalHash,
            createdAt:
              typeof candidate.createdAt === "string" && candidate.createdAt.trim()
                ? candidate.createdAt
                : nowIso(),
            updatedAt:
              typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
                ? candidate.updatedAt
                : nowIso(),
            result: normalizedResult
          };
        })
        .filter((item): item is Stage3IdempotencyRecord => Boolean(item))
    : [];

  return {
    version: 1,
    sessions,
    iterations,
    versions,
    messages,
    idempotency
  };
}

async function readStore(): Promise<Stage3Store> {
  await ensureStoreExists();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const normalized = sanitizeStore(parsed);

  if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
    await writeStore(normalized);
  }

  return normalized;
}

async function writeStore(store: Stage3Store): Promise<void> {
  await ensureStoreExists();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function createIdempotencyKey(input: {
  sessionId: string;
  projectId: string;
  mediaId: string;
  goalText: string;
}): Promise<string> {
  const raw = `${input.sessionId}:${input.projectId}:${input.mediaId}:${input.goalText}`;
  return createHash("sha1").update(raw).digest("hex");
}

export function buildGoalHash(goalText: string): string {
  return createHash("sha1").update(goalText.trim().toLowerCase()).digest("hex");
}

export async function createSession(input: CreateSessionInput): Promise<Stage3SessionRecord> {
  return withStoreLock(async () => {
    const store = await readStore();
    const now = nowIso();
    const session: Stage3SessionRecord = {
      id: randomUUID().replace(/-/g, ""),
      projectId: input.projectId,
      mediaId: input.mediaId,
      goalText: input.goalText,
      status: "running",
      goalType: input.goalType,
      targetScore: clamp01(input.targetScore),
      minGain: input.minGain,
      maxIterations: Math.max(1, Math.floor(input.maxIterations)),
      operationBudget: Math.max(1, Math.floor(input.operationBudget)),
      createdAt: now,
      updatedAt: now,
      lastPlanSummary: null,
      stagnationCount: 0,
      currentVersionId: null,
      bestVersionId: null
    };
    store.sessions.push(session);
    await writeStore(store);
    return session;
  });
}

export async function getSession(sessionId: string): Promise<Stage3SessionRecord | null> {
  return withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === sessionId) ?? null;
    return session;
  });
}

export async function getSessionsByProject(mediaId: string): Promise<Stage3SessionRecord[]> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.sessions.filter((item) => item.mediaId === mediaId);
  });
}

export async function getSessionsByProjectId(projectId: string): Promise<Stage3SessionRecord[]> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.sessions.filter((item) => item.projectId === projectId);
  });
}

export async function updateSession(sessionId: string, patch: UpdateSessionPatch): Promise<Stage3SessionRecord> {
  return withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    const updated: Stage3SessionRecord = {
      ...session,
      ...patch,
      updatedAt: nowIso()
    };
    const index = store.sessions.findIndex((item) => item.id === sessionId);
    store.sessions[index] = updated;
    await writeStore(store);
    return updated;
  });
}

export async function createVersion(input: CreateVersionInput): Promise<Stage3VersionRecord> {
  return withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === input.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const record: Stage3VersionRecord = {
      id: randomUUID().replace(/-/g, ""),
      sessionId: input.sessionId,
      parentVersionId: input.parentVersionId,
      iterationIndex: Math.max(0, Math.floor(input.iterationIndex)),
      source: input.source,
      transformConfig: input.transformConfig,
      diffSummary: input.diffSummary,
      rationale: input.rationale,
      createdAt: nowIso()
    };
    store.versions.push(record);
    session.currentVersionId = record.id;
    if (!session.bestVersionId) {
      session.bestVersionId = record.id;
    }
    session.updatedAt = nowIso();
    await writeStore(store);
    return record;
  });
}

export async function createIteration(input: CreateIterationInput): Promise<Stage3IterationRecord> {
  return withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === input.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const record: Stage3IterationRecord = {
      id: randomUUID().replace(/-/g, ""),
      sessionId: input.sessionId,
      iterationIndex: Math.max(1, Math.floor(input.iterationIndex)),
      beforeVersionId: input.beforeVersionId,
      afterVersionId: input.afterVersionId,
      plan: input.plan,
      appliedOps: input.appliedOps,
      scores: {
        quality: normalizeScore(input.scores.quality),
        goalFit: normalizeScore(input.scores.goalFit),
        safety: normalizeScore(input.scores.safety),
        stepGain: clampSigned01(input.scores.stepGain),
        total: normalizeScore(input.scores.total)
      },
      judgeNotes: input.judgeNotes,
      stoppedReason: input.stoppedReason,
      createdAt: nowIso(),
      timings: {
        planMs: input.timings.planMs,
        executeMs: input.timings.executeMs,
        judgeMs: input.timings.judgeMs,
        totalMs: input.timings.totalMs
      }
    };
    store.iterations.push(record);
    session.lastPlanSummary = input.plan.rationale;
    session.updatedAt = nowIso();
    await writeStore(store);
    return record;
  });
}

export async function listIterations(sessionId: string): Promise<Stage3IterationRecord[]> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.iterations
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.iterationIndex - b.iterationIndex);
  });
}

export async function getVersion(versionId: string): Promise<Stage3VersionRecord | null> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.versions.find((item) => item.id === versionId) ?? null;
  });
}

export async function listVersions(sessionId: string): Promise<Stage3VersionRecord[]> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.versions
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.iterationIndex - b.iterationIndex);
  });
}

export async function listMessages(sessionId: string): Promise<Stage3MessageRecord[]> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.messages
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
}

export async function createMessage(input: CreateMessageInput): Promise<Stage3MessageRecord> {
  return withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === input.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    const message: Stage3MessageRecord = {
      id: randomUUID().replace(/-/g, ""),
      sessionId: input.sessionId,
      role: input.role,
      text: input.text,
      payload: input.payload ?? null,
      createdAt: nowIso()
    };
    store.messages.push(message);
    session.updatedAt = nowIso();
    await writeStore(store);
    return message;
  });
}

export async function listVersionsWithSnapshot(sessionId: string): Promise<Stage3VersionRecord[]> {
  return listVersions(sessionId);
}

export async function setBestVersion(sessionId: string, versionId: string): Promise<void> {
  await withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    session.bestVersionId = versionId;
    session.updatedAt = nowIso();
    await writeStore(store);
  });
}

export async function getSessionTimeline(sessionId: string): Promise<Stage3TimelinePayload> {
  return withStoreLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    const versions = store.versions
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.iterationIndex - b.iterationIndex || a.createdAt.localeCompare(b.createdAt));
    const iterations = store.iterations
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.iterationIndex - b.iterationIndex);
    const messages = store.messages
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return { session, versions, iterations, messages };
  });
}

export async function registerIdempotency(
  key: string,
  result: Stage3IdempotencyRecord["result"],
  context: { sessionId: string; projectId: string; mediaId: string; goalHash: string }
): Promise<void> {
  return withStoreLock(async () => {
    const store = await readStore();
    const now = nowIso();
    const existing = store.idempotency.find((item) => item.key === key);
    if (existing) {
      existing.result = result;
      existing.updatedAt = now;
      await writeStore(store);
      return;
    }

    store.idempotency.push({
      key,
      sessionId: context.sessionId,
      projectId: context.projectId,
      mediaId: context.mediaId,
      goalHash: context.goalHash,
      createdAt: now,
      updatedAt: now,
      result
    });

    store.idempotency = store.idempotency.slice(-200);
    await writeStore(store);
  });
}

export async function findIdempotency(key: string): Promise<Stage3IdempotencyRecord | null> {
  return withStoreLock(async () => {
    const store = await readStore();
    return store.idempotency.find((item) => item.key === key) ?? null;
  });
}

export function buildStage3VersionFromStoreVersion(
  version: Stage3VersionRecord,
  parent: Stage3VersionRecord | null,
  passIndex: number,
  runId: string
): Stage3Version {
  const baseline = (parent?.transformConfig ?? version.transformConfig) as Stage3StateSnapshot;

  return {
    versionNo: Math.max(1, passIndex),
    runId,
    createdAt: version.createdAt,
    prompt: "",
    baseline,
    final: version.transformConfig,
    diff: {
      textChanged:
        baseline.topText !== version.transformConfig.topText ||
        baseline.bottomText !== version.transformConfig.bottomText,
      framingChanged:
        Math.abs(baseline.clipStartSec - version.transformConfig.clipStartSec) >= 0.01 ||
        Math.abs(baseline.focusY - version.transformConfig.focusY) >= 0.005 ||
        Math.abs(baseline.renderPlan.videoZoom - version.transformConfig.renderPlan.videoZoom) >= 0.01,
      timingChanged:
        baseline.renderPlan.timingMode !== version.transformConfig.renderPlan.timingMode ||
        baseline.renderPlan.audioMode !== version.transformConfig.renderPlan.audioMode ||
        baseline.renderPlan.policy !== version.transformConfig.renderPlan.policy ||
        baseline.renderPlan.smoothSlowMo !== version.transformConfig.renderPlan.smoothSlowMo,
      segmentsChanged:
        JSON.stringify(baseline.renderPlan.segments) !==
        JSON.stringify(version.transformConfig.renderPlan.segments),
      audioChanged: baseline.renderPlan.audioMode !== version.transformConfig.renderPlan.audioMode,
      summary: version.diffSummary
    },
    internalPasses: [
      {
        pass: passIndex,
        label: `Итерация ${passIndex}`,
        summary: version.rationale,
        changes: version.diffSummary,
        topText: version.transformConfig.topText,
        bottomText: version.transformConfig.bottomText,
        topFontPx: version.transformConfig.textFit.topFontPx,
        bottomFontPx: version.transformConfig.textFit.bottomFontPx,
        topCompacted: version.transformConfig.textFit.topCompacted,
        bottomCompacted: version.transformConfig.textFit.bottomCompacted,
        clipStartSec: version.transformConfig.clipStartSec,
        clipDurationSec: version.transformConfig.clipDurationSec,
        clipEndSec: version.transformConfig.clipStartSec + version.transformConfig.clipDurationSec,
        focusY: version.transformConfig.focusY,
        renderPlan: version.transformConfig.renderPlan
      }
    ],
    recommendedPass: 1,
    agentMeta: {
      model: "agent-autonomous",
      reasoningEffort: "mixed",
      passesExecuted: 1,
      acceptedPasses: 1,
      stoppedBy: version.source === "rollback" ? "max_pass" : "quality_threshold"
    }
  };
}

export async function ensureStoreInitialized(): Promise<void> {
  await withStoreLock(async () => {
    await ensureStoreExists();
    await readStore();
  });
}
