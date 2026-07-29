import { publishingApiErrorResponse, uploadPublishingContent } from "../../../../../../../lib/publishing-api";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await uploadPublishingContent(request, id);
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return publishingApiErrorResponse(error);
  }
}
