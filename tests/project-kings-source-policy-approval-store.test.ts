import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb } from "../lib/db/client";
import {
  approveCurrentProjectKingsSourcePolicy,
  getActiveProjectKingsSourcePolicyApproval
} from "../lib/project-kings/source-policy-approval-store";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "../lib/project-kings/source-rights-sensitive-policy";
import { bootstrapOwner } from "../lib/team-store";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-source-policy-approval-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("source policy approval is exact, durable and idempotent for one owner decision", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Source Policy Approval",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    assert.equal(getActiveProjectKingsSourcePolicyApproval(owner.workspace.id), null);
    assert.throws(() => approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: "f".repeat(64),
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha("owner-intent")
    }), /does not match the exact current frozen policy/);
    assert.throws(() => approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: "e".repeat(64),
      ownerAuthorizationEvidenceSha256: sha("owner-intent")
    }), /does not match the exact current frozen policy/);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM project_kings_source_policy_approvals").get() as { count: number }).count,
      0
    );

    const first = approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha("owner-intent"),
      approvedAt: "2026-07-10T16:00:00.000Z"
    });
    assert.equal(first.existing, false);
    assert.equal(first.approval.status, "active");
    assert.equal(first.approval.approval.policySha256, PROJECT_KINGS_SOURCE_POLICY_SHA256);
    assert.equal(first.approval.approval.approvalSha256, first.approval.approvalSha256);
    assert.equal(
      getActiveProjectKingsSourcePolicyApproval(owner.workspace.id)?.id,
      first.approval.id
    );

    const repeated = approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha("owner-intent"),
      approvedAt: "2040-01-01T00:00:00.000Z"
    });
    assert.equal(repeated.existing, true);
    assert.equal(repeated.approval.id, first.approval.id);
    assert.equal(repeated.approval.approvedAt, first.approval.approvedAt);
    assert.throws(() => approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha("different-owner-intent")
    }), /different owner authorization evidence/);
  });
});

test("different owner, hash drift and revoked state remain fail-closed", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Source Policy Owner One",
      email: "owner-one@example.com",
      password: "Password123!",
      displayName: "Owner One"
    });
    const otherUserId = "source-policy-other-owner";
    getDb().prepare(`INSERT INTO users
      (id, email, password_hash, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(
        otherUserId,
        "owner-two@example.com",
        "test-only-password-hash",
        "Owner Two",
        "2026-07-10T15:00:00.000Z",
        "2026-07-10T15:00:00.000Z"
      );
    const first = approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha("owner-one-intent")
    });
    assert.throws(() => approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: otherUserId,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha("owner-one-intent")
    }), /different owner identity/);

    getDb().prepare("UPDATE project_kings_source_policy_approvals SET approval_sha256 = ? WHERE id = ?")
      .run("0".repeat(64), first.approval.id);
    assert.equal(getActiveProjectKingsSourcePolicyApproval(owner.workspace.id), null);
    getDb().prepare(`UPDATE project_kings_source_policy_approvals
      SET approval_sha256 = ?, status = 'revoked', revoked_at = ?, revoked_by_user_id = ?, revocation_reason = ?
      WHERE id = ?`).run(
        first.approval.approvalSha256,
        "2026-07-10T17:00:00.000Z",
        owner.user.id,
        "owner revoked exact policy approval",
        first.approval.id
      );
    assert.equal(getActiveProjectKingsSourcePolicyApproval(owner.workspace.id), null);
  });
});
