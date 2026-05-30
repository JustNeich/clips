import { NextResponse } from "next/server";
import { scheduleChannelPublicationProcessing } from "../../../lib/channel-publication-runtime";
import { scheduleAppStorageMaintenance } from "../../../lib/storage-maintenance";

export const runtime = "nodejs";

export function GET(): NextResponse {
  scheduleChannelPublicationProcessing();
  scheduleAppStorageMaintenance("health");
  return NextResponse.json({ ok: true });
}
