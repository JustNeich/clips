import { getPublishingPublication, publishingApiErrorResponse } from "../../../../../../lib/publishing-api";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await getPublishingPublication(request, id);
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return publishingApiErrorResponse(error);
  }
}
