import { requireAuth } from "../../../lib/auth/guards";
import {
  getWorkspaceStage2ExamplesCorpusJson,
  updateWorkspaceStage2ExamplesCorpusJson
} from "../../../lib/team-store";

export const runtime = "nodejs";

type PatchBody = {
  stage2ExamplesCorpusJson?: string;
};

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    return Response.json(
      {
        stage2ExamplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(auth.workspace.id)
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
  if (!body || typeof body.stage2ExamplesCorpusJson !== "string") {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    if (auth.membership.role === "redactor_limited") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const workspace = updateWorkspaceStage2ExamplesCorpusJson(
      auth.workspace.id,
      body.stage2ExamplesCorpusJson
    );
    return Response.json(
      {
        stage2ExamplesCorpusJson: workspace.stage2ExamplesCorpusJson
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
