import { fetchCommentsPayloadForUrl } from "../../../lib/source-comments";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
  }

  try {
    const comments = await fetchCommentsPayloadForUrl(rawUrl);
    return Response.json(comments, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось получить комментарии." },
      { status: 503 }
    );
  }
}
