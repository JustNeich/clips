import type { Stage2PipelineVersion, Stage2VNextWorkerBuild } from "./contracts";

const STAGE2_WORKER_STARTED_AT = new Date().toISOString();

function readWorkerBuildId(env: NodeJS.ProcessEnv): string {
  const explicit =
    env.STAGE2_WORKER_BUILD_ID ??
    env.VERCEL_GIT_COMMIT_SHA ??
    env.RENDER_GIT_COMMIT ??
    env.SOURCE_VERSION ??
    null;
  const normalized = typeof explicit === "string" ? explicit.trim() : "";
  return normalized || `local-${STAGE2_WORKER_STARTED_AT}`;
}

export function getStage2WorkerBuildInfo(
  env: NodeJS.ProcessEnv = process.env
): Stage2VNextWorkerBuild {
  return {
    buildId: readWorkerBuildId(env),
    startedAt: STAGE2_WORKER_STARTED_AT,
    pid: Number.isFinite(process.pid) ? process.pid : null
  };
}

export function resolveStage2StageChainVersion(pipelineVersion: Stage2PipelineVersion): string {
  if (pipelineVersion === "native_caption_v3") {
    return "native-caption-v3";
  }
  return pipelineVersion === "vnext" ? "stage2-vnext" : "stage2-legacy-chain-v1";
}
