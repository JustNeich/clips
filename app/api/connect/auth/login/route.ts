import { setConnectorSessionCookie } from "../../../../../lib/auth/cookies";
import { asErrorResponse } from "../../../../../lib/http";
import { enforceRateLimit } from "../../../../../lib/rate-limit";
import {
  getRequestMetadata,
  loginChannelConnectorWithPassword
} from "../../../../../lib/team-store";

export const runtime = "nodejs";

type Body = { email?: string; password?: string };

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.email?.trim() || !body.password?.trim()) {
    return Response.json({ error: "Передайте email и password." }, { status: 400 });
  }
  try {
    enforceRateLimit({
      request,
      scope: "connector-login",
      key: body.email.trim().toLowerCase(),
      limit: 8,
      windowMs: 10 * 60_000
    });
    const result = await loginChannelConnectorWithPassword({
      email: body.email,
      password: body.password,
      ...getRequestMetadata(request)
    });
    await setConnectorSessionCookie(result.sessionToken, new Date(result.session.expiresAt));
    return Response.json(
      { user: result.user, membership: result.membership, workspace: result.workspace },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return asErrorResponse(error, "Не удалось войти.", 400);
  }
}
