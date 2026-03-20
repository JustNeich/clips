"use client";

import React, { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeDisplayText } from "../../lib/ui-error";
import type { ChatListItem, ChatWorkflowStatus, CodexDeviceAuth } from "./types";

export type FlowStep = {
  id: 1 | 2 | 3;
  label: string;
  enabled: boolean;
};

export type ChannelSelectorItem = {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string | null;
};

type HistoryFilter = "all" | "working" | "exported" | "error";

type HistorySection = {
  id: string;
  title: string;
  items: ChatListItem[];
};

type HistoryDayGroup = {
  id: string;
  label: string;
  items: ChatListItem[];
};

type AppShellProps = {
  title: string;
  subtitle: string;
  steps: FlowStep[];
  currentStep: 1 | 2 | 3;
  onStepChange: (step: 1 | 2 | 3) => void;
  historyItems: ChatListItem[];
  activeHistoryId: string | null;
  onHistoryOpen: (id: string, step?: 1 | 2 | 3) => void;
  onDeleteHistory: (id: string) => void;
  onCreateNew: () => void;
  channels: ChannelSelectorItem[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onManageChannels: () => void;
  canManageChannels: boolean;
  canManageTeam: boolean;
  onOpenTeam: () => void;
  codexConnected: boolean;
  codexBusyConnect: boolean;
  codexBusyRefresh: boolean;
  canManageCodex: boolean;
  canConnectCodex: boolean;
  codexConnectBlockedReason?: string | null;
  codexStatusLabel?: string;
  codexActionLabel?: string;
  codexDeviceAuth?: CodexDeviceAuth | null;
  codexSecondaryActionLabel?: string | null;
  onConnectCodex: () => void;
  onRefreshCodex: () => void;
  onSecondaryCodexAction?: () => void;
  onCopyCodexLoginUrl?: () => void;
  onCopyCodexUserCode?: () => void;
  currentUserName: string | null;
  currentUserRole: string | null;
  workspaceName: string | null;
  onLogout: () => void;
  statusText: string;
  statusTone: "ok" | "error" | "";
  headerActions?: ReactNode;
  children: ReactNode;
  details: ReactNode;
  afterDetails?: ReactNode;
};

function getStepState(stepId: number, currentStep: number): "completed" | "current" | "next" {
  if (stepId < currentStep) {
    return "completed";
  }
  if (stepId === currentStep) {
    return "current";
  }
  return "next";
}

function formatDeviceAuthStatus(status: CodexDeviceAuth["status"]): string {
  switch (status) {
    case "running":
      return "Ожидает входа";
    case "done":
      return "Вход завершен";
    case "error":
      return "Ошибка входа";
    case "canceled":
      return "Вход отменен";
    default:
      return "Нет активности";
  }
}

function formatRoleLabel(role: string | null): string | null {
  if (!role) {
    return null;
  }

  switch (role) {
    case "owner":
      return "Владелец";
    case "manager":
      return "Менеджер";
    case "redactor":
      return "Редактор (обычный)";
    case "redactor_limited":
      return "Редактор (ограниченный, по умолчанию)";
    default:
      return role.replace(/_/g, " ");
  }
}

function formatHistoryStatusLabel(status: ChatWorkflowStatus): string {
  switch (status) {
    case "new":
      return "Новый";
    case "sourceReady":
      return "Source ready";
    case "stage2Ready":
      return "Stage 2 ready";
    case "editing":
      return "Editing";
    case "agentRunning":
      return "Agent running";
    case "exported":
      return "Экспорт";
    case "error":
      return "Ошибка";
    default:
      return status;
  }
}

function formatHistoryTime(value: string): string {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getHistoryTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortHistoryItemsByUpdatedAt(items: ChatListItem[]): ChatListItem[] {
  return [...items].sort((left, right) => {
    const timestampDelta = getHistoryTimestamp(right.updatedAt) - getHistoryTimestamp(left.updatedAt);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function buildHistoryDayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return `unknown:${value}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatHistoryDayLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Без даты";
  }

  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDelta = Math.round((currentDay.getTime() - targetDay.getTime()) / 86_400_000);

  if (dayDelta === 0) {
    return "Сегодня";
  }
  if (dayDelta === 1) {
    return "Вчера";
  }

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

export function groupHistoryItemsByDay(items: ChatListItem[], now = new Date()): HistoryDayGroup[] {
  const groups = new Map<string, HistoryDayGroup>();

  sortHistoryItemsByUpdatedAt(items).forEach((item) => {
    const key = buildHistoryDayKey(item.updatedAt);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      return;
    }
    groups.set(key, {
      id: key,
      label: formatHistoryDayLabel(item.updatedAt, now),
      items: [item]
    });
  });

  return Array.from(groups.values());
}

function getChannelInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) {
    return "CH";
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "CH";
}

function matchesHistoryFilter(item: ChatListItem, filter: HistoryFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "exported") {
    return item.status === "exported";
  }
  if (filter === "error") {
    return item.status === "error";
  }
  return (
    item.status === "new" ||
    item.status === "sourceReady" ||
    item.status === "stage2Ready" ||
    item.status === "editing" ||
    item.status === "agentRunning"
  );
}

function buildHistorySections(items: ChatListItem[], activeHistoryId: string | null): HistorySection[] {
  const sections: HistorySection[] = [];
  const activeItem = activeHistoryId ? items.find((item) => item.id === activeHistoryId) ?? null : null;
  const remainder = activeItem ? items.filter((item) => item.id !== activeItem.id) : items;

  if (activeItem) {
    sections.push({ id: "active", title: "Активный", items: [activeItem] });
  }

  const working = remainder.filter((item) =>
    item.status === "new" ||
    item.status === "sourceReady" ||
    item.status === "stage2Ready" ||
    item.status === "editing" ||
    item.status === "agentRunning"
  );
  const exported = remainder.filter((item) => item.status === "exported");
  const errors = remainder.filter((item) => item.status === "error");

  if (working.length > 0) {
    sections.push({ id: "working", title: "В работе", items: working });
  }
  if (exported.length > 0) {
    sections.push({ id: "exported", title: "Экспорт", items: exported });
  }
  if (errors.length > 0) {
    sections.push({ id: "error", title: "Ошибка", items: errors });
  }

  return sections;
}

const HistoryCard = memo(function HistoryCard({
  item,
  active,
  compact = false,
  onOpen,
  onDelete
}: {
  item: ChatListItem;
  active: boolean;
  compact?: boolean;
  onOpen: (id: string, step?: 1 | 2 | 3) => void;
  onDelete: (id: string) => void;
}) {
  const handleOpen = useCallback(() => {
    onOpen(item.id);
  }, [item.id, onOpen]);
  const handleDelete = useCallback(() => {
    onDelete(item.id);
  }, [item.id, onDelete]);
  const handleOpenStep2 = useCallback(() => {
    onOpen(item.id, 2);
  }, [item.id, onOpen]);
  const handleOpenStep3 = useCallback(() => {
    onOpen(item.id, 3);
  }, [item.id, onOpen]);

  return (
    <article
      className={`history-card ${active ? "active" : ""} ${compact ? "compact" : ""} status-${item.status}`}
    >
      <div className="history-card-head">
        <div className="history-badge-row">
          <span className={`history-status-chip status-${item.status}`}>
            {formatHistoryStatusLabel(item.status)}
          </span>
          {item.liveAction ? <span className="history-live-chip">{item.liveAction}</span> : null}
          {active ? <span className="history-current-pill">Current</span> : null}
        </div>
        <button
          type="button"
          className="history-remove"
          aria-label={`Удалить ${item.title}`}
          onClick={handleDelete}
        >
          ✕
        </button>
      </div>

      <button
        type="button"
        className="history-open"
        onClick={handleOpen}
        aria-current={active ? "true" : undefined}
        title={item.url}
      >
        <span className="history-title clamp-2">{item.title}</span>
        <span className="history-meta-line">
          <span>Шаг {item.preferredStep}</span>
          <span>Обновлён {formatHistoryTime(item.updatedAt)}</span>
          {item.hasDraft ? <span className="history-draft-pill">draft</span> : null}
        </span>
        {item.exportTitle ? <span className="history-export-line">Export: {item.exportTitle}</span> : null}
      </button>

      <div className="history-actions">
        <button type="button" className="btn btn-secondary" onClick={handleOpen}>
          Open
        </button>
        {item.maxStep >= 2 ? (
          <button type="button" className="btn btn-ghost" onClick={handleOpenStep2}>
            Step 2
          </button>
        ) : null}
        {item.maxStep >= 3 ? (
          <button type="button" className="btn btn-ghost" onClick={handleOpenStep3}>
            Step 3
          </button>
        ) : null}
      </div>
    </article>
  );
});

const HistoryPanel = memo(function HistoryPanel({
  items,
  activeHistoryId,
  compact = false,
  emptyText,
  onOpen,
  onDelete
}: {
  items: ChatListItem[];
  activeHistoryId: string | null;
  compact?: boolean;
  emptyText: string;
  onOpen: (id: string, step?: 1 | 2 | 3) => void;
  onDelete: (id: string) => void;
}) {
  const sections = useMemo(() => buildHistorySections(items, activeHistoryId), [activeHistoryId, items]);

  if (sections.length === 0) {
    return <p className="empty-box">{emptyText}</p>;
  }

  return (
    <div className={`history-panel ${compact ? "compact" : ""}`}>
      {sections.map((section) => (
        <section key={section.id} className="history-section">
          <div className="history-section-head">
            <h3>{section.title}</h3>
            <span>{section.items.length}</span>
          </div>
          <div className="history-day-groups">
            {groupHistoryItemsByDay(section.items).map((group) => (
              <div key={group.id} className="history-day-group">
                <div className="history-day-head">
                  <h4>{group.label}</h4>
                  <span>{group.items.length}</span>
                </div>
                <ul className="history-list">
                  {group.items.map((item) => {
                    const active = item.id === activeHistoryId;
                    return (
                      <li key={item.id} className="history-row">
                        <HistoryCard
                          item={item}
                          active={active}
                          compact={compact}
                          onOpen={onOpen}
                          onDelete={onDelete}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});

export function AppShell({
  title,
  subtitle,
  steps,
  currentStep,
  onStepChange,
  historyItems,
  activeHistoryId,
  onHistoryOpen,
  onDeleteHistory,
  onCreateNew,
  channels,
  activeChannelId,
  onSelectChannel,
  onManageChannels,
  canManageChannels,
  canManageTeam,
  onOpenTeam,
  codexConnected,
  codexBusyConnect,
  codexBusyRefresh,
  canManageCodex,
  canConnectCodex,
  codexConnectBlockedReason,
  codexStatusLabel,
  codexActionLabel,
  codexDeviceAuth,
  codexSecondaryActionLabel,
  onConnectCodex,
  onRefreshCodex,
  onSecondaryCodexAction,
  onCopyCodexLoginUrl,
  onCopyCodexUserCode,
  currentUserName,
  currentUserRole,
  workspaceName,
  onLogout,
  statusText,
  statusTone,
  headerActions,
  children,
  details,
  afterDetails
}: AppShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [codexPanelOpen, setCodexPanelOpen] = useState(false);
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const historyPopoverRef = useRef<HTMLDivElement | null>(null);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);
  const historyCloseTimerRef = useRef<number | null>(null);
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? channels[0] ?? null,
    [activeChannelId, channels]
  );

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return historyItems.filter((item) => {
      if (!matchesHistoryFilter(item, historyFilter)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const title = item.title.toLowerCase();
      const exportTitle = item.exportTitle?.toLowerCase() ?? "";
      const status = formatHistoryStatusLabel(item.status).toLowerCase();
      return (
        title.includes(query) ||
        exportTitle.includes(query) ||
        item.url.toLowerCase().includes(query) ||
        status.includes(query)
      );
    });
  }, [historyFilter, historyItems, historyQuery]);

  const hasCodexDeviceAuthDetails = Boolean(
    canManageCodex &&
      codexDeviceAuth &&
      (codexDeviceAuth.status !== "idle" ||
        Boolean(codexDeviceAuth.loginUrl) ||
        Boolean(codexDeviceAuth.userCode) ||
        Boolean(codexDeviceAuth.output.trim()))
  );
  const showDeviceAuthDetails = Boolean(
    canManageCodex &&
      codexDeviceAuth &&
      (!codexConnected ||
        codexDeviceAuth.status === "running" ||
        codexDeviceAuth.status === "error" ||
        codexDeviceAuth.status === "canceled") &&
      (Boolean(codexDeviceAuth.loginUrl) ||
        Boolean(codexDeviceAuth.userCode) ||
        Boolean(codexDeviceAuth.output.trim()))
  );
  const codexPanelStatus =
    codexConnected && (codexDeviceAuth?.status ?? "idle") === "idle"
      ? "Подключен"
      : formatDeviceAuthStatus(codexDeviceAuth?.status ?? "idle");
  const showCodexDetailsToggle = Boolean(!codexConnected && hasCodexDeviceAuthDetails);
  const showCodexPanel = Boolean(
    canManageCodex && (showDeviceAuthDetails || (codexPanelOpen && !codexConnected))
  );
  const clearHistoryCloseTimer = useCallback(() => {
    if (typeof window === "undefined" || historyCloseTimerRef.current === null) {
      return;
    }
    window.clearTimeout(historyCloseTimerRef.current);
    historyCloseTimerRef.current = null;
  }, []);
  const openHistoryPopover = useCallback(
    (pin = false) => {
      clearHistoryCloseTimer();
      setHistoryOpen(true);
      if (pin) {
        setHistoryPinned(true);
      }
    },
    [clearHistoryCloseTimer]
  );
  const scheduleHistoryPopoverClose = useCallback(() => {
    if (historyPinned) {
      return;
    }
    clearHistoryCloseTimer();
    if (typeof window === "undefined") {
      setHistoryOpen(false);
      return;
    }
    historyCloseTimerRef.current = window.setTimeout(() => {
      historyCloseTimerRef.current = null;
      setHistoryOpen(false);
    }, 140);
  }, [clearHistoryCloseTimer, historyPinned]);
  const closeHistoryPopover = useCallback(() => {
    clearHistoryCloseTimer();
    setHistoryOpen(false);
    setHistoryPinned(false);
  }, [clearHistoryCloseTimer]);
  const handleCreateNewAndClose = useCallback(() => {
    onCreateNew();
    closeHistoryPopover();
  }, [closeHistoryPopover, onCreateNew]);
  const handleHistoryOpenAndClose = useCallback(
    (id: string, step?: 1 | 2 | 3) => {
      onHistoryOpen(id, step);
      closeHistoryPopover();
    },
    [closeHistoryPopover, onHistoryOpen]
  );

  useEffect(() => {
    if (
      hasCodexDeviceAuthDetails &&
      (codexDeviceAuth?.status === "running" ||
        codexDeviceAuth?.status === "error" ||
        codexDeviceAuth?.status === "canceled")
    ) {
      setCodexPanelOpen(true);
    }
  }, [codexDeviceAuth?.status, hasCodexDeviceAuthDetails]);

  useEffect(() => {
    if (codexConnected && (codexDeviceAuth?.status ?? "idle") === "idle") {
      setCodexPanelOpen(false);
    }
  }, [codexConnected, codexDeviceAuth?.status]);

  useEffect(() => {
    if (!historyOpen || typeof window === "undefined") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHistoryPopover();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeHistoryPopover, historyOpen]);

  useEffect(() => {
    if (!historyPinned || !historyOpen || typeof window === "undefined") {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (historyPopoverRef.current?.contains(target)) {
        return;
      }
      closeHistoryPopover();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeHistoryPopover, historyOpen, historyPinned]);

  useEffect(() => {
    return () => {
      clearHistoryCloseTimer();
    };
  }, [clearHistoryCloseTimer]);

  useEffect(() => {
    if (!channelMenuOpen || typeof window === "undefined") {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (channelMenuRef.current?.contains(target)) {
        return;
      }
      setChannelMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChannelMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [channelMenuOpen]);

  return (
    <main className="app-layout">
      <section className="app-main">
        <header className="app-topbar">
          <div className="topbar-primary">
            <div className="topbar-brand-row">
              <div
                ref={historyPopoverRef}
                className="history-popover-anchor"
                onMouseEnter={() => openHistoryPopover(false)}
                onMouseLeave={scheduleHistoryPopoverClose}
                onFocusCapture={() => openHistoryPopover(false)}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
                    return;
                  }
                  scheduleHistoryPopoverClose();
                }}
              >
                <button
                  type="button"
                  className={`history-trigger ${historyOpen ? "active" : ""}`}
                  aria-label={historyOpen ? "Скрыть историю" : "Открыть историю"}
                  aria-expanded={historyOpen}
                  aria-controls="history-navigation"
                  aria-haspopup="dialog"
                  onClick={() => {
                    if (historyPinned) {
                      closeHistoryPopover();
                      return;
                    }
                    openHistoryPopover(true);
                  }}
                >
                  <span aria-hidden="true">🕘</span>
                  <span>История</span>
                  <span className="history-count">{historyItems.length}</span>
                </button>

                {historyOpen ? (
                  <div
                    id="history-navigation"
                    className={`history-popover ${historyPinned ? "pinned" : ""}`}
                    role="dialog"
                    aria-label="Навигация по роликам"
                  >
                    <div className="history-popover-head">
                      <div>
                        <p className="sidebar-kicker">Навигация</p>
                        <h2>Ролики</h2>
                      </div>
                      <div className="history-popover-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={handleCreateNewAndClose}
                        >
                          + Новый
                        </button>
                        <button
                          type="button"
                          className="history-popover-close"
                          aria-label="Скрыть историю"
                          onClick={closeHistoryPopover}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <input
                      className="text-input history-popover-search"
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="Поиск по роликам..."
                      aria-label="Поиск по истории"
                    />

                    <div className="history-filter-row">
                      {(["all", "working", "exported", "error"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          className={`history-filter-chip ${historyFilter === filter ? "active" : ""}`}
                          onClick={() => setHistoryFilter(filter)}
                        >
                          {filter === "all"
                            ? "Все"
                            : filter === "working"
                              ? "В работе"
                              : filter === "exported"
                                ? "Экспорт"
                                : "Ошибка"}
                        </button>
                      ))}
                    </div>

                    <div className="history-popover-scroll">
                      <HistoryPanel
                        items={filteredHistory}
                        activeHistoryId={activeHistoryId}
                        compact
                        emptyText={historyItems.length > 0 ? "Ничего не найдено." : "Чатов пока нет."}
                        onOpen={handleHistoryOpenAndClose}
                        onDelete={onDeleteHistory}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="topbar-brand">
                <h1>{title}</h1>
                <p>{subtitle}</p>
              </div>
            </div>

            <div className="channel-switcher">
              <label className="field-label" htmlFor="channelPickerButton">
                Канал
              </label>
              <div className="channel-switcher-row">
                <div ref={channelMenuRef} className={`channel-picker ${channelMenuOpen ? "open" : ""}`}>
                  <button
                    id="channelPickerButton"
                    type="button"
                    className="channel-picker-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={channelMenuOpen}
                    onClick={() => setChannelMenuOpen((prev) => !prev)}
                    disabled={channels.length === 0}
                  >
                    <span
                      className={`channel-picker-avatar ${selectedChannel?.avatarUrl ? "has-image" : ""}`}
                      style={
                        selectedChannel?.avatarUrl
                          ? {
                              backgroundImage: `url(${selectedChannel.avatarUrl})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center"
                            }
                          : undefined
                      }
                      aria-hidden="true"
                    >
                      {selectedChannel?.avatarUrl ? "" : getChannelInitials(selectedChannel?.name ?? "Channel")}
                    </span>
                    <span className="channel-picker-copy">
                      <strong>{selectedChannel?.name ?? "Выберите канал"}</strong>
                      <span>@{selectedChannel?.username ?? "channel"}</span>
                    </span>
                    <span className="channel-picker-chevron" aria-hidden="true">
                      {channelMenuOpen ? "▴" : "▾"}
                    </span>
                  </button>

                  {channelMenuOpen ? (
                    <div className="channel-picker-menu" role="listbox" aria-label="Каналы">
                      {channels.map((channel) => {
                        const active = channel.id === selectedChannel?.id;
                        return (
                          <button
                            key={channel.id}
                            type="button"
                            className={`channel-picker-option ${active ? "active" : ""}`}
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              onSelectChannel(channel.id);
                              setChannelMenuOpen(false);
                            }}
                          >
                            <span
                              className={`channel-picker-avatar ${channel.avatarUrl ? "has-image" : ""}`}
                              style={
                                channel.avatarUrl
                                  ? {
                                      backgroundImage: `url(${channel.avatarUrl})`,
                                      backgroundSize: "cover",
                                      backgroundPosition: "center"
                                    }
                                  : undefined
                              }
                              aria-hidden="true"
                            >
                              {channel.avatarUrl ? "" : getChannelInitials(channel.name)}
                            </span>
                            <span className="channel-picker-copy">
                              <strong>{channel.name}</strong>
                              <span>@{channel.username}</span>
                            </span>
                            {active ? <span className="channel-picker-check">✓</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                {canManageChannels ? (
                  <button type="button" className="btn btn-secondary" onClick={onManageChannels}>
                    Каналы
                  </button>
                ) : null}
                {canManageTeam ? (
                  <button type="button" className="btn btn-ghost" onClick={onOpenTeam}>
                    Команда
                  </button>
                ) : null}
                {headerActions}
              </div>
            </div>
          </div>

          <aside className="topbar-utility">
            <section className="workspace-card">
              <div className="workspace-card-copy">
                <span className="workspace-kicker">{workspaceName ?? "Рабочее пространство"}</span>
                <div className="workspace-card-title-row">
                  <strong>{currentUserName ?? "Пользователь рабочего пространства"}</strong>
                  {currentUserRole ? <span className="workspace-role">{formatRoleLabel(currentUserRole)}</span> : null}
                  <span className={`status-chip ${codexConnected ? "online" : "offline"}`}>
                    {codexStatusLabel ?? (codexConnected ? "Shared Codex подключен" : "Shared Codex недоступен")}
                  </span>
                </div>
              </div>

              <div className="workspace-card-actions">
                {canManageCodex ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onConnectCodex}
                      aria-busy={codexBusyConnect}
                      disabled={codexBusyConnect || !canConnectCodex}
                      title={!canConnectCodex ? codexConnectBlockedReason ?? undefined : undefined}
                    >
                      {codexBusyConnect ? "Подключение..." : codexActionLabel ?? "Подключить"}
                    </button>
                    {codexSecondaryActionLabel && onSecondaryCodexAction ? (
                      <button type="button" className="btn btn-ghost" onClick={onSecondaryCodexAction}>
                        {codexSecondaryActionLabel}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={onRefreshCodex}
                      aria-busy={codexBusyRefresh}
                      disabled={codexBusyRefresh}
                    >
                      {codexBusyRefresh ? "Обновление..." : "Обновить"}
                    </button>
                    {showCodexDetailsToggle && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setCodexPanelOpen((prev) => !prev)}
                      >
                        {codexPanelOpen ? "Скрыть детали" : "Показать детали"}
                      </button>
                    )}
                  </>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={onLogout}>
                  Выйти
                </button>
              </div>
            </section>

            {showCodexPanel ? (
              <section className="codex-control-panel">
                <div className="codex-device-head">
                  <div>
                    <strong>Вход в Shared Codex</strong>
                    <p className="subtle-text">
                      Подключите один раз, завершите вход в браузере и затем обновите статус.
                    </p>
                  </div>
                  <span className={`status-chip ${codexConnected ? "online" : "offline"}`}>{codexPanelStatus}</span>
                </div>

                {!canConnectCodex && codexConnectBlockedReason ? (
                  <p className="subtle-text danger-text">{codexConnectBlockedReason}</p>
                ) : null}

                {showDeviceAuthDetails && codexDeviceAuth?.loginUrl ? (
                  <div className="codex-device-row">
                    <span className="field-label">Ссылка для входа</span>
                    <div className="codex-device-actions">
                      <a
                        className="btn btn-secondary codex-device-link"
                        href={codexDeviceAuth.loginUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть страницу входа
                      </a>
                      {onCopyCodexLoginUrl ? (
                        <button type="button" className="btn btn-ghost" onClick={onCopyCodexLoginUrl}>
                          Копировать ссылку
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showDeviceAuthDetails && codexDeviceAuth?.userCode ? (
                  <div className="codex-device-row">
                    <span className="field-label">Код устройства</span>
                    <div className="codex-device-actions">
                      <code className="codex-device-code">{codexDeviceAuth.userCode}</code>
                      {onCopyCodexUserCode ? (
                        <button type="button" className="btn btn-ghost" onClick={onCopyCodexUserCode}>
                          Копировать код
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showDeviceAuthDetails && codexDeviceAuth?.output.trim() ? (
                  <details className="codex-device-log">
                    <summary>Вывод CLI</summary>
                    <pre>{codexDeviceAuth.output}</pre>
                  </details>
                ) : null}
              </section>
            ) : null}
          </aside>
        </header>

        <section className="shell-body">
          <div className="shell-workspace">
            <nav className="wizard-stepper" aria-label="Шаги процесса">
              {steps.map((step) => {
                const stepState = getStepState(step.id, currentStep);
                const statusLabel =
                  stepState === "completed" ? "Завершено" : stepState === "current" ? "Текущий" : "Далее";
                return (
                  <button
                    key={step.id}
                    type="button"
                    className={`wizard-step ${stepState}`}
                    onClick={() => onStepChange(step.id)}
                    disabled={!step.enabled}
                    aria-current={stepState === "current" ? "step" : undefined}
                  >
                    <span className="wizard-step-num">Шаг {step.id}</span>
                    <span className="wizard-step-label">{step.label}</span>
                    <span className="wizard-step-state">{statusLabel}</span>
                  </button>
                );
              })}
            </nav>

            <section className="shell-content">{children}</section>

            {statusText ? (
              <p
                className={`status-line ${statusTone === "error" ? "error" : "ok"}`}
                role="status"
                aria-live={statusTone === "error" ? "assertive" : "polite"}
              >
                {sanitizeDisplayText(statusText)}
              </p>
            ) : null}

            {details}

            {afterDetails}
          </div>
        </section>
      </section>
    </main>
  );
}
