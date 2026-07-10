import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createProjectKingsSourceRefillRequest,
  decideProjectKingsSourceRefill,
  importQualifiedProjectKingsSourceBuffer
} from "../lib/project-kings/source-buffer-refill";
import { PROJECT_KINGS_PILOT_PROFILES } from "../lib/project-kings/pilot-production-profiles";
import type { ProjectKingsSourceBufferReadinessEvidence } from "../lib/project-kings/source-buffer-readiness";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("refill policy starts below six, fills toward twelve and never exceeds the nine-candidate budget", () => {
  assert.deepEqual(decideProjectKingsSourceRefill({ qualifiedAvailable: 5 }), {
    shouldRefill: true,
    qualifiedAvailable: 5,
    readyBufferMin: 6,
    readyBufferCap: 12,
    candidateAttemptBudget: 9,
    candidatesToRequest: 7
  });
  assert.equal(decideProjectKingsSourceRefill({ qualifiedAvailable: 6 }).shouldRefill, false);
  assert.equal(decideProjectKingsSourceRefill({ qualifiedAvailable: 0 }).candidatesToRequest, 9);

  const request = createProjectKingsSourceRefillRequest({
    workspaceId: "workspace-one",
    profileKey: "copscopes-x2e",
    profileVersion: "project-kings-profile-v1",
    requestedAt: "2026-07-10T12:55:00.000Z",
    qualifiedAvailable: 5
  });
  assert.equal(request?.reason, "ready_buffer_below_minimum");
  assert.equal(request?.channelId, PROJECT_KINGS_PILOT_PROFILES["copscopes-x2e"].profileId);
  assert.equal(request?.candidatesToRequest, 7);
  assert.equal(createProjectKingsSourceRefillRequest({
    workspaceId: "workspace-one",
    profileKey: "copscopes-x2e",
    profileVersion: "project-kings-profile-v1",
    requestedAt: "2026-07-10T12:55:00.000Z",
    qualifiedAvailable: 6
  }), null);
});

for (const version of ["v7", "v13"] as const) {
  test(`local importer rejects historical ${version} readiness before any source mutation`, async () => {
    const evidence = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          `docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10-${version}.json`
        ),
        "utf8"
      )
    ) as ProjectKingsSourceBufferReadinessEvidence;
    await assert.rejects(
      () => importQualifiedProjectKingsSourceBuffer({
        workspaceId: "must-not-be-used",
        repoRoot,
        evidence,
        inspectMedia: async () => assert.fail("legacy evidence must fail before media inspection")
      }),
      /requires policy-bound v2 evidence/i
    );
  });
}
