import { authenticateStage3WorkerSessionToken } from "../stage3-worker-store";

export function requireStage3WorkerAuth(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    throw new Response(JSON.stringify({ error: "Требуется worker token." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const auth = authenticateStage3WorkerSessionToken(token);
  if (!auth) {
    throw new Response(JSON.stringify({ error: "Worker token недействителен." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  return auth;
}
