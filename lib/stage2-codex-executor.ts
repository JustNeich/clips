import { ensureCodexLoggedIn } from "./codex-runner";
import {
  getWorkspaceAnthropicApiKey,
  getWorkspaceAnthropicIntegration,
  getWorkspaceCodexIntegration,
  getWorkspaceCodexModelConfig,
  getWorkspaceOpenRouterApiKey,
  getWorkspaceOpenRouterIntegration,
  getWorkspaceStage2CaptionProviderConfig
} from "./team-store";
import {
  AnthropicJsonStageExecutor,
  CodexJsonStageExecutor,
  HybridJsonStageExecutor,
  OpenRouterJsonStageExecutor
} from "./viral-shorts-worker/executor";
import {
  resolveWorkspaceCodexModelConfig,
  STAGE2_PROMPT_MODEL_STAGE_IDS,
  summarizeResolvedStage2ModelUsage
} from "./workspace-codex-models";

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
  resolvedCodexModelConfig: ReturnType<typeof resolveWorkspaceCodexModelConfig>;
  resolvedStageModelConfig: ReturnType<typeof resolveWorkspaceCodexModelConfig>;
  stage2CaptionProviderConfig: ReturnType<typeof getWorkspaceStage2CaptionProviderConfig>;
  pipelineModelSummary: string | null;
  reasoningEffort: string;
  timeoutMs: number;
  executor: HybridJsonStageExecutor;
}> {
  const integration = requireWorkspaceCodexIntegration(workspaceId);
  const codexHome = integration.codexHomePath as string;
  await ensureCodexLoggedIn(codexHome);

  const timeoutFromEnv = Number.parseInt(process.env.CODEX_STAGE2_TIMEOUT_MS ?? "", 10);
  const timeoutMs =
    Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0 ? timeoutFromEnv : 8 * 60_000;
  const resolvedCodexModelConfig = resolveWorkspaceCodexModelConfig({
    config: getWorkspaceCodexModelConfig(workspaceId),
    deployStage2Model: process.env.CODEX_STAGE2_MODEL,
    deployStage2SeoModel: process.env.CODEX_STAGE2_DESCRIPTION_MODEL,
    deployStage3Model: process.env.CODEX_STAGE3_MODEL
  });
  const stage2CaptionProviderConfig = getWorkspaceStage2CaptionProviderConfig(workspaceId);
  const resolvedStageModelConfig = {
    ...resolvedCodexModelConfig
  };
  let anthropicExecutor: AnthropicJsonStageExecutor | null = null;
  let openRouterExecutor: OpenRouterJsonStageExecutor | null = null;
  if (stage2CaptionProviderConfig.provider === "anthropic") {
    const anthropicIntegration = getWorkspaceAnthropicIntegration(workspaceId);
    const anthropicApiKey = getWorkspaceAnthropicApiKey(workspaceId);
    if (!anthropicIntegration || anthropicIntegration.status !== "connected" || !anthropicApiKey) {
      throw new Error("Anthropic captions недоступны: сначала подключите и проверьте API key.");
    }
    const anthropicModel = stage2CaptionProviderConfig.anthropicModel?.trim();
    if (!anthropicModel) {
      throw new Error("Anthropic model для captions не задана.");
    }
    resolvedStageModelConfig.oneShotReference = anthropicModel;
    resolvedStageModelConfig.candidateGenerator = anthropicModel;
    resolvedStageModelConfig.targetedRepair = anthropicModel;
    resolvedStageModelConfig.regenerate = anthropicModel;
    anthropicExecutor = new AnthropicJsonStageExecutor({
      apiKey: anthropicApiKey,
      defaultModel: anthropicModel,
      defaultTimeoutMs: timeoutMs
    });
  }
  if (stage2CaptionProviderConfig.provider === "openrouter") {
    const openRouterIntegration = getWorkspaceOpenRouterIntegration(workspaceId);
    const openRouterApiKey = getWorkspaceOpenRouterApiKey(workspaceId);
    if (!openRouterIntegration || openRouterIntegration.status !== "connected" || !openRouterApiKey) {
      throw new Error("OpenRouter captions недоступны: сначала подключите и проверьте API key.");
    }
    const openRouterModel = stage2CaptionProviderConfig.openrouterModel?.trim();
    if (!openRouterModel) {
      throw new Error("OpenRouter model для captions не задана.");
    }
    resolvedStageModelConfig.oneShotReference = openRouterModel;
    resolvedStageModelConfig.candidateGenerator = openRouterModel;
    resolvedStageModelConfig.targetedRepair = openRouterModel;
    resolvedStageModelConfig.regenerate = openRouterModel;
    openRouterExecutor = new OpenRouterJsonStageExecutor({
      apiKey: openRouterApiKey,
      defaultModel: openRouterModel,
      defaultTimeoutMs: timeoutMs
    });
  }
  const model =
    resolvedCodexModelConfig.oneShotReference ??
    resolvedCodexModelConfig.contextPacket ??
    resolvedCodexModelConfig.analyzer;
  const pipelineModelSummary = summarizeResolvedStage2ModelUsage({
    resolvedConfig: resolvedStageModelConfig,
    stageIds: STAGE2_PROMPT_MODEL_STAGE_IDS
  });
  const isDevelopment = process.env.NODE_ENV === "development";
  const reasoningEffort =
    process.env.CODEX_STAGE2_REASONING_EFFORT ?? (isDevelopment ? "low" : "high");
  const codexExecutor = new CodexJsonStageExecutor({
    cwd: process.cwd(),
    codexHome,
    defaultTimeoutMs: timeoutMs,
    defaultModel: model,
    defaultReasoningEffort: reasoningEffort
  });

  return {
    codexHome,
    model,
    resolvedCodexModelConfig,
    resolvedStageModelConfig,
    stage2CaptionProviderConfig,
    pipelineModelSummary,
    reasoningEffort,
    timeoutMs,
    executor: new HybridJsonStageExecutor({
      captionProviderConfig: stage2CaptionProviderConfig,
      codexExecutor,
      anthropicExecutor,
      openRouterExecutor
    })
  };
}
