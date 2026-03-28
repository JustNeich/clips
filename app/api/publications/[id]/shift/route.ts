import { requireAuth, requireChannelOperate } from "../../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../../lib/channel-publication-runtime";
import {
  getChannelPublicationById
} from "../../../../../lib/publication-store";
import {
  shiftChannelPublicationSlot,
  type PublicationShiftAxis,
  type PublicationShiftDirection
} from "../../../../../lib/channel-publication-service";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type Body = {
  axis?: PublicationShiftAxis;
  direction?: PublicationShiftDirection;
};

function isAxis(value: unknown): value is PublicationShiftAxis {
  return value === "slot" || value === "day";
}

function isDirection(value: unknown): value is PublicationShiftDirection {
  return value === "prev" || value === "next";
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Body | null;

  if (!isAxis(body?.axis) || !isDirection(body?.direction)) {
    return Response.json({ error: "Передайте корректные axis и direction." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const publication = getChannelPublicationById(id);
    if (!publication) {
      return Response.json({ error: "Publication not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, publication.channelId);
    const result = await shiftChannelPublicationSlot({
      publicationId: id,
      axis: body.axis,
      direction: body.direction
    });
    scheduleChannelPublicationProcessing();
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось быстро перенести публикацию." },
      { status: 400 }
    );
  }
}
