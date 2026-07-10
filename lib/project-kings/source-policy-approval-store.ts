import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_APPROVAL_VERSION,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  createProjectKingsSourcePolicyApproval,
  hashProjectKingsSourcePolicyArtifact,
  type ProjectKingsSourcePolicyApproval
} from "./source-rights-sensitive-policy";
import { getDb, newId, nowIso, runInTransaction } from "../db/client";
import { ProductionStoreError } from "../portfolio-production-store";

export type ProjectKingsSourcePolicyApprovalStatus = "active" | "revoked";

export type ProjectKingsSourcePolicyApprovalRecord = {
  id: string;
  workspaceId: string;
  policyVersion: string;
  policySha256: string;
  sourceDesignationsSha256: string;
  approval: ProjectKingsSourcePolicyApproval;
  approvalSha256: string;
  ownerUserId: string;
  ownerAuthorizationEvidenceSha256: string;
  approvedAt: string;
  status: ProjectKingsSourcePolicyApprovalStatus;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requiredText(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProductionStoreError("invalid_input", `${field} is required.`, { field });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ProductionStoreError("invalid_input", `${field} exceeds ${maxLength} characters.`, { field });
  }
  return normalized;
}

function requiredSha256(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new ProductionStoreError("invalid_input", `${field} must be a lowercase SHA-256.`, { field });
  }
  return normalized;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseApproval(value: unknown): ProjectKingsSourcePolicyApproval | null {
  try {
    const parsed = JSON.parse(String(value ?? "null")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ProjectKingsSourcePolicyApproval
      : null;
  } catch {
    return null;
  }
}

function mapRecord(row: Row): ProjectKingsSourcePolicyApprovalRecord | null {
  const approval = parseApproval(row.approval_json);
  if (!approval) return null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    policyVersion: String(row.policy_version),
    policySha256: String(row.policy_sha256),
    sourceDesignationsSha256: String(row.source_designations_sha256),
    approval,
    approvalSha256: String(row.approval_sha256),
    ownerUserId: String(row.owner_user_id),
    ownerAuthorizationEvidenceSha256: String(row.owner_authorization_evidence_sha256),
    approvedAt: String(row.approved_at),
    status: String(row.status) as ProjectKingsSourcePolicyApprovalStatus,
    revokedAt: optionalText(row.revoked_at),
    revokedByUserId: optionalText(row.revoked_by_user_id),
    revocationReason: optionalText(row.revocation_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function approvalPayload(approval: ProjectKingsSourcePolicyApproval): Record<string, unknown> {
  const payload = { ...approval } as Record<string, unknown>;
  delete payload.approvalSha256;
  return payload;
}

export function isProjectKingsSourcePolicyApprovalRecordValid(
  record: ProjectKingsSourcePolicyApprovalRecord
): boolean {
  const approval = record.approval;
  return record.status === "active" &&
    record.policyVersion === PROJECT_KINGS_SOURCE_POLICY_VERSION &&
    record.policySha256 === PROJECT_KINGS_SOURCE_POLICY_SHA256 &&
    record.sourceDesignationsSha256 === PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 &&
    record.approvalSha256 === approval.approvalSha256 &&
    record.ownerUserId === approval.ownerPrincipalId &&
    record.ownerAuthorizationEvidenceSha256 === approval.ownerAuthorizationEvidenceSha256 &&
    record.approvedAt === approval.approvedAt &&
    approval.approvalVersion === PROJECT_KINGS_SOURCE_POLICY_APPROVAL_VERSION &&
    approval.decision === "approved_policy_and_designated_source_routes" &&
    approval.policyVersion === PROJECT_KINGS_SOURCE_POLICY_VERSION &&
    approval.policySha256 === PROJECT_KINGS_SOURCE_POLICY_SHA256 &&
    approval.sourceDesignationsSha256 === PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 &&
    hashProjectKingsSourcePolicyArtifact(approval.sourceDesignations) ===
      PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 &&
    hashProjectKingsSourcePolicyArtifact(approvalPayload(approval)) === approval.approvalSha256;
}

export function getActiveProjectKingsSourcePolicyApproval(
  workspaceId: string
): ProjectKingsSourcePolicyApprovalRecord | null {
  const normalizedWorkspaceId = requiredText(workspaceId, "workspaceId", 64);
  const row = getDb().prepare(`SELECT * FROM project_kings_source_policy_approvals
    WHERE workspace_id = ? AND policy_version = ? AND policy_sha256 = ?
      AND source_designations_sha256 = ? AND status = 'active'
    LIMIT 1`).get(
      normalizedWorkspaceId,
      PROJECT_KINGS_SOURCE_POLICY_VERSION,
      PROJECT_KINGS_SOURCE_POLICY_SHA256,
      PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256
    ) as Row | undefined;
  if (!row) return null;
  const record = mapRecord(row);
  return record && isProjectKingsSourcePolicyApprovalRecordValid(record) ? record : null;
}

export function approveCurrentProjectKingsSourcePolicy(input: {
  workspaceId: string;
  ownerUserId: string;
  policyVersion: string;
  policySha256: string;
  sourceDesignationsSha256: string;
  ownerAuthorizationEvidenceSha256: string;
  approvalId?: string;
  approvedAt?: string;
}): { approval: ProjectKingsSourcePolicyApprovalRecord; existing: boolean } {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
  const ownerUserId = requiredText(input.ownerUserId, "ownerUserId", 64);
  const policyVersion = requiredText(input.policyVersion, "policyVersion", 160);
  const policySha256 = requiredSha256(input.policySha256, "policySha256");
  const sourceDesignationsSha256 = requiredSha256(
    input.sourceDesignationsSha256,
    "sourceDesignationsSha256"
  );
  const ownerAuthorizationEvidenceSha256 = requiredSha256(
    input.ownerAuthorizationEvidenceSha256,
    "ownerAuthorizationEvidenceSha256"
  );
  if (
    policyVersion !== PROJECT_KINGS_SOURCE_POLICY_VERSION ||
    policySha256 !== PROJECT_KINGS_SOURCE_POLICY_SHA256 ||
    sourceDesignationsSha256 !== PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256
  ) {
    throw new ProductionStoreError(
      "stale_version",
      "Source policy approval input does not match the exact current frozen policy and source designations.",
      {
        expectedPolicyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
        expectedPolicySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
        expectedSourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256
      }
    );
  }

  return runInTransaction((db) => {
    const existingRow = db.prepare(`SELECT * FROM project_kings_source_policy_approvals
      WHERE workspace_id = ? AND policy_version = ? AND policy_sha256 = ?
        AND source_designations_sha256 = ? LIMIT 1`).get(
          workspaceId,
          policyVersion,
          policySha256,
          sourceDesignationsSha256
        ) as Row | undefined;
    if (existingRow) {
      const existing = mapRecord(existingRow);
      if (!existing || !isProjectKingsSourcePolicyApprovalRecordValid(existing)) {
        throw new ProductionStoreError(
          "invalid_transition",
          "Existing source policy approval is revoked, malformed, or no longer matches its exact binding.",
          { approvalId: String(existingRow.id) }
        );
      }
      if (existing.ownerUserId !== ownerUserId) {
        throw new ProductionStoreError(
          "idempotency_conflict",
          "The exact source policy version is already approved by a different owner identity.",
          { approvalId: existing.id, approvedByUserId: existing.ownerUserId }
        );
      }
      if (existing.ownerAuthorizationEvidenceSha256 !== ownerAuthorizationEvidenceSha256) {
        throw new ProductionStoreError(
          "idempotency_conflict",
          "The exact source policy approval is already bound to different owner authorization evidence.",
          { approvalId: existing.id }
        );
      }
      return { approval: existing, existing: true };
    }

    const approvedAt = input.approvedAt ?? nowIso();
    const approvalId = input.approvalId
      ? requiredText(input.approvalId, "approvalId", 160)
      : newId();
    let artifact: ProjectKingsSourcePolicyApproval;
    try {
      artifact = createProjectKingsSourcePolicyApproval({
        approvalId,
        ownerPrincipalId: ownerUserId,
        ownerAuthorizationEvidenceSha256,
        approvedAt
      });
    } catch (error) {
      throw new ProductionStoreError(
        "invalid_input",
        error instanceof Error ? error.message : "Source policy approval artifact is invalid."
      );
    }
    const stamp = nowIso();
    try {
      db.prepare(`INSERT INTO project_kings_source_policy_approvals
        (id, workspace_id, policy_version, policy_sha256, source_designations_sha256,
         approval_json, approval_sha256, owner_user_id, owner_authorization_evidence_sha256,
         approved_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
          approvalId,
          workspaceId,
          policyVersion,
          policySha256,
          sourceDesignationsSha256,
          JSON.stringify(artifact),
          artifact.approvalSha256,
          ownerUserId,
          ownerAuthorizationEvidenceSha256,
          approvedAt,
          stamp,
          stamp
        );
    } catch (error) {
      if (error instanceof Error && /constraint|unique/i.test(error.message)) {
        throw new ProductionStoreError(
          "idempotency_conflict",
          "Source policy approval was claimed concurrently by a different immutable decision."
        );
      }
      throw error;
    }
    const storedRow = db.prepare(`SELECT * FROM project_kings_source_policy_approvals
      WHERE id = ? LIMIT 1`).get(approvalId) as Row | undefined;
    const stored = storedRow ? mapRecord(storedRow) : null;
    if (!stored || !isProjectKingsSourcePolicyApprovalRecordValid(stored)) {
      throw new ProductionStoreError(
        "invalid_transition",
        "Stored source policy approval failed its exact binding verification.",
        { approvalId }
      );
    }
    return { approval: stored, existing: false };
  });
}
