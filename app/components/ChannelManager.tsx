"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { AppShellToastTone } from "./AppShell";
import { AvatarUploadButton } from "./AvatarUploadButton";
import { ChannelManagerPublishingTab } from "./ChannelManagerPublishingTab";
import { ChannelManagerStage2Tab } from "./ChannelManagerStage2Tab";
import { ChannelManagerWorkspaceRenderTab } from "./ChannelManagerWorkspaceRenderTab";
import {
  AppRole,
  Channel,
  ChannelAccessGrant,
  ChannelAsset,
  ChannelAssetKind,
  ChannelFeedbackResponse,
  Stage3ExecutionCapabilities,
  Stage3ExecutionTarget,
  WorkspaceAnthropicIntegrationRecord,
  WorkspaceOpenRouterIntegrationRecord,
  WorkspaceMemberRecord,
  UserRecord
} from "./types";
import { STAGE3_TEMPLATE_ID } from "../../lib/stage3-template";
import type { ManagedTemplateSummary } from "../../lib/managed-template-types";
import { getTemplateVariant } from "../../lib/stage3-template-registry";
import type { Stage3TemplateFormatGroup } from "../../lib/stage3-template-semantics";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_REASONING_EFFORT_OPTIONS,
  type Stage2PromptSourceMode,
  type Stage2PromptConfig,
  normalizeStage2PromptConfig
} from "../../lib/stage2-pipeline";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_WORKSPACE_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  formatStage2DelimitedStringList,
  normalizeStage2ExamplesConfig,
  normalizeStage2HardConstraints,
  parseStage2DelimitedStringList,
  type Stage2ExamplesInputMode,
  type Stage2ExamplesSourceMode,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../../lib/stage2-channel-config";
import {
  findStage2SystemExamplesPresetByJson,
  getStage2SystemExamplesPresetJson,
  getStage2SystemPromptPreset,
  type Stage2SystemExamplesPresetId,
  type Stage2SystemPromptPresetId
} from "../../lib/stage2-system-presets";
import {
  DEFAULT_ANTHROPIC_CAPTION_MODEL,
  DEFAULT_OPENROUTER_CAPTION_MODEL,
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  normalizeStage2CaptionProviderConfig,
  type Stage2CaptionProvider,
  type Stage2CaptionProviderConfig
} from "../../lib/stage2-caption-provider";
import {
  normalizeWorkspaceCodexModelConfig,
  type ResolvedWorkspaceCodexModelConfig,
  type WorkspaceCodexModelConfig
} from "../../lib/workspace-codex-models";
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
  TabId
} from "./channel-manager-support";
import {
  buildStage3ClipDurationOptions,
  normalizeStage3ClipDurationSec
} from "../../lib/stage3-duration";

export { CHANNEL_MANAGER_DEFAULT_SETTINGS_ID, canDeleteManagedChannel, listChannelManagerTargets };

export function normalizeChannelManagerTabForSelection(
  tab: TabId,
  isWorkspaceDefaultsSelection: boolean
): TabId {
  if (!isWorkspaceDefaultsSelection) {
    return tab;
  }
  return tab === "stage2" || tab === "render" ? tab : "stage2";
}

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
  defaultClipDurationSec: number;
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

export function resolveChannelManagerTemplateFormatGroup(
  templateId: string,
  managedTemplates: ManagedTemplateSummary[]
): Stage3TemplateFormatGroup {
  const managedTemplate = managedTemplates.find((template) => template.id === templateId);
  const variantId = managedTemplate?.layoutFamily ?? managedTemplate?.baseTemplateId ?? templateId;
  return getTemplateVariant(variantId).formatGroup;
}

export function resolveChannelManagerCanEditChannelPrompt(input: {
  currentUserCanEditSetup: boolean;
  isWorkspaceDefaultsSelection: boolean;
}): boolean {
  return !input.isWorkspaceDefaultsSelection && input.currentUserCanEditSetup;
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
  if ("stage2ExamplesConfig" in patch || "stage2HardConstraints" in patch || "stage2PromptConfig" in patch) {
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
  if (
    "templateId" in patch ||
    "defaultBackgroundAssetId" in patch ||
    "defaultMusicAssetId" in patch ||
    "defaultClipDurationSec" in patch
  ) {
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
  workspaceStage2ExamplesConfig: Stage2ExamplesConfig;
  workspaceStage2HardConstraints: Stage2HardConstraints;
  workspaceStage2PromptConfig: Stage2PromptConfig;
  workspaceStage2CaptionProviderConfig: Stage2CaptionProviderConfig;
  workspaceAnthropicIntegration: WorkspaceAnthropicIntegrationRecord | null;
  workspaceOpenRouterIntegration: WorkspaceOpenRouterIntegrationRecord | null;
  workspaceCodexModelConfig: WorkspaceCodexModelConfig;
  workspaceResolvedCodexModelConfig: ResolvedWorkspaceCodexModelConfig;
  workspaceStage3ExecutionTarget: Stage3ExecutionTarget;
  workspaceResolvedStage3ExecutionTarget: Stage3ExecutionTarget;
  workspaceStage3ExecutionCapabilities: Stage3ExecutionCapabilities;
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
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2PromptConfig: Stage2PromptConfig;
      stage2CaptionProviderConfig: Stage2CaptionProviderConfig;
      codexModelConfig: WorkspaceCodexModelConfig;
    }>
  ) => Promise<void>;
  onSaveWorkspaceStage3ExecutionTarget: (target: Stage3ExecutionTarget) => Promise<void>;
  onRefreshWorkspaceState?: () => Promise<void>;
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

type AnthropicIntegrationActionState = {
  status: "idle" | "saving" | "saved" | "error";
  message: string | null;
};

type OpenRouterIntegrationActionState = {
  status: "idle" | "saving" | "saved" | "error";
  message: string | null;
};

export function ChannelManager({
  open,
  initialTab = null,
  channels,
  workspaceStage2ExamplesCorpusJson: workspaceStage2ExamplesCorpusJsonProp,
  workspaceStage2ExamplesConfig: workspaceStage2ExamplesConfigProp,
  workspaceStage2HardConstraints: workspaceStage2HardConstraintsProp,
  workspaceStage2PromptConfig: workspaceStage2PromptConfigProp,
  workspaceStage2CaptionProviderConfig: workspaceStage2CaptionProviderConfigProp,
  workspaceAnthropicIntegration: workspaceAnthropicIntegrationProp,
  workspaceOpenRouterIntegration: workspaceOpenRouterIntegrationProp,
  workspaceCodexModelConfig: workspaceCodexModelConfigProp,
  workspaceResolvedCodexModelConfig,
  workspaceStage3ExecutionTarget: workspaceStage3ExecutionTargetProp,
  workspaceResolvedStage3ExecutionTarget: workspaceResolvedStage3ExecutionTargetProp,
  workspaceStage3ExecutionCapabilities: workspaceStage3ExecutionCapabilitiesProp,
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
  onSaveWorkspaceStage3ExecutionTarget,
  onRefreshWorkspaceState = async () => undefined,
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
  const [stage2HardConstraints, setStage2HardConstraints] = useState<Stage2HardConstraints>(
    DEFAULT_STAGE2_HARD_CONSTRAINTS
  );
  const [stage2ExamplesConfig, setStage2ExamplesConfig] = useState<Stage2ExamplesConfig>(
    DEFAULT_STAGE2_EXAMPLES_CONFIG
  );
  const [stage2PromptConfig, setStage2PromptConfig] = useState<Stage2PromptConfig>({
    ...DEFAULT_STAGE2_PROMPT_CONFIG,
    useWorkspaceDefault: true
  });
  const [bannedWordsInput, setBannedWordsInput] = useState("");
  const [bannedOpenersInput, setBannedOpenersInput] = useState("");
  const [workspaceStage2ExamplesCorpusJson, setWorkspaceStage2ExamplesCorpusJson] = useState(
    workspaceStage2ExamplesCorpusJsonProp
  );
  const [workspaceStage2ExamplesConfig, setWorkspaceStage2ExamplesConfig] =
    useState<Stage2ExamplesConfig>(
      normalizeStage2ExamplesConfig(workspaceStage2ExamplesConfigProp, {
        channelId: "workspace-default",
        channelName: "Workspace default"
      })
    );
  const [workspaceStage2ExamplesSourceMode, setWorkspaceStage2ExamplesSourceMode] =
    useState<Stage2ExamplesSourceMode>(
      findStage2SystemExamplesPresetByJson(workspaceStage2ExamplesCorpusJsonProp)
        ? "system"
        : "custom"
    );
  const [workspaceStage2PromptConfig, setWorkspaceStage2PromptConfig] = useState<Stage2PromptConfig>(
    normalizeStage2PromptConfig(workspaceStage2PromptConfigProp)
  );
  const [workspaceStage2CaptionProviderConfig, setWorkspaceStage2CaptionProviderConfig] =
    useState<Stage2CaptionProviderConfig>(
      normalizeStage2CaptionProviderConfig(workspaceStage2CaptionProviderConfigProp)
    );
  const [workspaceAnthropicIntegration, setWorkspaceAnthropicIntegration] =
    useState<WorkspaceAnthropicIntegrationRecord | null>(workspaceAnthropicIntegrationProp);
  const [workspaceOpenRouterIntegration, setWorkspaceOpenRouterIntegration] =
    useState<WorkspaceOpenRouterIntegrationRecord | null>(workspaceOpenRouterIntegrationProp);
  const [anthropicApiKeyInput, setAnthropicApiKeyInput] = useState("");
  const [anthropicIntegrationActionState, setAnthropicIntegrationActionState] =
    useState<AnthropicIntegrationActionState>({
      status: "idle",
      message: null
    });
  const [openRouterApiKeyInput, setOpenRouterApiKeyInput] = useState("");
  const [openRouterIntegrationActionState, setOpenRouterIntegrationActionState] =
    useState<OpenRouterIntegrationActionState>({
      status: "idle",
      message: null
    });
  const [workspaceCodexModelConfig, setWorkspaceCodexModelConfig] =
    useState<WorkspaceCodexModelConfig>(
      normalizeWorkspaceCodexModelConfig(workspaceCodexModelConfigProp)
    );
  const [workspaceStage3ExecutionTarget, setWorkspaceStage3ExecutionTarget] =
    useState<Stage3ExecutionTarget>(workspaceStage3ExecutionTargetProp);
  const [workspaceResolvedStage3ExecutionTarget, setWorkspaceResolvedStage3ExecutionTarget] =
    useState<Stage3ExecutionTarget>(workspaceResolvedStage3ExecutionTargetProp);
  const [workspaceStage3ExecutionCapabilities, setWorkspaceStage3ExecutionCapabilities] =
    useState<Stage3ExecutionCapabilities>(workspaceStage3ExecutionCapabilitiesProp);
  const [workspaceStage3ExecutionSaveState, setWorkspaceStage3ExecutionSaveState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null
  });
  const [templateId, setTemplateId] = useState(STAGE3_TEMPLATE_ID);
  const [defaultClipDurationSec, setDefaultClipDurationSec] = useState(6);
  const [managedTemplates, setManagedTemplates] = useState<ManagedTemplateSummary[]>([]);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    brand: { status: "idle", message: null },
    stage2: { status: "idle", message: null },
    stage2Defaults: { status: "idle", message: null },
    render: { status: "idle", message: null }
  });
  const renderTemplateGroups = useMemo(
    () => groupManagedTemplatesByFormat(managedTemplates),
    [managedTemplates]
  );
  const clipDurationOptions = useMemo(() => buildStage3ClipDurationOptions(), []);
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
        stage2CaptionProviderConfig: Stage2CaptionProviderConfig;
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
    const normalizedTab = normalizeChannelManagerTabForSelection(tab, isWorkspaceDefaultsSelection);
    if (normalizedTab !== tab) {
      setTab(normalizedTab);
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
    nextHardConstraints: Stage2HardConstraints,
    nextExamplesConfig: Stage2ExamplesConfig,
    nextPromptConfig: Stage2PromptConfig
  ): string =>
    JSON.stringify({
      stage2HardConstraints: nextHardConstraints,
      stage2ExamplesConfig: nextExamplesConfig,
      stage2PromptConfig: nextPromptConfig
    });

  const buildStage2DefaultsSnapshot = (
    nextExamplesCorpusJson: string,
    nextExamplesConfig: Stage2ExamplesConfig,
    nextHardConstraints: Stage2HardConstraints,
    nextPromptConfig: Stage2PromptConfig,
    nextCaptionProviderConfig: Stage2CaptionProviderConfig,
    nextCodexModelConfig: WorkspaceCodexModelConfig
  ): string =>
    JSON.stringify({
      workspaceStage2ExamplesCorpusJson: nextExamplesCorpusJson,
      workspaceStage2ExamplesConfig: nextExamplesConfig,
      workspaceStage2HardConstraints: nextHardConstraints,
      workspaceStage2PromptConfig: nextPromptConfig,
      workspaceStage2CaptionProviderConfig: nextCaptionProviderConfig,
      workspaceCodexModelConfig: nextCodexModelConfig
    });

  const buildRenderSnapshot = (nextTemplateId: string, nextClipDurationSec: number): string =>
    JSON.stringify({
      templateId: nextTemplateId,
      defaultClipDurationSec: normalizeStage3ClipDurationSec(nextClipDurationSec)
    });

  useEffect(() => {
    const normalizedHardConstraints = normalizeStage2HardConstraints(workspaceStage2HardConstraintsProp);
    const normalizedPromptConfig = normalizeStage2PromptConfig(workspaceStage2PromptConfigProp);
    const normalizedCaptionProviderConfig = normalizeStage2CaptionProviderConfig(
      workspaceStage2CaptionProviderConfigProp
    );
    const normalizedCodexModelConfig = normalizeWorkspaceCodexModelConfig(
      workspaceCodexModelConfigProp
    );
    const normalizedWorkspaceExamplesJson = workspaceStage2ExamplesCorpusJsonProp;
    const normalizedWorkspaceExamplesConfig = normalizeStage2ExamplesConfig(
      workspaceStage2ExamplesConfigProp,
      {
        channelId: "workspace-default",
        channelName: "Workspace default"
      }
    );
    setStage2HardConstraints(normalizedHardConstraints);
    setStage2ExamplesConfig(DEFAULT_STAGE2_EXAMPLES_CONFIG);
    setStage2PromptConfig({
      ...DEFAULT_STAGE2_PROMPT_CONFIG,
      useWorkspaceDefault: true
    });
    setBannedWordsInput(formatStage2DelimitedStringList(normalizedHardConstraints.bannedWords));
    setBannedOpenersInput(formatStage2DelimitedStringList(normalizedHardConstraints.bannedOpeners));
    setWorkspaceStage2ExamplesCorpusJson(normalizedWorkspaceExamplesJson);
    setWorkspaceStage2ExamplesConfig(normalizedWorkspaceExamplesConfig);
    setWorkspaceStage2ExamplesSourceMode(
      findStage2SystemExamplesPresetByJson(normalizedWorkspaceExamplesJson) ? "system" : "custom"
    );
    setWorkspaceStage2PromptConfig(normalizedPromptConfig);
    setWorkspaceStage2CaptionProviderConfig(normalizedCaptionProviderConfig);
    setWorkspaceAnthropicIntegration(workspaceAnthropicIntegrationProp);
    setWorkspaceOpenRouterIntegration(workspaceOpenRouterIntegrationProp);
    setAnthropicApiKeyInput("");
    setAnthropicIntegrationActionState({ status: "idle", message: null });
    setOpenRouterApiKeyInput("");
    setOpenRouterIntegrationActionState({ status: "idle", message: null });
    setWorkspaceCodexModelConfig(normalizedCodexModelConfig);
    setWorkspaceStage3ExecutionTarget(workspaceStage3ExecutionTargetProp);
    setWorkspaceResolvedStage3ExecutionTarget(workspaceResolvedStage3ExecutionTargetProp);
    setWorkspaceStage3ExecutionCapabilities(workspaceStage3ExecutionCapabilitiesProp);
    setWorkspaceStage3ExecutionSaveState({ status: "idle", message: null });
    clearAutosaveReset("stage2Defaults");

    persistedSnapshotRef.current.stage2Defaults = buildStage2DefaultsSnapshot(
      normalizedWorkspaceExamplesJson,
      normalizedWorkspaceExamplesConfig,
      normalizedHardConstraints,
      normalizedPromptConfig,
      normalizedCaptionProviderConfig,
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

    setName(activeChannel.name);
    setUsername(activeChannel.username);
    const normalizedChannelHardConstraints = normalizeStage2HardConstraints(
      activeChannel.stage2HardConstraints
    );
    const normalizedChannelExamplesConfig = normalizeStage2ExamplesConfig(
      activeChannel.stage2ExamplesConfig,
      { channelId: activeChannel.id, channelName: activeChannel.name }
    );
    const normalizedChannelPromptConfig = normalizeStage2PromptConfig(activeChannel.stage2PromptConfig);
    setStage2HardConstraints(normalizedChannelHardConstraints);
    setStage2ExamplesConfig(normalizedChannelExamplesConfig);
    setStage2PromptConfig(normalizedChannelPromptConfig);
    setBannedWordsInput(formatStage2DelimitedStringList(normalizedChannelHardConstraints.bannedWords));
    setBannedOpenersInput(
      formatStage2DelimitedStringList(normalizedChannelHardConstraints.bannedOpeners)
    );
    setTemplateId(activeChannel.templateId);
    setDefaultClipDurationSec(normalizeStage3ClipDurationSec(activeChannel.defaultClipDurationSec));
    persistedSnapshotRef.current = {
      brand: buildBrandSnapshot(activeChannel.name, activeChannel.username),
      stage2: buildStage2Snapshot(
        normalizedChannelHardConstraints,
        normalizedChannelExamplesConfig,
        normalizedChannelPromptConfig
      ),
      stage2Defaults: buildStage2DefaultsSnapshot(
        normalizedWorkspaceExamplesJson,
        normalizedWorkspaceExamplesConfig,
        normalizedHardConstraints,
        normalizedPromptConfig,
        normalizedCaptionProviderConfig,
        normalizedCodexModelConfig
      ),
      render: buildRenderSnapshot(
        activeChannel.templateId,
        normalizeStage3ClipDurationSec(activeChannel.defaultClipDurationSec)
      )
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
    workspaceStage2HardConstraintsProp,
    workspaceStage2ExamplesCorpusJsonProp,
    workspaceStage2ExamplesConfigProp,
    workspaceStage2PromptConfigProp,
    workspaceStage2CaptionProviderConfigProp,
    workspaceAnthropicIntegrationProp,
    workspaceOpenRouterIntegrationProp,
    workspaceCodexModelConfigProp,
    workspaceStage3ExecutionCapabilitiesProp,
    workspaceStage3ExecutionTargetProp,
    workspaceResolvedStage3ExecutionTargetProp
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

  const canEditSetup = Boolean(activeChannel?.currentUserCanEditSetup);
  const canEditWorkspaceDefaults = isOwner && isWorkspaceDefaultsSelection;
  const canEditHardConstraints = isWorkspaceDefaultsSelection ? canEditWorkspaceDefaults : canEditSetup;
  const canEditChannelPrompt = resolveChannelManagerCanEditChannelPrompt({
    currentUserCanEditSetup: canEditSetup,
    isWorkspaceDefaultsSelection
  });

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
    if (!activeChannel || !canEditHardConstraints) {
      return;
    }
    if (skipAutosaveRef.current.stage2) {
      skipAutosaveRef.current.stage2 = false;
      return;
    }
    const nextSnapshot = buildStage2Snapshot(
      stage2HardConstraints,
      stage2ExamplesConfig,
      stage2PromptConfig
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
        stage2HardConstraints,
        stage2ExamplesConfig,
        ...(canEditChannelPrompt ? { stage2PromptConfig } : {})
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
    canEditChannelPrompt,
    canEditHardConstraints,
    clearAutosaveReset,
    resetAutosaveFeedbackIfNeeded,
    scheduleAutosaveReset,
    setAutosaveFeedback,
    stage2ExamplesConfig,
    stage2HardConstraints,
    stage2PromptConfig
  ]);

  useEffect(() => {
    if (!open || !canEditWorkspaceDefaults) {
      return;
    }
    if (skipAutosaveRef.current.stage2Defaults) {
      skipAutosaveRef.current.stage2Defaults = false;
      return;
    }
    const nextSnapshot = buildStage2DefaultsSnapshot(
      workspaceStage2ExamplesCorpusJson,
      workspaceStage2ExamplesConfig,
      stage2HardConstraints,
      workspaceStage2PromptConfig,
      workspaceStage2CaptionProviderConfig,
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
        stage2ExamplesCorpusJson: workspaceStage2ExamplesCorpusJson,
        stage2ExamplesConfig: workspaceStage2ExamplesConfig,
        stage2HardConstraints,
        stage2PromptConfig: workspaceStage2PromptConfig,
        stage2CaptionProviderConfig: workspaceStage2CaptionProviderConfig,
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
    stage2HardConstraints,
    workspaceStage2ExamplesCorpusJson,
    workspaceStage2ExamplesConfig,
    workspaceStage2PromptConfig,
    workspaceStage2CaptionProviderConfig,
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
    const nextSnapshot = buildRenderSnapshot(templateId, defaultClipDurationSec);
    if (nextSnapshot === persistedSnapshotRef.current.render) {
      resetAutosaveFeedbackIfNeeded("render");
      return;
    }
    clearAutosaveReset("render");
    setAutosaveFeedback("render", "pending", "Сохраним настройки рендера автоматически.");
    const revision = ++autosaveRevisionRef.current.render;
    const timerId = window.setTimeout(() => {
      setAutosaveFeedback("render", "saving", "Сохраняем рендер…");
      void saveChannelRef.current(activeChannel.id, {
        templateId,
        defaultClipDurationSec
      })
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
    defaultClipDurationSec,
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
  const activeTemplateFormatGroup = resolveChannelManagerTemplateFormatGroup(
    templateId,
    managedTemplates
  );

  const updateStage2PromptTemplate = (
    stageId: keyof Stage2PromptConfig["stages"],
    prompt: string
  ) => {
    setWorkspaceStage2PromptConfig((current) => ({
      ...current,
      ...(stageId === "oneShotReference" ? { sourceMode: "custom" as const } : {}),
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
      ...(stageId === "oneShotReference"
        ? {
            sourceMode: "system" as const,
            systemPresetId: "system_prompt" as const
          }
        : {}),
      stages: {
        ...current.stages,
        [stageId]: { ...DEFAULT_STAGE2_PROMPT_CONFIG.stages[stageId] }
      }
    }));
  };

  const buildPromptProfile = (input?: Partial<NonNullable<Stage2PromptConfig["formatProfiles"]>[Stage3TemplateFormatGroup]>) => {
    const presetId = input?.systemPresetId ?? "system_prompt";
    const sourceMode = input?.sourceMode ?? "system";
    return {
      useDefault: input?.useDefault ?? false,
      sourceMode,
      systemPresetId: presetId,
      stages:
        input?.stages ??
        normalizeStage2PromptConfig({
          ...DEFAULT_STAGE2_PROMPT_CONFIG,
          sourceMode,
          systemPresetId: presetId
        }).stages
    };
  };

  const buildExamplesProfile = (
    input?: Partial<NonNullable<Stage2ExamplesConfig["formatProfiles"]>[Stage3TemplateFormatGroup]>
  ) => {
    const sourceMode = input?.sourceMode ?? "system";
    const systemPresetId = input?.systemPresetId ?? "system_examples";
    return {
      useDefault: input?.useDefault ?? false,
      sourceMode,
      systemPresetId,
      customInputMode: input?.customInputMode ?? "json",
      customExamplesJson: input?.customExamplesJson ?? "",
      customExamplesText: input?.customExamplesText ?? "",
      customExamples: input?.customExamples ?? []
    };
  };

  const updatePromptFormatProfile = (
    setConfig: Dispatch<SetStateAction<Stage2PromptConfig>>,
    formatGroup: Stage3TemplateFormatGroup,
    updater: (current: ReturnType<typeof buildPromptProfile>) => ReturnType<typeof buildPromptProfile>
  ) => {
    setConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        formatProfiles: {
          ...current.formatProfiles,
          [formatGroup]: updater(buildPromptProfile(current.formatProfiles?.[formatGroup]))
        }
      })
    );
  };

  const updateExamplesFormatProfile = (
    setConfig: Dispatch<SetStateAction<Stage2ExamplesConfig>>,
    formatGroup: Stage3TemplateFormatGroup,
    updater: (current: ReturnType<typeof buildExamplesProfile>) => ReturnType<typeof buildExamplesProfile>,
    owner: { channelId: string; channelName: string }
  ) => {
    setConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          formatProfiles: {
            ...current.formatProfiles,
            [formatGroup]: updater(buildExamplesProfile(current.formatProfiles?.[formatGroup]))
          }
        },
        owner
      )
    );
  };

  const updateWorkspaceExamplesSourceMode = (sourceMode: Stage2ExamplesSourceMode) => {
    setWorkspaceStage2ExamplesSourceMode(sourceMode);
    setWorkspaceStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode
        },
        {
          channelId: "workspace-default",
          channelName: "Workspace default"
        }
      )
    );
    if (sourceMode === "system") {
      const presetId =
        findStage2SystemExamplesPresetByJson(workspaceStage2ExamplesCorpusJson) ??
        "system_examples";
      setWorkspaceStage2ExamplesCorpusJson(getStage2SystemExamplesPresetJson(presetId));
      setWorkspaceStage2ExamplesConfig((current) =>
        normalizeStage2ExamplesConfig(
          {
            ...current,
            useWorkspaceDefault: false,
            sourceMode: "system",
            systemPresetId: presetId
          },
          {
            channelId: "workspace-default",
            channelName: "Workspace default"
          }
        )
      );
    }
  };

  const updateWorkspaceExamplesPreset = (presetId: Stage2SystemExamplesPresetId) => {
    setWorkspaceStage2ExamplesSourceMode("system");
    setWorkspaceStage2ExamplesCorpusJson(getStage2SystemExamplesPresetJson(presetId));
    setWorkspaceStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode: "system",
          systemPresetId: presetId
        },
        {
          channelId: "workspace-default",
          channelName: "Workspace default"
        }
      )
    );
  };

  const updateWorkspaceExamplesJson = (value: string) => {
    setWorkspaceStage2ExamplesSourceMode("custom");
    setWorkspaceStage2ExamplesCorpusJson(value);
    setWorkspaceStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode: "custom",
          customInputMode: "json",
          customExamplesJson: value
        },
        {
          channelId: "workspace-default",
          channelName: "Workspace default"
        }
      )
    );
  };

  const updateWorkspacePromptSourceMode = (sourceMode: Stage2PromptSourceMode) => {
    setWorkspaceStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        sourceMode,
        stages: {
          ...current.stages,
          oneShotReference: {
            ...current.stages.oneShotReference,
            prompt:
              sourceMode === "system"
                ? getStage2SystemPromptPreset(current.systemPresetId).prompt
                : current.stages.oneShotReference.prompt
          }
        }
      })
    );
  };

  const updateWorkspacePromptPreset = (presetId: Stage2SystemPromptPresetId) => {
    const preset = getStage2SystemPromptPreset(presetId);
    setWorkspaceStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        sourceMode: "system",
        systemPresetId: preset.id,
        stages: {
          ...current.stages,
          oneShotReference: {
            ...current.stages.oneShotReference,
            prompt: preset.prompt
          }
        }
      })
    );
  };

  const updateWorkspaceFormatPromptMode = (
    formatGroup: Stage3TemplateFormatGroup,
    useDefault: boolean
  ) => {
    updatePromptFormatProfile(setWorkspaceStage2PromptConfig, formatGroup, (profile) => ({
      ...profile,
      useDefault
    }));
  };

  const updateWorkspaceFormatPromptSourceMode = (
    formatGroup: Stage3TemplateFormatGroup,
    sourceMode: Stage2PromptSourceMode
  ) => {
    updatePromptFormatProfile(setWorkspaceStage2PromptConfig, formatGroup, (profile) => {
      const preset = getStage2SystemPromptPreset(profile.systemPresetId);
      return {
        ...profile,
        useDefault: false,
        sourceMode,
        stages: {
          ...profile.stages,
          oneShotReference: {
            ...profile.stages.oneShotReference,
            prompt: sourceMode === "system" ? preset.prompt : profile.stages.oneShotReference.prompt
          }
        }
      };
    });
  };

  const updateWorkspaceFormatPromptPreset = (
    formatGroup: Stage3TemplateFormatGroup,
    presetId: Stage2SystemPromptPresetId
  ) => {
    const preset = getStage2SystemPromptPreset(presetId);
    updatePromptFormatProfile(setWorkspaceStage2PromptConfig, formatGroup, (profile) => ({
      ...profile,
      useDefault: false,
      sourceMode: "system",
      systemPresetId: preset.id,
      stages: {
        ...profile.stages,
        oneShotReference: {
          ...profile.stages.oneShotReference,
          prompt: preset.prompt
        }
      }
    }));
  };

  const updateWorkspaceFormatPromptTemplate = (
    formatGroup: Stage3TemplateFormatGroup,
    prompt: string
  ) => {
    updatePromptFormatProfile(setWorkspaceStage2PromptConfig, formatGroup, (profile) => ({
      ...profile,
      useDefault: false,
      sourceMode: "custom",
      stages: {
        ...profile.stages,
        oneShotReference: {
          ...profile.stages.oneShotReference,
          prompt
        }
      }
    }));
  };

  const updateChannelPromptMode = (useWorkspaceDefault: boolean) => {
    setStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        useWorkspaceDefault
      })
    );
  };

  const updateChannelPromptSourceMode = (sourceMode: Stage2PromptSourceMode) => {
    setStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        useWorkspaceDefault: false,
        sourceMode,
        stages: {
          ...current.stages,
          oneShotReference: {
            ...current.stages.oneShotReference,
            prompt:
              sourceMode === "system"
                ? getStage2SystemPromptPreset(current.systemPresetId).prompt
                : current.stages.oneShotReference.prompt
          }
        }
      })
    );
  };

  const updateChannelPromptPreset = (presetId: Stage2SystemPromptPresetId) => {
    const preset = getStage2SystemPromptPreset(presetId);
    setStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        useWorkspaceDefault: false,
        sourceMode: "system",
        systemPresetId: preset.id,
        stages: {
          ...current.stages,
          oneShotReference: {
            ...current.stages.oneShotReference,
            prompt: preset.prompt
          }
        }
      })
    );
  };

  const updateChannelPromptTemplate = (
    stageId: keyof Stage2PromptConfig["stages"],
    prompt: string
  ) => {
    setStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        useWorkspaceDefault: false,
        ...(stageId === "oneShotReference" ? { sourceMode: "custom" as const } : {}),
        stages: {
          ...current.stages,
          [stageId]: {
            ...current.stages[stageId],
            prompt
          }
        }
      })
    );
  };

  const updateChannelPromptReasoning = (
    stageId: keyof Stage2PromptConfig["stages"],
    reasoningEffort: Stage2PromptConfig["stages"][keyof Stage2PromptConfig["stages"]]["reasoningEffort"]
  ) => {
    setStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        useWorkspaceDefault: false,
        stages: {
          ...current.stages,
          [stageId]: {
            ...current.stages[stageId],
            reasoningEffort
          }
        }
      })
    );
  };

  const resetChannelPromptStage = (stageId: keyof Stage2PromptConfig["stages"]) => {
    setStage2PromptConfig((current) =>
      normalizeStage2PromptConfig({
        ...current,
        useWorkspaceDefault: false,
        sourceMode: "system",
        systemPresetId: "system_prompt",
        stages: {
          ...current.stages,
          [stageId]: { ...DEFAULT_STAGE2_PROMPT_CONFIG.stages[stageId] }
        }
      })
    );
  };

  const updateChannelFormatPromptMode = (
    formatGroup: Stage3TemplateFormatGroup,
    useDefault: boolean
  ) => {
    updatePromptFormatProfile(setStage2PromptConfig, formatGroup, (profile) => ({
      ...profile,
      useDefault
    }));
  };

  const updateChannelFormatPromptSourceMode = (
    formatGroup: Stage3TemplateFormatGroup,
    sourceMode: Stage2PromptSourceMode
  ) => {
    updatePromptFormatProfile(setStage2PromptConfig, formatGroup, (profile) => {
      const preset = getStage2SystemPromptPreset(profile.systemPresetId);
      return {
        ...profile,
        useDefault: false,
        sourceMode,
        stages: {
          ...profile.stages,
          oneShotReference: {
            ...profile.stages.oneShotReference,
            prompt: sourceMode === "system" ? preset.prompt : profile.stages.oneShotReference.prompt
          }
        }
      };
    });
  };

  const updateChannelFormatPromptPreset = (
    formatGroup: Stage3TemplateFormatGroup,
    presetId: Stage2SystemPromptPresetId
  ) => {
    const preset = getStage2SystemPromptPreset(presetId);
    updatePromptFormatProfile(setStage2PromptConfig, formatGroup, (profile) => ({
      ...profile,
      useDefault: false,
      sourceMode: "system",
      systemPresetId: preset.id,
      stages: {
        ...profile.stages,
        oneShotReference: {
          ...profile.stages.oneShotReference,
          prompt: preset.prompt
        }
      }
    }));
  };

  const updateChannelFormatPromptTemplate = (
    formatGroup: Stage3TemplateFormatGroup,
    prompt: string
  ) => {
    updatePromptFormatProfile(setStage2PromptConfig, formatGroup, (profile) => ({
      ...profile,
      useDefault: false,
      sourceMode: "custom",
      stages: {
        ...profile.stages,
        oneShotReference: {
          ...profile.stages.oneShotReference,
          prompt
        }
      }
    }));
  };

  const persistWorkspaceCaptionProviderConfig = async (
    nextConfig: Stage2CaptionProviderConfig,
    previousConfig: Stage2CaptionProviderConfig
  ): Promise<void> => {
    const nextSnapshot = buildStage2DefaultsSnapshot(
      workspaceStage2ExamplesCorpusJson,
      workspaceStage2ExamplesConfig,
      stage2HardConstraints,
      workspaceStage2PromptConfig,
      nextConfig,
      workspaceCodexModelConfig
    );
    const saveRevision = ++autosaveRevisionRef.current.stage2Defaults;
    clearAutosaveReset("stage2Defaults");
    setAutosaveFeedback("stage2Defaults", "saving", "Сохраняем общие AI-настройки…");
    try {
      await saveWorkspaceStage2DefaultsRef.current({
        stage2ExamplesCorpusJson: workspaceStage2ExamplesCorpusJson,
        stage2ExamplesConfig: workspaceStage2ExamplesConfig,
        stage2HardConstraints,
        stage2PromptConfig: workspaceStage2PromptConfig,
        stage2CaptionProviderConfig: nextConfig,
        codexModelConfig: workspaceCodexModelConfig
      });
      if (autosaveRevisionRef.current.stage2Defaults !== saveRevision) {
        return;
      }
      persistedSnapshotRef.current.stage2Defaults = nextSnapshot;
      skipAutosaveRef.current.stage2Defaults = true;
      setAutosaveFeedback("stage2Defaults", "saved", "Общие AI-настройки сохранены.");
      scheduleAutosaveReset("stage2Defaults");
    } catch (error) {
      if (autosaveRevisionRef.current.stage2Defaults !== saveRevision) {
        return;
      }
      skipAutosaveRef.current.stage2Defaults = true;
      setWorkspaceStage2CaptionProviderConfig(previousConfig);
      setAutosaveFeedback(
        "stage2Defaults",
        "error",
        error instanceof Error && error.message
          ? error.message
          : "Не удалось сохранить общие AI-настройки."
      );
    }
  };

  const updateWorkspaceCaptionProvider = (provider: Stage2CaptionProvider) => {
    if (!canEditWorkspaceDefaults) {
      return;
    }
    const previousConfig = workspaceStage2CaptionProviderConfig;
    const nextConfig = normalizeStage2CaptionProviderConfig({
      ...workspaceStage2CaptionProviderConfig,
      provider
    });
    skipAutosaveRef.current.stage2Defaults = true;
    setWorkspaceStage2CaptionProviderConfig(nextConfig);
    void persistWorkspaceCaptionProviderConfig(nextConfig, previousConfig);
  };

  const saveWorkspaceStage3ExecutionTarget = async (
    nextTarget: Stage3ExecutionTarget
  ): Promise<void> => {
    if (!canEditWorkspaceDefaults || nextTarget === workspaceStage3ExecutionTarget) {
      return;
    }
    const previousConfigured = workspaceStage3ExecutionTarget;
    const previousResolved = workspaceResolvedStage3ExecutionTarget;
    setWorkspaceStage3ExecutionTarget(nextTarget);
    setWorkspaceResolvedStage3ExecutionTarget(nextTarget);
    setWorkspaceStage3ExecutionSaveState({
      status: "saving",
      message: "Сохраняем режим выполнения Stage 3…"
    });
    showManagerSaveNotice("neutral", "Сохраняем режим выполнения Stage 3…");
    try {
      await onSaveWorkspaceStage3ExecutionTarget(nextTarget);
      setWorkspaceStage3ExecutionSaveState({
        status: "saved",
        message: "Режим выполнения Stage 3 сохранён."
      });
      showManagerSaveNotice("success", "Режим выполнения Stage 3 сохранён.", true);
    } catch (error) {
      setWorkspaceStage3ExecutionTarget(previousConfigured);
      setWorkspaceResolvedStage3ExecutionTarget(previousResolved);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось сохранить режим выполнения Stage 3.";
      setWorkspaceStage3ExecutionSaveState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
      throw error;
    }
  };

  const updateWorkspaceAnthropicModel = (value: string) => {
    setWorkspaceStage2CaptionProviderConfig((current) => ({
      ...current,
      anthropicModel: value
    }));
  };

  const updateWorkspaceOpenRouterModel = (value: string) => {
    setWorkspaceStage2CaptionProviderConfig((current) => ({
      ...current,
      openrouterModel: value
    }));
  };

  const saveWorkspaceAnthropicIntegration = async (): Promise<void> => {
    const model =
      workspaceStage2CaptionProviderConfig.anthropicModel?.trim() ||
      DEFAULT_ANTHROPIC_CAPTION_MODEL;
    const apiKey = anthropicApiKeyInput.trim();
    if (!apiKey) {
      setAnthropicIntegrationActionState({
        status: "error",
        message: "Введите Anthropic API key, чтобы подключить captions."
      });
      return;
    }

    setAnthropicIntegrationActionState({
      status: "saving",
      message: "Проверяем Anthropic API key…"
    });
    showManagerSaveNotice("neutral", "Проверяем Anthropic API key…");
    try {
      const response = await fetch("/api/workspace/integrations/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          apiKey,
          model
        })
      });
      if (!response.ok) {
        throw new Error("Не удалось сохранить Anthropic integration.");
      }
      const body = (await response.json()) as {
        integration?: WorkspaceAnthropicIntegrationRecord;
      };
      const integration = body.integration ?? null;
      setWorkspaceAnthropicIntegration(integration);
      if (integration?.status === "connected") {
        setAnthropicApiKeyInput("");
        await onRefreshWorkspaceState().catch(() => undefined);
        setAnthropicIntegrationActionState({
          status: "saved",
          message: "Anthropic captions подключены и проверены."
        });
        showManagerSaveNotice("success", "Anthropic captions подключены.", true);
        return;
      }
      const message =
        integration?.lastError?.trim() || "Anthropic API key не прошёл проверку.";
      setAnthropicIntegrationActionState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось сохранить Anthropic integration.";
      setAnthropicIntegrationActionState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
    }
  };

  const disconnectWorkspaceAnthropicIntegration = async (): Promise<void> => {
    const previousConfig = workspaceStage2CaptionProviderConfig;
    const wasAnthropicProviderActive = previousConfig.provider === "anthropic";
    setAnthropicIntegrationActionState({
      status: "saving",
      message: "Отключаем Anthropic captions…"
    });
    showManagerSaveNotice("neutral", "Отключаем Anthropic captions…");
    try {
      const response = await fetch("/api/workspace/integrations/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disconnect"
        })
      });
      if (!response.ok) {
        throw new Error("Не удалось отключить Anthropic integration.");
      }
      const body = (await response.json()) as {
        integration?: WorkspaceAnthropicIntegrationRecord;
      };
      setWorkspaceAnthropicIntegration(body.integration ?? null);
      setAnthropicApiKeyInput("");
      await onRefreshWorkspaceState().catch(() => undefined);
      if (wasAnthropicProviderActive) {
        const nextConfig = normalizeStage2CaptionProviderConfig({
          ...previousConfig,
          provider: "codex"
        });
        skipAutosaveRef.current.stage2Defaults = true;
        setWorkspaceStage2CaptionProviderConfig(nextConfig);
        void persistWorkspaceCaptionProviderConfig(nextConfig, previousConfig);
      }
      setAnthropicIntegrationActionState({
        status: "saved",
        message: "Anthropic captions отключены."
      });
      showManagerSaveNotice("success", "Anthropic captions отключены.", true);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось отключить Anthropic integration.";
      setAnthropicIntegrationActionState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
    }
  };

  const saveWorkspaceOpenRouterIntegration = async (): Promise<void> => {
    const model =
      workspaceStage2CaptionProviderConfig.openrouterModel?.trim() ||
      DEFAULT_OPENROUTER_CAPTION_MODEL;
    const apiKey = openRouterApiKeyInput.trim();
    if (!apiKey) {
      setOpenRouterIntegrationActionState({
        status: "error",
        message: "Введите OpenRouter API key, чтобы подключить captions."
      });
      return;
    }

    setOpenRouterIntegrationActionState({
      status: "saving",
      message: "Проверяем OpenRouter API key…"
    });
    showManagerSaveNotice("neutral", "Проверяем OpenRouter API key…");
    try {
      const response = await fetch("/api/workspace/integrations/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          apiKey,
          model
        })
      });
      if (!response.ok) {
        throw new Error("Не удалось сохранить OpenRouter integration.");
      }
      const body = (await response.json()) as {
        integration?: WorkspaceOpenRouterIntegrationRecord;
      };
      const integration = body.integration ?? null;
      setWorkspaceOpenRouterIntegration(integration);
      if (integration?.status === "connected") {
        setOpenRouterApiKeyInput("");
        await onRefreshWorkspaceState().catch(() => undefined);
        setOpenRouterIntegrationActionState({
          status: "saved",
          message: "OpenRouter captions подключены и проверены."
        });
        showManagerSaveNotice("success", "OpenRouter captions подключены.", true);
        return;
      }
      const message =
        integration?.lastError?.trim() || "OpenRouter API key не прошёл проверку.";
      setOpenRouterIntegrationActionState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось сохранить OpenRouter integration.";
      setOpenRouterIntegrationActionState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
    }
  };

  const disconnectWorkspaceOpenRouterIntegration = async (): Promise<void> => {
    const previousConfig = workspaceStage2CaptionProviderConfig;
    const wasOpenRouterProviderActive = previousConfig.provider === "openrouter";
    setOpenRouterIntegrationActionState({
      status: "saving",
      message: "Отключаем OpenRouter captions…"
    });
    showManagerSaveNotice("neutral", "Отключаем OpenRouter captions…");
    try {
      const response = await fetch("/api/workspace/integrations/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disconnect"
        })
      });
      if (!response.ok) {
        throw new Error("Не удалось отключить OpenRouter integration.");
      }
      const body = (await response.json()) as {
        integration?: WorkspaceOpenRouterIntegrationRecord;
      };
      setWorkspaceOpenRouterIntegration(body.integration ?? null);
      setOpenRouterApiKeyInput("");
      await onRefreshWorkspaceState().catch(() => undefined);
      if (wasOpenRouterProviderActive) {
        const nextConfig = normalizeStage2CaptionProviderConfig({
          ...previousConfig,
          provider: "codex"
        });
        skipAutosaveRef.current.stage2Defaults = true;
        setWorkspaceStage2CaptionProviderConfig(nextConfig);
        void persistWorkspaceCaptionProviderConfig(nextConfig, previousConfig);
      }
      setOpenRouterIntegrationActionState({
        status: "saved",
        message: "OpenRouter captions отключены."
      });
      showManagerSaveNotice("success", "OpenRouter captions отключены.", true);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Не удалось отключить OpenRouter integration.";
      setOpenRouterIntegrationActionState({
        status: "error",
        message
      });
      showManagerSaveNotice("error", message);
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

  const updateChannelExamplesMode = (useWorkspaceDefault: boolean) => {
    setStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault
        },
        {
          channelId: activeChannel?.id ?? "channel",
          channelName: activeChannel?.name ?? name
        }
      )
    );
  };

  const updateChannelExamplesSourceMode = (sourceMode: Stage2ExamplesSourceMode) => {
    setStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode
        },
        {
          channelId: activeChannel?.id ?? "channel",
          channelName: activeChannel?.name ?? name
        }
      )
    );
  };

  const updateChannelExamplesSystemPreset = (systemPresetId: Stage2SystemExamplesPresetId) => {
    setStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode: "system",
          systemPresetId
        },
        {
          channelId: activeChannel?.id ?? "channel",
          channelName: activeChannel?.name ?? name
        }
      )
    );
  };

  const updateChannelExamplesInputMode = (customInputMode: Stage2ExamplesInputMode) => {
    setStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode: "custom",
          customInputMode
        },
        {
          channelId: activeChannel?.id ?? "channel",
          channelName: activeChannel?.name ?? name
        }
      )
    );
  };

  const updateCustomExamplesJson = (value: string) => {
    setStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode: "custom",
          customInputMode: "json",
          customExamplesJson: value
        },
        {
          channelId: activeChannel?.id ?? "channel",
          channelName: activeChannel?.name ?? name
        }
      )
    );
  };

  const updateCustomExamplesText = (value: string) => {
    setStage2ExamplesConfig((current) =>
      normalizeStage2ExamplesConfig(
        {
          ...current,
          useWorkspaceDefault: false,
          sourceMode: "custom",
          customInputMode: "text",
          customExamplesText: value
        },
        {
          channelId: activeChannel?.id ?? "channel",
          channelName: activeChannel?.name ?? name
        }
      )
    );
  };

  const workspaceExamplesOwner = {
    channelId: "workspace-default",
    channelName: "Workspace default"
  };
  const channelExamplesOwner = {
    channelId: activeChannel?.id ?? "channel",
    channelName: activeChannel?.name ?? name
  };

  const updateWorkspaceFormatExamplesMode = (
    formatGroup: Stage3TemplateFormatGroup,
    useDefault: boolean
  ) => {
    updateExamplesFormatProfile(
      setWorkspaceStage2ExamplesConfig,
      formatGroup,
      (profile) => ({ ...profile, useDefault }),
      workspaceExamplesOwner
    );
  };

  const updateWorkspaceFormatExamplesSourceMode = (
    formatGroup: Stage3TemplateFormatGroup,
    sourceMode: Stage2ExamplesSourceMode
  ) => {
    updateExamplesFormatProfile(
      setWorkspaceStage2ExamplesConfig,
      formatGroup,
      (profile) => ({ ...profile, useDefault: false, sourceMode }),
      workspaceExamplesOwner
    );
  };

  const updateWorkspaceFormatExamplesPreset = (
    formatGroup: Stage3TemplateFormatGroup,
    presetId: Stage2SystemExamplesPresetId
  ) => {
    updateExamplesFormatProfile(
      setWorkspaceStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "system",
        systemPresetId: presetId
      }),
      workspaceExamplesOwner
    );
  };

  const updateWorkspaceFormatExamplesInputMode = (
    formatGroup: Stage3TemplateFormatGroup,
    customInputMode: Stage2ExamplesInputMode
  ) => {
    updateExamplesFormatProfile(
      setWorkspaceStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "custom",
        customInputMode
      }),
      workspaceExamplesOwner
    );
  };

  const updateWorkspaceFormatExamplesJson = (
    formatGroup: Stage3TemplateFormatGroup,
    value: string
  ) => {
    updateExamplesFormatProfile(
      setWorkspaceStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "custom",
        customInputMode: "json",
        customExamplesJson: value
      }),
      workspaceExamplesOwner
    );
  };

  const updateWorkspaceFormatExamplesText = (
    formatGroup: Stage3TemplateFormatGroup,
    value: string
  ) => {
    updateExamplesFormatProfile(
      setWorkspaceStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "custom",
        customInputMode: "text",
        customExamplesText: value
      }),
      workspaceExamplesOwner
    );
  };

  const updateChannelFormatExamplesMode = (
    formatGroup: Stage3TemplateFormatGroup,
    useDefault: boolean
  ) => {
    updateExamplesFormatProfile(
      setStage2ExamplesConfig,
      formatGroup,
      (profile) => ({ ...profile, useDefault }),
      channelExamplesOwner
    );
  };

  const updateChannelFormatExamplesSourceMode = (
    formatGroup: Stage3TemplateFormatGroup,
    sourceMode: Stage2ExamplesSourceMode
  ) => {
    updateExamplesFormatProfile(
      setStage2ExamplesConfig,
      formatGroup,
      (profile) => ({ ...profile, useDefault: false, sourceMode }),
      channelExamplesOwner
    );
  };

  const updateChannelFormatExamplesSystemPreset = (
    formatGroup: Stage3TemplateFormatGroup,
    presetId: Stage2SystemExamplesPresetId
  ) => {
    updateExamplesFormatProfile(
      setStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "system",
        systemPresetId: presetId
      }),
      channelExamplesOwner
    );
  };

  const updateChannelFormatExamplesInputMode = (
    formatGroup: Stage3TemplateFormatGroup,
    customInputMode: Stage2ExamplesInputMode
  ) => {
    updateExamplesFormatProfile(
      setStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "custom",
        customInputMode
      }),
      channelExamplesOwner
    );
  };

  const updateChannelFormatExamplesJson = (
    formatGroup: Stage3TemplateFormatGroup,
    value: string
  ) => {
    updateExamplesFormatProfile(
      setStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "custom",
        customInputMode: "json",
        customExamplesJson: value
      }),
      channelExamplesOwner
    );
  };

  const updateChannelFormatExamplesText = (
    formatGroup: Stage3TemplateFormatGroup,
    value: string
  ) => {
    updateExamplesFormatProfile(
      setStage2ExamplesConfig,
      formatGroup,
      (profile) => ({
        ...profile,
        useDefault: false,
        sourceMode: "custom",
        customInputMode: "text",
        customExamplesText: value
      }),
      channelExamplesOwner
    );
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
            ? (["stage2", "render"] as const)
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
                stage2HardConstraints={stage2HardConstraints}
                bannedWordsInput={bannedWordsInput}
                bannedOpenersInput={bannedOpenersInput}
                stage2PromptConfig={stage2PromptConfig}
                activeTemplateFormatGroup={activeTemplateFormatGroup}
                workspaceStage2ExamplesCorpusJson={workspaceStage2ExamplesCorpusJson}
                workspaceStage2ExamplesConfig={workspaceStage2ExamplesConfig}
                workspaceStage2ExamplesSourceMode={workspaceStage2ExamplesSourceMode}
                workspaceStage2PromptConfig={workspaceStage2PromptConfig}
                workspaceStage2CaptionProviderConfig={workspaceStage2CaptionProviderConfig}
                workspaceAnthropicIntegration={workspaceAnthropicIntegration}
                workspaceOpenRouterIntegration={workspaceOpenRouterIntegration}
                anthropicApiKeyInput={anthropicApiKeyInput}
                anthropicIntegrationActionState={anthropicIntegrationActionState}
                openRouterApiKeyInput={openRouterApiKeyInput}
                openRouterIntegrationActionState={openRouterIntegrationActionState}
                workspaceCodexModelConfig={workspaceCodexModelConfig}
                resolvedWorkspaceCodexModelConfig={workspaceResolvedCodexModelConfig}
                autosaveState={autosaveState}
                canEditWorkspaceDefaults={canEditWorkspaceDefaults}
                canEditHardConstraints={canEditHardConstraints}
                canEditChannelExamples={canEditSetup}
                canEditChannelPrompt={canEditChannelPrompt}
                stage2ExamplesConfig={stage2ExamplesConfig}
                customExamplesJson={stage2ExamplesConfig.customExamplesJson}
                customExamplesText={stage2ExamplesConfig.customExamplesText}
                customExamplesCount={stage2ExamplesConfig.customExamples.length}
                updateChannelExamplesMode={updateChannelExamplesMode}
                updateChannelExamplesSourceMode={updateChannelExamplesSourceMode}
                updateChannelExamplesSystemPreset={updateChannelExamplesSystemPreset}
                updateChannelExamplesInputMode={updateChannelExamplesInputMode}
                updateChannelFormatExamplesMode={updateChannelFormatExamplesMode}
                updateChannelFormatExamplesSourceMode={updateChannelFormatExamplesSourceMode}
                updateChannelFormatExamplesSystemPreset={updateChannelFormatExamplesSystemPreset}
                updateChannelFormatExamplesInputMode={updateChannelFormatExamplesInputMode}
                updateChannelFormatExamplesJson={updateChannelFormatExamplesJson}
                updateChannelFormatExamplesText={updateChannelFormatExamplesText}
                updateChannelPromptMode={updateChannelPromptMode}
                updateChannelPromptSourceMode={updateChannelPromptSourceMode}
                updateChannelPromptPreset={updateChannelPromptPreset}
                updateChannelFormatPromptMode={updateChannelFormatPromptMode}
                updateChannelFormatPromptSourceMode={updateChannelFormatPromptSourceMode}
                updateChannelFormatPromptPreset={updateChannelFormatPromptPreset}
                updateChannelFormatPromptTemplate={updateChannelFormatPromptTemplate}
                updateChannelPromptTemplate={updateChannelPromptTemplate}
                updateChannelPromptReasoning={updateChannelPromptReasoning}
                resetChannelPromptStage={resetChannelPromptStage}
                updateWorkspacePromptSourceMode={updateWorkspacePromptSourceMode}
                updateWorkspacePromptPreset={updateWorkspacePromptPreset}
                updateWorkspaceExamplesSourceMode={updateWorkspaceExamplesSourceMode}
                updateWorkspaceExamplesJson={updateWorkspaceExamplesJson}
                updateWorkspaceExamplesPreset={updateWorkspaceExamplesPreset}
                updateWorkspaceFormatPromptMode={updateWorkspaceFormatPromptMode}
                updateWorkspaceFormatPromptSourceMode={updateWorkspaceFormatPromptSourceMode}
                updateWorkspaceFormatPromptPreset={updateWorkspaceFormatPromptPreset}
                updateWorkspaceFormatPromptTemplate={updateWorkspaceFormatPromptTemplate}
                updateWorkspaceFormatExamplesMode={updateWorkspaceFormatExamplesMode}
                updateWorkspaceFormatExamplesSourceMode={updateWorkspaceFormatExamplesSourceMode}
                updateWorkspaceFormatExamplesPreset={updateWorkspaceFormatExamplesPreset}
                updateWorkspaceFormatExamplesInputMode={updateWorkspaceFormatExamplesInputMode}
                updateWorkspaceFormatExamplesJson={updateWorkspaceFormatExamplesJson}
                updateWorkspaceFormatExamplesText={updateWorkspaceFormatExamplesText}
                updateCustomExamplesJson={updateCustomExamplesJson}
                updateCustomExamplesText={updateCustomExamplesText}
                updateWorkspaceCaptionProvider={updateWorkspaceCaptionProvider}
                updateWorkspaceAnthropicModel={updateWorkspaceAnthropicModel}
                updateWorkspaceOpenRouterModel={updateWorkspaceOpenRouterModel}
                updateAnthropicApiKeyInput={setAnthropicApiKeyInput}
                saveWorkspaceAnthropicIntegration={saveWorkspaceAnthropicIntegration}
                disconnectWorkspaceAnthropicIntegration={disconnectWorkspaceAnthropicIntegration}
                updateOpenRouterApiKeyInput={setOpenRouterApiKeyInput}
                saveWorkspaceOpenRouterIntegration={saveWorkspaceOpenRouterIntegration}
                disconnectWorkspaceOpenRouterIntegration={disconnectWorkspaceOpenRouterIntegration}
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
              isWorkspaceDefaultsSelection ? (
                <ChannelManagerWorkspaceRenderTab
                  canEditWorkspaceDefaults={canEditWorkspaceDefaults}
                  configuredTarget={workspaceStage3ExecutionTarget}
                  resolvedTarget={workspaceResolvedStage3ExecutionTarget}
                  capabilities={workspaceStage3ExecutionCapabilities}
                  saveState={workspaceStage3ExecutionSaveState}
                  onChangeTarget={(target) => {
                    void saveWorkspaceStage3ExecutionTarget(target).catch(() => undefined);
                  }}
                />
              ) : (
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
                      <label className="field-label">Хронометраж по умолчанию</label>
                      <select
                        className="text-input"
                        value={String(defaultClipDurationSec)}
                        disabled={!canEditSetup}
                        onChange={(event) =>
                          setDefaultClipDurationSec(
                            normalizeStage3ClipDurationSec(Number.parseInt(event.target.value, 10))
                          )
                        }
                      >
                        {clipDurationOptions.map((value) => (
                          <option key={value} value={String(value)}>
                            {value} сек
                          </option>
                        ))}
                      </select>
                    </div>
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
              )
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
