import { createChannel, listChannelsWithStats } from "../../../lib/chat-history";

export const runtime = "nodejs";

type CreateChannelBody = {
  name?: string;
  username?: string;
  systemPrompt?: string;
  examplesJson?: string;
  templateId?: string;
};

export async function GET(): Promise<Response> {
  const channels = await listChannelsWithStats();
  return Response.json({ channels }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CreateChannelBody | null;
  try {
    const channel = await createChannel({
      name: body?.name,
      username: body?.username,
      systemPrompt: body?.systemPrompt,
      examplesJson: body?.examplesJson,
      templateId: body?.templateId
    });
    return Response.json({ channel }, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create channel." },
      { status: 400 }
    );
  }
}

