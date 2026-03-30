import { getRuntimeCapabilities } from "../../../../lib/runtime-capabilities";
import { requireAuth } from "../../../../lib/auth/guards";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuth(request);
    return Response.json(await getRuntimeCapabilities(), { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось определить возможности runtime.");
  }
}
