import { NextResponse } from "next/server";
import { scheduleChannelPublicationProcessing } from "../../../lib/channel-publication-runtime";

export const runtime = "nodejs";

export function GET(): NextResponse {
  scheduleChannelPublicationProcessing();
  return NextResponse.json({ ok: true });
}
