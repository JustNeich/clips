"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthMeResponse } from "../../components/types";

type FlowSummary = {
  chatId: string;
  channelId: string;
  channelName: string;
  channelUsername: string;
  title: string;
  sourceUrl: string;
  latestStage: "source" | "stage2" | "stage3" | "publishing" | "new";
  latestStatus:
    | "new"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "scheduled"
    | "published"
    | "paused"
    | "canceled";
  provider: string | null;
  model: string | null;
  updatedAt: string;
  createdAt: string;
  sourceJobId: string | null;
  stage2RunId: string | null;
  stage3JobId: string | null;
  publicationId: string | null;
  youtubeVideoUrl: string | null;
  lastError: string | null;
};

type FlowMetrics = {
  total: number;
  today: number;
  running: number;
  failed: number;
  scheduled: number;
  published: number;
  deleted: number;
};

type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  channelId: string | null;
  chatId: string | null;
  stage: string | null;
  status: string | null;
  severity: "info" | "warn" | "error";
  payload: Record<string, unknown> | null;
  createdAt: string;
};

type FlowListResponse = {
  flows: FlowSummary[];
  metrics: FlowMetrics;
  auditEvents: AuditEvent[];
  error?: string;
};

type FlowDetailResponse = {
  flow: FlowSummary;
  auditEvents: AuditEvent[];
  trace: unknown;
  error?: string;
};

type McpToken = {
  id: string;
  tokenHint: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type TabId = "summary" | "inputs" | "prompts" | "outputs" | "publication" | "raw";

const EMPTY_METRICS: FlowMetrics = {
  total: 0,
  today: 0,
  running: 0,
  failed: 0,
  scheduled: 0,
  published: 0,
  deleted: 0
};

const STAGE_LABELS: Record<FlowSummary["latestStage"], string> = {
  new: "Новый",
  source: "Source",
  stage2: "Stage 2",
  stage3: "Stage 3",
  publishing: "Publishing"
};

const STATUS_LABELS: Record<FlowSummary["latestStatus"], string> = {
  new: "Новый",
  queued: "Ожидает",
  running: "В работе",
  completed: "Готово",
  failed: "Ошибка",
  scheduled: "Запланировано",
  published: "Опубликовано",
  paused: "Пауза",
  canceled: "Удалено"
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function stringifyPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "string") {
    return value || "—";
  }
  return JSON.stringify(value, null, 2);
}

function getTraceSection(trace: unknown, path: string[]): unknown {
  let current = trace;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parseDownloadFileName(response: Response): string | null {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/i);
  return match?.[1] ?? null;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AdminFlowsPage() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [metrics, setMetrics] = useState<FlowMetrics>(EMPTY_METRICS);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowDetailResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [channelId, setChannelId] = useState("");
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [busy, setBusy] = useState(false);

  const channelOptions = useMemo(() => {
    const unique = new Map<string, { id: string; label: string }>();
    flows.forEach((flow) => {
      unique.set(flow.channelId, {
        id: flow.channelId,
        label: `${flow.channelName} · @${flow.channelUsername}`
      });
    });
    return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [flows]);

  const loadAuth = useCallback(async () => {
    const response = await fetch("/api/auth/me");
    const body = (await response.json()) as AuthMeResponse;
    setAuth(body);
    return body;
  }, []);

  const loadFlows = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (stage) params.set("stage", stage);
    if (status) params.set("status", status);
    if (channelId) params.set("channelId", channelId);
    params.set("limit", "120");
    const response = await fetch(`/api/admin/flows?${params.toString()}`);
    const body = (await response.json().catch(() => null)) as FlowListResponse | null;
    if (!response.ok) {
      throw new Error(body?.error ?? "Не удалось загрузить журнал процессов.");
    }
    setFlows(body?.flows ?? []);
    setMetrics(body?.metrics ?? EMPTY_METRICS);
    setAuditEvents(body?.auditEvents ?? []);
  }, [channelId, search, stage, status]);

  const loadTokens = useCallback(async () => {
    const response = await fetch("/api/admin/mcp-tokens");
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as { tokens?: McpToken[] };
    setTokens(body.tokens ?? []);
  }, []);

  useEffect(() => {
    void loadAuth()
      .then((body) => {
        if (body.membership.role === "owner") {
          return Promise.all([loadFlows(), loadTokens()]);
        }
        return null;
      })
      .catch((error) => {
        setStatusText(error instanceof Error ? error.message : "Не удалось открыть журнал процессов.");
      });
  }, [loadAuth, loadFlows, loadTokens]);

  useEffect(() => {
    if (auth?.membership.role !== "owner") {
      return;
    }
    const handle = window.setTimeout(() => {
      void loadFlows().catch((error) => {
        setStatusText(error instanceof Error ? error.message : "Не удалось обновить журнал.");
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [auth?.membership.role, loadFlows]);

  const openFlow = async (chatId: string): Promise<void> => {
    setSelectedChatId(chatId);
    setActiveTab("summary");
    setBusy(true);
    setStatusText("");
    try {
      const response = await fetch(`/api/admin/flows/${encodeURIComponent(chatId)}`);
      const body = (await response.json().catch(() => null)) as FlowDetailResponse | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось загрузить детали процесса.");
      }
      setDetail(body);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось загрузить детали процесса.");
    } finally {
      setBusy(false);
    }
  };

  const createToken = async (): Promise<void> => {
    setBusy(true);
    setCreatedToken(null);
    setStatusText("");
    try {
      const response = await fetch("/api/admin/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 30 })
      });
      const body = (await response.json().catch(() => null)) as
        | { token?: string; record?: McpToken; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось создать MCP token.");
      }
      setCreatedToken(body?.token ?? null);
      await loadTokens();
      setStatusText("MCP token создан. Он показан только один раз.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось создать MCP token.");
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (tokenId: string): Promise<void> => {
    setBusy(true);
    try {
      await fetch(`/api/admin/mcp-tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
      await loadTokens();
      setStatusText("MCP token отозван.");
    } finally {
      setBusy(false);
    }
  };

  const downloadTrace = async (chatId: string): Promise<void> => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/flows/${encodeURIComponent(chatId)}/trace`);
      if (!response.ok) {
        throw new Error("Не удалось выгрузить trace.");
      }
      const blob = await response.blob();
      downloadBlob(blob, parseDownloadFileName(response) ?? `flow-trace-${chatId}.json`);
      setStatusText("Trace JSON выгружен.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось выгрузить trace.");
    } finally {
      setBusy(false);
    }
  };

  const copyMcpHint = async (flow: FlowSummary): Promise<void> => {
    await navigator.clipboard.writeText(
      `clips_get_flow({ "chatId": "${flow.chatId}" })`
    );
    setStatusText("MCP подсказка скопирована.");
  };

  const renderTab = (): string => {
    const trace = detail?.trace ?? null;
    switch (activeTab) {
      case "inputs":
        return stringifyPreview({
          source: getTraceSection(trace, ["source"]),
          comments: getTraceSection(trace, ["comments"]),
          causalInputs: getTraceSection(trace, ["stage2", "causalInputs"])
        });
      case "prompts":
        return stringifyPreview(getTraceSection(trace, ["stage2", "effectivePrompting"]));
      case "outputs":
        return stringifyPreview({
          stage2: getTraceSection(trace, ["stage2", "currentResult"]),
          stage3: getTraceSection(trace, ["stage3"])
        });
      case "publication":
        return stringifyPreview({
          flow: detail?.flow ?? null,
          auditEvents: detail?.auditEvents.filter((event) => event.stage === "publishing" || event.stage === "youtube") ?? []
        });
      case "raw":
        return stringifyPreview(trace);
      default:
        return stringifyPreview(detail?.flow ?? null);
    }
  };

  if (auth && auth.membership.role !== "owner") {
    return (
      <main className="admin-flows-page">
        <section className="admin-flows-forbidden">
          <h1>Журнал процессов</h1>
          <p className="status-line error">Доступ запрещён.</p>
          <Link href="/" className="btn btn-ghost">
            Назад в приложение
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-flows-page">
      <header className="admin-flows-header">
        <div>
          <p className="admin-flows-kicker">Owner observability</p>
          <h1>Журнал процессов</h1>
        </div>
        <div className="admin-flows-header-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void loadFlows()} disabled={busy}>
            Обновить
          </button>
          <Link href="/" className="btn btn-secondary">
            Назад
          </Link>
        </div>
      </header>

      <section className="admin-flows-metrics">
        {[
          ["Всего", metrics.total],
          ["Сегодня", metrics.today],
          ["В работе", metrics.running],
          ["Ошибки", metrics.failed],
          ["Запланировано", metrics.scheduled],
          ["Опубликовано", metrics.published],
          ["Удалено", metrics.deleted]
        ].map(([label, value]) => (
          <div key={String(label)} className="admin-flows-metric">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="admin-flows-shell">
        <aside className="admin-flows-filters">
          <label>
            Поиск
            <input
              className="text-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="URL, title, run id"
            />
          </label>
          <label>
            Канал
            <select className="text-input" value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">Все каналы</option>
              {channelOptions.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stage
            <select className="text-input" value={stage} onChange={(event) => setStage(event.target.value)}>
              <option value="">Все</option>
              <option value="source">Source</option>
              <option value="stage2">Stage 2</option>
              <option value="stage3">Stage 3</option>
              <option value="publishing">Publishing</option>
            </select>
          </label>
          <label>
            Статус
            <select className="text-input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Все</option>
              <option value="queued">Ожидает</option>
              <option value="running">В работе</option>
              <option value="completed">Готово</option>
              <option value="failed">Ошибка</option>
              <option value="scheduled">Запланировано</option>
              <option value="published">Опубликовано</option>
              <option value="canceled">Удалено</option>
            </select>
          </label>
          <section className="admin-flows-mcp">
            <div className="control-actions">
              <h2>MCP</h2>
              <button className="btn btn-primary" type="button" onClick={() => void createToken()} disabled={busy}>
                Новый token
              </button>
            </div>
            {createdToken ? <pre>{createdToken}</pre> : null}
            <ul>
              {tokens.slice(0, 4).map((token) => (
                <li key={token.id}>
                  <span>...{token.tokenHint}</span>
                  <small>{token.revokedAt ? "отозван" : `до ${formatDate(token.expiresAt)}`}</small>
                  {!token.revokedAt ? (
                    <button type="button" onClick={() => void revokeToken(token.id)} disabled={busy}>
                      Отозвать
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="admin-flows-table-wrap">
          <table className="admin-flows-table">
            <thead>
              <tr>
                <th>Канал / ролик</th>
                <th>Stage</th>
                <th>Provider</th>
                <th>Обновлён</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flows.map((flow) => (
                <tr key={flow.chatId} className={selectedChatId === flow.chatId ? "active" : ""}>
                  <td>
                    <strong>{flow.title}</strong>
                    <span>@{flow.channelUsername}</span>
                    <small>{flow.sourceUrl}</small>
                  </td>
                  <td>
                    <span className={`admin-status-pill tone-${flow.latestStatus}`}>
                      {STAGE_LABELS[flow.latestStage]} · {STATUS_LABELS[flow.latestStatus]}
                    </span>
                    {flow.lastError ? <small className="admin-flow-error">{flow.lastError}</small> : null}
                  </td>
                  <td>
                    <span>{flow.provider ?? "—"}</span>
                    <small>{flow.model ?? ""}</small>
                  </td>
                  <td>{formatDate(flow.updatedAt)}</td>
                  <td>
                    <div className="admin-flows-row-actions">
                      <button className="btn btn-ghost" type="button" onClick={() => void openFlow(flow.chatId)}>
                        Детали
                      </button>
                      <button className="btn btn-ghost" type="button" onClick={() => void copyMcpHint(flow)}>
                        MCP
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {flows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-flows-empty">
                    Процессы не найдены.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <aside className="admin-flows-detail">
          {detail ? (
            <>
              <div className="admin-flows-detail-head">
                <div>
                  <h2>{detail.flow.title}</h2>
                  <p>@{detail.flow.channelUsername}</p>
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => void downloadTrace(detail.flow.chatId)}>
                  Trace JSON
                </button>
              </div>
              <ol className="admin-flow-timeline">
                {detail.auditEvents.slice(0, 18).map((event) => (
                  <li key={event.id} className={`tone-${event.severity}`}>
                    <span>{formatDate(event.createdAt)}</span>
                    <strong>{event.action}</strong>
                    <small>{event.stage ?? "system"} · {event.status ?? "event"}</small>
                  </li>
                ))}
              </ol>
              <div className="admin-flows-tabs">
                {[
                  ["summary", "Summary"],
                  ["inputs", "Inputs"],
                  ["prompts", "Prompts"],
                  ["outputs", "Outputs"],
                  ["publication", "Publication"],
                  ["raw", "Raw JSON"]
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={activeTab === id ? "active" : ""}
                    type="button"
                    onClick={() => setActiveTab(id as TabId)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <pre className="admin-flows-json">{renderTab()}</pre>
            </>
          ) : (
            <div className="admin-flows-empty-detail">
              <h2>Выберите процесс</h2>
              <p>Детали, prompt trace и публикация откроются здесь.</p>
            </div>
          )}
        </aside>
      </section>

      <section className="admin-flows-audit">
        <h2>Последние события</h2>
        <div>
          {auditEvents.slice(0, 12).map((event) => (
            <article key={event.id} className={`tone-${event.severity}`}>
              <span>{formatDate(event.createdAt)}</span>
              <strong>{event.action}</strong>
              <small>{event.stage ?? "system"} · {event.status ?? "event"}</small>
            </article>
          ))}
        </div>
      </section>

      {statusText ? <p className="admin-flows-toast">{statusText}</p> : null}
    </main>
  );
}
