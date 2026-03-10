import { requireAuth } from "../../../../../lib/auth/guards";
import { issueStage3WorkerPairingToken } from "../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth();
    const issued = issueStage3WorkerPairingToken({
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    const origin = new URL(request.url).origin;
    const localDevCommand = `npm run stage3-worker -- pair --server ${origin} --token ${issued.token}`;
    const shellBootstrapCommand = `curl -fsSL ${origin}/stage3-worker/bootstrap.sh | bash -s -- --server ${origin} --token ${issued.token}`;
    const powershellBootstrapCommand = `powershell -ExecutionPolicy Bypass -Command "iwr '${origin}/stage3-worker/bootstrap.ps1' -UseBasicParsing | iex; Install-ClipsStage3Worker -Server '${origin}' -Token '${issued.token}'"`;
    const isLocalOrigin =
      origin.startsWith("http://localhost") ||
      origin.startsWith("https://localhost") ||
      origin.startsWith("http://127.0.0.1") ||
      origin.startsWith("https://127.0.0.1");
    const direct = isLocalOrigin ? localDevCommand : shellBootstrapCommand;
    return Response.json(
      {
        pairingToken: issued.token,
        expiresAt: issued.expiresAt,
        serverOrigin: origin,
        suggestedLabel: `${auth.user.displayName} ${auth.workspace.name}`.trim(),
        commands: {
          shell: isLocalOrigin ? localDevCommand : shellBootstrapCommand,
          powershell: isLocalOrigin ? localDevCommand : powershellBootstrapCommand,
          direct,
          localDev: localDevCommand
        }
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
