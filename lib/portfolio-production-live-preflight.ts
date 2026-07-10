import { createHash } from "node:crypto";
import { getChannelById } from "./chat-history";
import { readManagedTemplate } from "./managed-template-store";
import {
  getChannelPublishIntegration,
  getChannelPublishSettings
} from "./publication-store";
import type { ProductionProfileRecord } from "./portfolio-production-store";
import type { ProductionPreflightCheck } from "./portfolio-production-orchestrator";
import { listStage3Workers, type Stage3WorkerRecord } from "./stage3-worker-store";
import { getWorkspaceStage3ExecutionTarget } from "./team-store";
import type { ChannelProductionProfile } from "./project-kings/channel-production-profile";
import { isProductionSemanticExecutorReadiness } from "./project-kings/production-semantic-job-contract";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deriveSlots(input: {
  firstSlotLocalTime: string;
  dailySlotCount: number;
  slotIntervalMinutes: number;
}): string[] {
  const [hourText, minuteText] = input.firstSlotLocalTime.split(":");
  const start = Number(hourText) * 60 + Number(minuteText);
  if (!Number.isFinite(start)) return [];
  return Array.from({ length: input.dailySlotCount }, (_, index) => {
    const total = (start + index * input.slotIntervalMinutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
}

function check(
  code: string,
  pass: boolean,
  detail: string,
  expected?: unknown,
  actual?: unknown,
  blocking = true
): ProductionPreflightCheck {
  return { code, pass, blocking, detail, expected, actual };
}

export function calculateManagedTemplateApiSha(template: unknown): string {
  return sha256(JSON.stringify({ template }));
}

function workerCapabilities(worker: Stage3WorkerRecord): Record<string, unknown> | null {
  if (!worker.capabilitiesJson) return null;
  try {
    const parsed = JSON.parse(worker.capabilitiesJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function classifyPortfolioLiveWorkers(
  workers: readonly Stage3WorkerRecord[]
): Readonly<{
  renderWorkerIds: readonly string[];
  semanticWorkerIds: readonly string[];
}> {
  const online = workers.filter(
    (worker) => worker.status === "online" || worker.status === "busy"
  );
  const semanticWorkerIds = online.flatMap((worker) => {
    const capabilities = workerCapabilities(worker);
    const readiness = capabilities?.productionSemantic;
    return capabilities?.workerClass === "project-kings-semantic-only-v1" &&
      isProductionSemanticExecutorReadiness(readiness) &&
      readiness.ready &&
      readiness.code === "ready"
      ? [worker.id]
      : [];
  });
  const renderWorkerIds = online.flatMap((worker) => {
    const capabilities = workerCapabilities(worker);
    return capabilities?.workerClass === "project-kings-semantic-only-v1"
      ? []
      : [worker.id];
  });
  return {
    renderWorkerIds: renderWorkerIds.sort(),
    semanticWorkerIds: semanticWorkerIds.sort()
  };
}

export function buildPortfolioLiveProfileValidator(input: {
  workspaceId: string;
  userId: string;
}): (profile: ProductionProfileRecord) => Promise<{
  liveFactsHash: string;
  checks: ProductionPreflightCheck[];
}> {
  return async (profile) => {
    const checks: ProductionPreflightCheck[] = [];
    const config = profile.config as unknown as ChannelProductionProfile;
    const channel = await getChannelById(profile.channelId);
    checks.push(
      check(
        "clips_channel",
        Boolean(channel && channel.workspaceId === input.workspaceId),
        channel ? "Exact Clips channel exists in the workspace." : "Exact Clips channel is missing.",
        profile.channelId,
        channel?.id ?? null
      )
    );
    const integration = getChannelPublishIntegration(profile.channelId);
    checks.push(
      check(
        "youtube_connection",
        integration?.status === "connected" && !integration.lastError,
        integration?.lastError || `YouTube integration status is ${integration?.status ?? "missing"}.`,
        "connected with no lastError",
        { status: integration?.status ?? null, lastError: integration?.lastError ?? null }
      )
    );
    checks.push(
      check(
        "youtube_destination",
        integration?.selectedYoutubeChannelId === profile.expectedYoutubeChannelId,
        "Stable YouTube channel ID must match; title is advisory.",
        profile.expectedYoutubeChannelId,
        integration?.selectedYoutubeChannelId ?? null
      )
    );
    checks.push(
      check(
        "youtube_title_advisory",
        integration?.selectedYoutubeChannelTitle === profile.expectedDestinationTitle,
        "Destination title changed; stable channel ID remains authoritative.",
        profile.expectedDestinationTitle,
        integration?.selectedYoutubeChannelTitle ?? null,
        false
      )
    );

    const settings = getChannelPublishSettings(profile.channelId);
    const actualSlots = deriveSlots(settings);
    const expectedSlots = config.publication.slots.map((slot) => slot.localTime);
    checks.push(
      check(
        "publish_timezone",
        settings.timezone === config.publication.timezone,
        "Publication timezone must match the frozen profile.",
        config.publication.timezone,
        settings.timezone
      )
    );
    checks.push(
      check(
        "publish_slots",
        JSON.stringify(actualSlots) === JSON.stringify(expectedSlots),
        "Publication slot grid must match the frozen profile.",
        expectedSlots,
        actualSlots
      )
    );
    checks.push(
      check(
        "publish_policy",
        settings.autoQueueEnabled && !settings.notifySubscribersByDefault,
        "Auto queue must be enabled and subscriber notifications disabled.",
        { autoQueueEnabled: true, notifySubscribersByDefault: false },
        {
          autoQueueEnabled: settings.autoQueueEnabled,
          notifySubscribersByDefault: settings.notifySubscribersByDefault
        }
      )
    );

    checks.push(
      check(
        "channel_template_id",
        channel?.templateId === profile.templateId,
        "Channel template ID must match the frozen profile.",
        profile.templateId,
        channel?.templateId ?? null
      )
    );
    const template = await readManagedTemplate(profile.templateId, {
      workspaceId: input.workspaceId
    });
    const templateSha = template ? calculateManagedTemplateApiSha(template) : null;
    checks.push(
      check(
        "template_snapshot_sha",
        templateSha === profile.templateSnapshotSha256,
        "Managed template API JSON must match the frozen SHA-256.",
        profile.templateSnapshotSha256,
        templateSha
      )
    );

    const executionTarget = getWorkspaceStage3ExecutionTarget(input.workspaceId);
    const workers = listStage3Workers({
      workspaceId: input.workspaceId,
      userId: input.userId
    }) as Stage3WorkerRecord[];
    const workerReadiness = classifyPortfolioLiveWorkers(workers);
    const onlineRenderWorker = workerReadiness.renderWorkerIds.length > 0;
    checks.push(
      check(
        "stage3_worker",
        executionTarget !== "local" || onlineRenderWorker,
        "A local Stage 3 target requires an online or busy paired worker.",
        { executionTarget, workerReady: true },
        { executionTarget, workerReady: onlineRenderWorker }
      )
    );
    checks.push(
      check(
        "semantic_worker",
        workerReadiness.semanticWorkerIds.length > 0,
        "Semantic roles require an online dedicated worker whose local executor passed preflight; each claimed job revalidates the exact manifest binding.",
        {
          executionTarget: "local",
          workerClass: "project-kings-semantic-only-v1",
          ready: true
        },
        {
          executionTarget: "local",
          workerClass: "project-kings-semantic-only-v1",
          ready: workerReadiness.semanticWorkerIds.length > 0
        }
      )
    );

    const liveFacts = {
      workspaceId: input.workspaceId,
      channelId: channel?.id ?? null,
      channelTemplateId: channel?.templateId ?? null,
      expectedYoutubeChannelId: integration?.selectedYoutubeChannelId ?? null,
      destinationTitle: integration?.selectedYoutubeChannelTitle ?? null,
      integrationStatus: integration?.status ?? null,
      integrationLastError: integration?.lastError ?? null,
      publishSettings: settings,
      templateSha,
      executionTarget,
      renderWorkerIds: workerReadiness.renderWorkerIds,
      semanticWorkerIds: workerReadiness.semanticWorkerIds
    };
    return {
      liveFactsHash: sha256(JSON.stringify(liveFacts)),
      checks
    };
  };
}
