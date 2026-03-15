import { promises as fs } from "node:fs";
import {
  Stage3JobKind
} from "../app/components/types";
import {
  prepareStage3Preview,
  PREVIEW_WAIT_TIMEOUT_MS,
  Stage3PreviewRequestBody,
  summarizeStage3PreviewError
} from "./stage3-preview-service";
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

export function summarizeStage3HeavyJobError(kind: Stage3JobKind, error: unknown): string {
  if (kind === "preview") {
    return summarizeStage3PreviewError(error);
  }
  if (kind === "render") {
    return summarizeStage3RenderError(error);
  }
  if (kind === "agent-media-step") {
    return error instanceof Error ? error.message : "Stage 3 agent media step failed.";
  }
  return error instanceof Error ? error.message : "Stage 3 job failed.";
}
