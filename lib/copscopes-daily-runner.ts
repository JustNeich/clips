import { createHash } from "node:crypto";
import { appendFlowAuditEvent } from "./audit-log-store";
import { createOrGetChatByUrl, getChannelById } from "./chat-history";
import {
  createCopscopesDailyRun,
  markCopscopesSourceReel,
  recordCopscopesDailyRunItem,
  selectCopscopesDailyCandidates,
  updateCopscopesDailyRunSummary,
  type CopscopesSourceReel,
  type CopscopesRunStatus
} from "./copscopes-source-pool";
import { buildStage2RunChannelSnapshot } from "./stage2-run-channel-snapshot";
import { buildStage2RunRequestSnapshot } from "./stage2-run-request";
import { enqueueAndScheduleStage2Run, getStage2RunOrThrow } from "./stage2-run-runtime";
import { enqueueAndScheduleSourceJob, getSourceJobOrThrow } from "./source-job-runtime";
import { runAutonomousOptimization } from "./stage3-agent-autonomous";
import { getVersion } from "./stage3-session-store";
import { DEFAULT_STAGE3_CLIP_DURATION_SEC } from "./stage3-duration";
import { resolveStage3Execution } from "./stage3-execution";
import { enqueueAndScheduleStage3Job } from "./stage3-job-runtime";
import { buildStage3RenderRequestDedupeKey } from "./stage3-render-request";
import { normalizeRenderPlan, type Stage3RenderRequestBody } from "./stage3-render-service";
import type { Stage3SourceCrop } from "../app/components/types";
import type { Stage2Response } from "../app/components/types";

export type CopscopesStage3Review = {
  qualityGatePassed: boolean;
  cropPassed: boolean;
  sourceMetaLeakDetected: boolean;
  finalDurationSec: number | null;
  notes: string[];
};

export type CopscopesDailyExecutionInput = {
  workspaceId: string;
  channelId: string;
  userId: string;
  runId: string;
  reel: CopscopesSourceReel;
  targetDurationSec: number;
  sourceCrop: Stage3SourceCrop | null;
};

export type CopscopesDailyExecutionResult = {
  status: "queued" | "needs_review" | "failed" | "skipped";
  qualityGatePassed: boolean;
  chatId?: string | null;
  stage2RunId?: string | null;
  stage3JobId?: string | null;
  publicationId?: string | null;
  review?: CopscopesStage3Review | null;
  error?: string | null;
  report?: Record<string, unknown> | null;
};

export type CopscopesDailyExecutor = (
  input: CopscopesDailyExecutionInput
) => Promise<CopscopesDailyExecutionResult>;

export type RunCopscopesDailyPoolResult = {
  dryRun: boolean;
  runId: string | null;
  status: CopscopesRunStatus;
  categorySlug: string | null;
  selected: Array<{
    id: string;
    shortcode: string;
    url: string;
    categorySlug: string;
    status: string;
  }>;
  queuedCount: number;
  reviewedCount: number;
  failedCount: number;
  exhausted: boolean;
  report: Record<string, unknown>;
};

export function buildCopscopesStage3EditorGoal(input: {
  reel: Pick<CopscopesSourceReel, "title" | "caption" | "canonicalUrl" | "crop" | "cropConfidence">;
  winningCaption?: string | null;
}): string {
  const caption = input.winningCaption?.trim() || input.reel.title || input.reel.caption || "the strongest bodycam beat";
  return [
    "You are the CopScopes Stage 3 editor.",
    "Build a police/bodycam short that feels like PaleWitness: clean white captions with selective yellow emphasis.",
    `Winning caption: ${caption}`,
    "Pick one to three exact source moments that make the caption feel earned.",
    "Allowed speeds: 1, 1.5, 2, 2.5, 3, 4, 5.",
    "Final output must be exactly 6 seconds.",
    "Reject and revise if CopScopes source-frame text, black border, captions, handles, or other channel meta leaks into our source window.",
    input.reel.crop
      ? `Use the stored inner-source crop before fitting: x=${input.reel.crop.x}, y=${input.reel.crop.y}, width=${input.reel.crop.width}, height=${input.reel.crop.height}, confidence=${input.reel.cropConfidence ?? input.reel.crop.confidence ?? "unknown"}.`
      : "Detect and crop the inner original video area before fitting."
  ].join("\n");
}

export function shouldQueueCopscopesStage3Render(result: CopscopesDailyExecutionResult): boolean {
  const duration = result.review?.finalDurationSec ?? null;
  const durationOk = duration === null || Math.abs(duration - DEFAULT_STAGE3_CLIP_DURATION_SEC) <= 0.05;
  return (
    result.status === "queued" &&
    result.qualityGatePassed &&
    result.review?.qualityGatePassed === true &&
    result.review?.cropPassed === true &&
    result.review?.sourceMetaLeakDetected === false &&
    durationOk
  );
}

export const failClosedCopscopesDailyExecutor: CopscopesDailyExecutor = async (input) => {
  const goalHash = createHash("sha256")
    .update(buildCopscopesStage3EditorGoal({ reel: input.reel }))
    .digest("hex")
    .slice(0, 16);
  return {
    status: "needs_review",
    qualityGatePassed: false,
    error:
      "copscopes_daily_executor_not_configured: provide a Stage 1/2/3 executor before non-dry production runs.",
    review: {
      qualityGatePassed: false,
      cropPassed: false,
      sourceMetaLeakDetected: true,
      finalDurationSec: null,
      notes: [
        "Fail-closed guard prevented blind publication.",
        "Daily MCP selection works; production execution must wire source ingest, Stage 2, Stage 3 review, and render queue."
      ]
    },
    report: {
      goalHash,
      sourceCrop: input.sourceCrop
    }
  };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function waitForSourceJobTerminal(jobId: string, timeoutMs: number): Promise<ReturnType<typeof getSourceJobOrThrow>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const job = getSourceJobOrThrow(jobId);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await delay(750);
  }
  throw new Error("Timed out waiting for CopScopes source ingest.");
}

async function waitForStage2RunTerminal(runId: string, timeoutMs: number): Promise<ReturnType<typeof getStage2RunOrThrow>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const run = getStage2RunOrThrow(runId);
    if (run.status === "completed" || run.status === "failed") {
      return run;
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for CopScopes Stage 2 run.");
}

function extractCopscopesWinningCopy(stage2: Stage2Response): {
  topText: string;
  bottomText: string;
  title: string;
  winningCaption: string;
} {
  const output = stage2.output;
  const option = output.winner?.option ?? output.finalPick.option;
  const story = output.storyOptions?.find((candidate) => candidate.option === option) ?? output.storyOptions?.[0] ?? null;
  const classic =
    output.classicOptions?.find((candidate) => candidate.option === option) ??
    output.captionOptions.find((candidate) => candidate.option === option) ??
    output.classicOptions?.[0] ??
    output.captionOptions[0] ??
    null;
  const topText = story?.lead ?? classic?.top ?? "THE MOMENT TURNED FAST";
  const bottomText =
    story?.mainCaption ??
    classic?.bottom ??
    "The bodycam clip shows the decision point, the sudden move, and the consequence in one tight sequence.";
  const title = output.titleOptions[0]?.title ?? `${topText}: CopScopes bodycam`;
  return {
    topText,
    bottomText,
    title,
    winningCaption: `${topText}. ${bottomText}`
  };
}

export const copscopesProductionDailyExecutor: CopscopesDailyExecutor = async (input) => {
  const channel = await getChannelById(input.channelId);
  if (!channel || channel.workspaceId !== input.workspaceId) {
    return {
      status: "failed",
      qualityGatePassed: false,
      error: "copscopes_channel_not_found"
    };
  }
  const chat = await createOrGetChatByUrl(input.reel.canonicalUrl, input.channelId);
  const sourceJob = enqueueAndScheduleSourceJob({
    workspaceId: input.workspaceId,
    creatorUserId: input.userId,
    request: {
      sourceUrl: input.reel.canonicalUrl,
      autoRunStage2: false,
      trigger: "fetch",
      chat: {
        id: chat.id,
        channelId: input.channelId
      },
      channel: {
        id: input.channelId,
        name: channel.name,
        username: channel.username
      }
    }
  });
  const completedSource = await waitForSourceJobTerminal(sourceJob.jobId, 4 * 60_000);
  if (completedSource.status !== "completed" || !completedSource.resultData?.stage1Ready) {
    return {
      status: "failed",
      qualityGatePassed: false,
      chatId: chat.id,
      error: completedSource.errorMessage ?? completedSource.progress.error ?? "source_ingest_failed"
    };
  }

  const stage2Run = enqueueAndScheduleStage2Run({
    workspaceId: input.workspaceId,
    creatorUserId: input.userId,
    chatId: chat.id,
    request: buildStage2RunRequestSnapshot({
      sourceUrl: input.reel.canonicalUrl,
      userInstruction:
        "CopScopes daily pool: generate the strongest police/bodycam story caption for a 6-second short. Ignore source-post engagement fiction and unsupported legal claims.",
      mode: "manual",
      baseRunId: null,
      debugMode: "summary",
      channel: buildStage2RunChannelSnapshot(channel, { workspaceId: input.workspaceId })
    })
  });
  const completedStage2 = await waitForStage2RunTerminal(stage2Run.runId, 5 * 60_000);
  if (completedStage2.status !== "completed" || !completedStage2.resultData) {
    return {
      status: "failed",
      qualityGatePassed: false,
      chatId: chat.id,
      stage2RunId: stage2Run.runId,
      error: completedStage2.errorMessage ?? completedStage2.snapshot.error ?? "stage2_failed"
    };
  }

  const stage2 = completedStage2.resultData as Stage2Response;
  const copy = extractCopscopesWinningCopy(stage2);
  const goalText = buildCopscopesStage3EditorGoal({
    reel: input.reel,
    winningCaption: copy.winningCaption
  });
  const renderPlan = normalizeRenderPlan(
    {
      targetDurationSec: DEFAULT_STAGE3_CLIP_DURATION_SEC,
      templateId: channel.templateId,
      sourceCrop: input.sourceCrop,
      editorSelectionMode: "fragments",
      segments: []
    },
    null,
    channel.templateId,
    goalText,
    undefined,
    input.workspaceId
  );
  let stage3: Awaited<ReturnType<typeof runAutonomousOptimization>>;
  try {
    stage3 = await runAutonomousOptimization({
      projectId: chat.id,
      mediaId: input.reel.shortcode,
      workspaceId: input.workspaceId,
      userId: input.userId,
      executionTarget: resolveStage3Execution("host").resolvedTarget,
      sourceUrl: input.reel.canonicalUrl,
      goalText,
      options: {
        maxIterations: 5,
        targetScore: 0.9,
        minGain: 0.015,
        operationBudget: 5
      },
      currentSnapshot: {
        topText: copy.topText,
        bottomText: copy.bottomText,
        sourceOverlayText: "",
        clipStartSec: 0,
        clipDurationSec: DEFAULT_STAGE3_CLIP_DURATION_SEC,
        focusY: 0.5,
        sourceDurationSec: null,
        renderPlan
      },
      idempotencyKey: `copscopes-daily:${input.runId}:${input.reel.id}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "needs_review",
      qualityGatePassed: false,
      chatId: chat.id,
      stage2RunId: stage2Run.runId,
      error: message,
      review: {
        qualityGatePassed: false,
        cropPassed: false,
        sourceMetaLeakDetected: true,
        finalDurationSec: null,
        notes: [
          "Stage 3 editor loop did not complete, so publication was not queued.",
          message
        ]
      },
      report: {
        sourceJobId: sourceJob.jobId,
        stage3Error: message
      }
    };
  }
  const bestVersion = await getVersion(stage3.bestVersionId);
  const snapshot = bestVersion?.transformConfig;
  if (!snapshot) {
    return {
      status: "failed",
      qualityGatePassed: false,
      chatId: chat.id,
      stage2RunId: stage2Run.runId,
      error: "stage3_best_version_missing"
    };
  }

  const cropConfidence = input.sourceCrop?.confidence ?? input.reel.cropConfidence ?? 0;
  const cropPassed = Boolean(input.sourceCrop?.enabled) && cropConfidence >= 0.55;
  const qualityGatePassed = stage3.status === "applied" && stage3.finalScore >= 0.9 && cropPassed;
  if (!qualityGatePassed) {
    return {
      status: "needs_review",
      qualityGatePassed: false,
      chatId: chat.id,
      stage2RunId: stage2Run.runId,
      review: {
        qualityGatePassed: false,
        cropPassed,
        sourceMetaLeakDetected: !cropPassed,
        finalDurationSec: snapshot.clipDurationSec,
        notes: [
          `Stage 3 score ${stage3.finalScore.toFixed(3)} did not clear the CopScopes queue gate.`,
          cropPassed ? "Source crop confidence cleared the minimum gate." : "Source crop confidence is too low for blind queueing."
        ]
      },
      report: {
        stage3SessionId: stage3.sessionId,
        bestVersionId: stage3.bestVersionId,
        finalScore: stage3.finalScore
      }
    };
  }

  const renderBody = {
    requestId: `copscopes-daily-${input.runId}-${input.reel.shortcode}`,
    sourceUrl: input.reel.canonicalUrl,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: chat.id,
    publishAfterRender: true,
    renderTitle: copy.title,
    topText: snapshot.topText,
    bottomText: snapshot.bottomText,
    sourceOverlayText: snapshot.sourceOverlayText,
    templateId: snapshot.renderPlan.templateId,
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    focusY: snapshot.focusY,
    agentPrompt: goalText,
    renderPlan: snapshot.renderPlan,
    snapshot
  } satisfies Stage3RenderRequestBody;
  const executionTarget = resolveStage3Execution("host").resolvedTarget;
  const renderJob = enqueueAndScheduleStage3Job({
    workspaceId: input.workspaceId,
    userId: input.userId,
    kind: "render",
    executionTarget,
    dedupeKey: buildStage3RenderRequestDedupeKey(renderBody, {
      workspaceId: input.workspaceId,
      userId: input.userId
    }),
    payloadJson: JSON.stringify(renderBody),
    reuseCompleted: false
  });

  return {
    status: "queued",
    qualityGatePassed: true,
    chatId: chat.id,
    stage2RunId: stage2Run.runId,
    stage3JobId: renderJob.id,
    review: {
      qualityGatePassed: true,
      cropPassed: true,
      sourceMetaLeakDetected: false,
      finalDurationSec: snapshot.clipDurationSec,
      notes: [
        `Stage 3 cleared queue gate with score ${stage3.finalScore.toFixed(3)}.`,
        "Render job was queued with publishAfterRender; publication is created only after render completion."
      ]
    },
    report: {
      sourceJobId: sourceJob.jobId,
      stage3SessionId: stage3.sessionId,
      bestVersionId: stage3.bestVersionId,
      finalScore: stage3.finalScore
    }
  };
};

function compactReel(reel: CopscopesSourceReel) {
  return {
    id: reel.id,
    shortcode: reel.shortcode,
    url: reel.canonicalUrl,
    categorySlug: reel.categorySlug,
    status: reel.status
  };
}

export async function runCopscopesDailyPool(input: {
  workspaceId: string;
  channelId: string;
  userId: string;
  categorySlug?: string | null;
  limit?: number | null;
  attemptBudget?: number | null;
  dryRun?: boolean | null;
  executor?: CopscopesDailyExecutor | null;
}): Promise<RunCopscopesDailyPoolResult> {
  const limit = Math.max(1, Math.min(3, Math.floor(input.limit ?? 3)));
  const attemptBudget = Math.max(limit, Math.min(12, Math.floor(input.attemptBudget ?? limit * 2)));
  const dryRun = Boolean(input.dryRun);
  const selection = selectCopscopesDailyCandidates({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    categorySlug: input.categorySlug,
    limit: attemptBudget,
    markInProgress: !dryRun
  });
  const categorySlug = selection.category?.slug ?? input.categorySlug ?? null;
  const selected = selection.reels.map(compactReel);

  if (dryRun) {
    return {
      dryRun,
      runId: null,
      status: "dry_run",
      categorySlug,
      selected,
      queuedCount: 0,
      reviewedCount: 0,
      failedCount: 0,
      exhausted: selection.exhausted,
      report: {
        limit,
        attemptBudget,
        activeCategory: categorySlug,
        selectedCount: selected.length
      }
    };
  }

  if (!selection.category) {
    return {
      dryRun,
      runId: null,
      status: "failed",
      categorySlug,
      selected,
      queuedCount: 0,
      reviewedCount: 0,
      failedCount: 1,
      exhausted: false,
      report: {
        error: "no_active_copscopes_category"
      }
    };
  }

  const runId = createCopscopesDailyRun({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    categoryId: selection.category.id,
    categorySlug: selection.category.slug,
    status: selection.exhausted ? "exhausted" : "running",
    limit,
    attemptBudget,
    dryRun,
    selectedCount: selected.length,
    report: {
      selected
    }
  });

  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "copscopes_daily_pool.started",
    entityType: "copscopes_daily_run",
    entityId: runId,
    channelId: input.channelId,
    stage: "mcp",
    status: "running",
    payload: {
      categorySlug: selection.category.slug,
      limit,
      attemptBudget,
      selectedCount: selected.length
    }
  });

  if (selection.exhausted || selection.reels.length === 0) {
    updateCopscopesDailyRunSummary({
      runId,
      status: "exhausted",
      queuedCount: 0,
      reviewedCount: 0,
      failedCount: 0,
      report: {
        reason: "active_category_exhausted"
      }
    });
    return {
      dryRun,
      runId,
      status: "exhausted",
      categorySlug: selection.category.slug,
      selected,
      queuedCount: 0,
      reviewedCount: 0,
      failedCount: 0,
      exhausted: true,
      report: {
        reason: "active_category_exhausted"
      }
    };
  }

  const executor = input.executor ?? copscopesProductionDailyExecutor;
  let queuedCount = 0;
  let reviewedCount = 0;
  let failedCount = 0;
  const itemReports: Record<string, unknown>[] = [];
  const processedIds = new Set<string>();

  for (const reel of selection.reels) {
    if (queuedCount >= limit) {
      break;
    }
    processedIds.add(reel.id);
    try {
      const result = await executor({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        userId: input.userId,
        runId,
        reel,
        targetDurationSec: DEFAULT_STAGE3_CLIP_DURATION_SEC,
        sourceCrop: reel.crop
      });
      const queueAllowed = shouldQueueCopscopesStage3Render(result);
      const finalStatus = queueAllowed ? "consumed" : result.status === "failed" ? "failed" : "needs_review";
      markCopscopesSourceReel({
        reelId: reel.id,
        status: finalStatus,
        chatId: result.chatId,
        stage2RunId: result.stage2RunId,
        stage3JobId: result.stage3JobId,
        error: finalStatus === "consumed" ? null : result.error ?? "copscopes_quality_gate_failed"
      });
      recordCopscopesDailyRunItem({
        runId,
        sourceReelId: reel.id,
        status: finalStatus,
        chatId: result.chatId,
        stage2RunId: result.stage2RunId,
        stage3JobId: result.stage3JobId,
        publicationId: result.publicationId,
        errorMessage: finalStatus === "consumed" ? null : result.error ?? "copscopes_quality_gate_failed",
        result: {
          ...result.report,
          review: result.review ?? null,
          queueAllowed
        }
      });
      if (queueAllowed) {
        queuedCount += 1;
      } else if (finalStatus === "failed") {
        failedCount += 1;
      } else {
        reviewedCount += 1;
      }
      itemReports.push({
        reelId: reel.id,
        shortcode: reel.shortcode,
        finalStatus,
        queueAllowed
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markCopscopesSourceReel({
        reelId: reel.id,
        status: "failed",
        error: message
      });
      recordCopscopesDailyRunItem({
        runId,
        sourceReelId: reel.id,
        status: "failed",
        errorMessage: message,
        result: {}
      });
      failedCount += 1;
      itemReports.push({
        reelId: reel.id,
        shortcode: reel.shortcode,
        finalStatus: "failed",
        error: message
      });
    }
  }

  for (const reel of selection.reels) {
    if (!processedIds.has(reel.id)) {
      markCopscopesSourceReel({
        reelId: reel.id,
        status: "available",
        error: null
      });
    }
  }

  const status: CopscopesRunStatus = queuedCount > 0 || reviewedCount > 0 || failedCount > 0 ? "completed" : "failed";
  const report = {
    limit,
    attemptBudget,
    categorySlug: selection.category.slug,
    selectedCount: selected.length,
    queuedCount,
    reviewedCount,
    failedCount,
    items: itemReports
  };
  updateCopscopesDailyRunSummary({
    runId,
    status,
    queuedCount,
    reviewedCount,
    failedCount,
    report
  });
  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "copscopes_daily_pool.completed",
    entityType: "copscopes_daily_run",
    entityId: runId,
    channelId: input.channelId,
    stage: "mcp",
    status: "completed",
    payload: report
  });

  return {
    dryRun,
    runId,
    status,
    categorySlug: selection.category.slug,
    selected,
    queuedCount,
    reviewedCount,
    failedCount,
    exhausted: false,
    report
  };
}
