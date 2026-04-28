"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthMeResponse } from "../../components/types";
import {
  buildAdminFlowMcpHint,
  getAdminFlowDisplayTitle,
  getAdminFlowUrlDisplay
} from "./view-model";

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
  lastActivityAt: string;
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
  createdToday: number;
  updatedToday: number;
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
  stage3Jobs: unknown[];
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

type TabId = "summary" | "inputs" | "prompts" | "outputs" | "stage3" | "publication" | "raw";

const EMPTY_METRICS: FlowMetrics = {
  total: 0,
  today: 0,
  createdToday: 0,
  updatedToday: 0,
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

function toLocalDateBoundary(value: string, edge: "start" | "end"): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return value;
  }
  const date =
    edge === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  return date.toISOString();
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [dateBasis, setDateBasis] = useState<"created" | "lastActivity">("created");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [busy, setBusy] = useState(false);

  const hasActiveFilters = Boolean(
    search.trim() || stage || status || channelId || provider || model || fromDate || toDate || dateBasis !== "created"
  );

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

  const providerOptions = useMemo(() => {
    return [...new Set(flows.map((flow) => flow.provider).filter((value): value is string => Boolean(value)))].sort();
  }, [flows]);

  const modelOptions = useMemo(() => {
    return [...new Set(flows.map((flow) => flow.model).filter((value): value is string => Boolean(value)))].sort();
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
    if (provider) params.set("provider", provider);
    if (model) params.set("model", model);
    if (dateBasis) params.set("dateBasis", dateBasis);
    if (fromDate) params.set("from", toLocalDateBoundary(fromDate, "start"));
    if (toDate) params.set("to", toLocalDateBoundary(toDate, "end"));
    const today = new Date();
    params.set("todayFrom", new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0).toISOString());
    params.set("todayTo", new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString());
    params.set("limit", "120");
    const response = await fetch(`/api/admin/flows?${params.toString()}`);
    const body = (await response.json().catch(() => null)) as FlowListResponse | null;
    if (!response.ok) {
      throw new Error(body?.error ?? "Не удалось загрузить журнал процессов.");
    }
    setFlows(body?.flows ?? []);
    setMetrics(body?.metrics ?? EMPTY_METRICS);
    setAuditEvents(body?.auditEvents ?? []);
  }, [channelId, dateBasis, fromDate, model, provider, search, stage, status, toDate]);

  const loadTokens = useCallback(async () => {
    const response = await fetch("/api/admin/mcp-tokens");
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as { tokens?: McpToken[] };
    setTokens(body.tokens ?? []);
  }, []);

  const resetFilters = (): void => {
    setSearch("");
    setStage("");
    setStatus("");
    setChannelId("");
    setProvider("");
    setModel("");
    setDateBasis("created");
    setFromDate("");
    setToDate("");
  };

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

  const openFlow = useCallback(async (chatId: string): Promise<void> => {
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
      setDetail(body ? { ...body, stage3Jobs: body.stage3Jobs ?? [] } : null);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось загрузить детали процесса.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (auth?.membership.role !== "owner") {
      return;
    }
    if (flows.length === 0) {
      setSelectedChatId(null);
      setDetail(null);
      return;
    }
    if (selectedChatId && flows.some((flow) => flow.chatId === selectedChatId)) {
      return;
    }
    void openFlow(flows[0].chatId);
  }, [auth?.membership.role, flows, openFlow, selectedChatId]);

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
    await navigator.clipboard.writeText(buildAdminFlowMcpHint(flow.chatId));
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
          stage3: getTraceSection(trace, ["stage3"]),
          stage3Jobs: detail?.stage3Jobs ?? []
        });
      case "stage3":
        return stringifyPreview({
          flow: detail?.flow ?? null,
          jobs: detail?.stage3Jobs ?? [],
          auditEvents: detail?.auditEvents.filter((event) => event.stage === "stage3") ?? [],
          trace: getTraceSection(trace, ["stage3"])
        });
      case "publication":
        return stringifyPreview({
          flow: detail?.flow ?? null,
          auditEvents: detail?.auditEvents.filter((event) => event.stage === "publishing" || event.stage === "youtube") ?? []
        });
      case "raw":
        return stringifyPreview(detail ?? null);
      default:
        return stringifyPreview(detail?.flow ?? null);
    }
  };

  const detailDisplayTitle = detail ? getAdminFlowDisplayTitle(detail.flow) : null;
  const detailSourceDisplay = detail ? getAdminFlowUrlDisplay(detail.flow.sourceUrl) : null;

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
          ["Создано сегодня", metrics.createdToday ?? metrics.today],
          ["Обновлено сегодня", metrics.updatedToday],
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
        <section className="admin-flows-controls" aria-label="Фильтры журнала процессов">
          <div className="admin-flows-controls-head">
            <div>
              <h2>Фильтры</h2>
              <p>{flows.length} процессов в текущей выборке</p>
            </div>
            <button className="btn btn-ghost" type="button" onClick={resetFilters} disabled={!hasActiveFilters}>
              Сбросить
            </button>
          </div>
          <div className="admin-flows-filters">
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
              Дата
              <select className="text-input" value={dateBasis} onChange={(event) => setDateBasis(event.target.value as "created" | "lastActivity")}>
                <option value="created">Создан</option>
                <option value="lastActivity">Последнее событие</option>
              </select>
            </label>
            <label>
              От
              <input className="text-input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label>
              До
              <input className="text-input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
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
            <label>
              Provider
              <select className="text-input" value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="">Все</option>
                {providerOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select className="text-input" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="">Все</option>
                {modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section className="admin-flows-mcp">
            <div>
              <h2>MCP-доступ</h2>
              <p>Доступ только на чтение к trace для внешних аудитов.</p>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => void createToken()} disabled={busy}>
              Новый token
            </button>
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
        </section>

        <section className="admin-flows-content">
          <section className="admin-flows-list" aria-label="Процессы">
            <div className="admin-flows-list-head">
              <div>
                <h2>Процессы</h2>
                <p>Клик по названию открывает trace, источник и публикацию справа.</p>
              </div>
              <span>{metrics.total} всего</span>
            </div>
            <div className="admin-flow-card-list">
              {flows.map((flow) => {
                const displayTitle = getAdminFlowDisplayTitle(flow);
                const sourceDisplay = getAdminFlowUrlDisplay(flow.sourceUrl);
                return (
                  <article key={flow.chatId} className={`admin-flow-card ${selectedChatId === flow.chatId ? "active" : ""}`}>
                    <div className="admin-flow-card-head">
                      <div className="admin-flow-main">
                        <span className="admin-flow-channel" title={flow.channelName}>
                          {flow.channelName} · @{flow.channelUsername}
                        </span>
                        <button
                          className="admin-flow-title-button"
                          type="button"
                          title={flow.title}
                          onClick={() => void openFlow(flow.chatId)}
                        >
                          {displayTitle}
                        </button>
                        <div className="admin-flow-source">
                          <span>Источник</span>
                          {sourceDisplay.href ? (
                            <a href={sourceDisplay.href} target="_blank" rel="noreferrer" title={sourceDisplay.original}>
                              <strong>{sourceDisplay.host}</strong>
                              {sourceDisplay.path ? <small>{sourceDisplay.path}</small> : null}
                            </a>
                          ) : (
                            <strong title={sourceDisplay.original}>{sourceDisplay.label}</strong>
                          )}
                        </div>
                      </div>
                      <div className="admin-flow-card-actions">
                        <button className="btn btn-secondary" type="button" onClick={() => void openFlow(flow.chatId)} disabled={busy}>
                          Детали
                        </button>
                        <button className="btn btn-ghost" type="button" onClick={() => void downloadTrace(flow.chatId)} disabled={busy}>
                          Trace
                        </button>
                        <button className="btn btn-ghost" type="button" onClick={() => void copyMcpHint(flow)}>
                          MCP
                        </button>
                      </div>
                    </div>
                    <dl className="admin-flow-meta-grid">
                      <div>
                        <dt>Stage</dt>
                        <dd>
                          <span className={`admin-status-pill tone-${flow.latestStatus}`}>
                            {STAGE_LABELS[flow.latestStage]} · {STATUS_LABELS[flow.latestStatus]}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Provider</dt>
                        <dd title={[flow.provider, flow.model].filter(Boolean).join(" · ")}>
                          <strong>{flow.provider ?? "—"}</strong>
                          {flow.model ? <small>{flow.model}</small> : null}
                        </dd>
                      </div>
                      <div>
                        <dt>Создан</dt>
                        <dd>{formatDate(flow.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Последнее событие</dt>
                        <dd>{formatDate(flow.lastActivityAt ?? flow.updatedAt)}</dd>
                      </div>
                    </dl>
                    {flow.lastError ? (
                      <p className="admin-flow-card-error" title={flow.lastError}>
                        {flow.lastError}
                      </p>
                    ) : null}
                  </article>
                );
              })}
              {flows.length === 0 ? (
                <div className="admin-flows-empty">
                  <h3>Процессы не найдены</h3>
                  <p>Измените поиск или сбросьте фильтры.</p>
                </div>
              ) : null}
            </div>
          </section>

        <aside className="admin-flows-detail">
          {detail ? (
            <>
              <div className="admin-flows-detail-head">
                <div>
                  <h2 title={detail.flow.title}>{detailDisplayTitle}</h2>
                  <p>{detail.flow.channelName} · @{detail.flow.channelUsername}</p>
                  {detailSourceDisplay ? (
                    <a className="admin-flows-detail-source" href={detailSourceDisplay.href ?? undefined} target="_blank" rel="noreferrer" title={detailSourceDisplay.original}>
                      {detailSourceDisplay.label}
                    </a>
                  ) : null}
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => void downloadTrace(detail.flow.chatId)}>
                  Trace JSON
                </button>
              </div>
              <dl className="admin-flows-detail-facts">
                <div>
                  <dt>Chat</dt>
                  <dd>{detail.flow.chatId}</dd>
                </div>
                <div>
                  <dt>Stage 2</dt>
                  <dd>{detail.flow.stage2RunId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Stage 3</dt>
                  <dd>{detail.flow.stage3JobId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Publication</dt>
                  <dd>{detail.flow.publicationId ?? "—"}</dd>
                </div>
              </dl>
              <ol className="admin-flow-timeline">
                {detail.auditEvents.slice(0, 18).map((event) => (
                  <li key={event.id} className={`tone-${event.severity}`}>
                    <span>{formatDate(event.createdAt)}</span>
                    <strong>{event.action}</strong>
                    <small>{event.stage ?? "system"} · {event.status ?? "event"}</small>
                  </li>
                ))}
              </ol>
              {detail.stage3Jobs.length > 0 ? (
                <div className="admin-flow-stage3-ledger">
                  {detail.stage3Jobs.slice(0, 6).map((rawJob) => {
                    const job = asRecord(rawJob);
                    const id = String(job.id ?? "");
                    const status = String(job.status ?? "new");
                    const kind = String(job.kind ?? "stage3");
                    const errorMessage = typeof job.errorMessage === "string" ? job.errorMessage : "";
                    const errorCode = typeof job.errorCode === "string" ? job.errorCode : "";
                    return (
                      <article key={id || `${kind}-${String(job.createdAt ?? "")}`} className={`tone-${status === "failed" || status === "interrupted" ? "error" : "info"}`}>
                        <span>{formatDate(String(job.updatedAt ?? job.createdAt ?? ""))}</span>
                        <strong>{kind} · {status}</strong>
                        <small>{errorCode || String(job.executionTarget ?? "")}</small>
                        {errorMessage ? <p>{errorMessage}</p> : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}
              <div className="admin-flows-tabs">
                {[
                  ["summary", "Summary"],
                  ["inputs", "Inputs"],
                  ["prompts", "Prompts"],
                  ["outputs", "Outputs"],
                  ["stage3", "Stage 3"],
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
