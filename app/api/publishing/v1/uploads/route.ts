import {
  createPublishingUpload,
  PublishingApiError,
  publishingApiErrorResponse,
  type CreatePublishingUploadInput
} from "../../../../../lib/publishing-api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as CreatePublishingUploadInput | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return publishingApiErrorResponse(
        new PublishingApiError("INVALID_REQUEST", "A JSON request body is required.", { field: "body" })
      );
    }
    const result = await createPublishingUpload(request, body);
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return publishingApiErrorResponse(error);
  }
}
