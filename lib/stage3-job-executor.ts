import { promises as fs } from "node:fs";
import {
  Stage3JobKind
} from "../app/components/types";
import { extractYtDlpErrorDescriptorFromUnknown } from "./ytdlp";
import {
  prepareStage3Preview,
  PREVIEW_WAIT_TIMEOUT_MS,
  Stage3PreviewRequestBody,
  summarizeStage3PreviewError
} from "./stage3-preview-service";
import {
  EDITING_PROXY_WAIT_TIMEOUT_MS,
  prepareStage3EditingProxy,
  Stage3EditingProxyRequestBody,
  summarizeStage3EditingProxyError
} from "./stage3-editing-proxy-service";
import {
  renderStage3Video,
  RENDER_WAIT_TIMEOUT_MS,
  Stage3RenderRequestBody,
  summarizeStage3RenderError
} from "./stage3-render-service";
import { executeStage3AgentMediaStep, type Stage3AgentMediaStepPayload } from "./stage3-agent-media-step";
import { ensureStage3SourceCached } from "./stage3-server-control";

export type Stage3ExecutedJobResult = {
  resultJson: string | null;
  artifact:
    | {
        filePath: string;
        fileName: string;
        mimeType: string;
      }
    | null;
  cleanup: (() => Promise<void>) | null;
};

export function resolveStage3HeavyJobErrorCode(kind: Stage3JobKind): string {
  if (kind === "preview") {
    return "preview_failed";
  }
  if (kind === "render") {
    return "render_failed";
  }
  if (kind === "editing-proxy") {
    return "editing_proxy_failed";
  }
  if (kind === "source-download") {
    return "source_download_failed";
  }
  return "job_failed";
}

export async function executeStage3HeavyJobPayload(
  kind: Stage3JobKind,
  payloadJson: string
): Promise<Stage3ExecutedJobResult> {
  if (kind === "preview") {
    const payload = JSON.parse(payloadJson) as Stage3PreviewRequestBody;
    const prepared = await prepareStage3Preview(payload, {
      waitTimeoutMs: PREVIEW_WAIT_TIMEOUT_MS
    });
    return {
      resultJson: JSON.stringify({
        cacheKey: prepared.cacheKey,
        cacheState: prepared.cacheState
      }),
      artifact: {
        filePath: prepared.filePath,
        fileName: `${prepared.cacheKey}.mp4`,
        mimeType: "video/mp4"
      },
      cleanup: null
    };
  }

  if (kind === "render") {
    const payload = JSON.parse(payloadJson) as Stage3RenderRequestBody;
    const rendered = await renderStage3Video(payload, {
      waitTimeoutMs: RENDER_WAIT_TIMEOUT_MS
    });
    return {
      resultJson: JSON.stringify({
        outputName: rendered.outputName,
        topCompacted: rendered.topCompacted,
        bottomCompacted: rendered.bottomCompacted,
        variation: {
          seed: rendered.variationManifest.seed,
          requestedMode: rendered.variationManifest.requestedMode,
          appliedMode: rendered.variationManifest.appliedMode,
          profileVersion: rendered.variationManifest.profileVersion
        }
      }),
      artifact: {
        filePath: rendered.filePath,
        fileName: rendered.outputName,
        mimeType: "video/mp4"
      },
      cleanup: async () => {
        await fs.rm(rendered.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
      }
    };
  }

  if (kind === "editing-proxy") {
    const payload = JSON.parse(payloadJson) as Stage3EditingProxyRequestBody;
    const prepared = await prepareStage3EditingProxy(payload, {
      waitTimeoutMs: EDITING_PROXY_WAIT_TIMEOUT_MS
    });
    return {
      resultJson: JSON.stringify({
        sourceKey: prepared.sourceKey,
        sourceDurationSec: prepared.sourceDurationSec,
        cacheState: prepared.cacheState
      }),
      artifact: {
        filePath: prepared.filePath,
        fileName: prepared.fileName,
        mimeType: "video/mp4"
      },
      cleanup: null
    };
  }

  if (kind === "source-download") {
    const payload = JSON.parse(payloadJson) as { sourceUrl?: string };
    const sourceUrl = payload.sourceUrl?.trim() ?? "";
    if (!sourceUrl) {
      throw new Error("Stage 3 source-download job is missing sourceUrl.");
    }
    const cached = await ensureStage3SourceCached(sourceUrl);
    return {
      resultJson: JSON.stringify({
        sourceKey: cached.sourceKey,
        sourceDurationSec: cached.sourceDurationSec,
        fileName: cached.fileName
      }),
      artifact: null,
      cleanup: null
    };
  }

  if (kind === "agent-media-step") {
    const payload = JSON.parse(payloadJson) as Stage3AgentMediaStepPayload;
    const result = await executeStage3AgentMediaStep(payload);
    return {
      resultJson: JSON.stringify(result),
      artifact: null,
      cleanup: null
    };
  }

  throw new Error(`Unsupported Stage 3 local job kind: ${kind}`);
}

export function classifyStage3HeavyJobError(
  kind: Stage3JobKind,
  error: unknown
): { code: string; message: string; recoverable: boolean } {
  const ytdlpError = extractYtDlpErrorDescriptorFromUnknown(error);
  if (ytdlpError) {
    return {
      code: resolveStage3HeavyJobErrorCode(kind),
      message: ytdlpError.message,
      recoverable: ytdlpError.retryable
    };
  }

  if (kind === "preview") {
    return {
      code: resolveStage3HeavyJobErrorCode(kind),
      message: summarizeStage3PreviewError(error),
      recoverable: true
    };
  }
  if (kind === "render") {
    return {
      code: resolveStage3HeavyJobErrorCode(kind),
      message: summarizeStage3RenderError(error),
      recoverable: true
    };
  }
  if (kind === "editing-proxy") {
    return {
      code: resolveStage3HeavyJobErrorCode(kind),
      message: summarizeStage3EditingProxyError(error),
      recoverable: true
    };
  }
  if (kind === "agent-media-step") {
    return {
      code: resolveStage3HeavyJobErrorCode(kind),
      message: error instanceof Error ? error.message : "Stage 3 agent media step failed.",
      recoverable: true
    };
  }
  return {
    code: resolveStage3HeavyJobErrorCode(kind),
    message: error instanceof Error ? error.message : "Stage 3 job failed.",
    recoverable: true
  };
}

export function summarizeStage3HeavyJobError(kind: Stage3JobKind, error: unknown): string {
  return classifyStage3HeavyJobError(kind, error).message;
}
