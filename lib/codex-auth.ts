import { spawn, ChildProcessByStdio } from "node:child_process";
import { Readable } from "node:stream";
import { getCodexLoginStatus } from "./codex-runner";
import {
  codexNotFoundMessage,
  isCodexNotFoundError,
  resolveCodexExecutable
} from "./codex-binary";

type DeviceAuthProcess = ChildProcessByStdio<null, Readable, Readable>;

type DeviceAuthStatus = "idle" | "running" | "done" | "error" | "canceled";

type DeviceAuthState = {
  status: DeviceAuthStatus;
  output: string;
  loginUrl: string | null;
  userCode: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  error: string | null;
};

type DeviceAuthInternalState = DeviceAuthState & {
  process: DeviceAuthProcess | null;
  cancelRequested: boolean;
};

const MAX_OUTPUT_CHARS = 12_000;

function sanitizeCliText(value: string): string {
  // Remove ANSI escape sequences.
  const withoutAnsi = value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  // Remove leftover style tags like [0m], [94m] if they appear as plain text.
  return withoutAnsi.replace(/\[(?:\d{1,3}(?:;\d{1,3})*)m/g, "");
}

function getDeviceAuthStore(): Map<string, DeviceAuthInternalState> {
  const globalScope = globalThis as typeof globalThis & {
    __codexDeviceAuthStore?: Map<string, DeviceAuthInternalState>;
  };

  if (!globalScope.__codexDeviceAuthStore) {
    globalScope.__codexDeviceAuthStore = new Map<string, DeviceAuthInternalState>();
  }

  return globalScope.__codexDeviceAuthStore;
}

function getOrCreateState(sessionId: string): DeviceAuthInternalState {
  const store = getDeviceAuthStore();
  const existing = store.get(sessionId);
  if (existing) {
    return existing;
  }

  const created: DeviceAuthInternalState = {
    status: "idle",
    output: "",
    loginUrl: null,
    userCode: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    error: null,
    process: null,
    cancelRequested: false
  };

  store.set(sessionId, created);
  return created;
}

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }
  return value.slice(value.length - MAX_OUTPUT_CHARS);
}

function parseDeviceHints(output: string): { loginUrl: string | null; userCode: string | null } {
  const clean = sanitizeCliText(output);
  const urlMatch =
    clean.match(/https?:\/\/auth\.openai\.com\/codex\/device[^\s)]*/i) ??
    clean.match(/https?:\/\/[^\s)]+/i);
  const codeMatch =
    clean.match(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})\b/) ??
    clean.match(/\b[A-Z0-9]{8}\b/);

  return {
    loginUrl: urlMatch?.[0] ?? null,
    userCode: codeMatch?.[0] ?? null
  };
}

function appendOutput(state: DeviceAuthInternalState, chunk: Buffer | string): void {
  const next = sanitizeCliText(state.output + chunk.toString());
  state.output = trimOutput(next);
  const hints = parseDeviceHints(state.output);
  if (hints.loginUrl) {
    state.loginUrl = hints.loginUrl;
  }
  if (hints.userCode) {
    state.userCode = hints.userCode;
  }
}

function toPublicState(state: DeviceAuthInternalState): DeviceAuthState {
  return {
    status: state.status,
    output: state.output,
    loginUrl: state.loginUrl,
    userCode: state.userCode,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    exitCode: state.exitCode,
    error: state.error
  };
}

export function getDeviceAuthState(sessionId: string): DeviceAuthState {
  return toPublicState(getOrCreateState(sessionId));
}

export async function startDeviceAuth(sessionId: string, codexHome: string): Promise<DeviceAuthState> {
  const state = getOrCreateState(sessionId);

  if (state.process && state.status === "running") {
    return toPublicState(state);
  }

  state.status = "running";
  state.output = "";
  state.loginUrl = null;
  state.userCode = null;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.exitCode = null;
  state.error = null;
  state.cancelRequested = false;

  const codexBin = await resolveCodexExecutable();
  const child = spawn(codexBin, ["login", "--device-auth"], {
    env: {
      ...process.env,
      CODEX_HOME: codexHome
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  state.process = child;

  child.stdout.on("data", (chunk) => appendOutput(state, chunk));
  child.stderr.on("data", (chunk) => appendOutput(state, chunk));

  child.on("error", (error) => {
    state.status = "error";
    state.error = isCodexNotFoundError(error) ? codexNotFoundMessage() : error.message;
    state.finishedAt = Date.now();
    state.process = null;
  });

  child.on("close", (code) => {
    state.exitCode = code;
    state.finishedAt = Date.now();
    state.process = null;

    if (state.cancelRequested) {
      state.status = "canceled";
      return;
    }
    if (code === 0) {
      state.status = "done";
      return;
    }

    state.status = "error";
    if (!state.error) {
      state.error = "Codex login завершился с ошибкой.";
    }
  });

  return toPublicState(state);
}

export function cancelDeviceAuth(sessionId: string): DeviceAuthState {
  const state = getOrCreateState(sessionId);
  if (!state.process || state.status !== "running") {
    return toPublicState(state);
  }

  state.cancelRequested = true;
  state.process.kill("SIGTERM");
  return toPublicState(state);
}

export async function getCombinedCodexAuthState(
  sessionId: string,
  codexHome: string
): Promise<{
  loggedIn: boolean;
  loginStatusText: string;
  deviceAuth: DeviceAuthState;
}> {
  const loginStatus = await getCodexLoginStatus(codexHome);
  return {
    loggedIn: loginStatus.loggedIn,
    loginStatusText: loginStatus.raw,
    deviceAuth: getDeviceAuthState(sessionId)
  };
}
