import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

export const LOCAL_FIRST_CONTRACT_VERSION = 1;
export const LOCAL_FIRST_STATE_SCHEMA_VERSION = 1;
export const LOCAL_FIRST_NODE_MAJOR = 22;
export const LOCAL_FIRST_RENDER_CONCURRENCY = 1;
export const LOCAL_FIRST_MAX_RECOVERY_ATTEMPTS = 5;

export const LOCAL_FIRST_RECREATABLE_DATA_DIRS = new Set([
  "agent-decomposition",
  "source-media-cache",
  "stage2-debug-artifacts",
  "stage3-cache"
]);

export type LocalFirstRuntimeIdentity = {
  gitRevision: string;
  lockfileSha256: string;
  nodeMajor: number;
};

export type LocalFirstHandoff = {
  id: string;
  fromMachineId: string;
  toMachineId: string;
  tokenSha256: string;
  createdAt: string;
  acceptedAt: string | null;
  sourceDataRoot: string;
};

export type LocalFirstStateManifest = {
  format: "clips-local-first-state";
  contractVersion: number;
  stateSchemaVersion: number;
  generation: number;
  status: "active" | "handoff_pending" | "handed_off";
  runtime: LocalFirstRuntimeIdentity;
  owner: {
    machineId: string;
    epoch: number;
    activatedAt: string;
  } | null;
  handoff: LocalFirstHandoff | null;
  updatedAt: string;
};

export type LocalFirstRuntimeIssue = {
  code: string;
  message: string;
};

const CORRECTABLE_LOCAL_ERROR_CODES = new Set([
  "artifact_storage_full",
  "busy",
  "editing_proxy_timeout",
  "process_restart",
  "preview_timeout",
  "render_timeout",
  "source_download_timeout",
  "worker_restart_attempt_limit",
  "worker_runtime_outdated",
  "worker_unavailable"
]);

const TRANSIENT_LOCAL_FAILURE_CODES = new Set([
  "editing_proxy_failed",
  "job_failed",
  "preview_failed",
  "render_failed",
  "source_download_failed"
]);

const TRANSIENT_MESSAGE_PATTERN =
  /\b(?:eai_again|econnreset|econnrefused|enospc|etimedout|socket hang up|target closed|browser closed|temporar(?:y|ily)|timeout|timed out)\b/i;

export function normalizeLocalFirstMachineId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(normalized)) {
    throw new Error(
      "Machine id must use 1-64 lowercase letters, digits, dots, underscores, or dashes."
    );
  }
  return normalized;
}

export function hashLocalFirstHandoffToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createLocalFirstManifest(input: {
  machineId: string;
  runtime: LocalFirstRuntimeIdentity;
  now?: string;
}): LocalFirstStateManifest {
  const now = input.now ?? new Date().toISOString();
  return {
    format: "clips-local-first-state",
    contractVersion: LOCAL_FIRST_CONTRACT_VERSION,
    stateSchemaVersion: LOCAL_FIRST_STATE_SCHEMA_VERSION,
    generation: 1,
    status: "active",
    runtime: input.runtime,
    owner: {
      machineId: normalizeLocalFirstMachineId(input.machineId),
      epoch: 1,
      activatedAt: now
    },
    handoff: null,
    updatedAt: now
  };
}

export function beginLocalFirstHandoff(input: {
  manifest: LocalFirstStateManifest;
  machineId: string;
  toMachineId: string;
  dataRoot: string;
  now?: string;
  token?: string;
}): {
  sourceManifest: LocalFirstStateManifest;
  transferManifest: LocalFirstStateManifest;
  token: string;
} {
  const machineId = normalizeLocalFirstMachineId(input.machineId);
  const toMachineId = normalizeLocalFirstMachineId(input.toMachineId);
  if (machineId === toMachineId) {
    throw new Error("Handoff target must be a different machine.");
  }
  if (input.manifest.status !== "active" || input.manifest.owner?.machineId !== machineId) {
    throw new Error(`State is not actively owned by ${machineId}.`);
  }
  const now = input.now ?? new Date().toISOString();
  const token = input.token ?? randomBytes(32).toString("hex");
  const handoff: LocalFirstHandoff = {
    id: randomUUID(),
    fromMachineId: machineId,
    toMachineId,
    tokenSha256: hashLocalFirstHandoffToken(token),
    createdAt: now,
    acceptedAt: null,
    sourceDataRoot: path.resolve(input.dataRoot)
  };
  const pending: LocalFirstStateManifest = {
    ...input.manifest,
    generation: input.manifest.generation + 1,
    status: "handoff_pending",
    handoff,
    updatedAt: now
  };
  return {
    sourceManifest: {
      ...pending,
      status: "handed_off",
      owner: null
    },
    transferManifest: pending,
    token
  };
}

export function acceptLocalFirstHandoff(input: {
  manifest: LocalFirstStateManifest;
  machineId: string;
  token: string;
  runtime: LocalFirstRuntimeIdentity;
  now?: string;
}): LocalFirstStateManifest {
  const machineId = normalizeLocalFirstMachineId(input.machineId);
  const handoff = input.manifest.handoff;
  if (input.manifest.status !== "handoff_pending" || !handoff) {
    throw new Error("Transfer is not awaiting handoff acceptance.");
  }
  if (handoff.toMachineId !== machineId) {
    throw new Error(`Transfer belongs to ${handoff.toMachineId}, not ${machineId}.`);
  }
  if (hashLocalFirstHandoffToken(input.token) !== handoff.tokenSha256) {
    throw new Error("Handoff token is invalid.");
  }
  const runtimeIssues = validateLocalFirstRuntime(input.manifest, input.runtime);
  if (runtimeIssues.length > 0) {
    throw new Error(runtimeIssues.map((issue) => issue.message).join(" "));
  }
  const now = input.now ?? new Date().toISOString();
  return {
    ...input.manifest,
    generation: input.manifest.generation + 1,
    status: "active",
    owner: {
      machineId,
      epoch: (input.manifest.owner?.epoch ?? 0) + 1,
      activatedAt: now
    },
    handoff: {
      ...handoff,
      acceptedAt: now
    },
    updatedAt: now
  };
}

export function validateLocalFirstRuntime(
  manifest: LocalFirstStateManifest,
  current: LocalFirstRuntimeIdentity
): LocalFirstRuntimeIssue[] {
  const issues: LocalFirstRuntimeIssue[] = [];
  if (manifest.format !== "clips-local-first-state") {
    issues.push({ code: "state_format_mismatch", message: "Portable state format is not recognized." });
  }
  if (manifest.contractVersion !== LOCAL_FIRST_CONTRACT_VERSION) {
    issues.push({
      code: "contract_version_mismatch",
      message:
        `State contract ${manifest.contractVersion} does not match runtime contract ` +
        `${LOCAL_FIRST_CONTRACT_VERSION}. Run local:first migrate while the state is offline.`
    });
  }
  if (manifest.stateSchemaVersion !== LOCAL_FIRST_STATE_SCHEMA_VERSION) {
    issues.push({
      code: "state_schema_mismatch",
      message:
        `State schema ${manifest.stateSchemaVersion} does not match runtime schema ` +
        `${LOCAL_FIRST_STATE_SCHEMA_VERSION}. Run local:first migrate while the state is offline.`
    });
  }
  if (manifest.runtime.nodeMajor !== LOCAL_FIRST_NODE_MAJOR) {
    issues.push({
      code: "state_node_version_mismatch",
      message:
        `State was prepared with Node ${manifest.runtime.nodeMajor}; ` +
        `Node ${LOCAL_FIRST_NODE_MAJOR} is required.`
    });
  }
  if (current.nodeMajor !== LOCAL_FIRST_NODE_MAJOR) {
    issues.push({
      code: "node_version_mismatch",
      message: `Node ${LOCAL_FIRST_NODE_MAJOR} is required; current major is ${current.nodeMajor}.`
    });
  }
  if (manifest.runtime.gitRevision !== current.gitRevision) {
    issues.push({
      code: "git_revision_mismatch",
      message:
        `State expects Git ${manifest.runtime.gitRevision}; checkout that revision or run ` +
        "local:first migrate before starting."
    });
  }
  if (manifest.runtime.lockfileSha256 !== current.lockfileSha256) {
    issues.push({
      code: "lockfile_mismatch",
      message: "package-lock.json does not match the runtime recorded in portable state."
    });
  }
  return issues;
}

export function isCorrectableLocalFirstFailure(input: {
  errorCode: string | null | undefined;
  errorMessage: string | null | undefined;
}): boolean {
  const code = input.errorCode?.trim().toLowerCase() ?? "";
  if (CORRECTABLE_LOCAL_ERROR_CODES.has(code)) {
    return true;
  }
  return (
    TRANSIENT_LOCAL_FAILURE_CODES.has(code) &&
    TRANSIENT_MESSAGE_PATTERN.test(input.errorMessage ?? "")
  );
}

export function buildLocalFirstChildEnvironment(input: {
  base?: NodeJS.ProcessEnv;
  stateDir: string;
  machineDir: string;
  port?: number;
}): NodeJS.ProcessEnv {
  const port = input.port ?? 3000;
  const env: NodeJS.ProcessEnv = { ...(input.base ?? process.env) };
  for (const key of [
    "CLIPS_REMOTE_API_ORIGIN",
    "RENDER",
    "RENDER_API_KEY",
    "RENDER_DEPLOY_HOOK_URL",
    "RENDER_EXTERNAL_HOSTNAME",
    "RENDER_SERVICE_ID"
  ]) {
    delete env[key];
  }
  const origin = `http://127.0.0.1:${port}`;
  return {
    ...env,
    APP_DATA_DIR: path.join(path.resolve(input.stateDir), "data"),
    CLIPS_APP_URL: origin,
    CLIPS_LOCAL_FIRST: "1",
    CODEX_SESSIONS_DIR: path.join(path.resolve(input.machineDir), "codex-sessions"),
    PUBLIC_APP_ORIGIN: origin,
    STAGE3_ALLOW_HOST_EXECUTION: "0",
    STAGE3_DEFAULT_EXECUTION_TARGET: "local",
    STAGE3_WORKER_HOME: path.join(path.resolve(input.machineDir), "worker"),
    STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS: String(LOCAL_FIRST_RENDER_CONCURRENCY)
  };
}
