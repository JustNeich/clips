import { requireAuth } from "../../../lib/auth/guards";
import {
  getWorkspaceStage3ExecutionTarget,
  getWorkspaceCodexModelConfig,
  getWorkspaceStage2CaptionProviderConfig,
  getWorkspaceStage2PromptConfig,
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2HardConstraints,
  updateWorkspaceStage3ExecutionTarget,
  updateWorkspaceCodexModelConfig,
  updateWorkspaceStage2CaptionProviderConfig,
  updateWorkspaceStage2PromptConfig,
  updateWorkspaceStage2HardConstraints,
  updateWorkspaceStage2ExamplesCorpusJson
} from "../../../lib/team-store";
import {
  getWorkspaceAnthropicStatus
} from "../../../lib/workspace-anthropic";
import {
  getWorkspaceOpenRouterStatus
} from "../../../lib/workspace-openrouter";
import { type Stage2PromptConfig } from "../../../lib/stage2-pipeline";
import { type Stage2HardConstraints } from "../../../lib/stage2-channel-config";
import {
  isStage3ExecutionTargetSelectable,
  resolveStage3Execution
} from "../../../lib/stage3-execution";
import {
  resolveWorkspaceCodexModelConfig,
  type WorkspaceCodexModelConfig
} from "../../../lib/workspace-codex-models";
import { type Stage2CaptionProviderConfig } from "../../../lib/stage2-caption-provider";
import { type Stage3ExecutionTarget } from "../../../app/components/types";

export const runtime = "nodejs";

type PatchBody = {
  stage2ExamplesCorpusJson?: string;
  stage2HardConstraints?: Stage2HardConstraints;
  stage2PromptConfig?: Stage2PromptConfig;
  codexModelConfig?: WorkspaceCodexModelConfig;
  stage2CaptionProviderConfig?: Stage2CaptionProviderConfig;
  stage3ExecutionTarget?: Stage3ExecutionTarget;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request);
    const workspaceAnthropicIntegration =
      auth.membership.role === "owner"
        ? await getWorkspaceAnthropicStatus(auth)
        : null;
    const workspaceOpenRouterIntegration =
      auth.membership.role === "owner"
        ? await getWorkspaceOpenRouterStatus(auth)
        : null;
    const stage3ExecutionTarget = getWorkspaceStage3ExecutionTarget(auth.workspace.id);
    const stage3Execution = resolveStage3Execution(stage3ExecutionTarget);
    return Response.json(
      {
        stage2ExamplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(auth.workspace.id),
        stage2HardConstraints: getWorkspaceStage2HardConstraints(auth.workspace.id),
        stage2PromptConfig: getWorkspaceStage2PromptConfig(auth.workspace.id),
        codexModelConfig: getWorkspaceCodexModelConfig(auth.workspace.id),
        stage2CaptionProviderConfig: getWorkspaceStage2CaptionProviderConfig(auth.workspace.id),
        stage3ExecutionTarget: stage3Execution.configuredTarget,
        resolvedStage3ExecutionTarget: stage3Execution.resolvedTarget,
        stage3ExecutionCapabilities: stage3Execution.capabilities,
        workspaceAnthropicIntegration,
        workspaceOpenRouterIntegration,
        resolvedCodexModelConfig: resolveWorkspaceCodexModelConfig({
          config: getWorkspaceCodexModelConfig(auth.workspace.id),
          deployStage2Model: process.env.CODEX_STAGE2_MODEL,
          deployStage2SeoModel: process.env.CODEX_STAGE2_DESCRIPTION_MODEL,
          deployStage3Model: process.env.CODEX_STAGE3_MODEL
        })
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить workspace." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (
    !body ||
    typeof body !== "object" ||
    (
      body.stage2ExamplesCorpusJson === undefined &&
      body.stage2HardConstraints === undefined &&
      body.stage2PromptConfig === undefined &&
      body.codexModelConfig === undefined &&
      body.stage2CaptionProviderConfig === undefined &&
      body.stage3ExecutionTarget === undefined
    )
  ) {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  try {
    const auth = await requireAuth(request);
    if (auth.membership.role !== "owner") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    let workspace = auth.workspace;
    if (typeof body.stage2ExamplesCorpusJson === "string") {
      workspace = updateWorkspaceStage2ExamplesCorpusJson(
        auth.workspace.id,
        body.stage2ExamplesCorpusJson
      );
    }
    if (body.stage2HardConstraints) {
      workspace = updateWorkspaceStage2HardConstraints(auth.workspace.id, body.stage2HardConstraints);
    }
    if (body.stage2PromptConfig) {
      workspace = updateWorkspaceStage2PromptConfig(auth.workspace.id, body.stage2PromptConfig);
    }
    if (body.codexModelConfig) {
      workspace = updateWorkspaceCodexModelConfig(auth.workspace.id, body.codexModelConfig);
    }
    if (body.stage2CaptionProviderConfig) {
      workspace = updateWorkspaceStage2CaptionProviderConfig(
        auth.workspace.id,
        body.stage2CaptionProviderConfig
      );
    }
    if (body.stage3ExecutionTarget !== undefined) {
      if (!isStage3ExecutionTargetSelectable(body.stage3ExecutionTarget)) {
        return Response.json(
          { error: "Выбранный режим Stage 3 сейчас недоступен на этом deployment." },
          { status: 400 }
        );
      }
      workspace = updateWorkspaceStage3ExecutionTarget(auth.workspace.id, body.stage3ExecutionTarget);
    }
    const stage3Execution = resolveStage3Execution(workspace.stage3ExecutionTarget);
    return Response.json(
      {
        stage2ExamplesCorpusJson: workspace.stage2ExamplesCorpusJson,
        stage2HardConstraints: workspace.stage2HardConstraints,
        stage2PromptConfig: workspace.stage2PromptConfig,
        codexModelConfig: workspace.codexModelConfig,
        stage2CaptionProviderConfig: workspace.stage2CaptionProviderConfig,
        stage3ExecutionTarget: stage3Execution.configuredTarget,
        resolvedStage3ExecutionTarget: stage3Execution.resolvedTarget,
        stage3ExecutionCapabilities: stage3Execution.capabilities,
        workspaceAnthropicIntegration: await getWorkspaceAnthropicStatus(auth),
        workspaceOpenRouterIntegration: await getWorkspaceOpenRouterStatus(auth),
        resolvedCodexModelConfig: resolveWorkspaceCodexModelConfig({
          config: workspace.codexModelConfig,
          deployStage2Model: process.env.CODEX_STAGE2_MODEL,
          deployStage2SeoModel: process.env.CODEX_STAGE2_DESCRIPTION_MODEL,
          deployStage3Model: process.env.CODEX_STAGE3_MODEL
        })
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить workspace." },
      { status: 400 }
    );
  }
}
