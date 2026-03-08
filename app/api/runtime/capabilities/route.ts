import { getRuntimeCapabilities } from "../../../../lib/runtime-capabilities";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getRuntimeCapabilities(), { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось определить возможности runtime.");
  }
}
