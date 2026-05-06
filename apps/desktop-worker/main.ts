import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildStage3DesktopWorkerChildLaunch,
  resolveStage3DesktopWorkerNode
} from "../../lib/stage3-worker-desktop-launch";
import {
  getStage3WorkerPaths,
  logoutStage3Worker,
  pairStage3Worker,
  readStage3WorkerConfig,
  syncStage3WorkerRuntime,
  type WorkerConfig
} from "../../lib/stage3-worker-runtime";

type DesktopWorkerState = {
  paired: boolean;
  workerStatus: "idle" | "starting" | "running" | "error";
  config: Pick<WorkerConfig, "serverOrigin" | "workerId" | "label" | "platform" | "pairedAt"> | null;
  error: string | null;
  logs: string[];
};

const PROTOCOL = "clips-stage3-worker";
const MAX_LOG_LINES = 200;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let workerPromise: Promise<void> | null = null;
let workerProcess: ChildProcess | null = null;
let workerRunId = 0;

const state: DesktopWorkerState = {
  paired: false,
  workerStatus: "idle",
  config: null,
  error: null,
  logs: []
};

function renderState(): DesktopWorkerState {
  return { ...state, logs: [...state.logs] };
}

async function appendLog(level: "info" | "error", message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  state.logs = [...state.logs.slice(-MAX_LOG_LINES + 1), line];
  mainWindow?.webContents.send("worker-state", renderState());
  try {
    const logDir = path.join(getStage3WorkerPaths().root, "logs");
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(path.join(logDir, "desktop-worker.log"), `${line}\n`, "utf-8");
  } catch {
    // Logging must not break the worker loop.
  }
}

function setState(patch: Partial<DesktopWorkerState>): void {
  Object.assign(state, patch);
  mainWindow?.webContents.send("worker-state", renderState());
  updateTray();
}

async function refreshConfigState(): Promise<WorkerConfig | null> {
  const config = await readStage3WorkerConfig();
  setState({
    paired: Boolean(config),
    config: config
      ? {
          serverOrigin: config.serverOrigin,
          workerId: config.workerId,
          label: config.label,
          platform: config.platform,
          pairedAt: config.pairedAt
        }
      : null
  });
  return config;
}

function patchConsoleForLogFile(): void {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    originalLog(...args);
    void appendLog("info", args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    void appendLog("info", args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    void appendLog("error", args.map(String).join(" "));
  };
}

function createWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 520,
    height: 620,
    title: "Clips Worker",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs")
    }
  });
  void mainWindow.loadFile(path.join(__dirname, "renderer.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function updateTray(): void {
  if (!tray) {
    return;
  }
  const label =
    state.workerStatus === "running"
      ? "Clips Worker: Online"
      : state.workerStatus === "starting"
        ? "Clips Worker: Starting"
        : state.workerStatus === "error"
          ? "Clips Worker: Error"
          : "Clips Worker";
  tray.setToolTip(label);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: "separator" },
      { label: "Open", click: () => createWindow() },
      { label: "Retry worker", click: () => void startWorkerIfConfigured(true) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.on("click", () => createWindow());
  updateTray();
}

function pipeWorkerOutput(
  stream: NodeJS.ReadableStream,
  level: "info" | "error"
): void {
  let buffer = "";
  stream.setEncoding("utf-8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "").trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) {
        void appendLog(level, line);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    const line = buffer.replace(/\r$/, "").trimEnd();
    if (line.trim()) {
      void appendLog(level, line);
    }
    buffer = "";
  });
}

async function stopWorkerProcess(): Promise<void> {
  const child = workerProcess;
  if (!child) {
    return;
  }
  workerProcess = null;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    child.once("exit", finish);
    child.once("error", finish);
    child.kill();
    setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
        finish();
      }
    }, 3000).unref?.();
  });
}

async function startWorkerIfConfigured(force = false): Promise<void> {
  if (workerPromise || workerProcess) {
    if (!force) {
      return;
    }
    workerRunId += 1;
    const previousWorkerPromise = workerPromise;
    await appendLog("info", "Restarting Clips Worker loop.");
    await stopWorkerProcess();
    await previousWorkerPromise?.catch(() => undefined);
  }

  const config = await refreshConfigState();
  if (!config) {
    setState({ workerStatus: "idle", error: "Open Stage 3 and click Open Clips Worker." });
    return;
  }
  setState({ workerStatus: "starting", error: null });
  const runId = workerRunId;
  const promise = (async () => {
    const node = await resolveStage3DesktopWorkerNode();
    if (!node.ok) {
      throw new Error(`${node.error} Checked: ${node.checked.join("; ") || "none"}`);
    }
    await appendLog("info", `Using Node.js ${node.version} for Stage 3 worker: ${node.command}`);

    const launch = buildStage3DesktopWorkerChildLaunch({
      nodeCommand: node.command,
      installRoot: getStage3WorkerPaths().root
    });
    const syncResult = await syncStage3WorkerRuntime(config.serverOrigin, {
      env: launch.env
    });
    if (syncResult.updated) {
      await appendLog("info", `Prepared local Stage 3 runtime ${syncResult.runtimeVersion ?? "latest"}.`);
    }
    if (runId !== workerRunId) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      workerProcess = child;
      pipeWorkerOutput(child.stdout, "info");
      pipeWorkerOutput(child.stderr, "error");
      child.once("spawn", () => {
        setState({ workerStatus: "running", error: null });
      });
      child.once("error", (error) => {
        if (workerProcess === child) {
          workerProcess = null;
        }
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (workerProcess === child) {
          workerProcess = null;
        }
        if (runId !== workerRunId) {
          resolve();
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Stage 3 worker process exited (${signal ?? `code ${code ?? "unknown"}`}).`));
      });
    });
  })()
    .then(() => {
      if (runId === workerRunId) {
        setState({ workerStatus: "idle" });
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (runId === workerRunId) {
        setState({ workerStatus: "error", error: message });
      }
      void appendLog("error", message);
    })
    .finally(() => {
      if (workerPromise === promise) {
        workerPromise = null;
      }
    });
  workerPromise = promise;
}

async function handlePairDeepLink(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    await appendLog("error", `Invalid Clips Worker deep link: ${rawUrl}`);
    return;
  }
  if (parsed.protocol !== `${PROTOCOL}:` || parsed.hostname !== "pair") {
    return;
  }
  const server = parsed.searchParams.get("server") ?? "";
  const token = parsed.searchParams.get("token") ?? "";
  const label = parsed.searchParams.get("label");
  setState({ workerStatus: "starting", error: null });
  try {
    const config = await pairStage3Worker({ server, token, label });
    await appendLog("info", `Paired ${config.label} with ${config.serverOrigin}`);
    await refreshConfigState();
    await startWorkerIfConfigured(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState({ workerStatus: "error", error: message });
    await appendLog("error", message);
  }
}

async function handlePossibleDeepLinkArg(argv: string[]): Promise<boolean> {
  const link = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (link) {
    await handlePairDeepLink(link);
    return true;
  }
  return false;
}

function registerProtocolHandling(): void {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1] ?? ""]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handlePairDeepLink(url);
  });
  app.on("second-instance", (_event, argv) => {
    createWindow();
    void handlePossibleDeepLinkArg(argv);
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  registerProtocolHandling();
  patchConsoleForLogFile();

  ipcMain.handle("get-worker-state", () => renderState());
  ipcMain.handle("retry-worker", () => startWorkerIfConfigured(true));
  ipcMain.handle("logout-worker", async () => {
    workerRunId += 1;
    if (workerPromise || workerProcess) {
      const previousWorkerPromise = workerPromise;
      await appendLog("info", "Stopping Clips Worker loop before removing pairing.");
      await stopWorkerProcess();
      await previousWorkerPromise?.catch(() => undefined);
    }
    await logoutStage3Worker();
    await appendLog("info", "Worker config removed.");
    setState({ workerStatus: "idle", error: "Open Stage 3 and click Open Clips Worker." });
    await refreshConfigState();
  });
  ipcMain.handle("open-logs", async () => {
    await shell.openPath(path.join(getStage3WorkerPaths().root, "logs"));
  });

  void app.whenReady().then(async () => {
    createTray();
    createWindow();
    await refreshConfigState();
    const handledDeepLink = await handlePossibleDeepLinkArg(process.argv);
    if (!handledDeepLink) {
      await startWorkerIfConfigured(false);
    }
  });
}
