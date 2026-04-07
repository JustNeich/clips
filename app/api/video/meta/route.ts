import { fetchSourceMetadata } from "../../../../lib/source-acquisition";
import { requireAuth } from "../../../../lib/auth/guards";
import { isSupportedUrl, normalizeSupportedUrl, SUPPORTED_SOURCE_ERROR_MESSAGE } from "../../../../lib/ytdlp";

export const runtime = "nodejs";

type MetaBody = {
  url?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuth(request);
    const body = (await request.json().catch(() => null)) as MetaBody | null;
    const rawUrl = body?.url?.trim();

    if (!rawUrl) {
      return Response.json({ error: "Передайте url." }, { status: 400 });
    }
    const sourceUrl = normalizeSupportedUrl(rawUrl);

    if (!isSupportedUrl(sourceUrl)) {
      return Response.json(
        { error: SUPPORTED_SOURCE_ERROR_MESSAGE },
        { status: 400 }
      );
    }

    const meta = await fetchSourceMetadata(sourceUrl);

    return Response.json({ durationSec: meta.durationSec }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Не удалось получить duration."
      },
      { status: 503 }
    );
  }
}
