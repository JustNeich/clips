import { fetchSourceMetadata } from "../../../../lib/source-acquisition";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";

export const runtime = "nodejs";

type MetaBody = {
  url?: string;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as MetaBody | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте url." }, { status: 400 });
  }
  const sourceUrl = normalizeSupportedUrl(rawUrl);

  if (!isSupportedUrl(sourceUrl)) {
    return Response.json(
      { error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels." },
      { status: 400 }
    );
  }

  try {
    const meta = await fetchSourceMetadata(sourceUrl);

    return Response.json({ durationSec: meta.durationSec }, { status: 200 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Не удалось получить duration."
      },
      { status: 503 }
    );
  }
}
