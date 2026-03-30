"use client";

import React, { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeDisplayText } from "../../lib/ui-error";
import type { ChatListItem, ChatWorkflowStatus, CodexDeviceAuth } from "./types";
import {
  getHistoryProgressBadge,
  groupHistoryItemsByDay
} from "./history-panel-support";

export { formatHistoryDayLabel, groupHistoryItemsByDay } from "./history-panel-support";

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

export type AppShellToastTone = "neutral" | "success" | "error";

export type AppShellToast = {
  id: string;
  tone: AppShellToastTone;
  title?: string | null;
  message: string;
  actionLabel?: string | null;
  onAction?: () => void;
  variant?: "default" | "shortcut";
  durationMs?: number | null;
};

export type AppShellProps = {
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
  toasts?: AppShellToast[];
  onDismissToast?: (toastId: string) => void;
  headerActions?: ReactNode;
  children: ReactNode;
  details: ReactNode;
  afterDetails?: ReactNode;
};

export function getOverflowActionWrapperProps(
  closeOverflowMenus: () => void
): Pick<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  return {
    onClick: () => {
      closeOverflowMenus();
    }
  };
}

export function getWorkspaceLogoutLabel(): string {
  return "Выйти из приложения";
}

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
      return "Редактор";
    case "redactor_limited":
      return "Редактор (ограниченный)";
    default:
      return role.replace(/_/g, " ");
  }
}

function formatHistoryStatusLabel(status: ChatWorkflowStatus): string {
  switch (status) {
    case "new":
      return "Новый";
    case "sourceReady":
      return "Источник готов";
    case "stage2Ready":
      return "Опции готовы";
    case "editing":
      return "Редактирование";
    case "agentRunning":
      return "Агент";
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

function formatHistoryLiveAction(liveAction: NonNullable<ChatListItem["liveAction"]>): string {
  switch (liveAction) {
    case "Fetching":
      return "Получение";
    case "Comments":
      return "Комментарии";
    case "Stage 2":
      return "В процессе";
    case "Rendering":
      return "Рендер";
    default:
      return liveAction;
  }
}

function formatPublicationStatusLabel(status: NonNullable<ChatListItem["publication"]>["status"]): string {
  switch (status) {
    case "queued":
      return "Ожидает";
    case "uploading":
      return "Загрузка";
    case "scheduled":
      return "Запланировано";
    case "published":
      return "Опубликовано";
    case "failed":
      return "Ошибка";
    case "paused":
      return "На паузе";
    case "canceled":
      return "Удалено";
    default:
      return status;
  }
}

function getPublicationToneClass(status: NonNullable<ChatListItem["publication"]>["status"]): string {
  switch (status) {
    case "queued":
      return "tone-queued";
    case "uploading":
      return "tone-running";
    case "scheduled":
      return "tone-scheduled";
    case "published":
      return "tone-published";
    case "failed":
      return "tone-error";
    case "paused":
      return "tone-paused";
    default:
      return "tone-muted";
  }
}

const HistoryCard = memo(function HistoryCard({
  item,
  active,
  onOpen,
  onDelete
}: {
  item: ChatListItem;
  active: boolean;
  onOpen: (id: string, step?: 1 | 2 | 3) => void;
  onDelete: (id: string) => void;
}) {
  const primaryStatusLabel = item.liveAction
    ? formatHistoryLiveAction(item.liveAction)
    : item.publication
      ? formatPublicationStatusLabel(item.publication.status)
      : formatHistoryStatusLabel(item.status);
  const progressBadge = getHistoryProgressBadge(item);
  const publicationSlotTime = item.publication
    ? formatHistoryTime(item.publication.scheduledAt)
    : null;
  const showProgressBadge = item.publication?.status !== "published";
  const handleOpen = useCallback(() => {
    onOpen(item.id);
  }, [item.id, onOpen]);
  const handleDelete = useCallback(() => {
    onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <article
      className={`history-card compact status-${item.status} ${active ? "active" : ""}`}
    >
      <button
        type="button"
        className="history-open history-open-row"
        onClick={handleOpen}
        aria-current={active ? "true" : undefined}
        title={item.url}
      >
        <span className="history-row-main">
          <span className="history-title clamp-1">{item.title}</span>
          {!item.publication ? (
            <span className="history-meta-line">
              <span>Обновлён {formatHistoryTime(item.updatedAt)}</span>
            </span>
          ) : null}
          {item.exportTitle ? <span className="history-export-line">Экспорт: {item.exportTitle}</span> : null}
          {item.publication && (publicationSlotTime || item.publication.needsReview) ? (
            <span className="history-publication-line">
              {publicationSlotTime ? <span className="history-slot-pill">{publicationSlotTime}</span> : null}
              {item.publication.needsReview ? (
                <span className="history-publication-pill tone-muted">Нужна проверка</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      <div className="history-row-side">
        <span className={`history-status-chip ${item.liveAction ? "status-live" : `status-${item.status}`}`}>
          {primaryStatusLabel}
        </span>
        {showProgressBadge ? (
          <span className={`history-step-pill tone-${progressBadge.tone}`}>{progressBadge.label}</span>
        ) : null}
        <button
          type="button"
          className="history-remove"
          aria-label={`Удалить ${item.title}`}
          onClick={handleDelete}
        >
          ✕
        </button>
      </div>
    </article>
  );
});

const HistoryPanel = memo(function HistoryPanel({
  visibleItems,
  activeHistoryId,
  compact = false,
  emptyText,
  onOpen,
  onDelete
}: {
  visibleItems: ChatListItem[];
  activeHistoryId: string | null;
  compact?: boolean;
  emptyText: string;
  onOpen: (id: string, step?: 1 | 2 | 3) => void;
  onDelete: (id: string) => void;
}) {
  const dayGroups = useMemo(() => groupHistoryItemsByDay(visibleItems), [visibleItems]);

  if (dayGroups.length === 0) {
    return <p className="empty-box">{emptyText}</p>;
  }

  return (
    <div className={`history-panel ${compact ? "compact" : ""}`}>
      {dayGroups.map((group) => (
        <section key={group.id} className="history-section">
          <div className="history-section-head">
            <h3>{group.label}</h3>
            <span>{group.items.length}</span>
          </div>
          <ul className={`history-list ${compact ? "compact" : ""}`}>
            {group.items.map((item) => {
              const active = item.id === activeHistoryId;
              return (
                <li key={item.id} className="history-row">
                  <HistoryCard
                    item={item}
                    active={active}
                    onOpen={onOpen}
                    onDelete={onDelete}
                  />
                </li>
              );
            })}
          </ul>
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
  toasts = [],
  onDismissToast,
  headerActions,
  children,
  details,
  afterDetails
}: AppShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [codexPanelOpen, setCodexPanelOpen] = useState(false);
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [headerOverflowOpen, setHeaderOverflowOpen] = useState(false);
  const [workspaceOverflowOpen, setWorkspaceOverflowOpen] = useState(false);
  const historyPopoverRef = useRef<HTMLDivElement | null>(null);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);
  const headerOverflowRef = useRef<HTMLDivElement | null>(null);
  const workspaceOverflowRef = useRef<HTMLDivElement | null>(null);
  const historyCloseTimerRef = useRef<number | null>(null);
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? channels[0] ?? null,
    [activeChannelId, channels]
  );
  const showHeaderOverflow = Boolean(canManageChannels || canManageTeam || headerActions);
  const showWorkspaceOverflow = Boolean(canManageCodex || currentUserName || currentUserRole || onLogout);

  const visibleHistoryItems = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return historyItems.filter((item) => {
      if (!query) {
        return true;
      }
      const title = item.title.toLowerCase();
      const exportTitle = item.exportTitle?.toLowerCase() ?? "";
      const status = formatHistoryStatusLabel(item.status).toLowerCase();
      const publicationStatus = item.publication
        ? formatPublicationStatusLabel(item.publication.status).toLowerCase()
        : "";
      return (
        title.includes(query) ||
        exportTitle.includes(query) ||
        item.url.toLowerCase().includes(query) ||
        status.includes(query) ||
        publicationStatus.includes(query)
      );
    });
  }, [historyItems, historyQuery]);

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
  const closeOverflowMenus = useCallback(() => {
    setHeaderOverflowOpen(false);
    setWorkspaceOverflowOpen(false);
  }, []);
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

  useEffect(() => {
    if ((!headerOverflowOpen && !workspaceOverflowOpen) || typeof window === "undefined") {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (headerOverflowOpen && headerOverflowRef.current?.contains(target)) {
        return;
      }
      if (workspaceOverflowOpen && workspaceOverflowRef.current?.contains(target)) {
        return;
      }
      closeOverflowMenus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverflowMenus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeOverflowMenus, headerOverflowOpen, workspaceOverflowOpen]);

  return (
    <main className="app-layout">
      {toasts.length > 0 ? (
        <div className="app-toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <section
              key={toast.id}
              className={`app-toast tone-${toast.tone} variant-${toast.variant ?? "default"}`}
              role={toast.tone === "error" ? "alert" : "status"}
              style={
                typeof toast.durationMs === "number" && toast.durationMs > 0
                  ? ({
                      ["--toast-duration" as string]: `${toast.durationMs}ms`
                    } as React.CSSProperties)
                  : undefined
              }
            >
              <div className="app-toast-head">
                <div className="app-toast-body">
                  {toast.title ? <strong>{sanitizeDisplayText(toast.title)}</strong> : null}
                  <p>{sanitizeDisplayText(toast.message)}</p>
                </div>
                {onDismissToast ? (
                  <button
                    type="button"
                    className="app-toast-close"
                    aria-label="Скрыть уведомление"
                    onClick={() => onDismissToast(toast.id)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              {(toast.actionLabel && toast.onAction) || toast.durationMs ? (
                <div className="app-toast-footer">
                  {toast.actionLabel && toast.onAction ? (
                    <button type="button" className="btn btn-secondary" onClick={toast.onAction}>
                      {toast.actionLabel}
                    </button>
                  ) : null}
                  {typeof toast.durationMs === "number" && toast.durationMs > 0 ? (
                    <span className="app-toast-timer" aria-hidden="true" />
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
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

                    <div className="history-popover-scroll">
                      <HistoryPanel
                        visibleItems={visibleHistoryItems}
                        activeHistoryId={activeHistoryId}
                        compact
                        emptyText={historyItems.length > 0 ? "Ничего не найдено." : "Роликов пока нет."}
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
                {showHeaderOverflow ? (
                  <div ref={headerOverflowRef} className="topbar-inline-details">
                    <button
                      type="button"
                      className={`topbar-inline-trigger ${headerOverflowOpen ? "active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={headerOverflowOpen}
                      onClick={() => {
                        setHeaderOverflowOpen((prev) => {
                          const next = !prev;
                          if (next) {
                            setWorkspaceOverflowOpen(false);
                            setChannelMenuOpen(false);
                          }
                          return next;
                        });
                      }}
                    >
                      Еще
                    </button>
                    {headerOverflowOpen ? (
                      <div className="topbar-inline-details-content">
                      {canManageChannels ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            closeOverflowMenus();
                            onManageChannels();
                          }}
                        >
                          Каналы
                        </button>
                      ) : null}
                      {canManageTeam ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            closeOverflowMenus();
                            onOpenTeam();
                          }}
                        >
                          Команда
                        </button>
                      ) : null}
                      {headerActions ? (
                        <div
                          className="topbar-inline-action"
                          // Bubble-phase close lets the nested button handler run before the menu unmounts.
                          {...getOverflowActionWrapperProps(closeOverflowMenus)}
                        >
                          {headerActions}
                        </div>
                      ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
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

              {showWorkspaceOverflow ? (
                <div className="workspace-card-actions">
                  <div ref={workspaceOverflowRef} className="topbar-inline-details topbar-inline-details-right">
                    <button
                      type="button"
                      className={`topbar-inline-trigger ${workspaceOverflowOpen ? "active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={workspaceOverflowOpen}
                      onClick={() => {
                        setWorkspaceOverflowOpen((prev) => {
                          const next = !prev;
                          if (next) {
                            setHeaderOverflowOpen(false);
                            setChannelMenuOpen(false);
                          }
                          return next;
                        });
                      }}
                    >
                      Управление
                    </button>
                    {workspaceOverflowOpen ? (
                      <div className="topbar-inline-details-content">
                      {canManageCodex ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              closeOverflowMenus();
                              onConnectCodex();
                            }}
                            aria-busy={codexBusyConnect}
                            disabled={codexBusyConnect || !canConnectCodex}
                            title={!canConnectCodex ? codexConnectBlockedReason ?? undefined : undefined}
                          >
                            {codexBusyConnect ? "Подключение..." : codexActionLabel ?? "Подключить"}
                          </button>
                          {codexSecondaryActionLabel && onSecondaryCodexAction ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                closeOverflowMenus();
                                onSecondaryCodexAction();
                              }}
                            >
                              {codexSecondaryActionLabel}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              closeOverflowMenus();
                              onRefreshCodex();
                            }}
                            aria-busy={codexBusyRefresh}
                            disabled={codexBusyRefresh}
                          >
                            {codexBusyRefresh ? "Обновление..." : "Обновить"}
                          </button>
                          {showCodexDetailsToggle && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                closeOverflowMenus();
                                setCodexPanelOpen((prev) => !prev);
                              }}
                            >
                              {codexPanelOpen ? "Скрыть детали" : "Показать детали"}
                            </button>
                          )}
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          closeOverflowMenus();
                          onLogout();
                        }}
                      >
                        {getWorkspaceLogoutLabel()}
                      </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
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
