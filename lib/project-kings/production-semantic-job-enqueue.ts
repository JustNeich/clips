import {
  validateProductionAgentPacket,
  type ProductionAgentPacketByRole
} from "./production-agent-contracts";
import {
  cleanupUnreferencedProductionSemanticInputs,
  releaseProductionSemanticInputReservation,
  stageProductionSemanticInputsWithReceipt
} from "./production-semantic-input-store";
import {
  buildProductionSemanticJobPayload,
  PRODUCTION_SEMANTIC_JOB_ROLES,
  type ProductionSemanticJobPayload,
  type ProductionSemanticJobRole,
  type ProductionSemanticPortablePacketByRole
} from "./production-semantic-job-contract";
import type { ProductionAgentModelSelection } from "./production-agent-runtime";
import {
  enqueueStage3JobWithOutcome,
  type Stage3JobEnqueueResult
} from "../stage3-job-store";

export type EnqueueProductionSemanticStage3JobInput<R extends ProductionSemanticJobRole> = Readonly<{
  workspaceId: string;
  userId: string;
  role: R;
  packet: ProductionAgentPacketByRole[R];
  qualityBindingSha256?: string | null;
  routeManifestId: string;
  routeManifestSha256: string;
  selection: ProductionAgentModelSelection;
  attemptLimit?: number | null;
  attemptGroup?: string | null;
  reuseCompleted?: boolean | null;
}>;

export type EnqueueProductionSemanticStage3JobResult<R extends ProductionSemanticJobRole> = Readonly<{
  payload: ProductionSemanticJobPayload<R>;
  enqueue: Stage3JobEnqueueResult;
}>;

export async function enqueueProductionSemanticStage3Job<R extends ProductionSemanticJobRole>(
  input: EnqueueProductionSemanticStage3JobInput<R>
): Promise<EnqueueProductionSemanticStage3JobResult<R>> {
  const workspaceId = input.workspaceId.trim();
  const userId = input.userId.trim();
  if (!workspaceId || !userId) {
    throw new Error("Production semantic enqueue requires exact workspace and user scope.");
  }
  if (!PRODUCTION_SEMANTIC_JOB_ROLES.includes(input.role)) {
    throw new Error(`Role ${String(input.role)} is not covered by the production-semantic transport contract.`);
  }
  const packet = validateProductionAgentPacket(input.role, input.packet);
  const staged = await stageProductionSemanticInputsWithReceipt(packet.artifacts);
  try {
    const portablePacket = {
      ...packet,
      artifacts: staged.refs
    } as unknown as ProductionSemanticPortablePacketByRole[R];
    const payload = buildProductionSemanticJobPayload({
      role: input.role,
      qualityBindingSha256: input.qualityBindingSha256,
      routeManifestId: input.routeManifestId,
      routeManifestSha256: input.routeManifestSha256,
      selection: input.selection,
      packet: portablePacket
    });
    const enqueue = enqueueStage3JobWithOutcome({
      workspaceId,
      userId,
      kind: "production-semantic",
      executionTarget: "local",
      payloadJson: JSON.stringify(payload),
      dedupeKey: `production-semantic:${payload.invocationKey}`,
      attemptLimit: input.attemptLimit,
      attemptGroup: input.attemptGroup,
      reuseCompleted: input.reuseCompleted
    });
    releaseProductionSemanticInputReservation(staged.reservationId);
    return { payload, enqueue };
  } catch (error) {
    releaseProductionSemanticInputReservation(staged.reservationId);
    try {
      const cleanup = await cleanupUnreferencedProductionSemanticInputs(staged.createdStorageKeys);
      if (cleanup.blocked) {
        throw new Error("Semantic input cleanup was blocked by an invalid existing job payload.");
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Production semantic enqueue failed and staged input cleanup could not be verified."
      );
    }
    throw error;
  }
}
