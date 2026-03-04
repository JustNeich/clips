"use client";

import { KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { ChatThread, CodexAuthResponse, CommentsPayload, Stage2Response } from "./types";

type BusyAction =
  | ""
  | "create-chat"
  | "download"
  | "comments"
  | "stage2"
  | "connect-codex"
  | "refresh-codex";

type ThreadViewProps = {
  activeChat: ChatThread | null;
  codexAuth: CodexAuthResponse | null;
  codexLoggedIn: boolean;
  isBusy: boolean;
  busyAction: BusyAction;
  stage2Instruction: string;
  latestComments: CommentsPayload | null;
  selectedStageEventId: string | null;
  onInstructionChange: (value: string) => void;
  onRunStage2: () => void;
  onDownloadVideo: () => void;
  onLoadComments: () => void;
  onDownloadCommentsJson: (payload: CommentsPayload) => void;
  onSelectStageEvent: (eventId: string) => void;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getRoleLabel(role: "user" | "assistant" | "system"): string {
  if (role === "user") {
    return "You";
  }
  if (role === "assistant") {
    return "Assistant";
  }
  return "System";
}

function extractCommentsPayload(data: unknown): CommentsPayload | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Partial<CommentsPayload>;
  if (!Array.isArray(candidate.topComments) || !Array.isArray(candidate.allComments)) {
    return null;
  }

  return {
    title: String(candidate.title ?? "video"),
    totalComments: Number(candidate.totalComments ?? candidate.allComments.length ?? 0),
    topComments: candidate.topComments,
    allComments: candidate.allComments
  };
}

function extractStage2(data: unknown): Stage2Response | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  if (!("output" in (data as Record<string, unknown>))) {
    return null;
  }
  return data as Stage2Response;
}

export function ThreadView({
  activeChat,
  codexAuth,
  codexLoggedIn,
  isBusy,
  busyAction,
  stage2Instruction,
  latestComments,
  selectedStageEventId,
  onInstructionChange,
  onRunStage2,
  onDownloadVideo,
  onLoadComments,
  onDownloadCommentsJson,
  onSelectStageEvent
}: ThreadViewProps) {
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!timelineRef.current) {
      return;
    }
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [activeChat?.id, activeChat?.events.length]);

  const placeholder = useMemo(() => {
    if (!activeChat) {
      return "Create or select a chat in the sidebar first.";
    }
    if (!codexLoggedIn) {
      return "Connect Codex first, then describe how to regenerate Stage 2 output.";
    }
    return "Refine output instructions. Example: make it punchier, add one dry joke, keep safer tone.";
  }, [activeChat, codexLoggedIn]);

  const canRunStage2 = Boolean(activeChat) && codexLoggedIn;

  const handleInstructionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onRunStage2();
    }
  };

  const showDeviceAuthHelp = !codexLoggedIn;

  return (
    <section className="thread-column" aria-label="Timeline and controls">
      <div className="timeline-scroll" ref={timelineRef}>
        {!activeChat ? (
          <div className="empty-state large">
            <h3>Start from a video link</h3>
            <p>
              Add a Shorts/Reels URL in the left panel. Then connect Codex and run Stage 2.
            </p>
          </div>
        ) : (
          <>
            {showDeviceAuthHelp ? (
              <section className="system-hint" aria-live="polite">
                <h3>Connect Codex to continue</h3>
                <p>
                  Use the top-right <strong>Connect</strong> button. Sign in with your OpenAI/ChatGPT account and then refresh status.
                </p>
                {codexAuth?.deviceAuth.loginUrl ? (
                  <p>
                    Login URL:{" "}
                    <a href={codexAuth.deviceAuth.loginUrl} target="_blank" rel="noreferrer">
                      {codexAuth.deviceAuth.loginUrl}
                    </a>
                  </p>
                ) : null}
                {codexAuth?.deviceAuth.userCode ? (
                  <p>
                    Device code: <strong>{codexAuth.deviceAuth.userCode}</strong>
                  </p>
                ) : null}
                {codexAuth?.deviceAuth.output ? (
                  <details>
                    <summary>Verbose auth log</summary>
                    <pre>{codexAuth.deviceAuth.output}</pre>
                  </details>
                ) : null}
              </section>
            ) : null}

            {activeChat.events.length === 0 ? (
              <div className="empty-state large">
                <h3>No events yet</h3>
                <p>Use actions below to download video, fetch comments, and run Stage 2.</p>
              </div>
            ) : (
              <div className="timeline-list">
                {activeChat.events.map((event) => {
                  const isUser = event.role === "user";
                  const commentsPayload =
                    event.type === "comments" && event.role === "assistant"
                      ? extractCommentsPayload(event.data)
                      : null;
                  const stage2Payload =
                    event.type === "stage2" && event.role === "assistant"
                      ? extractStage2(event.data)
                      : null;

                  return (
                    <article
                      key={event.id}
                      className={`timeline-item ${isUser ? "is-user" : "is-assistant"}`}
                      aria-label={`${event.type} event`}
                    >
                      <header className="timeline-meta">
                        <span className="meta-role">{getRoleLabel(event.role)}</span>
                        <span className="meta-dot">·</span>
                        <span className="meta-type">{event.type}</span>
                        <span className="meta-dot">·</span>
                        <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                      </header>
                      <p className="timeline-text">{event.text}</p>

                      {commentsPayload ? (
                        <details className="event-details">
                          <summary>
                            Top comments ({Math.min(10, commentsPayload.topComments.length)})
                          </summary>
                          <ol className="comments-list">
                            {commentsPayload.topComments.slice(0, 10).map((comment, index) => (
                              <li key={`${comment.id}_${index}`}>
                                <p className="comment-meta">
                                  @{comment.author} · 👍 {comment.likes}
                                </p>
                                <p>{comment.text}</p>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}

                      {stage2Payload ? (
                        <div className="event-inline-actions">
                          <button
                            type="button"
                            className={`btn btn-ghost ${selectedStageEventId === event.id ? "active" : ""}`}
                            onClick={() => onSelectStageEvent(event.id)}
                          >
                            {selectedStageEventId === event.id ? "Output opened" : "Open output"}
                          </button>
                          <span className="subtle-text">
                            {stage2Payload.source.totalComments} comments · model {stage2Payload.model ?? "default"}
                          </span>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="composer" role="group" aria-label="Stage 2 composer">
        <div className="composer-toolbar">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onDownloadVideo}
            disabled={isBusy || !activeChat}
            aria-busy={busyAction === "download"}
          >
            Download mp4
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLoadComments}
            disabled={isBusy || !activeChat}
            aria-busy={busyAction === "comments"}
          >
            Fetch comments
          </button>
          {latestComments ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onDownloadCommentsJson(latestComments)}
              disabled={isBusy}
            >
              Comments JSON
            </button>
          ) : null}
        </div>

        <label htmlFor="stage2-instruction" className="sr-only">
          Regeneration instruction
        </label>
        <textarea
          id="stage2-instruction"
          className="text-area"
          placeholder={placeholder}
          value={stage2Instruction}
          onChange={(event) => onInstructionChange(event.target.value.slice(0, 2000))}
          onKeyDown={handleInstructionKeyDown}
          rows={4}
          disabled={!activeChat}
        />

        <div className="composer-footer">
          <p className="subtle-text">{stage2Instruction.trim().length}/2000 · Cmd/Ctrl + Enter</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRunStage2}
            disabled={isBusy || !canRunStage2}
            aria-busy={busyAction === "stage2"}
          >
            {busyAction === "stage2" ? "Running Stage 2..." : "Run Stage 2"}
          </button>
        </div>
      </div>
    </section>
  );
}
