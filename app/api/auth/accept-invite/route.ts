import { setAppSessionCookie } from "../../../../lib/auth/cookies";
import { consumeInvite, createUserByInvite, getRequestMetadata } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";

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
    const invite = consumeInvite(token);
    if (!invite) {
      return Response.json({ error: "Invite not found or expired." }, { status: 404 });
    }
    const meta = getRequestMetadata(request);
    const result = await createUserByInvite({
      workspaceId: invite.workspaceId,
      role: invite.role,
      email: invite.email,
      password: body.password,
      displayName: body.displayName?.trim() || invite.role,
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
    return asErrorResponse(error, "Unable to accept invite.", 400);
  }
}
