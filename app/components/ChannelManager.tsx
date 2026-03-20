"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChannelManagerStage2Tab } from "./ChannelManagerStage2Tab";
import {
  AppRole,
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
  type Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../../lib/stage2-channel-config";
import {
  AutosaveScope,
  AutosaveState,
  AutosaveStatus,
  CHANNEL_MANAGER_DEFAULT_SETTINGS_ID,
  ChannelManagerTargetKind,
  listByKind,
  canDeleteManagedChannel,
  listChannelManagerTargets,
  stringifyCorpusExamples,
  areCorpusExamplesEquivalent,
  TabId
} from "./channel-manager-support";

export { CHANNEL_MANAGER_DEFAULT_SETTINGS_ID, canDeleteManagedChannel, listChannelManagerTargets };

type ChannelManagerProps = {
  open: boolean;
  channels: Channel[];
  workspaceStage2ExamplesCorpusJson: string;
  workspaceStage2HardConstraints: Stage2HardConstraints;
  workspaceStage2PromptConfig: Stage2PromptConfig;
  activeChannelId: string | null;
  assets: ChannelAsset[];
  currentUserRole: AppRole | null;
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
  onSaveWorkspaceStage2Defaults: (
    patch: Partial<{
      stage2ExamplesCorpusJson: string;
      stage2HardConstraints: Stage2HardConstraints;
      stage2PromptConfig: Stage2PromptConfig;
    }>
  ) => Promise<void>;
  onUploadAsset: (kind: ChannelAssetKind, file: File) => void;
  onDeleteAsset: (assetId: string) => void;
  canManageAccess: boolean;
  accessGrants: ChannelAccessGrant[];
  workspaceMembers: Array<{ user: UserRecord; role: WorkspaceMemberRecord["role"] }>;
  onUpdateAccess: (channelId: string, input: { grantUserIds: string[]; revokeUserIds: string[] }) => void;
};

export function ChannelManager({
  open,
  channels,
  workspaceStage2ExamplesCorpusJson,
  workspaceStage2HardConstraints: workspaceStage2HardConstraintsProp,
  workspaceStage2PromptConfig: workspaceStage2PromptConfigProp,
  activeChannelId,
  assets,
  currentUserRole,
  onClose,
  onSelectChannel,
  onCreateChannel,
  onDeleteChannel,
  canCreateChannel,
  onSaveChannel,
  onSaveWorkspaceStage2Defaults,
  onUploadAsset,
  onDeleteAsset,
  canManageAccess,
  accessGrants,
  workspaceMembers,
  onUpdateAccess
}: ChannelManagerProps) {
  const [tab, setTab] = useState<TabId>("brand");
  const [mounted, setMounted] = useState(false);
  const isOwner = currentUserRole === "owner";
  const managerTargets = useMemo(() => listChannelManagerTargets(channels, isOwner), [channels, isOwner]);
  const [managerSelectionId, setManagerSelectionId] = useState<string | null>(null);
  const selectedTarget = useMemo(() => {
    if (managerSelectionId) {
      return managerTargets.find((item) => item.id === managerSelectionId) ?? null;
    }
    if (activeChannelId) {
      return managerTargets.find((item) => item.id === activeChannelId) ?? null;
    }
    return managerTargets[0] ?? null;
  }, [activeChannelId, managerSelectionId, managerTargets]);
  const isWorkspaceDefaultsSelection = selectedTarget?.kind === "workspace_defaults";
  const activeChannel = selectedTarget?.kind === "channel" ? selectedTarget.channel : null;

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
  const [workspaceStage2PromptConfig, setWorkspaceStage2PromptConfig] = useState<Stage2PromptConfig>(
    normalizeStage2PromptConfig(workspaceStage2PromptConfigProp)
  );
  const [templateId, setTemplateId] = useState(STAGE3_TEMPLATE_ID);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    brand: { status: "idle", message: null },
    stage2: { status: "idle", message: null },
    stage2Defaults: { status: "idle", message: null },
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
    stage2Defaults: true,
    render: true
  });
  const persistedSnapshotRef = useRef<Record<AutosaveScope, string>>({
    brand: "",
    stage2: "",
    stage2Defaults: "",
    render: ""
  });
  const autosaveRevisionRef = useRef<Record<AutosaveScope, number>>({
    brand: 0,
    stage2: 0,
    stage2Defaults: 0,
    render: 0
  });
  const autosaveResetTimersRef = useRef<Partial<Record<AutosaveScope, number>>>({});
  const saveChannelRef = useRef(onSaveChannel);
  const saveWorkspaceStage2DefaultsRef = useRef(onSaveWorkspaceStage2Defaults);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    saveChannelRef.current = onSaveChannel;
  }, [onSaveChannel]);

  useEffect(() => {
    saveWorkspaceStage2DefaultsRef.current = onSaveWorkspaceStage2Defaults;
  }, [onSaveWorkspaceStage2Defaults]);

  useEffect(() => {
    return () => {
      Object.values(autosaveResetTimersRef.current).forEach((timerId) => {
        if (typeof timerId === "number") {
          window.clearTimeout(timerId);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setManagerSelectionId(null);
      setTab("brand");
      return;
    }

    if (managerSelectionId && managerTargets.some((item) => item.id === managerSelectionId)) {
      return;
    }

    if (activeChannelId && managerTargets.some((item) => item.id === activeChannelId)) {
      setManagerSelectionId(activeChannelId);
      return;
    }

    setManagerSelectionId(managerTargets[0]?.id ?? null);
  }, [open, activeChannelId, managerSelectionId, managerTargets]);

  useEffect(() => {
    if (isWorkspaceDefaultsSelection && tab !== "stage2") {
      setTab("stage2");
    }
  }, [isWorkspaceDefaultsSelection, tab]);

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
    nextExamplesConfig: Stage2ExamplesConfig,
    nextHardConstraints: Stage2HardConstraints
  ): string =>
    JSON.stringify({
      stage2ExamplesConfig: nextExamplesConfig,
      stage2HardConstraints: nextHardConstraints
    });

  const buildStage2DefaultsSnapshot = (
    nextWorkspaceExamplesJson: string,
    nextHardConstraints: Stage2HardConstraints,
    nextPromptConfig: Stage2PromptConfig
  ): string =>
    JSON.stringify({
      workspaceStage2ExamplesCorpusJson: nextWorkspaceExamplesJson,
      workspaceStage2HardConstraints: nextHardConstraints,
      workspaceStage2PromptConfig: nextPromptConfig
    });

  const buildRenderSnapshot = (nextTemplateId: string): string =>
    JSON.stringify({
      templateId: nextTemplateId
    });

  useEffect(() => {
    const normalizedHardConstraints = normalizeStage2HardConstraints(workspaceStage2HardConstraintsProp);
    const normalizedPromptConfig = normalizeStage2PromptConfig(workspaceStage2PromptConfigProp);
    setStage2HardConstraints(normalizedHardConstraints);
    setWorkspaceExamplesJson(workspaceStage2ExamplesCorpusJson);
    setWorkspaceExamplesError(null);
    setWorkspaceStage2PromptConfig(normalizedPromptConfig);
    clearAutosaveReset("stage2Defaults");

    persistedSnapshotRef.current.stage2Defaults = buildStage2DefaultsSnapshot(
      workspaceStage2ExamplesCorpusJson,
      normalizedHardConstraints,
      normalizedPromptConfig
    );
    skipAutosaveRef.current.stage2Defaults = true;

    if (isWorkspaceDefaultsSelection || !activeChannel) {
      setAutosaveState((current) => ({
        ...current,
        stage2Defaults: { status: "idle", message: null }
      }));
      return;
    }

    const normalizedExamplesConfig = normalizeStage2ExamplesConfig(activeChannel.stage2ExamplesConfig, {
      channelId: activeChannel.id,
      channelName: activeChannel.name
    });
    setName(activeChannel.name);
    setUsername(activeChannel.username);
    const initialChannelExamples = normalizedExamplesConfig.useWorkspaceDefault
      ? collectWorkspaceStage2Examples(workspaceStage2ExamplesCorpusJson)
      : normalizedExamplesConfig.customExamples ?? [];
    const normalizedChannelHardConstraints = normalizeStage2HardConstraints(
      activeChannel.stage2HardConstraints
    );
    setStage2ExamplesConfig(normalizedExamplesConfig);
    setStage2HardConstraints(normalizedChannelHardConstraints);
    setCustomExamplesJson(stringifyCorpusExamples(initialChannelExamples));
    setCustomExamplesError(null);
    setTemplateId(activeChannel.templateId);
    persistedSnapshotRef.current = {
      brand: buildBrandSnapshot(activeChannel.name, activeChannel.username),
      stage2: buildStage2Snapshot(normalizedExamplesConfig, normalizedChannelHardConstraints),
      stage2Defaults: buildStage2DefaultsSnapshot(
        workspaceStage2ExamplesCorpusJson,
        normalizedHardConstraints,
        normalizedPromptConfig
      ),
      render: buildRenderSnapshot(activeChannel.templateId)
    };
    skipAutosaveRef.current = {
      brand: true,
      stage2: true,
      stage2Defaults: true,
      render: true
    };
    clearAutosaveReset("brand");
    clearAutosaveReset("stage2");
    clearAutosaveReset("render");
    setAutosaveState({
      brand: { status: "idle", message: null },
      stage2: { status: "idle", message: null },
      stage2Defaults: { status: "idle", message: null },
      render: { status: "idle", message: null }
    });
  }, [
    activeChannel,
    isWorkspaceDefaultsSelection,
    workspaceStage2ExamplesCorpusJson,
    workspaceStage2HardConstraintsProp,
    workspaceStage2PromptConfigProp
  ]);

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
  const canEditWorkspaceDefaults = isOwner && isWorkspaceDefaultsSelection;
  const canEditChannelExamples = canEditSetup;
  const canEditHardConstraints = isWorkspaceDefaultsSelection ? canEditWorkspaceDefaults : canEditSetup;
  const activeExamplesPreview = useMemo(() => {
    if (!activeChannel) {
      return {
        source: "workspace_default" as const,
        corpus: collectWorkspaceStage2Examples(workspaceExamplesJson),
        workspaceCorpusCount: workspaceExamplesCount
      };
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
    if (!activeChannel || !canEditChannelExamples) {
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
    if (!activeChannel || !canEditChannelExamples) {
      return;
    }
    if (skipAutosaveRef.current.stage2) {
      skipAutosaveRef.current.stage2 = false;
      return;
    }
    if (customExamplesError) {
      clearAutosaveReset("stage2");
      setAutosaveFeedback(
        "stage2",
        "error",
        "Исправьте JSON custom corpus, чтобы сохранить Stage 2."
      );
      return;
    }
    const nextSnapshot = buildStage2Snapshot(stage2ExamplesConfig, stage2HardConstraints);
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
      void saveChannelRef.current(activeChannel.id, {
        stage2ExamplesConfig,
        stage2HardConstraints
      })
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
    canEditChannelExamples,
    customExamplesError,
    stage2ExamplesConfig,
    stage2HardConstraints
  ]);

  useEffect(() => {
    if (!open || !canEditWorkspaceDefaults) {
      return;
    }
    if (skipAutosaveRef.current.stage2Defaults) {
      skipAutosaveRef.current.stage2Defaults = false;
      return;
    }
    if (workspaceExamplesError) {
      clearAutosaveReset("stage2Defaults");
      setAutosaveFeedback(
        "stage2Defaults",
        "error",
        "Исправьте JSON workspace corpus, чтобы сохранить defaults."
      );
      return;
    }
    const nextSnapshot = buildStage2DefaultsSnapshot(
      workspaceExamplesJson,
      stage2HardConstraints,
      workspaceStage2PromptConfig
    );
    if (nextSnapshot === persistedSnapshotRef.current.stage2Defaults) {
      if (autosaveState.stage2Defaults.status !== "idle") {
        setAutosaveFeedback("stage2Defaults", "idle", null);
      }
      return;
    }
    clearAutosaveReset("stage2Defaults");
    setAutosaveFeedback("stage2Defaults", "pending", "Сохраним Stage 2 defaults автоматически.");
    const revision = ++autosaveRevisionRef.current.stage2Defaults;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("stage2Defaults", "saving", "Сохраняем Stage 2 defaults…");
      void saveWorkspaceStage2DefaultsRef.current({
        stage2ExamplesCorpusJson: workspaceExamplesJson,
        stage2HardConstraints,
        stage2PromptConfig: workspaceStage2PromptConfig
      })
        .then(() => {
          if (autosaveRevisionRef.current.stage2Defaults !== revision) {
            return;
          }
          persistedSnapshotRef.current.stage2Defaults = nextSnapshot;
          setAutosaveFeedback("stage2Defaults", "saved", "Stage 2 defaults сохранены.");
          scheduleAutosaveReset("stage2Defaults");
        })
        .catch(() => {
          if (autosaveRevisionRef.current.stage2Defaults !== revision) {
            return;
          }
          setAutosaveFeedback("stage2Defaults", "error", "Не удалось сохранить Stage 2 defaults.");
        });
    }, 900);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activeChannel,
    canEditWorkspaceDefaults,
    workspaceExamplesError,
    workspaceExamplesJson,
    stage2HardConstraints,
    workspaceStage2PromptConfig
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
    setWorkspaceStage2PromptConfig((current) => ({
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
    setWorkspaceStage2PromptConfig((current) => ({
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
    setWorkspaceStage2PromptConfig((current) => ({
      ...current,
      stages: {
        ...current.stages,
        [stageId]: { ...DEFAULT_STAGE2_PROMPT_CONFIG.stages[stageId] }
      }
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
      const normalizedExamplesConfig = normalizeStage2ExamplesConfig(
        {
          version: 1,
          useWorkspaceDefault: false,
          customExamples: Array.isArray(parsed) ? parsed : []
        },
        {
          channelId: activeChannel?.id ?? "",
          channelName: activeChannel?.name ?? ""
        }
      );
      const workspaceExamples = collectWorkspaceStage2Examples(workspaceExamplesJson);
      const shouldUseWorkspaceDefault = areCorpusExamplesEquivalent(
        normalizedExamplesConfig.customExamples,
        workspaceExamples
      );
      setStage2ExamplesConfig((current) =>
        normalizeStage2ExamplesConfig({
          ...current,
          useWorkspaceDefault: shouldUseWorkspaceDefault,
          customExamples: shouldUseWorkspaceDefault ? [] : normalizedExamplesConfig.customExamples
        }, {
          channelId: activeChannel?.id ?? "",
          channelName: activeChannel?.name ?? ""
        })
      );
      setCustomExamplesError(null);
    } catch {
      setCustomExamplesError("Examples corpus JSON должен быть валидным JSON-массивом.");
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
            value={selectedTarget?.id ?? ""}
            onChange={(event) => {
              const targetId = event.target.value;
              if (!targetId) {
                return;
              }
              setManagerSelectionId(targetId);
              if (targetId === CHANNEL_MANAGER_DEFAULT_SETTINGS_ID) {
                setTab("stage2");
                return;
              }
              onSelectChannel(targetId);
            }}
          >
            {managerTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
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
              disabled={!canDeleteManagedChannel(channels, activeChannel)}
            >
              Удалить канал
            </button>
          ) : null}
        </section>

        <div className="channel-tabs">
          {(isWorkspaceDefaultsSelection
            ? (["stage2"] as const)
            : (["brand", "stage2", "render", "assets", "access"] as const)
          ).map((item) => {
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

        {!activeChannel && !isWorkspaceDefaultsSelection ? (
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
                    value={activeChannel?.avatarAssetId ?? ""}
                    onChange={(event) =>
                        activeChannel && onSaveChannel(activeChannel.id, { avatarAssetId: event.target.value || null })
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
              <ChannelManagerStage2Tab
                isWorkspaceDefaultsSelection={isWorkspaceDefaultsSelection}
                workspaceExamplesCount={workspaceExamplesCount}
                workspaceExamplesJson={workspaceExamplesJson}
                workspaceExamplesError={workspaceExamplesError}
                stage2HardConstraints={stage2HardConstraints}
                workspaceStage2PromptConfig={workspaceStage2PromptConfig}
                stage2PromptStages={stage2PromptStages}
                autosaveState={autosaveState}
                canEditWorkspaceDefaults={canEditWorkspaceDefaults}
                canEditHardConstraints={canEditHardConstraints}
                canEditChannelExamples={canEditChannelExamples}
                activeExamplesPreview={activeExamplesPreview}
                customExamplesJson={customExamplesJson}
                customExamplesError={customExamplesError}
                updateWorkspaceExamplesJson={updateWorkspaceExamplesJson}
                updateCustomExamplesJson={updateCustomExamplesJson}
                updateStage2HardConstraint={updateStage2HardConstraint}
                updateStage2PromptTemplate={updateStage2PromptTemplate}
                updateStage2PromptReasoning={updateStage2PromptReasoning}
                resetStage2PromptStage={resetStage2PromptStage}
              />
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
                      value={activeChannel?.defaultBackgroundAssetId ?? ""}
                      onChange={(event) =>
                        activeChannel && onSaveChannel(activeChannel.id, {
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
                      value={activeChannel?.defaultMusicAssetId ?? ""}
                      onChange={(event) =>
                        activeChannel && onSaveChannel(activeChannel.id, {
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
                            activeChannel && onSaveChannel(activeChannel.id, { defaultBackgroundAssetId: asset.id })
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
                            onClick={() => activeChannel && onSaveChannel(activeChannel.id, { defaultMusicAssetId: asset.id })}
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
                            onClick={() => activeChannel && onSaveChannel(activeChannel.id, { avatarAssetId: asset.id })}
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
                                activeChannel && onUpdateAccess(activeChannel.id, {
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
                                activeChannel && onUpdateAccess(activeChannel.id, {
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
                                activeChannel && onUpdateAccess(activeChannel.id, {
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
