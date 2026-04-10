import { requireAuth, requireChannelOperate } from "../../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../../lib/channel-publication-runtime";
import {
  PublicationMutationError,
  toPublicationMutationErrorPayload
} from "../../../../../lib/publication-mutation-errors";
import {
  getChannelPublicationById
} from "../../../../../lib/publication-store";
import {
  moveChannelPublicationToSlot,
  shiftChannelPublicationSlot,
  type PublicationShiftAxis,
  type PublicationShiftDirection
} from "../../../../../lib/channel-publication-service";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type Body = {
  axis?: PublicationShiftAxis;
  direction?: PublicationShiftDirection;
  slotDate?: string;
  slotIndex?: number;
};

function isAxis(value: unknown): value is PublicationShiftAxis {
  return value === "slot" || value === "day";
}

function isDirection(value: unknown): value is PublicationShiftDirection {
  return value === "prev" || value === "next";
}

function isSlotDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isSlotIndex(value: unknown): value is number {
  return Number.isInteger(value);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Body | null;

  try {
    const auth = await requireAuth(request);
    const publication = getChannelPublicationById(id);
    if (!publication) {
      const payload = toPublicationMutationErrorPayload(
        new PublicationMutationError("Публикация не найдена.", {
          code: "PUBLICATION_NOT_FOUND",
          status: 404
        }),
        "Не удалось быстро перенести публикацию."
      );
      return Response.json(payload.body, { status: payload.status });
    }
    await requireChannelOperate(auth, publication.channelId);
    const result =
      isSlotDate(body?.slotDate) && isSlotIndex(body?.slotIndex)
        ? await moveChannelPublicationToSlot({
            publicationId: id,
            slotDate: body.slotDate,
            slotIndex: body.slotIndex
          })
        : isAxis(body?.axis) && isDirection(body?.direction)
          ? await shiftChannelPublicationSlot({
              publicationId: id,
              axis: body.axis,
              direction: body.direction
            })
          : null;

    if (!result) {
      return Response.json(
        {
          error: "Передайте корректные axis/direction или slotDate/slotIndex.",
          code: "INVALID_SLOT",
          field: "slot"
        },
        { status: 400 }
      );
    }

    scheduleChannelPublicationProcessing();
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const payload = toPublicationMutationErrorPayload(error, "Не удалось быстро перенести публикацию.");
    return Response.json(payload.body, { status: payload.status });
  }
}
