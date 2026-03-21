import { ensureCodexLoggedIn } from "./codex-runner";
import { getWorkspaceCodexIntegration } from "./team-store";
import { CodexJsonStageExecutor } from "./viral-shorts-worker/executor";

function requireWorkspaceCodexIntegration(workspaceId: string) {
  const integration = getWorkspaceCodexIntegration(workspaceId);
  if (!integration || integration.status !== "connected" || !integration.codexHomePath) {
    throw new Response(JSON.stringify({ error: "shared_codex_unavailable" }), {
      status: 412,
      headers: { "Content-Type": "application/json" }
    });
  }
  return integration;
}

export async function createStage2CodexExecutorContext(workspaceId: string): Promise<{
  codexHome: string;
  model: string | null;
  reasoningEffort: string;
  timeoutMs: number;
  executor: CodexJsonStageExecutor;
}> {
  const integration = requireWorkspaceCodexIntegration(workspaceId);
  const codexHome = integration.codexHomePath as string;
  await ensureCodexLoggedIn(codexHome);

  const timeoutFromEnv = Number.parseInt(process.env.CODEX_STAGE2_TIMEOUT_MS ?? "", 10);
  const timeoutMs =
    Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0 ? timeoutFromEnv : 8 * 60_000;
  const model = process.env.CODEX_STAGE2_MODEL ?? null;
  const isDevelopment = process.env.NODE_ENV === "development";
  const reasoningEffort =
    process.env.CODEX_STAGE2_REASONING_EFFORT ?? (isDevelopment ? "low" : "high");

  return {
    codexHome,
    model,
    reasoningEffort,
    timeoutMs,
    executor: new CodexJsonStageExecutor({
      cwd: process.cwd(),
      codexHome,
      defaultTimeoutMs: timeoutMs,
      defaultModel: model,
      defaultReasoningEffort: reasoningEffort
    })
  };
}
