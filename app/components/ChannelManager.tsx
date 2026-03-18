"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Channel,
  ChannelAccessGrant,
  ChannelAsset,
  ChannelAssetKind,
  WorkspaceMemberRecord,
  UserRecord
} from "./types";
import { STAGE3_TEMPLATE_ID } from "../../lib/stage3-template";
import { listStage3DesignLabPresets } from "../../lib/stage3-design-lab";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  listStage2PromptConfigStages,
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_REASONING_EFFORT_OPTIONS,
  type Stage2PromptConfig,
  normalizeStage2PromptConfig
} from "../../lib/stage2-pipeline";
import {
  collectWorkspaceStage2Examples,
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  normalizeStage2ExamplesConfig,
  normalizeStage2HardConstraints,
  resolveStage2ExamplesCorpus,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../../lib/stage2-channel-config";

type ChannelManagerProps = {
  open: boolean;
  channels: Channel[];
  workspaceStage2ExamplesCorpusJson: string;
  activeChannelId: string | null;
  assets: ChannelAsset[];
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: () => void;
  onDeleteChannel: (channelId: string) => void;
  canCreateChannel: boolean;
  onSaveChannel: (
    channelId: string,
    patch: Partial<{
      name: string;
      username: string;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2PromptConfig: Stage2PromptConfig;
      templateId: string;
      avatarAssetId: string | null;
      defaultBackgroundAssetId: string | null;
      defaultMusicAssetId: string | null;
    }>
  ) => Promise<void>;
  onSaveWorkspaceStage2ExamplesCorpus: (value: string) => Promise<void>;
  onUploadAsset: (kind: ChannelAssetKind, file: File) => void;
  onDeleteAsset: (assetId: string) => void;
  canManageAccess: boolean;
  accessGrants: ChannelAccessGrant[];
  workspaceMembers: Array<{ user: UserRecord; role: WorkspaceMemberRecord["role"] }>;
  onUpdateAccess: (channelId: string, input: { grantUserIds: string[]; revokeUserIds: string[] }) => void;
};

type TabId = "brand" | "stage2" | "render" | "assets" | "access";
type AutosaveScope = "brand" | "stage2" | "render";
type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type AutosaveState = Record<
  AutosaveScope,
  {
    status: AutosaveStatus;
    message: string | null;
  }
>;

function listByKind(assets: ChannelAsset[], kind: ChannelAssetKind): ChannelAsset[] {
  return assets.filter((item) => item.kind === kind);
}

export function ChannelManager({
  open,
  channels,
  workspaceStage2ExamplesCorpusJson,
  activeChannelId,
  assets,
  onClose,
  onSelectChannel,
  onCreateChannel,
  onDeleteChannel,
  canCreateChannel,
  onSaveChannel,
  onSaveWorkspaceStage2ExamplesCorpus,
  onUploadAsset,
  onDeleteAsset,
  canManageAccess,
  accessGrants,
  workspaceMembers,
  onUpdateAccess
}: ChannelManagerProps) {
  const [tab, setTab] = useState<TabId>("brand");
  const [mounted, setMounted] = useState(false);
  const activeChannel = useMemo(
    () => channels.find((item) => item.id === activeChannelId) ?? null,
    [channels, activeChannelId]
  );

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [stage2ExamplesConfig, setStage2ExamplesConfig] = useState<Stage2ExamplesConfig>(
    DEFAULT_STAGE2_EXAMPLES_CONFIG
  );
  const [stage2HardConstraints, setStage2HardConstraints] = useState<Stage2HardConstraints>(
    DEFAULT_STAGE2_HARD_CONSTRAINTS
  );
  const [workspaceExamplesJson, setWorkspaceExamplesJson] = useState("[]");
  const [workspaceExamplesError, setWorkspaceExamplesError] = useState<string | null>(null);
  const [customExamplesJson, setCustomExamplesJson] = useState("[]");
  const [customExamplesError, setCustomExamplesError] = useState<string | null>(null);
  const [stage2PromptConfig, setStage2PromptConfig] = useState<Stage2PromptConfig>(
    normalizeStage2PromptConfig(null)
  );
  const [templateId, setTemplateId] = useState(STAGE3_TEMPLATE_ID);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    brand: { status: "idle", message: null },
    stage2: { status: "idle", message: null },
    render: { status: "idle", message: null }
  });
  const stage2PromptStages = useMemo(() => listStage2PromptConfigStages(), []);
  const renderTemplateOptions = useMemo(
    () =>
      listStage3DesignLabPresets().map((preset) => ({
        value: preset.templateId,
        label: preset.label
      })),
    []
  );
  const skipAutosaveRef = useRef<Record<AutosaveScope, boolean>>({
    brand: true,
    stage2: true,
    render: true
  });
  const persistedSnapshotRef = useRef<Record<AutosaveScope, string>>({
    brand: "",
    stage2: "",
    render: ""
  });
  const autosaveRevisionRef = useRef<Record<AutosaveScope, number>>({
    brand: 0,
    stage2: 0,
    render: 0
  });
  const autosaveResetTimersRef = useRef<Partial<Record<AutosaveScope, number>>>({});
  const saveChannelRef = useRef(onSaveChannel);
  const saveWorkspaceStage2ExamplesRef = useRef(onSaveWorkspaceStage2ExamplesCorpus);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    saveChannelRef.current = onSaveChannel;
  }, [onSaveChannel]);

  useEffect(() => {
    saveWorkspaceStage2ExamplesRef.current = onSaveWorkspaceStage2ExamplesCorpus;
  }, [onSaveWorkspaceStage2ExamplesCorpus]);

  useEffect(() => {
    return () => {
      Object.values(autosaveResetTimersRef.current).forEach((timerId) => {
        if (typeof timerId === "number") {
          window.clearTimeout(timerId);
        }
      });
    };
  }, []);

  const setAutosaveFeedback = (
    scope: AutosaveScope,
    status: AutosaveStatus,
    message: string | null = null
  ) => {
    setAutosaveState((current) => ({
      ...current,
      [scope]: { status, message }
    }));
  };

  const scheduleAutosaveReset = (scope: AutosaveScope) => {
    const existingTimer = autosaveResetTimersRef.current[scope];
    if (typeof existingTimer === "number") {
      window.clearTimeout(existingTimer);
    }
    autosaveResetTimersRef.current[scope] = window.setTimeout(() => {
      setAutosaveFeedback(scope, "idle", null);
      delete autosaveResetTimersRef.current[scope];
    }, 1800);
  };

  const clearAutosaveReset = (scope: AutosaveScope) => {
    const existingTimer = autosaveResetTimersRef.current[scope];
    if (typeof existingTimer === "number") {
      window.clearTimeout(existingTimer);
      delete autosaveResetTimersRef.current[scope];
    }
  };

  const buildBrandSnapshot = (nextName: string, nextUsername: string): string =>
    JSON.stringify({
      name: nextName,
      username: nextUsername
    });

  const buildStage2Snapshot = (
    nextWorkspaceExamplesJson: string,
    nextExamplesConfig: Stage2ExamplesConfig,
    nextHardConstraints: Stage2HardConstraints,
    nextPromptConfig: Stage2PromptConfig
  ): string =>
    JSON.stringify({
      workspaceStage2ExamplesCorpusJson: nextWorkspaceExamplesJson,
      stage2ExamplesConfig: nextExamplesConfig,
      stage2HardConstraints: nextHardConstraints,
      stage2PromptConfig: nextPromptConfig
    });

  const buildRenderSnapshot = (nextTemplateId: string): string =>
    JSON.stringify({
      templateId: nextTemplateId
    });

  useEffect(() => {
    if (!activeChannel) {
      return;
    }
    const normalizedExamplesConfig = normalizeStage2ExamplesConfig(activeChannel.stage2ExamplesConfig, {
      channelId: activeChannel.id,
      channelName: activeChannel.name
    });
    const normalizedHardConstraints = normalizeStage2HardConstraints(activeChannel.stage2HardConstraints);
    const normalizedPromptConfig = normalizeStage2PromptConfig(activeChannel.stage2PromptConfig);
    setName(activeChannel.name);
    setUsername(activeChannel.username);
    setStage2ExamplesConfig(normalizedExamplesConfig);
    setStage2HardConstraints(normalizedHardConstraints);
    setWorkspaceExamplesJson(workspaceStage2ExamplesCorpusJson);
    setWorkspaceExamplesError(null);
    setCustomExamplesJson(JSON.stringify(normalizedExamplesConfig.customExamples ?? [], null, 2));
    setCustomExamplesError(null);
    setStage2PromptConfig(normalizedPromptConfig);
    setTemplateId(activeChannel.templateId);
    persistedSnapshotRef.current = {
      brand: buildBrandSnapshot(activeChannel.name, activeChannel.username),
      stage2: buildStage2Snapshot(
        workspaceStage2ExamplesCorpusJson,
        normalizedExamplesConfig,
        normalizedHardConstraints,
        normalizedPromptConfig
      ),
      render: buildRenderSnapshot(activeChannel.templateId)
    };
    skipAutosaveRef.current = {
      brand: true,
      stage2: true,
      render: true
    };
    clearAutosaveReset("brand");
    clearAutosaveReset("stage2");
    clearAutosaveReset("render");
    setAutosaveState({
      brand: { status: "idle", message: null },
      stage2: { status: "idle", message: null },
      render: { status: "idle", message: null }
    });
  }, [activeChannel, workspaceStage2ExamplesCorpusJson]);

  useEffect(() => {
    if (!open || !mounted) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, mounted, onClose]);

  const workspaceExamplesCount = useMemo(
    () => collectWorkspaceStage2Examples(workspaceExamplesJson).length,
    [workspaceExamplesJson]
  );
  const canEditSetup = Boolean(activeChannel?.currentUserCanEditSetup);
  const activeExamplesPreview = useMemo(() => {
    if (!activeChannel) {
      return { source: "workspace_default" as const, corpus: [], workspaceCorpusCount: workspaceExamplesCount };
    }
    return resolveStage2ExamplesCorpus({
      channel: {
        id: activeChannel.id,
        name: activeChannel.name,
        stage2ExamplesConfig
      },
      workspaceStage2ExamplesCorpusJson: workspaceExamplesJson
    });
  }, [activeChannel, stage2ExamplesConfig, workspaceExamplesCount, workspaceExamplesJson]);

  useEffect(() => {
    if (!activeChannel || !canEditSetup) {
      return;
    }
    if (skipAutosaveRef.current.brand) {
      skipAutosaveRef.current.brand = false;
      return;
    }
    const nextSnapshot = buildBrandSnapshot(name, username);
    if (nextSnapshot === persistedSnapshotRef.current.brand) {
      if (autosaveState.brand.status !== "idle") {
        setAutosaveFeedback("brand", "idle", null);
      }
      return;
    }
    clearAutosaveReset("brand");
    setAutosaveFeedback("brand", "pending", "Сохраним автоматически через секунду.");
    const revision = ++autosaveRevisionRef.current.brand;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("brand", "saving", "Сохраняем бренд…");
      void saveChannelRef.current(activeChannel.id, { name, username })
        .then(() => {
          if (autosaveRevisionRef.current.brand !== revision) {
            return;
          }
          persistedSnapshotRef.current.brand = nextSnapshot;
          setAutosaveFeedback("brand", "saved", "Бренд сохранён.");
          scheduleAutosaveReset("brand");
        })
        .catch(() => {
          if (autosaveRevisionRef.current.brand !== revision) {
            return;
          }
          setAutosaveFeedback("brand", "error", "Не удалось сохранить бренд.");
        });
    }, 600);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [activeChannel, canEditSetup, name, username]);

  useEffect(() => {
    if (!activeChannel || !canEditSetup) {
      return;
    }
    if (skipAutosaveRef.current.stage2) {
      skipAutosaveRef.current.stage2 = false;
      return;
    }
    if (workspaceExamplesError || customExamplesError) {
      clearAutosaveReset("stage2");
      setAutosaveFeedback(
        "stage2",
        "error",
        "Исправьте JSON корпуса примеров, чтобы сохранить Stage 2."
      );
      return;
    }
    const nextSnapshot = buildStage2Snapshot(
      workspaceExamplesJson,
      stage2ExamplesConfig,
      stage2HardConstraints,
      stage2PromptConfig
    );
    if (nextSnapshot === persistedSnapshotRef.current.stage2) {
      if (autosaveState.stage2.status !== "idle") {
        setAutosaveFeedback("stage2", "idle", null);
      }
      return;
    }
    clearAutosaveReset("stage2");
    setAutosaveFeedback("stage2", "pending", "Сохраним Stage 2 автоматически.");
    const revision = ++autosaveRevisionRef.current.stage2;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("stage2", "saving", "Сохраняем Stage 2…");
      void Promise.all([
        saveWorkspaceStage2ExamplesRef.current(workspaceExamplesJson),
        saveChannelRef.current(activeChannel.id, {
          stage2ExamplesConfig,
          stage2HardConstraints,
          stage2PromptConfig
        })
      ])
        .then(() => {
          if (autosaveRevisionRef.current.stage2 !== revision) {
            return;
          }
          persistedSnapshotRef.current.stage2 = nextSnapshot;
          setAutosaveFeedback("stage2", "saved", "Stage 2 сохранён.");
          scheduleAutosaveReset("stage2");
        })
        .catch(() => {
          if (autosaveRevisionRef.current.stage2 !== revision) {
            return;
          }
          setAutosaveFeedback("stage2", "error", "Не удалось сохранить Stage 2.");
        });
    }, 900);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activeChannel,
    canEditSetup,
    customExamplesError,
    stage2ExamplesConfig,
    stage2HardConstraints,
    stage2PromptConfig,
    workspaceExamplesError,
    workspaceExamplesJson
  ]);

  useEffect(() => {
    if (!activeChannel || !canEditSetup) {
      return;
    }
    if (skipAutosaveRef.current.render) {
      skipAutosaveRef.current.render = false;
      return;
    }
    const nextSnapshot = buildRenderSnapshot(templateId);
    if (nextSnapshot === persistedSnapshotRef.current.render) {
      if (autosaveState.render.status !== "idle") {
        setAutosaveFeedback("render", "idle", null);
      }
      return;
    }
    clearAutosaveReset("render");
    setAutosaveFeedback("render", "pending", "Сохраним настройки рендера автоматически.");
    const revision = ++autosaveRevisionRef.current.render;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("render", "saving", "Сохраняем рендер…");
      void saveChannelRef.current(activeChannel.id, { templateId })
        .then(() => {
          if (autosaveRevisionRef.current.render !== revision) {
            return;
          }
          persistedSnapshotRef.current.render = nextSnapshot;
          setAutosaveFeedback("render", "saved", "Рендер сохранён.");
          scheduleAutosaveReset("render");
        })
        .catch(() => {
          if (autosaveRevisionRef.current.render !== revision) {
            return;
          }
          setAutosaveFeedback("render", "error", "Не удалось сохранить рендер.");
        });
    }, 450);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [activeChannel, canEditSetup, templateId]);

  if (!open || !mounted) {
    return null;
  }

  const avatars = listByKind(assets, "avatar");
  const backgrounds = listByKind(assets, "background");
  const music = listByKind(assets, "music");
  const activeGrantUserIds = new Set(accessGrants.map((grant) => grant.userId));
  const accessCandidates = workspaceMembers.filter((member) => member.role !== "owner");

  const updateStage2PromptTemplate = (
    stageId: keyof Stage2PromptConfig["stages"],
    prompt: string
  ) => {
    setStage2PromptConfig((current) => ({
      ...current,
      stages: {
        ...current.stages,
        [stageId]: {
          ...current.stages[stageId],
          prompt
        }
      }
    }));
  };

  const updateStage2PromptReasoning = (
    stageId: keyof Stage2PromptConfig["stages"],
    reasoningEffort: Stage2PromptConfig["stages"][keyof Stage2PromptConfig["stages"]]["reasoningEffort"]
  ) => {
    setStage2PromptConfig((current) => ({
      ...current,
      stages: {
        ...current.stages,
        [stageId]: {
          ...current.stages[stageId],
          reasoningEffort
        }
      }
    }));
  };

  const resetStage2PromptStage = (stageId: keyof Stage2PromptConfig["stages"]) => {
    setStage2PromptConfig((current) => ({
      ...current,
      stages: {
        ...current.stages,
        [stageId]: { ...DEFAULT_STAGE2_PROMPT_CONFIG.stages[stageId] }
      }
    }));
  };

  const updateStage2ExamplesSource = (useWorkspaceDefault: boolean) => {
    setStage2ExamplesConfig((current) => ({
      ...current,
      useWorkspaceDefault
    }));
  };

  const updateWorkspaceExamplesJson = (value: string) => {
    setWorkspaceExamplesJson(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Workspace examples corpus JSON должен быть JSON-массивом.");
      }
      setWorkspaceExamplesError(null);
    } catch {
      setWorkspaceExamplesError("Workspace default corpus JSON должен быть валидным JSON-массивом.");
    }
  };

  const updateCustomExamplesJson = (value: string) => {
    setCustomExamplesJson(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      setStage2ExamplesConfig((current) =>
        normalizeStage2ExamplesConfig(
          {
            ...current,
            customExamples: Array.isArray(parsed) ? parsed : []
          },
          {
            channelId: activeChannel?.id ?? "",
            channelName: activeChannel?.name ?? ""
          }
        )
      );
      setCustomExamplesError(null);
    } catch {
      setCustomExamplesError("Channel custom corpus JSON должен быть валидным JSON-массивом.");
    }
  };

  const updateStage2HardConstraint = (
    key: keyof Stage2HardConstraints,
    value: string | boolean | string[]
  ) => {
    setStage2HardConstraints((current) =>
      normalizeStage2HardConstraints({
        ...current,
        [key]: value
      })
    );
  };

  const formatTabLabel = (value: "brand" | "stage2" | "render" | "assets" | "access") => {
    switch (value) {
      case "brand":
        return "Бренд";
      case "stage2":
        return "Stage 2";
      case "render":
        return "Рендер";
      case "assets":
        return "Ассеты";
      case "access":
        return "Доступ";
      default:
        return value;
    }
  };

  return createPortal(
    <div
      className="channel-manager-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Управление каналами"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="channel-manager">
        <header className="channel-manager-head">
          <h2>Управление каналами</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <section className="channel-manager-toolbar">
          <select
            className="text-input"
            value={activeChannelId ?? ""}
            onChange={(event) => {
              const channelId = event.target.value;
              if (!channelId) {
                return;
              }
              onSelectChannel(channelId);
            }}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name} @{channel.username}
              </option>
            ))}
          </select>
          {canCreateChannel ? (
            <button type="button" className="btn btn-secondary" onClick={onCreateChannel}>
              + Новый канал
            </button>
          ) : null}
          {activeChannel ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onDeleteChannel(activeChannel.id)}
              disabled={channels.length <= 1 || !activeChannel.currentUserCanEditSetup}
            >
              Удалить канал
            </button>
          ) : null}
        </section>

        <div className="channel-tabs">
          {(["brand", "stage2", "render", "assets", "access"] as const).map((item) => {
            if (item === "access" && !canManageAccess) {
              return null;
            }
            return (
            <button
              key={item}
              type="button"
              className={`channel-tab ${tab === item ? "active" : ""}`}
              onClick={() => setTab(item)}
            >
              {formatTabLabel(item)}
            </button>
            );
          })}
        </div>

        {!activeChannel ? (
          <p className="subtle-text">Выберите канал.</p>
        ) : (
          <div className="channel-tab-content">
            {tab === "brand" ? (
              <div className="field-stack">
                <label className="field-label">Название канала</label>
                <input
                  className="text-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!canEditSetup}
                />
                <label className="field-label">Username канала</label>
                <input
                  className="text-input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="science_snack"
                  disabled={!canEditSetup}
                />
                <p className={`subtle-text ${autosaveState.brand.status === "error" ? "danger-text" : ""}`}>
                  {autosaveState.brand.message ?? "Изменения бренда сохраняются автоматически."}
                </p>
                <div className="control-actions">
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="image/*"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        onUploadAsset("avatar", file);
                        event.currentTarget.value = "";
                      }}
                    />
                    Загрузить аватар
                  </label>
                  <select
                    className="text-input"
                    value={activeChannel.avatarAssetId ?? ""}
                    onChange={(event) =>
                        onSaveChannel(activeChannel.id, { avatarAssetId: event.target.value || null })
                    }
                  >
                    <option value="">Без аватара</option>
                    {avatars.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.originalName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {tab === "stage2" ? (
              <div className="field-stack">
                <section className="control-card control-card-priority">
                  <p className="field-label">Multi-stage Stage 2 pipeline</p>
                  <p className="subtle-text">
                    У каждого канала теперь один эффективный corpus примеров. По умолчанию он
                    берётся из workspace, а при необходимости этот канал может полностью заменить
                    его своим custom corpus. Один и тот же effective corpus используется для
                    selector, writer и остальных Stage 2 этапов.
                  </p>
                </section>
                <section className="control-card control-card-subtle">
                  <p className="field-label">Examples corpus</p>
                  <div className="stage2-insight-grid">
                    <article className="stage2-insight-card">
                      <span className="field-label">Workspace default</span>
                      <strong>{workspaceExamplesCount}</strong>
                      <p className="subtle-text">примеров находится в общем corpus workspace</p>
                    </article>
                    <article className="stage2-insight-card">
                      <span className="field-label">Effective source</span>
                      <strong>
                        {stage2ExamplesConfig.useWorkspaceDefault
                          ? "Workspace default"
                          : "Channel custom"}
                      </strong>
                      <p className="subtle-text">активный corpus для этого канала и этого run</p>
                    </article>
                    <article className="stage2-insight-card">
                      <span className="field-label">Effective corpus</span>
                      <strong>{activeExamplesPreview.corpus.length}</strong>
                      <p className="subtle-text">столько examples увидят selector и writer</p>
                    </article>
                    <article className="stage2-insight-card">
                      <span className="field-label">Hard constraints</span>
                      <strong>
                        TOP {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
                      </strong>
                      <p className="subtle-text">
                        BOTTOM {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
                      </p>
                    </article>
                  </div>

                  <p className="subtle-text">
                    Для каждого канала выбирается только один активный corpus. Если включён
                    workspace default, используется общий набор examples. Если включён custom
                    corpus канала, он полностью заменяет workspace default только для этого канала.
                  </p>

                  <div className="compact-field">
                    <label className="field-label">Workspace default corpus JSON</label>
                    <textarea
                      className="text-area mono"
                      rows={10}
                      value={workspaceExamplesJson}
                      disabled={!canEditSetup}
                      onChange={(event) => updateWorkspaceExamplesJson(event.target.value)}
                    />
                    {workspaceExamplesError ? (
                      <p className="subtle-text danger-text">{workspaceExamplesError}</p>
                    ) : (
                      <p className="subtle-text">
                        Это основной editable corpus для всего workspace. По умолчанию все каналы
                        используют именно его.
                      </p>
                    )}
                  </div>

                  <div className="compact-field">
                    <span className="field-label">Активный источник corpus</span>
                    <label className="field-label">
                      <input
                        type="radio"
                        name="stage2-examples-source"
                        checked={stage2ExamplesConfig.useWorkspaceDefault}
                        disabled={!canEditSetup}
                        onChange={() => updateStage2ExamplesSource(true)}
                      />{" "}
                      Use workspace default corpus
                    </label>
                    <label className="field-label">
                      <input
                        type="radio"
                        name="stage2-examples-source"
                        checked={!stage2ExamplesConfig.useWorkspaceDefault}
                        disabled={!canEditSetup}
                        onChange={() => updateStage2ExamplesSource(false)}
                      />{" "}
                      Use custom corpus for this channel
                    </label>
                  </div>

                  {!stage2ExamplesConfig.useWorkspaceDefault ? (
                    <div className="compact-field">
                      <label className="field-label">Channel custom corpus JSON</label>
                      <textarea
                        className="text-area mono"
                        rows={10}
                        value={customExamplesJson}
                        disabled={!canEditSetup}
                        onChange={(event) => updateCustomExamplesJson(event.target.value)}
                      />
                      {customExamplesError ? (
                        <p className="subtle-text danger-text">{customExamplesError}</p>
                      ) : (
                        <p className="subtle-text">
                          Этот набор полностью заменяет workspace default только для этого канала.
                        </p>
                      )}
                    </div>
                  ) : null}
                </section>

                <section className="control-card control-card-subtle">
                  <p className="field-label">Hard constraints</p>
                  <div className="compact-grid">
                    <div className="compact-field">
                      <label className="field-label">Top min</label>
                      <input
                        className="text-input"
                        type="number"
                        value={stage2HardConstraints.topLengthMin}
                        disabled={!canEditSetup}
                        onChange={(event) =>
                          updateStage2HardConstraint("topLengthMin", event.target.value)
                        }
                      />
                    </div>
                    <div className="compact-field">
                      <label className="field-label">Top max</label>
                      <input
                        className="text-input"
                        type="number"
                        value={stage2HardConstraints.topLengthMax}
                        disabled={!canEditSetup}
                        onChange={(event) =>
                          updateStage2HardConstraint("topLengthMax", event.target.value)
                        }
                      />
                    </div>
                    <div className="compact-field">
                      <label className="field-label">Bottom min</label>
                      <input
                        className="text-input"
                        type="number"
                        value={stage2HardConstraints.bottomLengthMin}
                        disabled={!canEditSetup}
                        onChange={(event) =>
                          updateStage2HardConstraint("bottomLengthMin", event.target.value)
                        }
                      />
                    </div>
                    <div className="compact-field">
                      <label className="field-label">Bottom max</label>
                      <input
                        className="text-input"
                        type="number"
                        value={stage2HardConstraints.bottomLengthMax}
                        disabled={!canEditSetup}
                        onChange={(event) =>
                          updateStage2HardConstraint("bottomLengthMax", event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <label className="field-label">
                    <input
                      type="checkbox"
                      checked={stage2HardConstraints.bottomQuoteRequired}
                      disabled={!canEditSetup}
                      onChange={(event) =>
                        updateStage2HardConstraint("bottomQuoteRequired", event.target.checked)
                      }
                    />{" "}
                    Bottom quote required
                  </label>
                  <label className="field-label">Banned words</label>
                  <textarea
                    className="text-area"
                    rows={3}
                    value={stage2HardConstraints.bannedWords.join(", ")}
                    disabled={!canEditSetup}
                    onChange={(event) =>
                      updateStage2HardConstraint(
                        "bannedWords",
                        event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      )
                    }
                  />
                  <label className="field-label">Banned openers</label>
                  <textarea
                    className="text-area"
                    rows={3}
                    value={stage2HardConstraints.bannedOpeners.join(", ")}
                    disabled={!canEditSetup}
                    onChange={(event) =>
                      updateStage2HardConstraint(
                        "bannedOpeners",
                        event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      )
                    }
                  />
                  <p className={`subtle-text ${autosaveState.stage2.status === "error" ? "danger-text" : ""}`}>
                    {autosaveState.stage2.message ?? "Поля Stage 2 сохраняются автоматически."}
                  </p>
                </section>
                <section className="control-card control-card-subtle">
                  <div className="control-section-head">
                    <div>
                      <h3>Stage prompts</h3>
                      <p className="subtle-text">
                        Каждый блок ниже соответствует одному реальному этапу пайплайна. Внутри
                        только две настройки: фактический prompt и выбранный reasoning.
                      </p>
                    </div>
                  </div>
                  <div className="stage2-config-stage-list">
                    {stage2PromptStages.map((stage, index) => {
                      const stageConfig = stage2PromptConfig.stages[stage.id];
                      const isDefaultPrompt =
                        stageConfig.prompt === STAGE2_DEFAULT_STAGE_PROMPTS[stage.id];
                      const isDefaultReasoning =
                        stageConfig.reasoningEffort ===
                        STAGE2_DEFAULT_REASONING_EFFORTS[stage.id];
                      return (
                        <article key={stage.id} className="stage2-config-stage-card">
                          <div className="stage2-config-stage-head">
                            <div className="stage2-config-stage-index">{index + 1}</div>
                            <div className="stage2-config-stage-copy">
                              <div className="quick-edit-label-row">
                                <label className="field-label">
                                  {stage.shortLabel} <span className="badge">LLM stage</span>
                                </label>
                                {!isDefaultPrompt || !isDefaultReasoning ? (
                                  <span className="badge">Custom</span>
                                ) : (
                                  <span className="badge muted">Default</span>
                                )}
                              </div>
                              <p className="subtle-text">{stage.description}</p>
                            </div>
                          </div>
                          <div className="stage2-config-stage-body">
                            <label className="field-label">Prompt</label>
                            <textarea
                              className="text-area mono"
                              rows={10}
                              value={stageConfig.prompt}
                              disabled={!canEditSetup}
                              onChange={(event) =>
                                updateStage2PromptTemplate(stage.id, event.target.value)
                              }
                            />
                            <div className="stage2-config-stage-controls">
                              <div className="compact-field">
                                <label className="field-label">Reasoning</label>
                                <select
                                  className="text-input"
                                  value={stageConfig.reasoningEffort}
                                  disabled={!canEditSetup}
                                  onChange={(event) =>
                                    updateStage2PromptReasoning(
                                      stage.id,
                                      event.target.value as typeof stageConfig.reasoningEffort
                                    )
                                  }
                                >
                                  {STAGE2_REASONING_EFFORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="stage2-config-stage-actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={!canEditSetup}
                                  onClick={() => resetStage2PromptStage(stage.id)}
                                >
                                  Reset to default
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}

            {tab === "render" ? (
              <div className="field-stack">
                <label className="field-label">Шаблон</label>
                <select
                  className="text-input"
                  value={templateId}
                  disabled={!canEditSetup}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {renderTemplateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="compact-grid">
                  <div className="compact-field">
                    <label className="field-label">Фон по умолчанию</label>
                    <select
                      className="text-input"
                      value={activeChannel.defaultBackgroundAssetId ?? ""}
                      onChange={(event) =>
                        onSaveChannel(activeChannel.id, {
                          defaultBackgroundAssetId: event.target.value || null
                        })
                      }
                    >
                      <option value="">None</option>
                      {backgrounds.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.originalName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="compact-field">
                    <label className="field-label">Музыка по умолчанию</label>
                    <select
                      className="text-input"
                      value={activeChannel.defaultMusicAssetId ?? ""}
                      onChange={(event) =>
                        onSaveChannel(activeChannel.id, {
                          defaultMusicAssetId: event.target.value || null
                        })
                      }
                    >
                      <option value="">None</option>
                      {music.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.originalName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className={`subtle-text ${autosaveState.render.status === "error" ? "danger-text" : ""}`}>
                  {autosaveState.render.message ?? "Настройки рендера сохраняются автоматически."}
                </p>
              </div>
            ) : null}

            {tab === "assets" ? (
              <div className="field-stack">
                <div className="control-actions">
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        onUploadAsset("background", file);
                        event.currentTarget.value = "";
                      }}
                    />
                    Загрузить фон
                  </label>
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="audio/*"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        onUploadAsset("music", file);
                        event.currentTarget.value = "";
                      }}
                    />
                    Загрузить музыку
                  </label>
                </div>
                <section className="details-section">
                  <h3>Фоны ({backgrounds.length})</h3>
                  <ul className="details-log-list">
                    {backgrounds.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                            onSaveChannel(activeChannel.id, { defaultBackgroundAssetId: asset.id })
                          }
                        >
                            Сделать по умолчанию
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Музыка ({music.length})</h3>
                  <ul className="details-log-list">
                    {music.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onSaveChannel(activeChannel.id, { defaultMusicAssetId: asset.id })}
                          >
                            Сделать по умолчанию
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Аватары ({avatars.length})</h3>
                  <ul className="details-log-list">
                    {avatars.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onSaveChannel(activeChannel.id, { avatarAssetId: asset.id })}
                          >
                            Сделать аватаром
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}

            {tab === "access" && canManageAccess ? (
              <div className="field-stack">
                <p className="subtle-text">
                  Менеджеры и владелец могут выдавать рабочий доступ к каналам.
                </p>
                <section className="details-section">
                  <h3>Текущий доступ ({accessGrants.length})</h3>
                  <ul className="details-log-list">
                    {accessGrants.length === 0 ? (
                      <li className="log-item">
                        <p>Явных выдач доступа нет.</p>
                      </li>
                    ) : (
                      accessGrants.map((grant) => (
                        <li key={grant.id} className="log-item">
                          <p>
                            {grant.user?.displayName ?? grant.userId}{" "}
                            <span className="subtle-text">{grant.user?.email ?? ""}</span>
                          </p>
                          <div className="control-actions">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                onUpdateAccess(activeChannel.id, {
                                  grantUserIds: [],
                                  revokeUserIds: [grant.userId]
                                })
                              }
                            >
                              Отозвать
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Выдать доступ</h3>
                  <ul className="details-log-list">
                    {accessCandidates.map((member) => (
                      <li key={member.user.id} className="log-item">
                        <p>
                          {member.user.displayName}{" "}
                          <span className="subtle-text">
                            {member.user.email} · {member.role}
                          </span>
                        </p>
                        <div className="control-actions">
                          {activeGrantUserIds.has(member.user.id) ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                onUpdateAccess(activeChannel.id, {
                                  grantUserIds: [],
                                  revokeUserIds: [member.user.id]
                                })
                              }
                            >
                              Отозвать
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() =>
                                onUpdateAccess(activeChannel.id, {
                                  grantUserIds: [member.user.id],
                                  revokeUserIds: []
                                })
                              }
                            >
                              Выдать рабочий доступ
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
