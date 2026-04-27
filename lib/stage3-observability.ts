import type { Stage3JobKind } from "../app/components/types";
import { tryAppendFlowAuditEvent } from "./audit-log-store";
import { newId } from "./db/client";

type Stage3RequestAuditBody = {
  requestId?: string | null;
  chatId?: string | null;
  channelId?: string | null;
  sourceUrl?: string | null;
  templateId?: string | null;
  renderPlan?: {
    templateId?: string | null;
  } | null;
  snapshot?: {
    renderPlan?: {
      templateId?: string | null;
    } | null;
  } | null;
};

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractStage3RequestAuditFacts(body: Stage3RequestAuditBody | null | undefined): {
  requestId: string | null;
  chatId: string | null;
  channelId: string | null;
  sourceUrl: string | null;
  templateId: string | null;
} {
  const templateId =
    cleanString(body?.snapshot?.renderPlan?.templateId) ??
    cleanString(body?.renderPlan?.templateId) ??
    cleanString(body?.templateId);
  return {
    requestId: cleanString(body?.requestId),
    chatId: cleanString(body?.chatId),
    channelId: cleanString(body?.channelId),
    sourceUrl: cleanString(body?.sourceUrl),
    templateId
  };
}

export function auditStage3RequestFailure(input: {
  workspaceId: string;
  userId: string;
  kind: Stage3JobKind;
  body?: Stage3RequestAuditBody | null;
  errorCode: string;
  errorMessage: string;
  recoverable: boolean;
  executionTarget?: string | null;
}): void {
  const facts = extractStage3RequestAuditFacts(input.body);
  tryAppendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "stage3_request.failed",
    entityType: "stage3_request",
    entityId: facts.requestId ?? newId(),
    channelId: facts.channelId,
    chatId: facts.chatId,
    correlationId: facts.requestId,
    stage: "stage3",
    status: "failed",
    severity: "error",
    payload: {
      kind: input.kind,
      executionTarget: input.executionTarget ?? null,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      recoverable: input.recoverable,
      sourceUrl: facts.sourceUrl,
      templateId: facts.templateId
    }
  });
}
