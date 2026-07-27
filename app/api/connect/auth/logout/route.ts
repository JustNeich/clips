import {
  clearConnectorSessionCookie,
  readConnectorSessionCookieFromRequest
} from "../../../../../lib/auth/cookies";
import { invalidateAuthSession } from "../../../../../lib/team-store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const token = readConnectorSessionCookieFromRequest(request);
  if (token) {
    invalidateAuthSession(token);
  }
  await clearConnectorSessionCookie();
  return Response.json({ ok: true }, { status: 200 });
}
