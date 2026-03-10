import {
  Stage3JobEnvelope,
  Stage3JobSummary
} from "../app/components/types";
import { Stage3JobRecord } from "./stage3-job-store";

export type Stage3JobErrorBody = {
  status: "busy" | "error";
  retryAfterSec: number | null;
  jobId: string | null;
  message: string;
  recoverable: boolean;
};

export function buildStage3JobEnvelope(
  job: Stage3JobRecord,
  downloadUrl: string | null
): Stage3JobEnvelope {
  const artifact = job.artifact
    ? {
        ...job.artifact,
        downloadUrl
      }
    : null;

  const summary: Stage3JobSummary = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    dedupeKey: job.dedupeKey,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    attempts: job.attempts,
    recoverable: job.recoverable,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    artifact
  };

  return {
    job: summary
  };
}

export function buildStage3JobErrorBody(input: {
  message: string;
  recoverable: boolean;
  jobId?: string | null;
  retryAfterSec?: number | null;
}): Stage3JobErrorBody {
  return {
    status: input.retryAfterSec ? "busy" : "error",
    retryAfterSec: input.retryAfterSec ?? null,
    jobId: input.jobId ?? null,
    message: input.message,
    recoverable: input.recoverable
  };
}
