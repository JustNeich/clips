"use client";

import { FormEvent, useMemo, useState } from "react";
import { ChatThread } from "./types";

type SidebarProps = {
  chats: ChatThread[];
  activeChatId: string | null;
  draftUrl: string;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onDraftUrlChange: (value: string) => void;
  onCreateChat: (event: FormEvent<HTMLFormElement>) => void;
  onSelectChat: (chatId: string) => void;
  isBusy: boolean;
  isCreatingChat: boolean;
};

function truncate(value: string, left = 22, right = 10): string {
  if (value.length <= left + right + 3) {
    return value;
  }
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

export function Sidebar({
  chats,
  activeChatId,
  draftUrl,
  isOpenMobile,
  onCloseMobile,
  onDraftUrlChange,
  onCreateChat,
  onSelectChat,
  isBusy,
  isCreatingChat
}: SidebarProps) {
  const [search, setSearch] = useState("");

  const filteredChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return chats;
    }
    return chats.filter((chat) => {
      return chat.title.toLowerCase().includes(query) || chat.url.toLowerCase().includes(query);
    });
  }, [chats, search]);

  return (
    <>
      <div
        className={`mobile-overlay ${isOpenMobile ? "open" : ""}`}
        onClick={onCloseMobile}
        aria-hidden={!isOpenMobile}
      />

      <aside className={`app-sidebar ${isOpenMobile ? "open" : ""}`} aria-label="Боковая панель чатов">
        <div className="sidebar-top">
          <div>
            <p className="sidebar-kicker">Рабочее пространство</p>
            <h1>Clips Automations</h1>
          </div>
          <button
            type="button"
            className="icon-btn mobile-only"
            onClick={onCloseMobile}
            aria-label="Закрыть боковую панель"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <form onSubmit={onCreateChat} className="sidebar-link-form" aria-label="Создать чат по ссылке">
          <label htmlFor="sidebar-url" className="sr-only">
            Ссылка на Shorts или Reels
          </label>
          <input
            id="sidebar-url"
            className="text-input"
            placeholder="Вставьте ссылку на Shorts или Reels"
            value={draftUrl}
            onChange={(event) => onDraftUrlChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isBusy}
            aria-busy={isCreatingChat}
          >
            {isCreatingChat ? "Создаём..." : "Новый чат"}
          </button>
        </form>

        <div className="sidebar-search">
          <label htmlFor="thread-search" className="sr-only">
            Поиск по чатам
          </label>
          <input
            id="thread-search"
            className="text-input"
            placeholder="Поиск"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <nav className="thread-list" aria-label="История чатов">
          {filteredChats.length === 0 ? (
            <p className="empty-state small">Чатов пока нет. Добавьте ссылку, чтобы начать.</p>
          ) : (
            filteredChats.map((chat) => {
              const isActive = activeChatId === chat.id;
              return (
                <button
                  key={chat.id}
                  type="button"
                  className={`thread-item ${isActive ? "active" : ""}`}
                  onClick={() => {
                    onSelectChat(chat.id);
                    onCloseMobile();
                  }}
                  aria-current={isActive ? "true" : undefined}
                  title={chat.url}
                >
                  <span className="thread-title">{chat.title}</span>
                  <span className="thread-sub">{truncate(chat.url)}</span>
                </button>
              );
            })
          )}
        </nav>
      </aside>
    </>
  );
}
