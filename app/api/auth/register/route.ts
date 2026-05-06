import { PUBLIC_REGISTRATION_DISABLED_MESSAGE } from "../../../../lib/auth/registration-policy";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return Response.json({ error: PUBLIC_REGISTRATION_DISABLED_MESSAGE }, { status: 403 });
}
