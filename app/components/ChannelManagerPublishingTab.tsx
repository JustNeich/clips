"use client";

import { useEffect, useMemo, useState } from "react";
import type { Channel, ChannelPublishSettings, YouTubeOAuthClientOption } from "./types";

type ChannelManagerPublishingTabProps = {
  channel: Channel | null;
  canEditSetup: boolean;
  canManageYouTube: boolean;
  onSaveSettings: (channelId: string, patch: Partial<ChannelPublishSettings>) => Promise<void>;
  onConnectYouTube: (channelId: string, oauthClientKey?: string) => Promise<void>;
  onDisconnectYouTube: (channelId: string) => Promise<void>;
  onSelectYouTubeDestination: (channelId: string, selectedYoutubeChannelId: string) => Promise<void>;
};

const FALLBACK_PUBLISH_SETTINGS: ChannelPublishSettings = {
  timezone: "Europe/Moscow",
  firstSlotLocalTime: "21:00",
  dailySlotCount: 4,
  slotIntervalMinutes: 15,
  autoQueueEnabled: true,
  uploadLeadMinutes: 120,
  notifySubscribersByDefault: false
};

function buildSlotPreview(settings: ChannelPublishSettings): string[] {
  const [hourString, minuteString] = settings.firstSlotLocalTime.split(":");
  const hour = Number.parseInt(hourString ?? "21", 10);
  const minute = Number.parseInt(minuteString ?? "0", 10);
  const slots: string[] = [];
  for (let index = 0; index < settings.dailySlotCount; index += 1) {
    const totalMinutes = hour * 60 + minute + index * settings.slotIntervalMinutes;
    const slotHour = Math.floor(((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
    const slotMinute = ((totalMinutes % 60) + 60) % 60;
    slots.push(`${String(slotHour).padStart(2, "0")}:${String(slotMinute).padStart(2, "0")}`);
  }
  return slots;
}

export function ChannelManagerPublishingTab({
  channel,
  canEditSetup,
  canManageYouTube,
  onSaveSettings,
  onConnectYouTube,
  onDisconnectYouTube,
  onSelectYouTubeDestination
}: ChannelManagerPublishingTabProps) {
  const [settingsDraft, setSettingsDraft] = useState<ChannelPublishSettings>(
    channel?.publishSettings ?? FALLBACK_PUBLISH_SETTINGS
  );
  const [selectedChannelId, setSelectedChannelId] = useState(
    channel?.publishIntegration?.selectedYoutubeChannelId ?? ""
  );
  const [oauthClients, setOauthClients] = useState<YouTubeOAuthClientOption[]>([]);
  const [oauthClientsLoaded, setOauthClientsLoaded] = useState(false);
  const [selectedOauthClientKey, setSelectedOauthClientKey] = useState(
    channel?.publishIntegration?.youtubeOAuthClientKey ?? ""
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [busyAction, setBusyAction] = useState<"" | "save" | "connect" | "disconnect" | "select">("");

  useEffect(() => {
    setSettingsDraft(channel?.publishSettings ?? FALLBACK_PUBLISH_SETTINGS);
    setSelectedChannelId(channel?.publishIntegration?.selectedYoutubeChannelId ?? "");
    setSelectedOauthClientKey(channel?.publishIntegration?.youtubeOAuthClientKey ?? "");
    setStatusMessage(null);
    setStatusTone("idle");
    setBusyAction("");
  }, [channel?.id, channel?.publishIntegration, channel?.publishSettings]);

  const integration = channel?.publishIntegration ?? null;
  const channelId = channel?.id ?? "";
  const integrationOauthClientKey = integration?.youtubeOAuthClientKey ?? "";
  const slotPreview = useMemo(() => buildSlotPreview(settingsDraft), [settingsDraft]);
  const selectionRequired = integration?.status === "pending_selection" || !integration?.selectedYoutubeChannelId;
  const selectedOauthClient = oauthClients.find((client) => client.key === selectedOauthClientKey) ?? null;

  useEffect(() => {
    if (!channelId || !canManageYouTube) {
      setOauthClients([]);
      setOauthClientsLoaded(Boolean(channelId));
      return;
    }
    setOauthClientsLoaded(false);
    setOauthClients([]);
    const controller = new AbortController();
    void fetch(`/api/channels/${channelId}/publishing/youtube/connect`, {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Не удалось загрузить Google OAuth projects.");
        }
        return (await response.json()) as {
          oauthClients?: YouTubeOAuthClientOption[];
          defaultOauthClientKey?: string;
        };
      })
      .then((body) => {
        const clients = Array.isArray(body.oauthClients) ? body.oauthClients : [];
        setOauthClients(clients);
        setOauthClientsLoaded(true);
        setSelectedOauthClientKey((current) => {
          const preferred =
            integrationOauthClientKey ||
            current ||
            body.defaultOauthClientKey ||
            clients.find((client) => client.isDefault)?.key ||
            clients[0]?.key ||
            "";
          return clients.some((client) => client.key === preferred) ? preferred : clients[0]?.key ?? "";
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setOauthClients([]);
        setOauthClientsLoaded(true);
        setStatusTone("error");
        setStatusMessage(error instanceof Error ? error.message : "Не удалось загрузить Google OAuth projects.");
      });
    return () => controller.abort();
  }, [canManageYouTube, channelId, integrationOauthClientKey]);

  const setBusy = (action: typeof busyAction, message: string) => {
    setBusyAction(action);
    setStatusTone("saving");
    setStatusMessage(message);
  };

  const finishSuccess = (message: string) => {
    setBusyAction("");
    setStatusTone("success");
    setStatusMessage(message);
  };

  const finishError = (error: unknown, fallback: string) => {
    setBusyAction("");
    setStatusTone("error");
    setStatusMessage(error instanceof Error ? error.message || fallback : fallback);
  };

  if (!channel) {
    return <p className="subtle-text">Выберите канал, чтобы настроить публикацию.</p>;
  }

  return (
    <div className="field-stack">
      <section className="details-section publishing-manager-section">
        <h3>YouTube</h3>
        <p className="subtle-text">
          Публикация работает только через OAuth 2.0 с сохранением refresh token на сервере.
        </p>
        <div className="publishing-manager-status-grid">
          <div className="publishing-manager-status-card">
            <strong>Статус</strong>
            <span className={`meta-pill ${integration?.status === "connected" ? "ok" : integration?.status === "reauth_required" ? "warn" : ""}`}>
              {integration?.status === "connected"
                ? "Подключено"
                : integration?.status === "pending_selection"
                  ? "Нужно выбрать канал"
                  : integration?.status === "reauth_required"
                    ? "Нужно переподключение"
                    : integration?.status === "error"
                      ? "Ошибка"
                      : "Не подключено"}
            </span>
            <span className="subtle-text">
              {integration?.selectedGoogleAccountEmail ?? "Google account ещё не подключён."}
            </span>
          </div>
          <div className="publishing-manager-status-card">
            <strong>Канал назначения</strong>
            <span>{integration?.selectedYoutubeChannelTitle ?? "Не выбран"}</span>
            <span className="subtle-text">
              {integration?.selectedYoutubeChannelCustomUrl ?? integration?.selectedYoutubeChannelId ?? "Ожидает выбора"}
            </span>
          </div>
          <div className="publishing-manager-status-card">
            <strong>Google project</strong>
            <span>{integration?.youtubeOAuthClientLabel ?? selectedOauthClient?.label ?? "Не выбран"}</span>
            <span className="subtle-text">
              {integration?.youtubeOAuthProjectNumber ?? selectedOauthClient?.projectNumber ?? "Project number не указан"}
            </span>
          </div>
        </div>

        {canManageYouTube && oauthClients.length ? (
          <label className="field-stack">
            <span className="field-label">Google project для подключения</span>
            <select
              className="text-input"
              value={selectedOauthClientKey}
              disabled={!canManageYouTube || busyAction === "connect"}
              onChange={(event) => setSelectedOauthClientKey(event.target.value)}
            >
              {oauthClients.map((client) => (
                <option key={client.key} value={client.key}>
                  {client.label}
                  {client.projectNumber ? ` (${client.projectNumber})` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : canManageYouTube && oauthClientsLoaded ? (
          <p className="danger-text subtle-text">
            Google OAuth project не настроен на сервере.
          </p>
        ) : null}

        <div className="control-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              !canManageYouTube ||
              busyAction === "connect" ||
              !selectedOauthClientKey ||
              !oauthClientsLoaded ||
              oauthClients.length === 0
            }
            onClick={() => {
              setBusy("connect", "Открываем Google OAuth…");
              void onConnectYouTube(channel.id, selectedOauthClientKey)
                .then(() => finishSuccess("YouTube успешно подключён."))
                .catch((error) => finishError(error, "Не удалось подключить YouTube."));
            }}
          >
            {integration ? "Переподключить YouTube" : "Подключить YouTube"}
          </button>
          {integration ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canManageYouTube || busyAction === "disconnect"}
              onClick={() => {
                if (!window.confirm("Отключить YouTube интеграцию для этого канала?")) {
                  return;
                }
                setBusy("disconnect", "Отключаем YouTube…");
                void onDisconnectYouTube(channel.id)
                  .then(() => finishSuccess("Интеграция отключена."))
                  .catch((error) => finishError(error, "Не удалось отключить интеграцию."));
              }}
            >
              Отключить
            </button>
          ) : null}
        </div>

        {integration?.availableChannels.length ? (
          <div className="field-stack">
            <label className="field-label">Канал, куда публикуем</label>
            <div className="control-actions publishing-manager-selection-row">
              <select
                className="text-input"
                value={selectedChannelId}
                disabled={!canManageYouTube || busyAction === "select"}
                onChange={(event) => setSelectedChannelId(event.target.value)}
              >
                <option value="">Выберите канал</option>
                {integration.availableChannels.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                    {option.customUrl ? ` (${option.customUrl})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canManageYouTube || !selectedChannelId || (!selectionRequired && selectedChannelId === integration.selectedYoutubeChannelId) || busyAction === "select"}
                onClick={() => {
                  setBusy("select", "Сохраняем канал назначения…");
                  void onSelectYouTubeDestination(channel.id, selectedChannelId)
                    .then(() => finishSuccess("Канал назначения сохранён."))
                    .catch((error) => finishError(error, "Не удалось выбрать канал назначения."));
                }}
              >
                Сохранить канал
              </button>
            </div>
          </div>
        ) : null}

        {integration?.lastError ? <p className="danger-text subtle-text">{integration.lastError}</p> : null}
      </section>

      <section className="details-section publishing-manager-section">
        <h3>Слоты публикации</h3>
        <p className="subtle-text">
          Автопостановка в publish queue включается только после подключения YouTube и выбора канала назначения.
          После этого успешный render попадёт в ближайший свободный слот, а конкретную публикацию можно будет
          перевести на точную дату и время прямо в planner.
        </p>
        <div className="compact-grid publishing-manager-grid">
          <label className="field-stack">
            <span className="field-label">Таймзона</span>
            <input
              className="text-input"
              value={settingsDraft.timezone}
              disabled={!canEditSetup}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  timezone: event.target.value
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span className="field-label">Первый слот</span>
            <input
              className="text-input"
              type="time"
              value={settingsDraft.firstSlotLocalTime}
              disabled={!canEditSetup}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  firstSlotLocalTime: event.target.value
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span className="field-label">Слотов в день</span>
            <input
              className="text-input"
              type="number"
              min={1}
              max={12}
              value={settingsDraft.dailySlotCount}
              disabled={!canEditSetup}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  dailySlotCount: Number.parseInt(event.target.value || "4", 10)
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span className="field-label">Интервал, мин</span>
            <input
              className="text-input"
              type="number"
              min={5}
              max={180}
              step={5}
              value={settingsDraft.slotIntervalMinutes}
              disabled={!canEditSetup}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  slotIntervalMinutes: Number.parseInt(event.target.value || "15", 10)
                }))
              }
            />
          </label>
          <label className="field-stack">
            <span className="field-label">Окно до upload, мин</span>
            <input
              className="text-input"
              type="number"
              min={15}
              max={720}
              step={15}
              value={settingsDraft.uploadLeadMinutes}
              disabled={!canEditSetup}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  uploadLeadMinutes: Number.parseInt(event.target.value || "120", 10)
                }))
              }
            />
          </label>
          <label className="field-label fragment-toggle publishing-manager-toggle">
            <input
              type="checkbox"
              checked={settingsDraft.autoQueueEnabled}
              disabled={!canEditSetup}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  autoQueueEnabled: event.target.checked
                }))
              }
            />
            <span>По умолчанию включать чекбокс «Опубликовать» для новых рендеров</span>
          </label>
        </div>

        <div className="publishing-slot-preview">
          {slotPreview.map((slot) => (
            <span key={slot} className="meta-pill">
              {slot}
            </span>
          ))}
        </div>

        <label className="field-label fragment-toggle publishing-manager-toggle">
          <input
            type="checkbox"
            checked={settingsDraft.notifySubscribersByDefault}
            disabled={!canEditSetup}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                notifySubscribersByDefault: event.target.checked
              }))
            }
          />
          <span>По умолчанию публиковать в фид подписок и уведомлять подписчиков</span>
        </label>
        <p className="subtle-text">
          Это значение наследуют новые ролики при постановке в очередь. Для конкретной публикации
          его можно переопределить отдельно в planner.
        </p>

        <div className="control-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canEditSetup || busyAction === "save"}
            onClick={() => {
              setBusy("save", "Сохраняем слот-шаблон…");
              void onSaveSettings(channel.id, settingsDraft)
                .then(() => finishSuccess("Настройки публикации сохранены."))
                .catch((error) => finishError(error, "Не удалось сохранить настройки публикации."));
            }}
          >
            Сохранить настройки
          </button>
        </div>

        <ul className="publishing-constraints-list subtle-text">
          <li>API key недостаточен для загрузки видео в YouTube.</li>
          <li>Service accounts YouTube не поддерживает для публикации от лица канала.</li>
          <li>Неподтверждённый Google project может ограничивать режим публикации значением private.</li>
        </ul>

        {statusMessage ? (
          <p className={`subtle-text ${statusTone === "error" ? "danger-text" : ""}`}>{statusMessage}</p>
        ) : null}
      </section>
    </div>
  );
}
