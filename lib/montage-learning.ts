import type { Stage3Segment, Stage3SourceCrop } from "../app/components/types";
import {
  clampStage3FocusX,
  clampStage3FocusY,
  clampStage3CameraZoom
} from "./stage3-camera";
import { normalizeStage3RenderPlanSegments } from "./stage3-render-plan";
import { normalizeStage3SourceCrop } from "./stage3-source-crop";
import {
  DEFAULT_STAGE3_VIDEO_FIT,
  normalizeStage3VideoFit,
  type Stage3VideoFit
} from "./stage3-video-fit";

export type MontageLearningJsonRecord = Record<string, unknown>;

export type MontageLearningPublication = {
  id: string;
  workspaceId?: string;
  channelId: string;
  chatId: string;
  renderExportId?: string;
  status: string;
  title?: string;
  sourceUrl?: string;
  chatTitle?: string;
  renderFileName?: string;
  youtubeVideoId?: string | null;
  youtubeVideoUrl?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MontageLearningChannel = {
  id: string;
  name?: string;
  username?: string;
  templateId?: string | null;
};

export type MontageLearningFlowSummary = {
  chatId?: string;
  channelId?: string;
  channelName?: string;
  channelUsername?: string;
  title?: string;
  sourceUrl?: string;
  latestStage?: string;
  latestStatus?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  stage3JobId?: string | null;
  publicationId?: string | null;
  youtubeVideoUrl?: string | null;
};

export type MontageLearningStage3Job = {
  id: string;
  kind?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  payload?: MontageLearningJsonRecord | null;
  result?: MontageLearningJsonRecord | null;
  artifact?: MontageLearningJsonRecord | null;
};

export type MontageLearningFlowDetail = {
  flow?: MontageLearningFlowSummary | null;
  auditEvents?: unknown[];
  stage3Jobs?: MontageLearningStage3Job[];
  trace?: unknown;
};

export type MontageLearningParamValue<T> = {
  raw_saved_value: unknown;
  effective_value: T;
};

export type MontageLearningEffectiveRenderPlan = {
  focusX: number;
  focusY: number;
  videoZoom: number;
  videoFit: Stage3VideoFit;
  sourceCrop: Stage3SourceCrop | null;
  segments: Stage3Segment[];
  clipStartSec: number;
  clipDurationSec: number | null;
  targetDurationSec: number | null;
  durationMode: string | null;
  timingMode: string | null;
  editorSelectionMode: string | null;
  normalizeToTargetEnabled: boolean;
  policy: string | null;
  mirrorEnabled: boolean;
  sourceAudioEnabled: boolean;
  audioMode: string;
  topFontScale: number;
  bottomFontScale: number;
  videoScaleX: number | null;
  videoScaleY: number | null;
  sourceAudioGain: number;
  musicGain: number;
  cameraMotion: string;
  cameraKeyframes: unknown[];
  cameraPositionKeyframes: unknown[];
  cameraScaleKeyframes: unknown[];
  templateId: string | null;
};

export type MontageLearningParams = {
  focusX: MontageLearningParamValue<number>;
  focusY: MontageLearningParamValue<number>;
  videoZoom: MontageLearningParamValue<number>;
  videoFit: MontageLearningParamValue<Stage3VideoFit>;
  sourceCrop: MontageLearningParamValue<Stage3SourceCrop | null>;
  segments: MontageLearningParamValue<Stage3Segment[]>;
  clipStartSec: MontageLearningParamValue<number>;
  clipDurationSec: MontageLearningParamValue<number | null>;
  fontScale: {
    top: MontageLearningParamValue<number>;
    bottom: MontageLearningParamValue<number>;
  };
  audio: {
    audioMode: MontageLearningParamValue<string>;
    sourceAudioEnabled: MontageLearningParamValue<boolean>;
    sourceAudioGain: MontageLearningParamValue<number>;
    musicGain: MontageLearningParamValue<number>;
  };
  mirrorEnabled: MontageLearningParamValue<boolean>;
  fitFields: {
    videoScaleX: MontageLearningParamValue<number | null>;
    videoScaleY: MontageLearningParamValue<number | null>;
  };
};

export type MontageLearningFrameManifest = {
  source: {
    requested: boolean;
    count: number;
    files: string[];
    status: "not_requested" | "available" | "unavailable";
    error?: string;
  };
  final: {
    requested: boolean;
    count: number;
    files: string[];
    status: "not_requested" | "available" | "unavailable";
    error?: string;
  };
};

export type MontageLearningAnalysis = {
  case_id: string;
  channel_id: string;
  chat_id: string;
  source_url: string;
  final_render_plan_raw: MontageLearningJsonRecord;
  final_render_plan_effective: MontageLearningEffectiveRenderPlan;
  visual_before_after_summary: string;
  editing_intent_labels: string[];
  parameter_reasoning: Record<string, string>;
  tradeoffs: string[];
  reusable_lessons: string[];
  judge_verdict: {
    status: "PASS" | "NEEDS_LLM_REVIEW" | "NEEDS_VISUAL_REVIEW" | "REJECT";
    provider: "heuristic" | "llm";
    reasons: string[];
  };
};

export type MontageLearningCase = {
  case_id: string;
  channel_id: string;
  channel_name: string | null;
  channel_username: string | null;
  template_id: string | null;
  chat_id: string;
  source: {
    source_url: string;
    source_metadata: MontageLearningJsonRecord;
    sampled_source_frames: string[];
    source_available: boolean | null;
  };
  final: {
    publication_id: string;
    render_export_id: string | null;
    stage3_job_id: string | null;
    final_mp4_ref: string | null;
    sampled_final_frames: string[];
    final_available: boolean | null;
  };
  params: MontageLearningParams;
  final_render_plan_raw: MontageLearningJsonRecord;
  final_render_plan_effective: MontageLearningEffectiveRenderPlan;
  outcome: {
    publication_status: string;
    title: string | null;
    channel_id: string;
    chat_id: string;
    timestamps: {
      published_at: string | null;
      created_at: string | null;
      updated_at: string | null;
    };
    artifact_refs: {
      render_file_name: string | null;
      youtube_video_id: string | null;
      youtube_video_url: string | null;
    };
  };
  frame_manifest: MontageLearningFrameManifest;
  clean_training_candidate: boolean;
  exclusion_reasons: string[];
  analysis: MontageLearningAnalysis;
};

export type MontageLearningCaseBuildInput = {
  publication: MontageLearningPublication;
  flow: MontageLearningFlowDetail;
  channel?: MontageLearningChannel | null;
  frameManifest?: MontageLearningFrameManifest;
};

const CANONICAL_PUBLICATION_STATUSES = new Set(["published", "scheduled", "queued", "paused"]);

const DEFAULT_FRAME_MANIFEST: MontageLearningFrameManifest = {
  source: {
    requested: false,
    count: 0,
    files: [],
    status: "not_requested"
  },
  final: {
    requested: false,
    count: 0,
    files: [],
    status: "not_requested"
  }
};

function isRecord(value: unknown): value is MontageLearningJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const numberValue = finiteNumber(value);
  return numberValue !== null && numberValue > 0 ? numberValue : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function normalizeScale(value: unknown): number {
  const numberValue = finiteNumber(value);
  if (numberValue === null) {
    return 1;
  }
  return round(Math.min(1.6, Math.max(0.6, numberValue)), 4);
}

function normalizeOptionalGain(value: unknown, fallback: number, max: number): number {
  const numberValue = finiteNumber(value);
  if (numberValue === null) {
    return fallback;
  }
  return round(Math.min(max, Math.max(0, numberValue)), 4);
}

function normalizeOptionalScale(value: unknown): number | null {
  const numberValue = finiteNumber(value);
  if (numberValue === null) {
    return null;
  }
  return round(Math.min(2, Math.max(0.2, numberValue)), 4);
}

export function isCanonicalMontagePublication(publication: Pick<MontageLearningPublication, "status">): boolean {
  return CANONICAL_PUBLICATION_STATUSES.has(publication.status);
}

export function buildMontageLearningCaseId(input: {
  channelUsername?: string | null;
  channelName?: string | null;
  chatId: string;
  publicationId: string;
}): string {
  const channelSlug = (input.channelUsername ?? input.channelName ?? "channel")
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "channel";
  return [
    channelSlug,
    input.chatId.slice(0, 8),
    input.publicationId.slice(0, 8)
  ].join("-");
}

export function selectFinalStage3Job(input: {
  flow?: MontageLearningFlowSummary | null;
  jobs?: MontageLearningStage3Job[] | null;
}): MontageLearningStage3Job | null {
  const jobs = input.jobs ?? [];
  if (jobs.length === 0) {
    return null;
  }
  const preferredId = stringOrNull(input.flow?.stage3JobId);
  const completed = jobs.filter((job) => job.status === "completed" || job.status === "succeeded");
  if (preferredId) {
    const preferred = completed.find((job) => job.id === preferredId) ?? jobs.find((job) => job.id === preferredId);
    if (preferred) {
      return preferred;
    }
  }
  const renderCompleted = completed.filter((job) => job.kind === "render");
  const pool = renderCompleted.length ? renderCompleted : completed.length ? completed : jobs;
  return [...pool].sort(compareJobsNewestFirst)[0] ?? null;
}

function compareJobsNewestFirst(left: MontageLearningStage3Job, right: MontageLearningStage3Job): number {
  const leftTime = Date.parse(left.completedAt ?? left.updatedAt ?? left.createdAt ?? "");
  const rightTime = Date.parse(right.completedAt ?? right.updatedAt ?? right.createdAt ?? "");
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

export function readStage3SnapshotFromJob(job: MontageLearningStage3Job | null): MontageLearningJsonRecord {
  const payload = isRecord(job?.payload) ? job.payload : {};
  const result = isRecord(job?.result) ? job.result : {};
  const snapshot =
    (isRecord(payload.snapshot) ? payload.snapshot : null) ??
    (isRecord(result.snapshot) ? result.snapshot : null) ??
    (isRecord(payload.stage3Snapshot) ? payload.stage3Snapshot : null) ??
    {};
  return snapshot;
}

export function readRawRenderPlanFromJob(job: MontageLearningStage3Job | null): MontageLearningJsonRecord {
  const payload = isRecord(job?.payload) ? job.payload : {};
  const result = isRecord(job?.result) ? job.result : {};
  const snapshot = readStage3SnapshotFromJob(job);
  return (
    (isRecord(snapshot.renderPlan) ? snapshot.renderPlan : null) ??
    (isRecord(payload.renderPlan) ? payload.renderPlan : null) ??
    (isRecord(result.renderPlan) ? result.renderPlan : null) ??
    {}
  );
}

export function buildEffectiveRenderPlan(input: {
  rawRenderPlan?: MontageLearningJsonRecord | null;
  snapshot?: MontageLearningJsonRecord | null;
}): MontageLearningEffectiveRenderPlan {
  const rawPlan = input.rawRenderPlan ?? {};
  const snapshot = input.snapshot ?? {};
  const targetDurationSec = positiveNumber(rawPlan.targetDurationSec);
  const clipDurationSec =
    positiveNumber(snapshot.clipDurationSec) ??
    positiveNumber(rawPlan.clipDurationSec) ??
    targetDurationSec;
  const focusX = clampStage3FocusX(finiteNumber(rawPlan.focusX) ?? 0.5);
  const focusY = clampStage3FocusY(
    finiteNumber(snapshot.focusY) ??
      finiteNumber(rawPlan.focusY) ??
      0.5
  );
  const videoZoom = clampStage3CameraZoom(finiteNumber(rawPlan.videoZoom) ?? 1);
  const segments = normalizeStage3RenderPlanSegments(rawPlan.segments);
  const normalizeToTargetEnabled =
    typeof rawPlan.normalizeToTargetEnabled === "boolean"
      ? rawPlan.normalizeToTargetEnabled
      : rawPlan.timingMode === "compress" ||
        rawPlan.timingMode === "stretch" ||
        rawPlan.policy === "full_source_normalize" ||
        rawPlan.durationMode === "source_full";

  return {
    focusX: round(focusX),
    focusY: round(focusY),
    videoZoom: round(videoZoom),
    videoFit: normalizeStage3VideoFit(rawPlan.videoFit, DEFAULT_STAGE3_VIDEO_FIT),
    sourceCrop: normalizeStage3SourceCrop(rawPlan.sourceCrop, null),
    segments,
    clipStartSec: Math.max(0, finiteNumber(snapshot.clipStartSec) ?? finiteNumber(rawPlan.clipStartSec) ?? 0),
    clipDurationSec,
    targetDurationSec,
    durationMode: stringOrNull(rawPlan.durationMode),
    timingMode: stringOrNull(rawPlan.timingMode) ?? "auto",
    editorSelectionMode: stringOrNull(rawPlan.editorSelectionMode),
    normalizeToTargetEnabled,
    policy: stringOrNull(rawPlan.policy),
    mirrorEnabled: booleanOrNull(rawPlan.mirrorEnabled) ?? true,
    sourceAudioEnabled: booleanOrNull(rawPlan.sourceAudioEnabled) ?? true,
    audioMode: rawPlan.audioMode === "source_plus_music" ? "source_plus_music" : "source_only",
    topFontScale: normalizeScale(rawPlan.topFontScale),
    bottomFontScale: normalizeScale(rawPlan.bottomFontScale),
    videoScaleX: normalizeOptionalScale(rawPlan.videoScaleX),
    videoScaleY: normalizeOptionalScale(rawPlan.videoScaleY),
    sourceAudioGain: normalizeOptionalGain(rawPlan.sourceAudioGain, 1, 2),
    musicGain: normalizeOptionalGain(rawPlan.musicGain, 0.65, 1),
    cameraMotion: stringOrNull(rawPlan.cameraMotion) ?? "disabled",
    cameraKeyframes: Array.isArray(rawPlan.cameraKeyframes) ? rawPlan.cameraKeyframes : [],
    cameraPositionKeyframes: Array.isArray(rawPlan.cameraPositionKeyframes) ? rawPlan.cameraPositionKeyframes : [],
    cameraScaleKeyframes: Array.isArray(rawPlan.cameraScaleKeyframes) ? rawPlan.cameraScaleKeyframes : [],
    templateId: stringOrNull(rawPlan.templateId)
  };
}

export function buildMontageLearningParams(input: {
  rawRenderPlan: MontageLearningJsonRecord;
  snapshot: MontageLearningJsonRecord;
  effective: MontageLearningEffectiveRenderPlan;
}): MontageLearningParams {
  const { rawRenderPlan, snapshot, effective } = input;
  return {
    focusX: {
      raw_saved_value: rawRenderPlan.focusX ?? null,
      effective_value: effective.focusX
    },
    focusY: {
      raw_saved_value: snapshot.focusY ?? rawRenderPlan.focusY ?? null,
      effective_value: effective.focusY
    },
    videoZoom: {
      raw_saved_value: rawRenderPlan.videoZoom ?? null,
      effective_value: effective.videoZoom
    },
    videoFit: {
      raw_saved_value: rawRenderPlan.videoFit ?? null,
      effective_value: effective.videoFit
    },
    sourceCrop: {
      raw_saved_value: rawRenderPlan.sourceCrop ?? null,
      effective_value: effective.sourceCrop
    },
    segments: {
      raw_saved_value: rawRenderPlan.segments ?? null,
      effective_value: effective.segments
    },
    clipStartSec: {
      raw_saved_value: snapshot.clipStartSec ?? rawRenderPlan.clipStartSec ?? null,
      effective_value: effective.clipStartSec
    },
    clipDurationSec: {
      raw_saved_value: snapshot.clipDurationSec ?? rawRenderPlan.clipDurationSec ?? rawRenderPlan.targetDurationSec ?? null,
      effective_value: effective.clipDurationSec
    },
    fontScale: {
      top: {
        raw_saved_value: rawRenderPlan.topFontScale ?? null,
        effective_value: effective.topFontScale
      },
      bottom: {
        raw_saved_value: rawRenderPlan.bottomFontScale ?? null,
        effective_value: effective.bottomFontScale
      }
    },
    audio: {
      audioMode: {
        raw_saved_value: rawRenderPlan.audioMode ?? null,
        effective_value: effective.audioMode
      },
      sourceAudioEnabled: {
        raw_saved_value: rawRenderPlan.sourceAudioEnabled ?? null,
        effective_value: effective.sourceAudioEnabled
      },
      sourceAudioGain: {
        raw_saved_value: rawRenderPlan.sourceAudioGain ?? null,
        effective_value: effective.sourceAudioGain
      },
      musicGain: {
        raw_saved_value: rawRenderPlan.musicGain ?? null,
        effective_value: effective.musicGain
      }
    },
    mirrorEnabled: {
      raw_saved_value: rawRenderPlan.mirrorEnabled ?? null,
      effective_value: effective.mirrorEnabled
    },
    fitFields: {
      videoScaleX: {
        raw_saved_value: rawRenderPlan.videoScaleX ?? null,
        effective_value: effective.videoScaleX
      },
      videoScaleY: {
        raw_saved_value: rawRenderPlan.videoScaleY ?? null,
        effective_value: effective.videoScaleY
      }
    }
  };
}

export function buildHeuristicMontageAnalysis(input: {
  caseId: string;
  channelId: string;
  chatId: string;
  sourceUrl: string;
  rawRenderPlan: MontageLearningJsonRecord;
  effective: MontageLearningEffectiveRenderPlan;
  frameManifest: MontageLearningFrameManifest;
}): MontageLearningAnalysis {
  const labels = new Set<string>();
  const reasoning: Record<string, string> = {};
  const tradeoffs: string[] = [];
  const lessons: string[] = [];
  const effective = input.effective;

  if (Math.abs(effective.focusX - 0.5) >= 0.04) {
    labels.add("horizontal_reframing");
    reasoning.focusX = `focusX=${effective.focusX} shifts the visible action horizontally instead of accepting the centered default.`;
    lessons.push("Use horizontal focus when the main action or face is visibly off-center after crop/fit.");
  } else {
    reasoning.focusX = "focusX stays at the centered effective default, so no horizontal reframe is implied by saved parameters.";
  }

  if (Math.abs(effective.focusY - 0.5) >= 0.04) {
    labels.add("vertical_reframing");
    reasoning.focusY = `focusY=${effective.focusY} changes the vertical anchor, usually to keep the important source area out of template dead space.`;
    lessons.push("Use vertical focus after checking the full-phone frame, not from a fixed pixel recipe.");
  } else {
    reasoning.focusY = "focusY stays at the centered effective default, so the source likely did not need vertical panning.";
  }

  if (effective.videoZoom > 1.04) {
    labels.add("action_centering");
    labels.add("template_fit");
    reasoning.videoZoom = `videoZoom=${effective.videoZoom} enlarges source media to increase visual weight or remove unwanted edge material.`;
    tradeoffs.push("More zoom can remove provenance or dead space, but it risks making the source less readable.");
    lessons.push("Raise zoom only after confirming the source remains understandable on phone-size previews.");
  } else {
    labels.add("overzoom_avoidance");
    reasoning.videoZoom = "videoZoom remains near 1, preserving more source context and avoiding quality loss.";
  }

  if (effective.videoFit === "contain") {
    labels.add("source_readability");
    labels.add("overzoom_avoidance");
    reasoning.videoFit = "videoFit=contain preserves the source aspect ratio instead of forcing a full cover crop.";
    tradeoffs.push("Contain can preserve context but may create a landscape strip or dead lower canvas if the template does not support the media.");
    lessons.push("Contain is acceptable only when the surrounding matte still feels intentional in the full-phone frame.");
  } else {
    reasoning.videoFit = "videoFit=cover gives the media more vertical weight but can crop source context.";
  }

  if (effective.sourceCrop?.enabled) {
    labels.add("provenance_removal");
    reasoning.sourceCrop = `sourceCrop keeps x=${effective.sourceCrop.x}, y=${effective.sourceCrop.y}, width=${effective.sourceCrop.width}, height=${effective.sourceCrop.height}.`;
    tradeoffs.push("Cropping can remove donor UI/provenance, but it may also remove native source context if too aggressive.");
    lessons.push("Distinguish donor/provenance UI from source-native context before cropping.");
  } else {
    reasoning.sourceCrop = "No effective sourceCrop is present; provenance removal depends on fit, focus, segments, blur, or source cleanliness.";
  }

  if (effective.segments.length > 0) {
    labels.add("clip_window_choice");
    reasoning.segments = `The final plan uses ${effective.segments.length} segment(s), so the accepted result is not just the whole source timeline.`;
    lessons.push("Segments are training evidence for what source window the editor judged worth keeping.");
  } else {
    reasoning.segments = "No saved segments were present; the timeline window is represented by clipStartSec/clipDurationSec or defaults.";
  }

  if (effective.mirrorEnabled === false) {
    labels.add("source_context_preservation");
    reasoning.mirrorEnabled = "mirrorEnabled=false preserves readable baked text and source orientation.";
    lessons.push("Do not mirror when the source contains readable text, UI, captions, signage, or years that should stay legible.");
  } else {
    reasoning.mirrorEnabled = "mirrorEnabled=true follows the product normalizer default unless the final snapshot explicitly disabled it.";
  }

  const reasons: string[] = [];
  const hasFrameEvidence = input.frameManifest.source.count >= 3 && input.frameManifest.final.count >= 3;
  if (!hasFrameEvidence) {
    reasons.push("Less than 3 source/final frame pairs are available, so visual claims must be reviewed before clean training use.");
  }
  reasons.push("Heuristic analysis explains parameter intent from saved values, but it does not replace an LLM visual judge.");

  return {
    case_id: input.caseId,
    channel_id: input.channelId,
    chat_id: input.chatId,
    source_url: input.sourceUrl,
    final_render_plan_raw: input.rawRenderPlan,
    final_render_plan_effective: input.effective,
    visual_before_after_summary:
      "Offline heuristic seed. Use source/final frames plus LLM judge to convert this into a clean teaching example.",
    editing_intent_labels: [...labels].sort(),
    parameter_reasoning: reasoning,
    tradeoffs,
    reusable_lessons: [...new Set(lessons)],
    judge_verdict: {
      status: "NEEDS_LLM_REVIEW",
      provider: "heuristic",
      reasons
    }
  };
}

export function buildMontageLearningCase(input: MontageLearningCaseBuildInput): MontageLearningCase {
  const finalJob = selectFinalStage3Job({
    flow: input.flow.flow,
    jobs: input.flow.stage3Jobs
  });
  const snapshot = readStage3SnapshotFromJob(finalJob);
  const rawRenderPlan = readRawRenderPlanFromJob(finalJob);
  const effective = buildEffectiveRenderPlan({ rawRenderPlan, snapshot });
  const params = buildMontageLearningParams({ rawRenderPlan, snapshot, effective });
  const channelUsername =
    input.channel?.username ??
    input.flow.flow?.channelUsername ??
    null;
  const channelName =
    input.channel?.name ??
    input.flow.flow?.channelName ??
    null;
  const caseId = buildMontageLearningCaseId({
    channelUsername,
    channelName,
    chatId: input.publication.chatId,
    publicationId: input.publication.id
  });
  const frameManifest = input.frameManifest ?? DEFAULT_FRAME_MANIFEST;
  const sourceUrl =
    input.publication.sourceUrl ??
    input.flow.flow?.sourceUrl ??
    "";
  const finalRef =
    input.publication.youtubeVideoUrl ??
    stringOrNull(finalJob?.artifact?.downloadUrl) ??
    stringOrNull(finalJob?.artifact?.fileName) ??
    input.publication.renderFileName ??
    null;

  const exclusionReasons: string[] = [];
  if (!isCanonicalMontagePublication(input.publication)) {
    exclusionReasons.push(`publication_status:${input.publication.status}`);
  }
  if (!sourceUrl) {
    exclusionReasons.push("missing_source_url");
  }
  if (!finalJob) {
    exclusionReasons.push("missing_final_stage3_job");
  } else if (finalJob.status !== "completed" && finalJob.status !== "succeeded") {
    exclusionReasons.push(`stage3_job_status:${finalJob.status ?? "unknown"}`);
  }

  const analysis = buildHeuristicMontageAnalysis({
    caseId,
    channelId: input.publication.channelId,
    chatId: input.publication.chatId,
    sourceUrl,
    rawRenderPlan,
    effective,
    frameManifest
  });

  if (analysis.judge_verdict.status !== "PASS") {
    exclusionReasons.push("judge_not_passed");
  }
  if (frameManifest.source.requested && frameManifest.source.status !== "available") {
    exclusionReasons.push("source_frames_unavailable");
  }
  if (frameManifest.final.requested && frameManifest.final.status !== "available") {
    exclusionReasons.push("final_frames_unavailable");
  }

  return {
    case_id: caseId,
    channel_id: input.publication.channelId,
    channel_name: channelName,
    channel_username: channelUsername,
    template_id: effective.templateId ?? input.channel?.templateId ?? null,
    chat_id: input.publication.chatId,
    source: {
      source_url: sourceUrl,
      source_metadata: extractSourceMetadata(input.flow.trace),
      sampled_source_frames: frameManifest.source.files,
      source_available:
        frameManifest.source.status === "available"
          ? true
          : frameManifest.source.status === "unavailable"
            ? false
            : null
    },
    final: {
      publication_id: input.publication.id,
      render_export_id: input.publication.renderExportId ?? null,
      stage3_job_id: finalJob?.id ?? input.flow.flow?.stage3JobId ?? null,
      final_mp4_ref: finalRef,
      sampled_final_frames: frameManifest.final.files,
      final_available:
        frameManifest.final.status === "available"
          ? true
          : frameManifest.final.status === "unavailable"
            ? false
            : null
    },
    params,
    final_render_plan_raw: rawRenderPlan,
    final_render_plan_effective: effective,
    outcome: {
      publication_status: input.publication.status,
      title: input.publication.title ?? input.publication.chatTitle ?? input.flow.flow?.title ?? null,
      channel_id: input.publication.channelId,
      chat_id: input.publication.chatId,
      timestamps: {
        published_at: input.publication.publishedAt ?? null,
        created_at: input.publication.createdAt ?? null,
        updated_at: input.publication.updatedAt ?? input.flow.flow?.updatedAt ?? null
      },
      artifact_refs: {
        render_file_name: input.publication.renderFileName ?? null,
        youtube_video_id: input.publication.youtubeVideoId ?? null,
        youtube_video_url: input.publication.youtubeVideoUrl ?? input.flow.flow?.youtubeVideoUrl ?? null
      }
    },
    frame_manifest: frameManifest,
    clean_training_candidate: exclusionReasons.length === 0,
    exclusion_reasons: exclusionReasons,
    analysis
  };
}

function extractSourceMetadata(trace: unknown): MontageLearningJsonRecord {
  if (!isRecord(trace)) {
    return {};
  }
  const candidates = [
    trace.source,
    trace.sourceJob,
    trace.source_job,
    trace.sourceMetadata,
    trace.source_metadata
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      return candidate;
    }
  }
  return {};
}

export function buildMontageLearningQualityReport(cases: MontageLearningCase[]): MontageLearningJsonRecord {
  const statusCounts = new Map<string, number>();
  const channelCounts = new Map<string, number>();
  let clean = 0;
  let withSourceFrames = 0;
  let withFinalFrames = 0;
  for (const item of cases) {
    statusCounts.set(item.outcome.publication_status, (statusCounts.get(item.outcome.publication_status) ?? 0) + 1);
    channelCounts.set(item.channel_id, (channelCounts.get(item.channel_id) ?? 0) + 1);
    if (item.clean_training_candidate) {
      clean += 1;
    }
    if (item.source.sampled_source_frames.length >= 3) {
      withSourceFrames += 1;
    }
    if (item.final.sampled_final_frames.length >= 3) {
      withFinalFrames += 1;
    }
  }
  return {
    total_cases: cases.length,
    clean_training_cases: clean,
    excluded_cases: cases.length - clean,
    with_3_source_frames: withSourceFrames,
    with_3_final_frames: withFinalFrames,
    status_counts: Object.fromEntries(statusCounts),
    channel_counts: Object.fromEntries(channelCounts),
    exclusion_counts: countExclusions(cases),
    generated_at: new Date().toISOString()
  };
}

function countExclusions(cases: MontageLearningCase[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of cases) {
    for (const reason of item.exclusion_reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts);
}

export function buildMontageLearningPlaybook(cases: MontageLearningCase[]): string {
  const cleanCases = cases.filter((item) => item.clean_training_candidate);
  const reviewedCases = cleanCases.length ? cleanCases : cases;
  const lessons = new Map<string, number>();
  const labels = new Map<string, number>();
  for (const item of reviewedCases) {
    for (const label of item.analysis.editing_intent_labels) {
      labels.set(label, (labels.get(label) ?? 0) + 1);
    }
    for (const lesson of item.analysis.reusable_lessons) {
      lessons.set(lesson, (lessons.get(lesson) ?? 0) + 1);
    }
  }
  const lessonLines = [...lessons.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([lesson, count]) => `- ${lesson} (${count})`);
  const labelLines = [...labels.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => `- ${label}: ${count}`);
  return [
    "# Montage Learning Playbook v1",
    "",
    "This playbook is generated from final Clips publications/render jobs. It is a teaching artifact for future LLM editors, not an automatic production editor.",
    "",
    "## Dataset Status",
    "",
    `- Total cases: ${cases.length}`,
    `- Clean training cases: ${cleanCases.length}`,
    `- Review source: ${cleanCases.length ? "judge PASS cases" : "heuristic seed cases awaiting LLM/visual PASS"}`,
    "",
    "## Intent Labels",
    "",
    ...(labelLines.length ? labelLines : ["- No labels yet."]),
    "",
    "## Reusable Lessons",
    "",
    ...(lessonLines.length ? lessonLines : ["- No reusable lessons yet."]),
    "",
    "## Guardrails",
    "",
    "- Do not learn from chat_drafts as canonical truth; use final publications/render exports/stage3 jobs.",
    "- Keep raw saved values separate from effective normalized values.",
    "- Treat donor/provenance UI differently from source-native context such as years, subtitles, signage, or location cues.",
    "- A lesson becomes clean training material only after judge PASS against source/final frames.",
    "- Reject examples with overzoom, dead canvas, donor UI, unreadable source, or loss of the main action."
  ].join("\n");
}
