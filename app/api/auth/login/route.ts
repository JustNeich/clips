import { setAppSessionCookie } from "../../../../lib/auth/cookies";
import { getRequestMetadata, loginWithPassword } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";
import { enforceRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

type Body = {
  email?: string;
  password?: string;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.email?.trim() || !body.password?.trim()) {
    return Response.json({ error: "Передайте email и password." }, { status: 400 });
  }

  try {
    enforceRateLimit({
      request,
      scope: "auth-login",
      key: body.email,
      limit: 8,
      windowMs: 10 * 60_000
    });
    const meta = getRequestMetadata(request);
    const result = await loginWithPassword({
      email: body.email,
      password: body.password,
      ...meta
    });
    await setAppSessionCookie(result.sessionToken, new Date(result.session.expiresAt));
    return Response.json(
      {
        workspace: result.workspace,
        user: result.user,
        membership: result.membership
      },
      { status: 200 }
    );
  } catch (error) {
    return asErrorResponse(error, "Не удалось войти.", 400);
  }
}
