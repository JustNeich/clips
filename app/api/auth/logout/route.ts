import { clearAppSessionCookie, readAppSessionCookie } from "../../../../lib/auth/cookies";
import { invalidateAuthSession } from "../../../../lib/team-store";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const token = await readAppSessionCookie();
  if (token) {
    invalidateAuthSession(token);
  }
  await clearAppSessionCookie();
  return Response.json({ ok: true }, { status: 200 });
}
