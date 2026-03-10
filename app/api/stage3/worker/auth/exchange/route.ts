import { exchangeStage3WorkerPairingToken } from "../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type ExchangeBody = {
  pairingToken?: string;
  label?: string;
  platform?: string;
  hostname?: string | null;
  appVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as ExchangeBody | null;

  try {
    const pairingToken = body?.pairingToken?.trim() ?? "";
    if (!pairingToken) {
      return Response.json({ error: "Передайте pairingToken." }, { status: 400 });
    }
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken,
      label: body?.label?.trim() || "Local Worker",
      platform: body?.platform?.trim() || "unknown",
      hostname: body?.hostname?.trim() || null,
      appVersion: body?.appVersion?.trim() || null,
      capabilitiesJson: body?.capabilities ? JSON.stringify(body.capabilities) : null
    });
    return Response.json(
      {
        worker: exchanged.worker,
        sessionToken: exchanged.sessionToken,
        expiresAt: exchanged.expiresAt
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось завершить pairing Stage 3 worker.";
    return Response.json(
      { error: message },
      { status: message.includes("token") ? 400 : 500 }
    );
  }
}
