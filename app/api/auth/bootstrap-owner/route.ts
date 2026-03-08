import { setAppSessionCookie } from "../../../../lib/auth/cookies";
import { bootstrapOwner, hasWorkspaceBootstrap } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";
import { getBootstrapStatus } from "../../../../lib/bootstrap";

export const runtime = "nodejs";

type Body = {
  workspaceName?: string;
  email?: string;
  password?: string;
  displayName?: string;
  bootstrapSecret?: string;
};

export async function GET(): Promise<Response> {
  return Response.json(getBootstrapStatus(), { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const bootstrap = getBootstrapStatus();
  const expectedSecret = process.env.APP_BOOTSTRAP_SECRET?.trim() || null;
  const workspaceName = body?.workspaceName?.trim() ?? "";
  const email = body?.email?.trim() ?? "";
  const password = body?.password?.trim() ?? "";
  const displayName = body?.displayName?.trim() || "Owner";
  const providedSecret = body?.bootstrapSecret;
  if (bootstrap.ownerExists || hasWorkspaceBootstrap()) {
    return Response.json({ error: "Owner already exists." }, { status: 403 });
  }
  if (bootstrap.secretRequired && !expectedSecret) {
    return Response.json(
      { error: "APP_BOOTSTRAP_SECRET is required in production but not configured." },
      { status: 500 }
    );
  }
  if (expectedSecret && providedSecret !== expectedSecret) {
    return Response.json({ error: "Invalid bootstrap secret." }, { status: 403 });
  }
  if (!expectedSecret && !bootstrap.allowWithoutSecret) {
    return Response.json({ error: "Bootstrap secret policy rejected this request." }, { status: 403 });
  }
  if (!email || !password || !workspaceName) {
    return Response.json(
      { error: "Передайте workspaceName, email, password и bootstrapSecret." },
      { status: 400 }
    );
  }

  try {
    const result = await bootstrapOwner({
      workspaceName,
      email,
      password,
      displayName
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
    return asErrorResponse(error, "Не удалось создать owner через bootstrap.", 400);
  }
}
