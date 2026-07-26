"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type YoutubeOption = { id: string; title: string; customUrl: string | null };
type ConnectorChannel = {
  id: string;
  name: string;
  username: string;
  integration: null | {
    status: "disconnected" | "pending_selection" | "connected" | "reauth_required" | "error";
    selectedGoogleAccountEmail: string | null;
    selectedYoutubeChannelId: string | null;
    selectedYoutubeChannelTitle: string | null;
    selectedYoutubeChannelCustomUrl: string | null;
    availableChannels: YoutubeOption[];
    updatedAt: string;
    lastError: string | null;
  };
};

type PortalPayload = {
  user: { displayName: string; email: string };
  channels: ConnectorChannel[];
  error?: string;
};

export default function ConnectorPortalPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/connect/channels", { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/connect/login");
      return;
    }
    const body = (await response.json().catch(() => null)) as PortalPayload | null;
    if (!response.ok || !body) {
      throw new Error(body?.error ?? "Не удалось загрузить назначенные каналы.");
    }
    setPayload(body);
  }, [router]);

  useEffect(() => {
    void load().catch((error) => {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить портал.");
    });
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean; error?: string } | null;
      if (data?.type !== "youtube-oauth-result") return;
      if (!data.ok) {
        setStatusError(true);
        setStatus(data.error || "Google не завершил подключение.");
        return;
      }
      setStatusError(false);
      setStatus("Google-аккаунт подключён.");
      void load();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  const connect = async (channelId: string) => {
    setBusyChannelId(channelId);
    setStatusError(false);
    setStatus("");
    try {
      const response = await fetch(`/api/connect/channels/${channelId}/youtube/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "Не удалось начать подключение Google.");
      }
      const popup = window.open(body.url, "youtube-oauth", "popup,width=620,height=760");
      if (!popup) {
        throw new Error("Разрешите всплывающие окна и повторите подключение.");
      }
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось начать подключение.");
    } finally {
      setBusyChannelId(null);
    }
  };

  const selectYoutubeChannel = async (channelId: string, selectedYoutubeChannelId: string) => {
    if (!selectedYoutubeChannelId) return;
    setBusyChannelId(channelId);
    setStatusError(false);
    setStatus("");
    try {
      const response = await fetch(`/api/connect/channels/${channelId}/youtube/connection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedYoutubeChannelId })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось выбрать YouTube-канал.");
      }
      setStatus("YouTube-канал выбран. Подключение завершено.");
      await load();
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось выбрать канал.");
    } finally {
      setBusyChannelId(null);
    }
  };

  const logout = async () => {
    await fetch("/api/connect/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/connect/login");
    router.refresh();
  };

  return (
    <main className="auth-page">
      <section className="auth-card" style={{ width: "min(760px, 100%)" }}>
        <div className="control-actions">
          <div>
            <h1>Подключение каналов</h1>
            <p className="subtle-text">
              {payload ? `${payload.user.displayName} · ${payload.user.email}` : "Загрузка..."}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Выйти
          </button>
        </div>

        <p className="subtle-text">
          Здесь доступны только каналы, назначенные администратором. Доступа к рабочему приложению нет.
        </p>

        <div className="field-stack">
          {payload?.channels.map((channel) => {
            const integration = channel.integration;
            const connected = integration?.status === "connected";
            return (
              <section key={channel.id} className="details-section">
                <h3>{channel.name}</h3>
                <p className="subtle-text">@{channel.username}</p>
                {connected ? (
                  <p className="status-line ok">
                    Подключён: {integration.selectedYoutubeChannelTitle || "YouTube"}
                  </p>
                ) : null}
                {integration?.status === "pending_selection" ? (
                  <label className="field-stack">
                    <span className="field-label">Выберите YouTube-канал</span>
                    <select
                      className="text-input"
                      defaultValue=""
                      disabled={busyChannelId === channel.id}
                      onChange={(event) =>
                        void selectYoutubeChannel(channel.id, event.target.value)
                      }
                    >
                      <option value="" disabled>Выберите канал</option>
                      {integration.availableChannels.map((option) => (
                        <option key={option.id} value={option.id}>{option.title}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyChannelId === channel.id}
                    onClick={() => void connect(channel.id)}
                  >
                    {busyChannelId === channel.id
                      ? "Открываем Google..."
                      : connected
                        ? "Переподключить Google"
                        : "Подключить Google"}
                  </button>
                )}
                {integration?.lastError ? (
                  <p className="status-line error">{integration.lastError}</p>
                ) : null}
              </section>
            );
          })}
          {payload && payload.channels.length === 0 ? (
            <p className="subtle-text">Администратор пока не назначил вам канал.</p>
          ) : null}
        </div>
        {status ? <p className={`status-line ${statusError ? "error" : "ok"}`}>{status}</p> : null}
      </section>
    </main>
  );
}
