import { setAppSessionCookie } from "../../../../lib/auth/cookies";
import { acceptInviteRegistration, getRequestMetadata } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";
import { enforceRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

type Body = {
  token?: string;
  password?: string;
  displayName?: string;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token || !body?.password?.trim()) {
    return Response.json({ error: "Передайте token и password." }, { status: 400 });
  }

  try {
    enforceRateLimit({
      request,
      scope: "auth-accept-invite",
      key: token,
      limit: 8,
      windowMs: 30 * 60_000
    });
    const meta = getRequestMetadata(request);
    const result = await acceptInviteRegistration({
      token,
      password: body.password,
      displayName: body.displayName?.trim() || "User",
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
    return asErrorResponse(error, "Не удалось принять приглашение.", 400);
  }
}
