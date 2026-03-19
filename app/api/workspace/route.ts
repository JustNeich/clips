import { requireAuth } from "../../../lib/auth/guards";
import {
  getWorkspaceStage2PromptConfig,
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2HardConstraints,
  updateWorkspaceStage2PromptConfig,
  updateWorkspaceStage2HardConstraints,
  updateWorkspaceStage2ExamplesCorpusJson
} from "../../../lib/team-store";
import { type Stage2PromptConfig } from "../../../lib/stage2-pipeline";
import { type Stage2HardConstraints } from "../../../lib/stage2-channel-config";

export const runtime = "nodejs";

type PatchBody = {
  stage2ExamplesCorpusJson?: string;
  stage2HardConstraints?: Stage2HardConstraints;
  stage2PromptConfig?: Stage2PromptConfig;
};

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    return Response.json(
      {
        stage2ExamplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(auth.workspace.id),
        stage2HardConstraints: getWorkspaceStage2HardConstraints(auth.workspace.id),
        stage2PromptConfig: getWorkspaceStage2PromptConfig(auth.workspace.id)
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
      body.stage2PromptConfig === undefined
    )
  ) {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
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
    return Response.json(
      {
        stage2ExamplesCorpusJson: workspace.stage2ExamplesCorpusJson,
        stage2HardConstraints: workspace.stage2HardConstraints,
        stage2PromptConfig: workspace.stage2PromptConfig
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
