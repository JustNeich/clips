import { createHash } from "node:crypto";
import path from "node:path";

import { requireOwnerOrMcpMachineScope } from "../../../../../lib/auth/guards";
import { appendFlowAuditEvent } from "../../../../../lib/audit-log-store";
import { newId } from "../../../../../lib/db/client";
import {
  MultipartUploadError,
  parseMultipartSingleFileRequest
} from "../../../../../lib/multipart-upload";
import {
  assertProjectKingsSourceQualificationApprovalActive,
  decideProjectKingsSourceRefill,
  importUploadedQualifiedProjectKingsSource,
  isProjectKingsSourceCandidateProductionReady
} from "../../../../../lib/project-kings/source-buffer-refill";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "../../../../../lib/project-kings/pilot-production-profiles";
import {
  verifyProjectKingsSourceQualificationEvidence,
  type ProjectKingsSourceQualificationEvidence
} from "../../../../../lib/project-kings/source-buffer-readiness";
import { getActiveProjectKingsSourcePolicyApproval } from "../../../../../lib/project-kings/source-policy-approval-store";
import { storeUploadedSourceMedia } from "../../../../../lib/source-media-cache";
import { buildUploadedSourceUrl } from "../../../../../lib/uploaded-source";
import {
  listChannelSourceCandidates,
  type ChannelSourceCandidateRecord
} from "../../../../../lib/portfolio-production-store";

export const runtime = "nodejs";

const MAX_SOURCE_BUFFER_UPLOAD_BYTES = 512 * 1024 * 1024;
const PROFILE_KEYS = new Set<ProjectKingsPilotProfileKey>([
  "dark-joy-boy",
  "light-kingdom",
  "copscopes-x2e"
]);

function sanitizeFileName(fileName: string): string {
  return path.basename(fileName).replace(/["\r\n]/g, "_");
}

function looksLikeMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && new TextDecoder("ascii").decode(bytes.slice(4, 8)) === "ftyp";
}

function createReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

function parseProfileKey(value: string | undefined): ProjectKingsPilotProfileKey {
  const key = value?.trim() as ProjectKingsPilotProfileKey | undefined;
  if (!key || !PROFILE_KEYS.has(key)) throw new Error("Unsupported Project Kings profileKey.");
  return key;
}

function parseQualificationEvidence(value: string | undefined): ProjectKingsSourceQualificationEvidence {
  if (!value?.trim()) throw new Error("qualificationEvidence is required.");
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("qualificationEvidence must be a JSON object.");
  }
  return parsed as ProjectKingsSourceQualificationEvidence;
}

function candidateResponse(candidate: ChannelSourceCandidateRecord, created: boolean): Response {
  return Response.json({
    created,
    candidate: {
      id: candidate.id,
      channelId: candidate.channelId,
      canonicalUrl: candidate.canonicalUrl,
      contentSha256: candidate.contentSha256,
      eventFingerprint: candidate.eventFingerprint,
      qualificationStatus: candidate.qualificationStatus,
      status: candidate.status
    }
  }, { status: created ? 201 : 200 });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpMachineScope(request, "control:write");
    const sourcePolicyApproval = getActiveProjectKingsSourcePolicyApproval(auth.workspace.id);
    const channels = Object.entries(PROJECT_KINGS_PILOT_PROFILES).map(([key, profile]) => {
      const candidates = listChannelSourceCandidates({
        workspaceId: auth.workspace.id,
        channelId: profile.profileId,
        limit: 1000
      });
      const qualifiedAvailable = candidates.filter((candidate) =>
        candidate.status === "available" &&
        candidate.rightsStatus === "owner_approved_source_pool" &&
        isProjectKingsSourceCandidateProductionReady(candidate)
      ).length;
      return {
        profileKey: key,
        channelId: profile.profileId,
        qualifiedAvailable,
        refill: decideProjectKingsSourceRefill({ qualifiedAvailable }),
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          canonicalUrl: candidate.canonicalUrl,
          contentSha256: candidate.contentSha256,
          eventFingerprint: candidate.eventFingerprint,
          rightsStatus: candidate.rightsStatus,
          status: candidate.status,
          qualificationStatus: candidate.qualificationStatus
        }))
      };
    });
    return Response.json({
      schemaVersion: "project-kings-source-buffer-runtime-v1",
      workspaceId: auth.workspace.id,
      ready: channels.every((channel) => channel.qualifiedAvailable >= channel.refill.readyBufferMin),
      sourcePolicyApproval: sourcePolicyApproval?.approval ?? null,
      sourcePolicyApprovalSha256: sourcePolicyApproval?.approvalSha256 ?? null,
      channels
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: error instanceof Error ? error.message : "Project Kings source-buffer read failed." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpMachineScope(request, "control:write");
    const parsed = await parseMultipartSingleFileRequest(request, {
      fileFieldName: "file",
      maxFileBytes: MAX_SOURCE_BUFFER_UPLOAD_BYTES,
      fileTooLargeMessage: `Source candidate exceeds ${Math.round(
        MAX_SOURCE_BUFFER_UPLOAD_BYTES / (1024 * 1024)
      )} MB.`,
      parseErrorMessage: "Could not parse Project Kings source-buffer upload.",
      missingBodyMessage: "Send multipart/form-data with file and qualification fields."
    });
    if (!parsed.file || !looksLikeMp4(parsed.file.bytes)) {
      return Response.json({ error: "Only a complete MP4 source candidate can be imported." }, { status: 400 });
    }
    const mimeType = parsed.file.mimeType.trim().toLowerCase();
    if (mimeType !== "video/mp4" && mimeType !== "application/mp4") {
      return Response.json({ error: "Project Kings source candidate must use video/mp4." }, { status: 400 });
    }
    const profileKey = parseProfileKey(parsed.fields.profileKey);
    const sourceBufferEvidenceSha256 = parsed.fields.sourceBufferEvidenceSha256?.trim() ?? "";
    const qualificationEvidence = parseQualificationEvidence(parsed.fields.qualificationEvidence);
    verifyProjectKingsSourceQualificationEvidence(qualificationEvidence);
    assertProjectKingsSourceQualificationApprovalActive({
      workspaceId: auth.workspace.id,
      qualificationEvidence
    });
    if (qualificationEvidence.profileKey !== profileKey) {
      return Response.json({ error: "profileKey differs from qualification evidence." }, { status: 400 });
    }
    const uploadedSha256 = createHash("sha256").update(parsed.file.bytes).digest("hex");
    if (uploadedSha256 !== qualificationEvidence.contentSha256) {
      return Response.json({ error: "Uploaded bytes differ from qualification evidence." }, { status: 400 });
    }
    const profile = PROJECT_KINGS_PILOT_PROFILES[profileKey];
    const existing = listChannelSourceCandidates({
      workspaceId: auth.workspace.id,
      channelId: profile.profileId,
      limit: 1000
    }).find((candidate) =>
      candidate.canonicalUrl === qualificationEvidence.canonicalUrl ||
      candidate.contentSha256 === qualificationEvidence.contentSha256 ||
      candidate.eventFingerprint === qualificationEvidence.eventFingerprint
    );
    if (existing) {
      if (
        existing.rightsStatus !== "owner_approved_source_pool" ||
        existing.contentSha256 !== qualificationEvidence.contentSha256 ||
        existing.eventFingerprint !== qualificationEvidence.eventFingerprint ||
        !isProjectKingsSourceCandidateProductionReady(existing)
      ) {
        return Response.json(
          { error: "Existing source record has a conflicting or incomplete immutable binding." },
          { status: 409 }
        );
      }
      appendFlowAuditEvent({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "project_kings.source_buffer.imported",
        entityType: "channel_source_candidate",
        entityId: existing.id,
        channelId: existing.channelId,
        stage: "source_refill",
        status: "idempotent",
        severity: "info",
        payload: {
          candidateId: qualificationEvidence.candidateId,
          sourceBufferEvidenceSha256,
          contentSha256: existing.contentSha256,
          eventFingerprint: existing.eventFingerprint
        }
      });
      return candidateResponse(existing, false);
    }
    const fileName = sanitizeFileName(parsed.file.name || `${qualificationEvidence.candidateId}.mp4`);
    const uploadedSourceUrl = buildUploadedSourceUrl(newId(), fileName);
    await storeUploadedSourceMedia({
      sourceUrl: uploadedSourceUrl,
      fileName,
      title: qualificationEvidence.candidateId,
      sourceStream: createReadableStream(parsed.file.bytes),
      maxBytes: MAX_SOURCE_BUFFER_UPLOAD_BYTES,
      requireMp4Signature: true
    });
    const result = await importUploadedQualifiedProjectKingsSource({
      workspaceId: auth.workspace.id,
      profileKey,
      uploadedSourceUrl,
      sourceBufferEvidenceSha256,
      qualificationEvidence
    });
    appendFlowAuditEvent({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      action: "project_kings.source_buffer.imported",
      entityType: "channel_source_candidate",
      entityId: result.candidate.id,
      channelId: result.candidate.channelId,
      stage: "source_refill",
      status: result.created ? "created" : "idempotent",
      severity: "info",
      payload: {
        candidateId: qualificationEvidence.candidateId,
        sourceBufferEvidenceSha256,
        contentSha256: result.candidate.contentSha256,
        eventFingerprint: result.candidate.eventFingerprint
      }
    });
    return candidateResponse(result.candidate, result.created);
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof MultipartUploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Project Kings source import failed." },
      { status: 400 }
    );
  }
}
