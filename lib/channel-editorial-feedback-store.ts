import { getDb, newId, nowIso } from "./db/client";
import {
  ChannelEditorialFeedbackEvent,
  ChannelEditorialFeedbackKind,
  normalizeChannelEditorialFeedbackEvent,
  normalizeChannelEditorialFeedbackOptionSnapshot
} from "./stage2-channel-learning";

type ChannelEditorialFeedbackRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  user_id?: string | null;
  chat_id?: string | null;
  stage2_run_id?: string | null;
  kind: string;
  note?: string | null;
  option_snapshot_json?: string | null;
  created_at: string;
};

function mapChannelEditorialFeedbackRow(
  row: ChannelEditorialFeedbackRow
): ChannelEditorialFeedbackEvent | null {
  return normalizeChannelEditorialFeedbackEvent({
    id: row.id,
    workspaceId: row.workspace_id,
    channelId: row.channel_id,
    userId: row.user_id ?? null,
    chatId: row.chat_id ?? null,
    stage2RunId: row.stage2_run_id ?? null,
    kind: row.kind as ChannelEditorialFeedbackKind,
    note: row.note ?? null,
    optionSnapshot: row.option_snapshot_json
      ? JSON.parse(row.option_snapshot_json)
      : null,
    createdAt: row.created_at
  });
}

export function createChannelEditorialFeedbackEvent(input: {
  workspaceId: string;
  channelId: string;
  userId?: string | null;
  chatId?: string | null;
  stage2RunId?: string | null;
  kind: ChannelEditorialFeedbackKind;
  note?: string | null;
  optionSnapshot?: unknown;
}): ChannelEditorialFeedbackEvent {
  const optionSnapshot = normalizeChannelEditorialFeedbackOptionSnapshot(input.optionSnapshot);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const event: ChannelEditorialFeedbackEvent = {
    id: newId(),
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    stage2RunId: input.stage2RunId ?? null,
    kind: input.kind,
    note,
    optionSnapshot,
    createdAt: nowIso()
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO channel_editorial_feedback_events
      (
        id,
        workspace_id,
        channel_id,
        user_id,
        chat_id,
        stage2_run_id,
        kind,
        note,
        option_snapshot_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.workspaceId,
    event.channelId,
    event.userId,
    event.chatId,
    event.stage2RunId,
    event.kind,
    event.note,
    optionSnapshot ? JSON.stringify(optionSnapshot) : null,
    event.createdAt
  );

  return event;
}

export function listChannelEditorialFeedbackEvents(
  channelId: string,
  limit = 30
): ChannelEditorialFeedbackEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
        FROM channel_editorial_feedback_events
       WHERE channel_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(channelId, Math.max(1, Math.floor(limit))) as ChannelEditorialFeedbackRow[];
  return rows
    .map((row) => mapChannelEditorialFeedbackRow(row))
    .filter((event): event is ChannelEditorialFeedbackEvent => event !== null);
}
