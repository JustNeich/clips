import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { normalizeChannelManagerTabForSelection } from "../app/components/ChannelManager";
import { Step3RenderTemplate } from "../app/components/Step3RenderTemplate";
import { ChannelManagerWorkspaceRenderTab } from "../app/components/ChannelManagerWorkspaceRenderTab";

function makeStep3RenderTemplateProps(
  overrides?: Partial<React.ComponentProps<typeof Step3RenderTemplate>>
): React.ComponentProps<typeof Step3RenderTemplate> {
  return {
    sourceUrl: "https://example.com/source",
    templateId: "science-card-v1",
    channelName: "Echoes Of Honor",
    channelUsername: "EchoesOfHonor50",
    avatarUrl: null,
    previewVideoUrl: null,
    backgroundAssetUrl: null,
    backgroundAssetMimeType: null,
    backgroundOptions: [],
    musicOptions: [],
    selectedBackgroundAssetId: null,
    selectedMusicAssetId: null,
    selectedMusicAssetUrl: null,
    versions: [],
    selectedVersionId: null,
    selectedPassIndex: 0,
    previewState: "idle",
    previewNotice: null,
    agentPrompt: "",
    agentSession: null,
    agentMessages: [],
    agentCurrentScore: null,
    isAgentTimelineLoading: false,
    canResumeAgent: false,
    canRollbackSelectedVersion: false,
    topText: "Final top text",
    bottomText: "Final bottom text",
    captionSources: [
      {
        option: 1,
        top: "Option one top",
        bottom: "Option one bottom",
        highlights: { top: [], bottom: [] }
      }
    ],
    selectedCaptionOption: 1,
    handoffSummary: {
      stage2Available: true,
      defaultCaptionOption: 1,
      selectedCaptionOption: 1,
      defaultTitleOption: 1,
      selectedTitleOption: 1,
      caption: {
        option: 1,
        top: "Option one top",
        bottom: "Option one bottom",
        highlights: { top: [], bottom: [] }
      },
      title: {
        option: 1,
        title: "Title one"
      },
      topText: "Final top text",
      bottomText: "Final bottom text",
      topTextSource: "selected_caption",
      bottomTextSource: "selected_caption",
      hasManualTextOverride: false,
      canResetToSelectedCaption: true,
      latestVersionId: null,
      hasStage3Overrides: false
    },
    segments: [],
    compressionEnabled: false,
    timingMode: "auto",
    renderPolicy: "fixed_segments",
    renderState: "idle",
    executionTarget: "local",
    workerState: "not_paired",
    workerLabel: null,
    workerPlatform: null,
    workerLastSeenAt: null,
    workerCurrentJobKind: null,
    workerPairing: null,
    isWorkerPairing: false,
    showWorkerControls: false,
    isOptimizing: false,
    isUploadingBackground: false,
    isUploadingMusic: false,
    clipStartSec: 0,
    clipDurationSec: 6,
    sourceDurationSec: 15,
    focusY: 0.5,
    cameraMotion: "disabled",
    cameraKeyframes: [],
    cameraPositionKeyframes: [],
    cameraScaleKeyframes: [],
    mirrorEnabled: false,
    videoZoom: 1,
    videoBrightness: 1,
    videoExposure: 0,
    videoContrast: 1,
    videoSaturation: 1,
    topFontScale: 1,
    bottomFontScale: 1,
    sourceAudioEnabled: true,
    musicGain: 0,
    onRender: () => undefined,
    onPublishAfterRenderChange: () => undefined,
    onExport: () => undefined,
    onOptimize: () => undefined,
    onResumeAgent: () => undefined,
    onRollbackSelectedVersion: () => undefined,
    onReset: () => undefined,
    onTopTextChange: () => undefined,
    onBottomTextChange: () => undefined,
    onApplyCaptionSource: () => undefined,
    onResetCaptionText: () => undefined,
    onUploadBackground: async () => undefined,
    onUploadMusic: async () => undefined,
    onClearBackground: () => undefined,
    onClearMusic: () => undefined,
    onSelectBackgroundAssetId: () => undefined,
    onSelectMusicAssetId: () => undefined,
    onSelectVersionId: () => undefined,
    onSelectPassIndex: () => undefined,
    onAgentPromptChange: () => undefined,
    onFragmentStateChange: () => undefined,
    onClipStartChange: () => undefined,
    onFocusYChange: () => undefined,
    onCameraPositionKeyframesChange: () => undefined,
    onCameraScaleKeyframesChange: () => undefined,
    onMirrorEnabledChange: () => undefined,
    onVideoZoomChange: () => undefined,
    onVideoBrightnessChange: () => undefined,
    onVideoExposureChange: () => undefined,
    onVideoContrastChange: () => undefined,
    onVideoSaturationChange: () => undefined,
    onTopFontScaleChange: () => undefined,
    onBottomFontScaleChange: () => undefined,
    onSourceAudioEnabledChange: () => undefined,
    onMusicGainChange: () => undefined,
    onCreateWorkerPairing: () => undefined,
    onManagedTemplateStateChange: () => undefined,
    onOpenPlanner: () => undefined,
    ...overrides
  };
}

test("step 3 host mode shows hosting execution state and hides executor setup controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Step3RenderTemplate,
      makeStep3RenderTemplateProps({
        executionTarget: "host",
        showWorkerControls: false
      })
    )
  );

  assert.match(html, /Execution: Хостинг/);
  assert.match(html, /Локальный executor для preview, render и соседних heavy-задач не требуется/i);
  assert.doesNotMatch(html, /Подключить executor/);
});

test("step 3 local mode keeps the executor call-to-action visible", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Step3RenderTemplate,
      makeStep3RenderTemplateProps({
        executionTarget: "local",
        showWorkerControls: true
      })
    )
  );

  assert.match(html, /Execution: Локальный executor/);
  assert.match(html, /Подключить executor/);
});

test("workspace render tab warns when configured host mode is currently forced back to local", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelManagerWorkspaceRenderTab, {
      canEditWorkspaceDefaults: true,
      configuredTarget: "host",
      resolvedTarget: "local",
      capabilities: {
        localAvailable: true,
        hostAvailable: false
      },
      saveState: {
        status: "idle",
        message: null
      },
      onChangeTarget: () => undefined
    })
  );

  assert.match(html, /Режим выполнения/);
  assert.match(html, /Выбрано: Хостинг/);
  assert.match(html, /Сейчас работает: Локальный executor/);
  assert.match(html, /Хостинг сохранён как default, но сейчас выключен на deployment/i);
  assert.match(html, /Хостинг \(недоступен\)/);
});

test("workspace defaults keep the render tab selected once the user switches to it", () => {
  assert.equal(normalizeChannelManagerTabForSelection("render", true), "render");
  assert.equal(normalizeChannelManagerTabForSelection("stage2", true), "stage2");
  assert.equal(normalizeChannelManagerTabForSelection("brand", true), "stage2");
  assert.equal(normalizeChannelManagerTabForSelection("render", false), "render");
});
