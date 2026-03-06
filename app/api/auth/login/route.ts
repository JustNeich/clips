import { setAppSessionCookie } from "../../../../lib/auth/cookies";
import { getRequestMetadata, loginWithPassword } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";

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
    return asErrorResponse(error, "Unable to login.", 400);
  }
}
