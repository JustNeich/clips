import { requireAuth } from "../../../../../lib/auth/guards";
import {
  buildStage3WorkerCommands,
  resolveStage3WorkerPublicOrigin
} from "../../../../../lib/stage3-worker-commands";
import { issueStage3WorkerPairingToken } from "../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth();
    const issued = issueStage3WorkerPairingToken({
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    const origin = resolveStage3WorkerPublicOrigin(request);
    return Response.json(
      {
        pairingToken: issued.token,
        expiresAt: issued.expiresAt,
        serverOrigin: origin,
        suggestedLabel: `${auth.user.displayName} ${auth.workspace.name}`.trim(),
        commands: buildStage3WorkerCommands({
          origin,
          pairingToken: issued.token
        })
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось создать pairing token." },
      { status: 500 }
    );
  }
}
