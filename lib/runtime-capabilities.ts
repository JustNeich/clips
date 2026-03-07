import { resolveExecutableFromCandidates } from "./command-path";
import { isFastSaverConfigured } from "./source-acquisition";

export type RuntimeToolCapability = {
  available: boolean;
  resolvedPath: string | null;
  message: string | null;
};

export type RuntimeCapabilities = {
  deployment: {
    vercel: boolean;
    nodeVersion: string;
  };
  tools: {
    codex: RuntimeToolCapability;
    fastSaver: RuntimeToolCapability;
    ytDlp: RuntimeToolCapability;
    ffmpeg: RuntimeToolCapability;
    ffprobe: RuntimeToolCapability;
  };
  features: {
    fetchSource: boolean;
    downloadSource: boolean;
    loadComments: boolean;
    sharedCodex: boolean;
    stage2: boolean;
    stage3: boolean;
  };
};

const CODEX_CANDIDATES = [
  process.env.CODEX_BIN?.trim(),
  "/Applications/Codex.app/Contents/Resources/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "codex"
];

const YTDLP_CANDIDATES = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"];
const FFMPEG_CANDIDATES = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
const FFPROBE_CANDIDATES = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];

function isRenderRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function codexUnavailableMessage(): string {
  if (process.env.VERCEL === "1") {
    return "Codex CLI недоступен на этом Vercel deployment. Shared Codex device auth здесь не заработает без внешнего runtime/worker.";
  }
  if (isRenderRuntime()) {
    return "Codex CLI не найден на Render. Для этого проекта нужен Docker runtime с `npm i -g @openai/codex`.";
  }
  return "Codex CLI не найден. Установите Codex или задайте CODEX_BIN, затем перезапустите сервер.";
}

function ytDlpUnavailableMessage(): string {
  if (process.env.VERCEL === "1") {
    return "yt-dlp недоступен на этом Vercel deployment. Step 1 fetch/download/comments не сможет обработать исходное видео.";
  }
  if (isRenderRuntime()) {
    return "yt-dlp не найден на Render. Для этого проекта нужен Docker runtime с установленными yt-dlp и ffmpeg.";
  }
  return "yt-dlp не найден на сервере.";
}

function fastSaverUnavailableMessage(): string {
  return "FastSaver API key не задан. Добавьте FASTSAVER_API_KEY, чтобы source/mp4 скачивались через hosted provider без локального yt-dlp.";
}

function ffmpegUnavailableMessage(tool: "ffmpeg" | "ffprobe"): string {
  if (process.env.VERCEL === "1") {
    return `${tool} недоступен на этом Vercel deployment. Media pipeline Step 2/Step 3 не сможет обработать видео.`;
  }
  if (isRenderRuntime()) {
    return `${tool} не найден на Render. Для этого проекта нужен Docker runtime с установленными yt-dlp и ffmpeg.`;
  }
  return `${tool} не найден на сервере.`;
}

async function inspectTool(
  candidates: Array<string | null | undefined>,
  unavailableMessage: string
): Promise<RuntimeToolCapability> {
  const resolvedPath = await resolveExecutableFromCandidates(candidates);
  if (!resolvedPath) {
    return {
      available: false,
      resolvedPath: null,
      message: unavailableMessage
    };
  }
  return {
    available: true,
    resolvedPath,
    message: null
  };
}

async function inspectFastSaver(): Promise<RuntimeToolCapability> {
  if (!isFastSaverConfigured()) {
    return {
      available: false,
      resolvedPath: null,
      message: fastSaverUnavailableMessage()
    };
  }

  return {
    available: true,
    resolvedPath: process.env.FASTSAVER_BASE_URL?.trim() || "https://api.fastsaver.io/v1",
    message: null
  };
}

export async function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const [codex, fastSaver, ytDlp, ffmpeg, ffprobe] = await Promise.all([
    inspectTool(CODEX_CANDIDATES, codexUnavailableMessage()),
    inspectFastSaver(),
    inspectTool(YTDLP_CANDIDATES, ytDlpUnavailableMessage()),
    inspectTool(FFMPEG_CANDIDATES, ffmpegUnavailableMessage("ffmpeg")),
    inspectTool(FFPROBE_CANDIDATES, ffmpegUnavailableMessage("ffprobe"))
  ]);

  const sourceAcquisitionReady = fastSaver.available || ytDlp.available;
  const stage2 = codex.available && sourceAcquisitionReady && ffmpeg.available && ffprobe.available;
  const stage3 = sourceAcquisitionReady && ffmpeg.available && ffprobe.available;

  return {
    deployment: {
      vercel: process.env.VERCEL === "1",
      nodeVersion: process.version
    },
    tools: {
      codex,
      fastSaver,
      ytDlp,
      ffmpeg,
      ffprobe
    },
    features: {
      fetchSource: sourceAcquisitionReady,
      downloadSource: sourceAcquisitionReady,
      loadComments: ytDlp.available,
      sharedCodex: codex.available,
      stage2,
      stage3
    }
  };
}

export async function requireRuntimeTool(
  tool: "codex" | "ytDlp" | "ffmpeg" | "ffprobe"
): Promise<string> {
  const capabilities = await getRuntimeCapabilities();
  const capability = capabilities.tools[tool];
  if (!capability.available || !capability.resolvedPath) {
    throw new Error(capability.message ?? `${tool} is unavailable.`);
  }
  return capability.resolvedPath;
}
