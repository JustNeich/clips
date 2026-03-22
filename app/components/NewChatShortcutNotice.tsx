"use client";

import React from "react";

type NewChatShortcutNoticeProps = {
  onCreateNextChat: () => void;
};

export function NewChatShortcutNotice({ onCreateNextChat }: NewChatShortcutNoticeProps) {
  return (
    <section className="new-chat-shortcut-card" aria-live="polite">
      <p className="field-label">Следующий ролик</p>
      <p className="new-chat-shortcut-title">Источник уже получен</p>
      <p className="subtle-text new-chat-shortcut-copy">
        Можно сразу создать новый чат, найти следующую ссылку и вставить её одним заходом. Текущий ролик
        продолжит жить в истории и, если нужно, обрабатываться в фоне.
      </p>
      <div className="new-chat-shortcut-actions">
        <button type="button" className="btn btn-secondary" onClick={onCreateNextChat}>
          Создать новый чат
        </button>
      </div>
    </section>
  );
}
