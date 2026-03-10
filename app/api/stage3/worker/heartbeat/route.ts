import { requireStage3WorkerAuth } from "../../../../../lib/auth/stage3-worker";
import { touchStage3WorkerHeartbeat } from "../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type HeartbeatBody = {
  appVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as HeartbeatBody | null;

  try {
    const auth = requireStage3WorkerAuth(request);
    const worker = touchStage3WorkerHeartbeat({
      workerId: auth.worker.id,
      appVersion: body?.appVersion ?? null,
      capabilitiesJson: body?.capabilities ? JSON.stringify(body.capabilities) : null
    });
    return Response.json({ worker }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить heartbeat worker." },
      { status: 500 }
    );
  }
}
