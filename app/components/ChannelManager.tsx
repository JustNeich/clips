"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppShellToastTone } from "./AppShell";
import { AvatarUploadButton } from "./AvatarUploadButton";
import { ChannelManagerPublishingTab } from "./ChannelManagerPublishingTab";
import { ChannelManagerStage2Tab } from "./ChannelManagerStage2Tab";
import {
  AppRole,
  Channel,
  ChannelAccessGrant,
  ChannelAsset,
  ChannelAssetKind,
  ChannelFeedbackResponse,
  WorkspaceMemberRecord,
  UserRecord
} from "./types";
import { STAGE3_TEMPLATE_ID } from "../../lib/stage3-template";
import type { ManagedTemplateSummary } from "../../lib/managed-template-types";
import { getTemplateVariant } from "../../lib/stage3-template-registry";
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
  formatStage2DelimitedStringList,
  normalizeStage2ExamplesConfig,
  normalizeStage2HardConstraints,
  parseStage2DelimitedStringList,
  resolveStage2ExamplesCorpus,
  type Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../../lib/stage2-channel-config";
import {
  normalizeWorkspaceCodexModelConfig,
  type ResolvedWorkspaceCodexModelConfig,
  type WorkspaceCodexModelConfig
} from "../../lib/workspace-codex-models";
import {
  resolveStage2WorkerProfile,
  type Stage2WorkerProfileId
} from "../../lib/stage2-worker-profile";
import {
  applyChannelStyleProfileEditorDiscoveryResult,
  buildChannelStyleProfileFromEditorDraft,
  createChannelStyleProfileEditorDraft,
  getChannelStyleProfileEditorDiscoveryStatus,
  normalizePersistedChannelStyleProfileEditorState,
  parseChannelOnboardingReferenceLinks,
  selectAllChannelStyleProfileEditorDirections,
  setChannelStyleProfileEditorExplorationShare,
  toggleChannelStyleProfileEditorDirectionSelection,
  type ChannelStyleProfileEditorDraft,
  updateChannelStyleProfileEditorReferenceLinks,
  clearChannelStyleProfileEditorDirectionSelection
} from "./channel-onboarding-support";
import type { ChannelStyleDiscoveryRunDetail } from "../../lib/channel-style-discovery-types";
import {
  normalizeStage2StyleProfile,
  stringifyStage2StyleProfile,
  type Stage2EditorialMemorySummary,
  type Stage2StyleProfile
} from "../../lib/stage2-channel-learning";
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

type ChannelSavePatch = Partial<{
  name: string;
  username: string;
  stage2WorkerProfileId: string | null;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  stage2PromptConfig: Stage2PromptConfig;
  stage2StyleProfile: Stage2StyleProfile;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
}>;

type ManagedTemplateListResponse = {
  templates?: ManagedTemplateSummary[];
};

export function groupManagedTemplatesByFormat(
  managedTemplates: ManagedTemplateSummary[]
): Array<{ label: string; options: Array<{ value: string; label: string }> }> {
  const groups = new Map<string, Array<{ value: string; label: string }>>();
  managedTemplates.forEach((template) => {
    const formatLabel = getTemplateVariant(template.layoutFamily ?? template.baseTemplateId).formatLabel;
    const existing = groups.get(formatLabel) ?? [];
    existing.push({
      value: template.id,
      label: template.name
    });
    groups.set(formatLabel, existing);
  });
  return Array.from(groups.entries()).map(([label, options]) => ({ label, options }));
}

export function describeChannelManagerSavePatch(patch: ChannelSavePatch): {
  saving: string;
  saved: string;
  error: string;
} {
  if ("stage2StyleProfile" in patch) {
    return {
      saving: "Сохраняем стиль канала…",
      saved: "Стиль канала сохранён.",
      error: "Не удалось сохранить стиль канала."
    };
  }
  if ("stage2ExamplesConfig" in patch || "stage2HardConstraints" in patch) {
    return {
      saving: "Сохраняем настройки Stage 2…",
      saved: "Настройки Stage 2 сохранены.",
      error: "Не удалось сохранить настройки Stage 2."
    };
  }
  if ("stage2WorkerProfileId" in patch) {
    return {
      saving: "Сохраняем формат pipeline…",
      saved: "Формат pipeline сохранён.",
      error: "Не удалось сохранить формат pipeline."
    };
  }
  if ("templateId" in patch || "defaultBackgroundAssetId" in patch || "defaultMusicAssetId" in patch) {
    return {
      saving: "Сохраняем настройки рендера…",
      saved: "Настройки рендера сохранены.",
      error: "Не удалось сохранить настройки рендера."
    };
  }
  if ("name" in patch || "username" in patch || "avatarAssetId" in patch) {
    return {
      saving: "Сохраняем бренд канала…",
      saved: "Бренд канала сохранён.",
      error: "Не удалось сохранить бренд канала."
    };
  }
  return {
    saving: "Сохраняем настройки канала…",
    saved: "Настройки канала сохранены.",
    error: "Не удалось сохранить настройки канала."
  };
}

type ChannelManagerProps = {
  open: boolean;
  initialTab?: TabId | null;
  channels: Channel[];
  workspaceStage2ExamplesCorpusJson: string;
  workspaceStage2HardConstraints: Stage2HardConstraints;
  workspaceStage2PromptConfig: Stage2PromptConfig;
  workspaceCodexModelConfig: WorkspaceCodexModelConfig;
  workspaceResolvedCodexModelConfig: ResolvedWorkspaceCodexModelConfig;
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
    patch: ChannelSavePatch
  ) => Promise<void>;
  onShowGlobalToast?: (input: {
    id: string;
    tone: AppShellToastTone;
    title?: string | null;
    message: string;
    actionLabel?: string | null;
    onAction?: () => void;
    autoHideMs?: number | null;
  }) => void;
  onDismissGlobalToast?: (toastId: string) => void;
  onStartStyleDiscovery: (input: {
    name: string;
    username: string;
    stage2HardConstraints: Stage2HardConstraints;
    referenceLinks: string[];
  }) => Promise<ChannelStyleDiscoveryRunDetail>;
  onGetStyleDiscoveryRun: (runId: string) => Promise<ChannelStyleDiscoveryRunDetail>;
  feedbackHistory: ChannelFeedbackResponse["historyEvents"];
  feedbackHistoryLoading: boolean;
  editorialMemory: Stage2EditorialMemorySummary | null;
  onDeleteFeedbackEvent: (eventId: string) => Promise<void>;
  deletingFeedbackEventId: string | null;
  onSaveWorkspaceStage2Defaults: (
    patch: Partial<{
      stage2ExamplesCorpusJson: string;
      stage2HardConstraints: Stage2HardConstraints;
      stage2PromptConfig: Stage2PromptConfig;
      codexModelConfig: WorkspaceCodexModelConfig;
    }>
  ) => Promise<void>;
  onUploadAsset: (kind: ChannelAssetKind, file: File) => void;
  onDeleteAsset: (assetId: string) => void;
  canManageAccess: boolean;
  accessGrants: ChannelAccessGrant[];
  workspaceMembers: Array<{ user: UserRecord; role: WorkspaceMemberRecord["role"] }>;
  onUpdateAccess: (channelId: string, input: { grantUserIds: string[]; revokeUserIds: string[] }) => void;
  onSavePublishSettings: (
    channelId: string,
    patch: Partial<NonNullable<Channel["publishSettings"]>>
  ) => Promise<void>;
  onConnectYouTube: (channelId: string) => Promise<void>;
  onDisconnectYouTube: (channelId: string) => Promise<void>;
  onSelectYouTubeDestination: (channelId: string, selectedYoutubeChannelId: string) => Promise<void>;
};

export function ChannelManager({
  open,
  initialTab = null,
  channels,
  workspaceStage2ExamplesCorpusJson,
  workspaceStage2HardConstraints: workspaceStage2HardConstraintsProp,
  workspaceStage2PromptConfig: workspaceStage2PromptConfigProp,
  workspaceCodexModelConfig: workspaceCodexModelConfigProp,
  workspaceResolvedCodexModelConfig,
  activeChannelId,
  assets,
  currentUserRole,
  onClose,
  onSelectChannel,
  onCreateChannel,
  onDeleteChannel,
  canCreateChannel,
  onSaveChannel,
  onShowGlobalToast,
  onDismissGlobalToast,
  onStartStyleDiscovery,
  onGetStyleDiscoveryRun,
  feedbackHistory,
  feedbackHistoryLoading,
  editorialMemory,
  onDeleteFeedbackEvent,
  deletingFeedbackEventId,
  onSaveWorkspaceStage2Defaults,
  onUploadAsset,
  onDeleteAsset,
  canManageAccess,
  accessGrants,
  workspaceMembers,
  onUpdateAccess,
  onSavePublishSettings,
  onConnectYouTube,
  onDisconnectYouTube,
  onSelectYouTubeDestination
}: ChannelManagerProps) {
  const [styleProfileDraft, setStyleProfileDraft] = useState<ChannelStyleProfileEditorDraft | null>(null);
  const [styleProfileActiveRunId, setStyleProfileActiveRunId] = useState<string | null>(null);
  const [styleProfileIsDiscovering, setStyleProfileIsDiscovering] = useState(false);
  const [styleProfileDiscoveryError, setStyleProfileDiscoveryError] = useState<string | null>(null);
  const [styleProfileSaveState, setStyleProfileSaveState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null
  });
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
  const styleProfileStorageKey = activeChannel
    ? `clips:channel-style-profile-editor:${activeChannel.id}`
    : null;

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [stage2WorkerProfileId, setStage2WorkerProfileId] = useState<Stage2WorkerProfileId>(
    resolveStage2WorkerProfile(null).resolvedId
  );
  const [stage2ExamplesConfig, setStage2ExamplesConfig] = useState<Stage2ExamplesConfig>(
    DEFAULT_STAGE2_EXAMPLES_CONFIG
  );
  const [stage2HardConstraints, setStage2HardConstraints] = useState<Stage2HardConstraints>(
    DEFAULT_STAGE2_HARD_CONSTRAINTS
  );
  const [bannedWordsInput, setBannedWordsInput] = useState("");
  const [bannedOpenersInput, setBannedOpenersInput] = useState("");
  const [workspaceExamplesJson, setWorkspaceExamplesJson] = useState("[]");
  const [workspaceExamplesError, setWorkspaceExamplesError] = useState<string | null>(null);
  const [customExamplesJson, setCustomExamplesJson] = useState("[]");
  const [customExamplesError, setCustomExamplesError] = useState<string | null>(null);
  const [workspaceStage2PromptConfig, setWorkspaceStage2PromptConfig] = useState<Stage2PromptConfig>(
    normalizeStage2PromptConfig(workspaceStage2PromptConfigProp)
  );
  const [workspaceCodexModelConfig, setWorkspaceCodexModelConfig] =
    useState<WorkspaceCodexModelConfig>(
      normalizeWorkspaceCodexModelConfig(workspaceCodexModelConfigProp)
    );
  const [templateId, setTemplateId] = useState(STAGE3_TEMPLATE_ID);
  const [managedTemplates, setManagedTemplates] = useState<ManagedTemplateSummary[]>([]);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    brand: { status: "idle", message: null },
    stage2: { status: "idle", message: null },
    stage2Defaults: { status: "idle", message: null },
    render: { status: "idle", message: null }
  });
  const stage2PromptStages = useMemo(() => listStage2PromptConfigStages(), []);
  const renderTemplateGroups = useMemo(
    () => groupManagedTemplatesByFormat(managedTemplates),
    [managedTemplates]
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

  const showManagerSaveNotice = useCallback(
    (tone: AppShellToastTone, message: string | null, autoHide = false) => {
      if (!message) {
        onDismissGlobalToast?.("channel-manager-save");
        return;
      }
      onShowGlobalToast?.({
        id: "channel-manager-save",
        tone,
        title: tone === "error" ? "Проверьте сохранение" : "Сохранение",
        message,
        autoHideMs: autoHide ? 2400 : null
      });
    },
    [onDismissGlobalToast, onShowGlobalToast]
  );

  const saveManagedChannel = useCallback(
    async (channelId: string, patch: ChannelSavePatch): Promise<void> => {
      const copy = describeChannelManagerSavePatch(patch);
      showManagerSaveNotice("neutral", copy.saving);
      try {
        await onSaveChannel(channelId, patch);
        showManagerSaveNotice("success", copy.saved, true);
      } catch (error) {
        showManagerSaveNotice(
          "error",
          error instanceof Error && error.message ? error.message : copy.error
        );
        throw error;
      }
    },
    [onSaveChannel, showManagerSaveNotice]
  );

  const saveWorkspaceStage2DefaultsWithNotice = useCallback(
    async (
      patch: Partial<{
        stage2ExamplesCorpusJson: string;
        stage2HardConstraints: Stage2HardConstraints;
        stage2PromptConfig: Stage2PromptConfig;
        codexModelConfig: WorkspaceCodexModelConfig;
      }>
    ): Promise<void> => {
      showManagerSaveNotice("neutral", "Сохраняем общие AI-настройки…");
      try {
        await onSaveWorkspaceStage2Defaults(patch);
        showManagerSaveNotice("success", "Общие AI-настройки сохранены.", true);
      } catch (error) {
        showManagerSaveNotice(
          "error",
          error instanceof Error && error.message
            ? error.message
            : "Не удалось сохранить общие AI-настройки."
        );
        throw error;
      }
    },
    [onSaveWorkspaceStage2Defaults, showManagerSaveNotice]
  );

  const triggerManagedChannelSave = useCallback(
    (channelId: string, patch: ChannelSavePatch): void => {
      void saveManagedChannel(channelId, patch).catch(() => undefined);
    },
    [saveManagedChannel]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadManagedTemplates() {
      try {
        const response = await fetch("/api/design/templates", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Templates failed: ${response.status}`);
        }
        const payload = (await response.json()) as ManagedTemplateListResponse;
        if (cancelled) {
          return;
        }
        setManagedTemplates(Array.isArray(payload.templates) ? payload.templates : []);
      } catch {
        // Keep the last successful template list to avoid showing a false
        // "current unavailable template" state on transient request failures.
      }
    }

    void loadManagedTemplates();

    function handleWindowFocus() {
      void loadManagedTemplates();
    }

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    saveChannelRef.current = saveManagedChannel;
  }, [saveManagedChannel]);

  useEffect(() => {
    saveWorkspaceStage2DefaultsRef.current = saveWorkspaceStage2DefaultsWithNotice;
  }, [saveWorkspaceStage2DefaultsWithNotice]);

  useEffect(() => {
    const autosaveResetTimers = autosaveResetTimersRef.current;
    return () => {
      Object.values(autosaveResetTimers).forEach((timerId) => {
        if (typeof timerId === "number") {
          window.clearTimeout(timerId);
        }
      });
      onDismissGlobalToast?.("channel-manager-save");
    };
  }, [onDismissGlobalToast]);

  useEffect(() => {
    if (!open) {
      setManagerSelectionId(null);
      setTab("brand");
      onDismissGlobalToast?.("channel-manager-save");
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
  }, [open, activeChannelId, managerSelectionId, managerTargets, onDismissGlobalToast]);

  useEffect(() => {
    onDismissGlobalToast?.("channel-manager-save");
  }, [managerSelectionId, onDismissGlobalToast]);

  useEffect(() => {
    if (isWorkspaceDefaultsSelection && tab !== "stage2") {
      setTab("stage2");
    }
  }, [isWorkspaceDefaultsSelection, tab]);

  useEffect(() => {
    if (!open || !initialTab || isWorkspaceDefaultsSelection) {
      return;
    }
    setTab(initialTab);
  }, [initialTab, isWorkspaceDefaultsSelection, open]);

  useEffect(() => {
    if (!activeChannel || isWorkspaceDefaultsSelection) {
      setStyleProfileDraft(null);
      setStyleProfileActiveRunId(null);
      setStyleProfileIsDiscovering(false);
      setStyleProfileDiscoveryError(null);
      setStyleProfileSaveState({ status: "idle", message: null });
      return;
    }

    const fallbackDraft = createChannelStyleProfileEditorDraft(activeChannel.stage2StyleProfile);
    if (!styleProfileStorageKey || typeof window === "undefined") {
      setStyleProfileDraft(fallbackDraft);
      setStyleProfileActiveRunId(null);
      setStyleProfileIsDiscovering(false);
      setStyleProfileDiscoveryError(null);
      setStyleProfileSaveState({ status: "idle", message: null });
      return;
    }

    try {
      const persisted = normalizePersistedChannelStyleProfileEditorState(
        JSON.parse(window.localStorage.getItem(styleProfileStorageKey) ?? "null"),
        activeChannel.stage2StyleProfile
      );
      setStyleProfileDraft(persisted?.draft ?? fallbackDraft);
      setStyleProfileActiveRunId(persisted?.activeStyleDiscoveryRunId ?? null);
    } catch {
      setStyleProfileDraft(fallbackDraft);
      setStyleProfileActiveRunId(null);
    } finally {
      setStyleProfileIsDiscovering(false);
      setStyleProfileDiscoveryError(null);
      setStyleProfileSaveState({ status: "idle", message: null });
    }
  }, [activeChannel, isWorkspaceDefaultsSelection, styleProfileStorageKey]);

  useEffect(() => {
    if (!styleProfileStorageKey || !styleProfileDraft || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        styleProfileStorageKey,
        JSON.stringify({
          draft: styleProfileDraft,
          activeStyleDiscoveryRunId: styleProfileActiveRunId
        })
      );
    } catch {
      // Persist editor draft best-effort only.
    }
  }, [styleProfileActiveRunId, styleProfileDraft, styleProfileStorageKey]);

  const setAutosaveFeedback = useCallback((
    scope: AutosaveScope,
    status: AutosaveStatus,
    message: string | null = null
  ) => {
    setAutosaveState((current) => ({
      ...current,
      [scope]: { status, message }
    }));
  }, []);

  const resetAutosaveFeedbackIfNeeded = useCallback((scope: AutosaveScope) => {
    setAutosaveState((current) => {
      const scopeState = current[scope];
      if (scopeState.status === "idle" && scopeState.message === null) {
        return current;
      }
      return {
        ...current,
        [scope]: { status: "idle", message: null }
      };
    });
  }, []);

  const scheduleAutosaveReset = useCallback((scope: AutosaveScope) => {
    const existingTimer = autosaveResetTimersRef.current[scope];
    if (typeof existingTimer === "number") {
      window.clearTimeout(existingTimer);
    }
    autosaveResetTimersRef.current[scope] = window.setTimeout(() => {
      setAutosaveFeedback(scope, "idle", null);
      delete autosaveResetTimersRef.current[scope];
    }, 1800);
  }, [setAutosaveFeedback]);

  const clearAutosaveReset = useCallback((scope: AutosaveScope) => {
    const existingTimer = autosaveResetTimersRef.current[scope];
    if (typeof existingTimer === "number") {
      window.clearTimeout(existingTimer);
      delete autosaveResetTimersRef.current[scope];
    }
  }, []);

  const buildBrandSnapshot = (nextName: string, nextUsername: string): string =>
    JSON.stringify({
      name: nextName,
      username: nextUsername
    });

  const buildStage2Snapshot = (
    nextWorkerProfileId: string | null,
    nextExamplesConfig: Stage2ExamplesConfig,
    nextHardConstraints: Stage2HardConstraints
  ): string =>
    JSON.stringify({
      stage2WorkerProfileId: resolveStage2WorkerProfile(nextWorkerProfileId).resolvedId,
      stage2ExamplesConfig: nextExamplesConfig,
      stage2HardConstraints: nextHardConstraints
    });

  const buildStage2DefaultsSnapshot = (
    nextWorkspaceExamplesJson: string,
    nextHardConstraints: Stage2HardConstraints,
    nextPromptConfig: Stage2PromptConfig,
    nextCodexModelConfig: WorkspaceCodexModelConfig
  ): string =>
    JSON.stringify({
      workspaceStage2ExamplesCorpusJson: nextWorkspaceExamplesJson,
      workspaceStage2HardConstraints: nextHardConstraints,
      workspaceStage2PromptConfig: nextPromptConfig,
      workspaceCodexModelConfig: nextCodexModelConfig
    });

  const buildRenderSnapshot = (nextTemplateId: string): string =>
    JSON.stringify({
      templateId: nextTemplateId
    });

  useEffect(() => {
    const normalizedHardConstraints = normalizeStage2HardConstraints(workspaceStage2HardConstraintsProp);
    const normalizedPromptConfig = normalizeStage2PromptConfig(workspaceStage2PromptConfigProp);
    const normalizedCodexModelConfig = normalizeWorkspaceCodexModelConfig(
      workspaceCodexModelConfigProp
    );
    setStage2HardConstraints(normalizedHardConstraints);
    setBannedWordsInput(formatStage2DelimitedStringList(normalizedHardConstraints.bannedWords));
    setBannedOpenersInput(formatStage2DelimitedStringList(normalizedHardConstraints.bannedOpeners));
    setWorkspaceExamplesJson(workspaceStage2ExamplesCorpusJson);
    setWorkspaceExamplesError(null);
    setWorkspaceStage2PromptConfig(normalizedPromptConfig);
    setWorkspaceCodexModelConfig(normalizedCodexModelConfig);
    clearAutosaveReset("stage2Defaults");

    persistedSnapshotRef.current.stage2Defaults = buildStage2DefaultsSnapshot(
      workspaceStage2ExamplesCorpusJson,
      normalizedHardConstraints,
      normalizedPromptConfig,
      normalizedCodexModelConfig
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
    const resolvedWorkerProfile = resolveStage2WorkerProfile(activeChannel.stage2WorkerProfileId);
    setName(activeChannel.name);
    setUsername(activeChannel.username);
    setStage2WorkerProfileId(resolvedWorkerProfile.resolvedId);
    const initialChannelExamples = normalizedExamplesConfig.useWorkspaceDefault
      ? collectWorkspaceStage2Examples(workspaceStage2ExamplesCorpusJson)
      : normalizedExamplesConfig.customExamples ?? [];
    const normalizedChannelHardConstraints = normalizeStage2HardConstraints(
      activeChannel.stage2HardConstraints
    );
    setStage2ExamplesConfig(normalizedExamplesConfig);
    setStage2HardConstraints(normalizedChannelHardConstraints);
    setBannedWordsInput(formatStage2DelimitedStringList(normalizedChannelHardConstraints.bannedWords));
    setBannedOpenersInput(
      formatStage2DelimitedStringList(normalizedChannelHardConstraints.bannedOpeners)
    );
    setCustomExamplesJson(stringifyCorpusExamples(initialChannelExamples));
    setCustomExamplesError(null);
    setTemplateId(activeChannel.templateId);
    persistedSnapshotRef.current = {
      brand: buildBrandSnapshot(activeChannel.name, activeChannel.username),
      stage2: buildStage2Snapshot(
        activeChannel.stage2WorkerProfileId,
        normalizedExamplesConfig,
        normalizedChannelHardConstraints
      ),
      stage2Defaults: buildStage2DefaultsSnapshot(
        workspaceStage2ExamplesCorpusJson,
        normalizedHardConstraints,
        normalizedPromptConfig,
        normalizedCodexModelConfig
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
    clearAutosaveReset,
    isWorkspaceDefaultsSelection,
    workspaceStage2ExamplesCorpusJson,
    workspaceStage2HardConstraintsProp,
    workspaceStage2PromptConfigProp,
    workspaceCodexModelConfigProp
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
    if (!activeChannel || !canEditSetup) {
      return;
    }
    if (skipAutosaveRef.current.brand) {
      skipAutosaveRef.current.brand = false;
      return;
    }
    const nextSnapshot = buildBrandSnapshot(name, username);
    if (nextSnapshot === persistedSnapshotRef.current.brand) {
      resetAutosaveFeedbackIfNeeded("brand");
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
  }, [
    activeChannel,
    canEditSetup,
    clearAutosaveReset,
    name,
    resetAutosaveFeedbackIfNeeded,
    scheduleAutosaveReset,
    setAutosaveFeedback,
    username
  ]);

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
        "Исправьте JSON собственного корпуса, чтобы сохранить настройки второго этапа."
      );
      return;
    }
    const nextSnapshot = buildStage2Snapshot(
      stage2WorkerProfileId,
      stage2ExamplesConfig,
      stage2HardConstraints
    );
    if (nextSnapshot === persistedSnapshotRef.current.stage2) {
      resetAutosaveFeedbackIfNeeded("stage2");
      return;
    }
    clearAutosaveReset("stage2");
    setAutosaveFeedback("stage2", "pending", "Сохраним настройки второго этапа автоматически.");
    const revision = ++autosaveRevisionRef.current.stage2;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("stage2", "saving", "Сохраняем настройки второго этапа…");
      void saveChannelRef.current(activeChannel.id, {
        stage2WorkerProfileId,
        stage2ExamplesConfig,
        stage2HardConstraints
      })
        .then(() => {
          if (autosaveRevisionRef.current.stage2 !== revision) {
            return;
          }
          persistedSnapshotRef.current.stage2 = nextSnapshot;
          setAutosaveFeedback("stage2", "saved", "Настройки второго этапа сохранены.");
          scheduleAutosaveReset("stage2");
        })
        .catch(() => {
          if (autosaveRevisionRef.current.stage2 !== revision) {
            return;
          }
          setAutosaveFeedback("stage2", "error", "Не удалось сохранить настройки второго этапа.");
        });
    }, 900);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activeChannel,
    canEditChannelExamples,
    clearAutosaveReset,
    customExamplesError,
    resetAutosaveFeedbackIfNeeded,
    scheduleAutosaveReset,
    setAutosaveFeedback,
    stage2WorkerProfileId,
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
        "Исправьте JSON общего корпуса, чтобы сохранить общие AI-настройки."
      );
      return;
    }
    const nextSnapshot = buildStage2DefaultsSnapshot(
      workspaceExamplesJson,
      stage2HardConstraints,
      workspaceStage2PromptConfig,
      workspaceCodexModelConfig
    );
    if (nextSnapshot === persistedSnapshotRef.current.stage2Defaults) {
      resetAutosaveFeedbackIfNeeded("stage2Defaults");
      return;
    }
    clearAutosaveReset("stage2Defaults");
    setAutosaveFeedback("stage2Defaults", "pending", "Сохраним общие AI-настройки автоматически.");
    const revision = ++autosaveRevisionRef.current.stage2Defaults;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("stage2Defaults", "saving", "Сохраняем общие AI-настройки…");
      void saveWorkspaceStage2DefaultsRef.current({
        stage2ExamplesCorpusJson: workspaceExamplesJson,
        stage2HardConstraints,
        stage2PromptConfig: workspaceStage2PromptConfig,
        codexModelConfig: workspaceCodexModelConfig
      })
        .then(() => {
          if (autosaveRevisionRef.current.stage2Defaults !== revision) {
            return;
          }
          persistedSnapshotRef.current.stage2Defaults = nextSnapshot;
          setAutosaveFeedback("stage2Defaults", "saved", "Общие AI-настройки сохранены.");
          scheduleAutosaveReset("stage2Defaults");
        })
        .catch(() => {
          if (autosaveRevisionRef.current.stage2Defaults !== revision) {
            return;
          }
          setAutosaveFeedback("stage2Defaults", "error", "Не удалось сохранить общие AI-настройки.");
        });
    }, 900);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activeChannel,
    canEditWorkspaceDefaults,
    clearAutosaveReset,
    open,
    resetAutosaveFeedbackIfNeeded,
    scheduleAutosaveReset,
    setAutosaveFeedback,
    workspaceExamplesError,
    workspaceExamplesJson,
    stage2HardConstraints,
    workspaceStage2PromptConfig,
    workspaceCodexModelConfig
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
      resetAutosaveFeedbackIfNeeded("render");
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
  }, [
    activeChannel,
    canEditSetup,
    clearAutosaveReset,
    resetAutosaveFeedbackIfNeeded,
    scheduleAutosaveReset,
    setAutosaveFeedback,
    templateId
  ]);

  useEffect(() => {
    if (!styleProfileActiveRunId) {
      setStyleProfileIsDiscovering(false);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      try {
        const run = await onGetStyleDiscoveryRun(styleProfileActiveRunId);
        if (cancelled) {
          return;
        }
        if (run.status === "completed" && run.result) {
          setStyleProfileDraft((current) =>
            current
              ? applyChannelStyleProfileEditorDiscoveryResult(
                  current,
                  run.result as Stage2StyleProfile
                )
              : current
          );
          setStyleProfileIsDiscovering(false);
          setStyleProfileDiscoveryError(null);
          setStyleProfileActiveRunId(null);
          return;
        }
        if (run.status === "failed") {
          setStyleProfileIsDiscovering(false);
          setStyleProfileDiscoveryError(run.errorMessage ?? "Не удалось обновить пул стилей.");
          setStyleProfileActiveRunId(null);
          return;
        }
        setStyleProfileIsDiscovering(true);
      } catch {
        if (cancelled) {
          return;
        }
        setStyleProfileIsDiscovering(true);
        scheduleNextPoll(document.hidden ? 2500 : 900);
        return;
      }

      scheduleNextPoll(document.hidden ? 2500 : 900);
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onGetStyleDiscoveryRun, styleProfileActiveRunId]);

  const handleStartStyleProfileDiscovery = async (): Promise<void> => {
    if (!activeChannel || !styleProfileDraft) {
      return;
    }

    const referenceLinks = parseChannelOnboardingReferenceLinks(styleProfileDraft.referenceLinksText);
    if (referenceLinks.length < 10) {
      setStyleProfileDiscoveryError("Добавьте минимум 10 поддерживаемых ссылок перед пересборкой.");
      return;
    }

    setStyleProfileDiscoveryError(null);
    setStyleProfileIsDiscovering(true);
    try {
      const run = await onStartStyleDiscovery({
        name: activeChannel.name,
        username: activeChannel.username,
        stage2HardConstraints,
        referenceLinks
      });
      if (run.status === "completed" && run.result) {
        setStyleProfileDraft((current) =>
          current
            ? applyChannelStyleProfileEditorDiscoveryResult(
                current,
                run.result as Stage2StyleProfile
              )
            : current
        );
        setStyleProfileIsDiscovering(false);
        setStyleProfileActiveRunId(null);
        return;
      }
      setStyleProfileActiveRunId(run.runId);
    } catch (error) {
      setStyleProfileIsDiscovering(false);
      setStyleProfileDiscoveryError(
        error instanceof Error ? error.message : "Не удалось обновить пул стилей."
      );
    }
  };

  const handleDiscardStyleProfileDraft = (): void => {
    if (!activeChannel) {
      return;
    }
    setStyleProfileDraft(createChannelStyleProfileEditorDraft(activeChannel.stage2StyleProfile));
    setStyleProfileActiveRunId(null);
    setStyleProfileIsDiscovering(false);
    setStyleProfileDiscoveryError(null);
    setStyleProfileSaveState({ status: "idle", message: null });
    if (styleProfileStorageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(styleProfileStorageKey);
      } catch {
        // Ignore best-effort cleanup failures.
      }
    }
  };

  const handleSaveStyleProfileDraft = async (): Promise<void> => {
    if (!activeChannel || !styleProfileDraft) {
      return;
    }
    if (getChannelStyleProfileEditorDiscoveryStatus(styleProfileDraft) === "stale") {
      setStyleProfileSaveState({
        status: "error",
        message: "Сначала обновите пул стилей под текущий набор референсов."
      });
      return;
    }

    const nextStyleProfile = buildChannelStyleProfileFromEditorDraft(styleProfileDraft);
    setStyleProfileSaveState({ status: "saving", message: "Сохраняем стиль канала…" });
    try {
      await saveChannelRef.current(activeChannel.id, {
        stage2StyleProfile: nextStyleProfile
      });
      setStyleProfileDraft(createChannelStyleProfileEditorDraft(nextStyleProfile));
      setStyleProfileActiveRunId(null);
      setStyleProfileDiscoveryError(null);
      setStyleProfileSaveState({ status: "saved", message: "Стиль канала сохранён." });
      if (styleProfileStorageKey && typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(styleProfileStorageKey);
        } catch {
          // Ignore best-effort cleanup failures.
        }
      }
    } catch (error) {
      setStyleProfileSaveState({
        status: "error",
        message: error instanceof Error ? error.message : "Не удалось сохранить стиль канала."
      });
    }
  };

  const normalizeComparableStyleProfile = (profile: Stage2StyleProfile): Stage2StyleProfile =>
    normalizeStage2StyleProfile({
      ...profile,
      updatedAt: null
    });

  const styleProfileStatus = styleProfileDraft
    ? getChannelStyleProfileEditorDiscoveryStatus(styleProfileDraft)
    : "missing";
  const styleProfileDraftHasChanges = Boolean(
    activeChannel &&
      styleProfileDraft &&
      (
        styleProfileDraft.referenceLinksText !==
          createChannelStyleProfileEditorDraft(activeChannel.stage2StyleProfile).referenceLinksText ||
        stringifyStage2StyleProfile(
          normalizeComparableStyleProfile(buildChannelStyleProfileFromEditorDraft(styleProfileDraft))
        ) !==
          stringifyStage2StyleProfile(
            normalizeComparableStyleProfile(
              normalizeStage2StyleProfile(activeChannel.stage2StyleProfile)
            )
          )
      )
  );

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
        throw new Error("JSON общего корпуса должен быть JSON-массивом.");
      }
      setWorkspaceExamplesError(null);
    } catch {
      setWorkspaceExamplesError("JSON общего корпуса должен быть валидным JSON-массивом.");
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
      setCustomExamplesError("JSON корпуса примеров должен быть валидным JSON-массивом.");
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

  const updateBannedWordsInput = (value: string) => {
    setBannedWordsInput(value);
    updateStage2HardConstraint("bannedWords", parseStage2DelimitedStringList(value));
  };

  const updateBannedOpenersInput = (value: string) => {
    setBannedOpenersInput(value);
    updateStage2HardConstraint("bannedOpeners", parseStage2DelimitedStringList(value));
  };

  const formatTabLabel = (value: "brand" | "stage2" | "render" | "publishing" | "assets" | "access") => {
    switch (value) {
      case "brand":
        return "Бренд";
      case "stage2":
        return "Stage 2";
      case "render":
        return "Рендер";
      case "publishing":
        return "Publishing";
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
            : (["brand", "stage2", "render", "publishing", "assets", "access"] as const)
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
                  <AvatarUploadButton
                    buttonLabel="Загрузить аватар"
                    buttonClassName="btn btn-ghost background-upload-btn"
                    onAvatarReady={(file) => onUploadAsset("avatar", file)}
                  />
                  <select
                    className="text-input"
                    value={activeChannel?.avatarAssetId ?? ""}
                    onChange={(event) =>
                      activeChannel
                        ? triggerManagedChannelSave(activeChannel.id, {
                            avatarAssetId: event.target.value || null
                          })
                        : undefined
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
                bannedWordsInput={bannedWordsInput}
                bannedOpenersInput={bannedOpenersInput}
                workspaceStage2PromptConfig={workspaceStage2PromptConfig}
                workspaceCodexModelConfig={workspaceCodexModelConfig}
                resolvedWorkspaceCodexModelConfig={workspaceResolvedCodexModelConfig}
                stage2PromptStages={stage2PromptStages}
                autosaveState={autosaveState}
                canEditWorkspaceDefaults={canEditWorkspaceDefaults}
                canEditHardConstraints={canEditHardConstraints}
                canEditChannelExamples={canEditChannelExamples}
                stage2WorkerProfileId={stage2WorkerProfileId}
                canEditStage2WorkerProfile={canEditSetup}
                updateStage2WorkerProfileId={(value) => setStage2WorkerProfileId(value)}
                activeExamplesPreview={activeExamplesPreview}
                channelStyleProfile={activeChannel?.stage2StyleProfile ?? null}
                channelStyleProfileDraft={styleProfileDraft}
                channelStyleProfileStatus={styleProfileStatus}
                channelStyleProfileDirty={styleProfileDraftHasChanges}
                channelStyleProfileFeedbackHistory={feedbackHistory}
                channelStyleProfileFeedbackHistoryLoading={feedbackHistoryLoading}
                onDeleteChannelFeedbackEvent={onDeleteFeedbackEvent}
                deletingChannelFeedbackEventId={deletingFeedbackEventId}
                channelEditorialMemory={editorialMemory}
                canEditChannelStyleProfile={canEditSetup}
                channelStyleProfileDiscovering={styleProfileIsDiscovering}
                channelStyleProfileDiscoveryError={styleProfileDiscoveryError}
                channelStyleProfileSaveState={styleProfileSaveState}
                updateChannelStyleProfileReferenceLinks={(value) => {
                  setStyleProfileDiscoveryError(null);
                  setStyleProfileSaveState({ status: "idle", message: null });
                  setStyleProfileDraft((current) =>
                    current ? updateChannelStyleProfileEditorReferenceLinks(current, value) : current
                  );
                }}
                updateChannelStyleProfileExplorationShare={(value) => {
                  setStyleProfileSaveState({ status: "idle", message: null });
                  setStyleProfileDraft((current) =>
                    current ? setChannelStyleProfileEditorExplorationShare(current, value) : current
                  );
                }}
                toggleChannelStyleProfileDirectionSelection={(directionId) => {
                  setStyleProfileSaveState({ status: "idle", message: null });
                  setStyleProfileDraft((current) =>
                    current
                      ? toggleChannelStyleProfileEditorDirectionSelection(current, directionId)
                      : current
                  );
                }}
                selectAllChannelStyleProfileDirections={() => {
                  setStyleProfileSaveState({ status: "idle", message: null });
                  setStyleProfileDraft((current) =>
                    current ? selectAllChannelStyleProfileEditorDirections(current) : current
                  );
                }}
                clearChannelStyleProfileDirectionSelection={() => {
                  setStyleProfileSaveState({ status: "idle", message: null });
                  setStyleProfileDraft((current) =>
                    current ? clearChannelStyleProfileEditorDirectionSelection(current) : current
                  );
                }}
                startChannelStyleProfileDiscovery={handleStartStyleProfileDiscovery}
                saveChannelStyleProfileDraft={handleSaveStyleProfileDraft}
                discardChannelStyleProfileDraft={handleDiscardStyleProfileDraft}
                customExamplesJson={customExamplesJson}
                customExamplesError={customExamplesError}
                updateWorkspaceExamplesJson={updateWorkspaceExamplesJson}
                updateCustomExamplesJson={updateCustomExamplesJson}
                updateStage2HardConstraint={updateStage2HardConstraint}
                updateBannedWordsInput={updateBannedWordsInput}
                updateBannedOpenersInput={updateBannedOpenersInput}
                updateStage2PromptTemplate={updateStage2PromptTemplate}
                updateStage2PromptReasoning={updateStage2PromptReasoning}
                resetStage2PromptStage={resetStage2PromptStage}
                updateWorkspaceCodexModelSetting={(stageId, value) =>
                  setWorkspaceCodexModelConfig((current) => ({
                    ...current,
                    [stageId]: value
                  }))
                }
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
                  {renderTemplateGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="subtle-text">
                  {managedTemplates.length > 0
                    ? "Новый шаблон из `Template Road` появится здесь автоматически."
                    : "Пока у тебя нет доступных шаблонов. Сначала создай свой шаблон в `Template Road`, и он сразу появится здесь."}{" "}
                  Редактор:{" "}
                  <a href="/design/template-road" target="_blank" rel="noreferrer">
                    открыть Template Road
                  </a>
                </p>
                <div className="compact-grid">
                  <div className="compact-field">
                    <label className="field-label">Фон по умолчанию</label>
                    <select
                      className="text-input"
                      value={activeChannel?.defaultBackgroundAssetId ?? ""}
                      onChange={(event) =>
                        activeChannel
                          ? triggerManagedChannelSave(activeChannel.id, {
                              defaultBackgroundAssetId: event.target.value || null
                            })
                          : undefined
                      }
                    >
                      <option value="">Нет</option>
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
                        activeChannel
                          ? triggerManagedChannelSave(activeChannel.id, {
                              defaultMusicAssetId: event.target.value || null
                            })
                          : undefined
                      }
                    >
                      <option value="">Нет</option>
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

            {tab === "publishing" ? (
              <ChannelManagerPublishingTab
                channel={activeChannel}
                canEditSetup={canEditSetup}
                onSaveSettings={onSavePublishSettings}
                onConnectYouTube={onConnectYouTube}
                onDisconnectYouTube={onDisconnectYouTube}
                onSelectYouTubeDestination={onSelectYouTubeDestination}
              />
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
                              activeChannel
                                ? triggerManagedChannelSave(activeChannel.id, {
                                    defaultBackgroundAssetId: asset.id
                                  })
                                : undefined
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
                            onClick={() =>
                              activeChannel
                                ? triggerManagedChannelSave(activeChannel.id, {
                                    defaultMusicAssetId: asset.id
                                  })
                                : undefined
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
                  <h3>Аватары ({avatars.length})</h3>
                  <ul className="details-log-list">
                    {avatars.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              activeChannel
                                ? triggerManagedChannelSave(activeChannel.id, {
                                    avatarAssetId: asset.id
                                  })
                                : undefined
                            }
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
