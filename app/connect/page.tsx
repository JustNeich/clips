"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type YoutubeOption = {
  id: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
};

type ConnectorChannel = {
  id: string;
  name: string;
  username: string;
  onboardingStatus: "draft" | "needs_identity" | "ready";
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
  const [creating, setCreating] = useState(false);
  const [identityName, setIdentityName] = useState<Record<string, string>>({});
  const [identityUsername, setIdentityUsername] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/connect/channels", { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/connect/login");
      return;
    }
    const body = (await response.json().catch(() => null)) as PortalPayload | null;
    if (!response.ok || !body) {
      throw new Error(body?.error ?? "Не удалось загрузить созданные каналы.");
    }
    setPayload(body);
    setIdentityName((current) => {
      const next = { ...current };
      for (const channel of body.channels) next[channel.id] ??= channel.name;
      return next;
    });
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

  const createChannel = async () => {
    setCreating(true);
    setStatus("");
    setStatusError(false);
    try {
      const response = await fetch("/api/connect/channels", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        created?: boolean;
        channel?: { id?: string };
        error?: string;
      } | null;
      if (!response.ok || !body?.channel?.id) {
        throw new Error(body?.error ?? "Не удалось создать канал.");
      }
      setStatus(body.created ? "Черновик создан. Подключите к нему Google." : "Открыт уже созданный черновик.");
      await load();
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось создать канал.");
    } finally {
      setCreating(false);
    }
  };

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
      setStatus("YouTube-канал выбран.");
      await load();
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось выбрать канал.");
    } finally {
      setBusyChannelId(null);
    }
  };

  const saveIdentity = async (event: FormEvent<HTMLFormElement>, channelId: string) => {
    event.preventDefault();
    setBusyChannelId(channelId);
    setStatusError(false);
    setStatus("");
    try {
      const response = await fetch(`/api/connect/channels/${channelId}/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: identityName[channelId] ?? "",
          username: identityUsername[channelId] ?? ""
        })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Не удалось сохранить название.");
      setStatus("Данные канала сохранены. Подключение завершено.");
      await load();
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить данные канала.");
    } finally {
      setBusyChannelId(null);
    }
  };

  const deleteDraft = async (channelId: string) => {
    setBusyChannelId(channelId);
    setStatusError(false);
    setStatus("");
    try {
      const response = await fetch(`/api/connect/channels/${channelId}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Не удалось удалить черновик.");
      setStatus("Пустой черновик удалён.");
      await load();
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : "Не удалось удалить черновик.");
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
          Здесь видны только каналы, созданные вами. Доступа к рабочему приложению Clips нет.
        </p>
        <p className="status-line">
          В окне Google выберите отдельную строку нужного YouTube-канала или бизнес-аккаунта, а не
          только строку с почтой. Если нужного канала нет в списке Google, не продолжайте подключение.
        </p>

        <button
          type="button"
          className="btn btn-primary"
          disabled={creating}
          onClick={() => void createChannel()}
        >
          {creating ? "Создаём..." : "Создать канал"}
        </button>

        <div className="field-stack">
          {payload?.channels.map((channel) => {
            const integration = channel.integration;
            const connected = integration?.status === "connected";
            const confirmedHandle = integration?.selectedYoutubeChannelCustomUrl?.startsWith("@")
              ? integration.selectedYoutubeChannelCustomUrl
              : null;
            return (
              <section key={channel.id} className="details-section">
                <h3>{channel.name}</h3>
                {confirmedHandle ? <p className="subtle-text">{confirmedHandle}</p> : null}
                {channel.onboardingStatus === "ready" && connected ? (
                  <p className="status-line ok">
                    Подключён: {integration.selectedYoutubeChannelTitle || channel.name}
                  </p>
                ) : null}

                {integration?.status === "pending_selection" ? (
                  <label className="field-stack">
                    <span className="field-label">Выберите YouTube-канал</span>
                    <select
                      className="text-input"
                      defaultValue=""
                      disabled={busyChannelId === channel.id}
                      onChange={(event) => void selectYoutubeChannel(channel.id, event.target.value)}
                    >
                      <option value="" disabled>Выберите канал</option>
                      {integration.availableChannels.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.title || option.customUrl || option.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {channel.onboardingStatus === "needs_identity" && connected ? (
                  <form className="field-stack" onSubmit={(event) => void saveIdentity(event, channel.id)}>
                    <p className="status-line error">
                      YouTube не вернул название. Укажите его вручную.
                    </p>
                    <input
                      className="text-input"
                      type="text"
                      required
                      placeholder="Название канала"
                      value={identityName[channel.id] ?? ""}
                      onChange={(event) =>
                        setIdentityName((current) => ({ ...current, [channel.id]: event.target.value }))
                      }
                    />
                    <input
                      className="text-input"
                      type="text"
                      placeholder="YouTube handle — необязательно"
                      value={identityUsername[channel.id] ?? ""}
                      onChange={(event) =>
                        setIdentityUsername((current) => ({ ...current, [channel.id]: event.target.value }))
                      }
                    />
                    <button className="btn btn-primary" disabled={busyChannelId === channel.id}>
                      Сохранить
                    </button>
                  </form>
                ) : null}

                {integration?.status !== "pending_selection" && channel.onboardingStatus !== "needs_identity" ? (
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
                ) : null}

                {channel.onboardingStatus === "draft" && !integration?.selectedYoutubeChannelId ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busyChannelId === channel.id}
                    onClick={() => void deleteDraft(channel.id)}
                  >
                    Удалить пустой канал
                  </button>
                ) : null}
                {integration?.lastError ? (
                  <p className="status-line error">{integration.lastError}</p>
                ) : null}
              </section>
            );
          })}
          {payload && payload.channels.length === 0 ? (
            <p className="subtle-text">Пока нет каналов. Нажмите «Создать канал».</p>
          ) : null}
        </div>
        {status ? <p className={`status-line ${statusError ? "error" : "ok"}`}>{status}</p> : null}
      </section>
    </main>
  );
}
