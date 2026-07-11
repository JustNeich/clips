import { createHash } from "node:crypto";
import {
  calculateQualityVerdictBindingSha256,
  getProductionItem,
  getProductionRun,
  listAgentAttempts,
  listProductionOutbox,
  listProductionRunChannels,
  recordAgentAttempt,
  recordPublicVerification,
  recordQualityVerdict,
  transitionProductionItem,
  type AgentAttemptRecord,
  type ProductionItemRecord,
  type ProductionOutboxRecord
} from "./portfolio-production-store";
import {
  dispatchPortfolioProductionOutbox,
  getPortfolioProductionRun,
  reconcilePortfolioProductionRun,
  type PortfolioRunSummary
} from "./portfolio-production-orchestrator";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireItem(itemId: string): ProductionItemRecord {
  const item = getProductionItem(itemId);
  if (!item) throw new Error(`Simulation item not found: ${itemId}`);
  return item;
}

function recordSimulationAgent(
  item: ProductionItemRecord,
  role: string,
  output: unknown,
  qualityBindingSha256?: string | null,
  stamp: string = new Date().toISOString()
): AgentAttemptRecord {
  const attemptNo = listAgentAttempts({
    runId: item.runId,
    productionItemId: item.id
  }).filter((attempt) => attempt.role === role).length + 1;
  return recordAgentAttempt({
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    role,
    attemptNo,
    model: "deterministic-simulation",
    reasoningLevel: "none",
    promptHash: hash({ role, itemId: item.id }),
    qualityBindingSha256: qualityBindingSha256 ?? null,
    outputHash: hash(output),
    artifactIds: [],
    status: "passed",
    outcome: "simulation",
    verdict: "pass",
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    costUnit: "codex_credits",
    durationMs: 0,
    startedAt: stamp,
    finishedAt: stamp
  });
}

function recordPassGate(
  item: ProductionItemRecord,
  gateType: "source" | "preview" | "final",
  artifactSha256: string,
  agentAttempt: AgentAttemptRecord
): void {
  const common = {
    workspaceId: item.workspaceId,
    runId: item.runId,
    productionItemId: item.id,
    gateType,
    verdict: "pass" as const,
    attemptNo: agentAttempt.attemptNo,
    artifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256,
    defects: []
  };
  recordQualityVerdict({
    ...common,
    judgeKind: "deterministic",
    evidenceSha256: hash({ gateType, artifactSha256, kind: "deterministic-simulation-probe" }),
    evidenceArtifactPath: `/simulation/${item.id}/${gateType}-deterministic.json`
  });
  recordQualityVerdict({
    ...common,
    judgeKind: gateType === "source" ? "semantic" : "vision",
    agentAttemptId: agentAttempt.id,
    evidenceSha256: hash({ gateType, artifactSha256, kind: "agent-simulation-verdict" }),
    evidenceArtifactPath: `/simulation/${item.id}/${gateType}-agent.json`
  });
}

export type PortfolioSimulationFaults = {
  failBeforeEvent?: Record<string, number>;
  uploadOutcomeUnknownOnce?: boolean;
};

export function createPortfolioSimulationDispatcher(input: {
  faults?: PortfolioSimulationFaults;
  // Optional virtual clock. Deterministic replay/simulation contours pass it so
  // every time-dependent store write (outbox availableAt via transitionProductionItem,
  // recordPublicVerification) is stamped on the virtual clock, not the real one.
  now?: () => Date;
} = {}): (event: ProductionOutboxRecord) => Promise<void> {
  const remainingFailures = new Map(
    Object.entries(input.faults?.failBeforeEvent ?? {})
  );
  const now = input.now ?? (() => new Date());
  let uploadOutcomeUnknownRemaining = input.faults?.uploadOutcomeUnknownOnce === true;

  return async (event) => {
    const stampIso = now().toISOString();
    const failures = remainingFailures.get(event.eventKind) ?? 0;
    if (failures > 0) {
      remainingFailures.set(event.eventKind, failures - 1);
      throw new Error(`Injected simulation failure before ${event.eventKind}`);
    }
    if (event.eventKind === "production.item.public_verified") {
      return;
    }
    let item = requireItem(event.productionItemId);
    const run = getProductionRun(item.runId);
    if (!run) throw new Error("Simulation run not found.");

    if (event.eventKind === "source_ingest.requested") {
      const sourceSha256 = hash({ itemId: item.id, candidateId: item.sourceCandidateId, stage: "source" });
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "source_ingested",
        eventType: "simulation.source_ingested",
        patch: { sourceSha256 },
        outbox: {
          eventKind: "source_fit.requested",
          payload: { sourceSha256 },
          maxAttempts: 3
        },
        now: stampIso
      });
      return;
    }

    if (event.eventKind === "source_fit.requested") {
      const bindingSha256 = calculateQualityVerdictBindingSha256({
        gateType: "source",
        artifactSha256: item.sourceSha256!,
        sourceSha256: item.sourceSha256
      });
      const attempt = recordSimulationAgent(item, "source_fit", { decision: "PASS" }, bindingSha256, stampIso);
      recordPassGate(item, "source", item.sourceSha256!, attempt);
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "source_qualified",
        eventType: "simulation.source_qualified",
        outbox: {
          eventKind: "brief.requested",
          payload: { sourceSha256: item.sourceSha256 },
          maxAttempts: 3
        },
        now: stampIso
      });
      return;
    }

    if (event.eventKind === "brief.requested") {
      recordSimulationAgent(item, "caption", { title: "Simulation title", hook: "Hook" }, null, stampIso);
      recordSimulationAgent(item, "montage_planner", { clipStartSec: 0, durationSec: 30 }, null, stampIso);
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "brief_ready",
        eventType: "simulation.brief_ready",
        outbox: {
          eventKind: "preview.requested",
          payload: { sourceSha256: item.sourceSha256 },
          maxAttempts: 3
        },
        now: stampIso
      });
      return;
    }

    if (event.eventKind === "preview.requested") {
      const runChannel = listProductionRunChannels(item.runId).find(
        (channel) => channel.id === item.runChannelId
      );
      if (!runChannel) throw new Error("Simulation run channel not found.");
      const previewSha256 = hash({ itemId: item.id, stage: "preview" });
      const templateSha256 = hash({ profileHash: runChannel.profileHash, stage: "template" });
      const settingsSha256 = hash({ runId: item.runId, itemId: item.id, stage: "settings" });
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "preview_ready",
        eventType: "simulation.preview_ready",
        patch: { previewSha256, templateSha256, settingsSha256 },
        now: stampIso
      });
      const bindingSha256 = calculateQualityVerdictBindingSha256({
        gateType: "preview",
        artifactSha256: previewSha256,
        sourceSha256: item.sourceSha256,
        previewSha256: item.previewSha256,
        templateSha256: item.templateSha256,
        settingsSha256: item.settingsSha256
      });
      const attempt = recordSimulationAgent(
        item,
        "vision_qa",
        { decision: "PASS", artifact: previewSha256 },
        bindingSha256,
        stampIso
      );
      recordPassGate(item, "preview", previewSha256, attempt);
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "preview_approved",
        eventType: "simulation.preview_approved",
        outbox: {
          eventKind: "final_render.requested",
          payload: { previewSha256 },
          maxAttempts: 3
        },
        now: stampIso
      });
      return;
    }

    if (event.eventKind === "final_render.requested") {
      const finalArtifactSha256 = hash({ itemId: item.id, stage: "final" });
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "final_rendered",
        eventType: "simulation.final_rendered",
        patch: { finalArtifactSha256 },
        now: stampIso
      });
      const bindingSha256 = calculateQualityVerdictBindingSha256({
        gateType: "final",
        artifactSha256: finalArtifactSha256,
        sourceSha256: item.sourceSha256,
        previewSha256: item.previewSha256,
        templateSha256: item.templateSha256,
        settingsSha256: item.settingsSha256
      });
      const attempt = recordSimulationAgent(
        item,
        "vision_qa",
        { decision: "PASS", artifact: finalArtifactSha256 },
        bindingSha256,
        stampIso
      );
      recordPassGate(item, "final", finalArtifactSha256, attempt);
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "final_approved",
        eventType: "simulation.final_approved",
        now: stampIso
      });
      if (run.mode === "shadow") return;
      const publicationId = `simulation-publication-${item.id}`;
      const youtubeVideoId = `sim_${hash(item.id).slice(0, 11)}`;
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "publication_scheduled",
        eventType: "simulation.publication_scheduled",
        patch: { publicationId, youtubeVideoId },
        now: stampIso
      });
      if (uploadOutcomeUnknownRemaining) {
        uploadOutcomeUnknownRemaining = false;
        transitionProductionItem({
          itemId: item.id,
          expectedVersion: item.version,
          toState: "upload_outcome_unknown",
          eventType: "simulation.upload_outcome_unknown",
          outbox: {
            eventKind: "upload.reconcile",
            payload: { publicationId, youtubeVideoId },
            maxAttempts: 3
          },
          now: stampIso
        });
        return;
      }
      recordPublicVerification({
        productionItemId: item.id,
        expectedItemVersion: item.version,
        publicationId,
        expectedYoutubeChannelId: item.expectedYoutubeChannelId,
        youtubeVideoId,
        attemptNo: 1,
        clipsStatus: "scheduled",
        clipsMatches: true,
        rssSeen: true,
        shortsHttpStatus: 200,
        pagePlayable: true,
        pageCanonicalVideoId: youtubeVideoId,
        pageChannelId: item.expectedYoutubeChannelId,
        evidence: { simulation: true, exactPage: true },
        now: stampIso
      });
      return;
    }

    if (event.eventKind === "upload.reconcile") {
      if (item.state !== "upload_outcome_unknown" || !item.publicationId || !item.youtubeVideoId) {
        throw new Error("Upload reconciliation lost its bound publication identity.");
      }
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "publication_scheduled",
        eventType: "simulation.upload_reconciled",
        patch: {
          publicationId: item.publicationId,
          youtubeVideoId: item.youtubeVideoId
        },
        now: stampIso
      });
      recordPublicVerification({
        productionItemId: item.id,
        expectedItemVersion: item.version,
        publicationId: item.publicationId!,
        expectedYoutubeChannelId: item.expectedYoutubeChannelId,
        youtubeVideoId: item.youtubeVideoId!,
        attemptNo: 1,
        clipsStatus: "scheduled",
        clipsMatches: true,
        rssSeen: true,
        shortsHttpStatus: 200,
        pagePlayable: true,
        pageCanonicalVideoId: item.youtubeVideoId,
        pageChannelId: item.expectedYoutubeChannelId,
        evidence: { simulation: true, reconciledExistingUpload: true },
        now: stampIso
      });
      return;
    }

    throw new Error(`Unknown portfolio simulation event: ${event.eventKind}`);
  };
}

export async function runPortfolioSimulationUntilSettled(input: {
  runId: string;
  dispatcher?: (event: ProductionOutboxRecord) => Promise<void>;
  maxTicks?: number;
  startTime?: Date;
  // Shared mutable virtual clock. When provided, one clock drives the default
  // dispatcher's store writes, the outbox dispatch, and the reconcile pass, and
  // this loop advances it. Kept coherent with the run-start clock so no write
  // stamps availableAt in the virtual future.
  clock?: { ms: number };
}): Promise<{
  summary: PortfolioRunSummary;
  ticks: number;
  delivered: number;
  retried: number;
  dead: number;
}> {
  const clock = input.clock ?? { ms: (input.startTime ?? new Date()).getTime() };
  const dispatcher = input.dispatcher ?? createPortfolioSimulationDispatcher({ now: () => new Date(clock.ms) });
  const maxTicks = input.maxTicks ?? 50;
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const batch = await dispatchPortfolioProductionOutbox({
      owner: `simulation-${input.runId}`,
      dispatcher,
      limit: 100,
      leaseMs: 60_000,
      retryDelayMs: 1_000,
      now: new Date(clock.ms)
    });
    delivered += batch.delivered;
    retried += batch.retried;
    dead += batch.dead;
    const summary = reconcilePortfolioProductionRun({
      runId: input.runId,
      leaseOwner: `simulation-reconcile-${input.runId}`,
      now: new Date(clock.ms)
    });
    const terminal =
      summary.run.status === "completed" ||
      summary.run.status === "blocked" ||
      summary.run.status === "failed";
    const hasOutstandingOutbox = listProductionOutbox({ runId: input.runId })
      .some((event) => event.status === "pending" || event.status === "processing");
    if (terminal && !hasOutstandingOutbox) {
      return { summary, ticks: tick, delivered, retried, dead };
    }
    if (batch.claimed === 0) {
      clock.ms += 1_000;
    } else {
      clock.ms += 10;
    }
  }
  return {
    summary: getPortfolioProductionRun(input.runId),
    ticks: maxTicks,
    delivered,
    retried,
    dead
  };
}
