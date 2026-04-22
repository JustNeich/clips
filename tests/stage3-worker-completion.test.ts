import assert from "node:assert/strict";
import test from "node:test";

import { completeRemoteStage3Artifact } from "../lib/stage3-worker-completion";

function jsonErrorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

test("completeRemoteStage3Artifact retries with raw upload after retryable multipart 502", async () => {
  const calls: Array<{ headers: HeadersInit | undefined; body: BodyInit | null | undefined }> = [];
  const warnings: string[] = [];

  const result = await completeRemoteStage3Artifact({
    url: "https://clips.example.com/api/stage3/worker/jobs/job-1/complete",
    authHeaders: {
      Authorization: "Bearer token-123"
    },
    jobId: "job-1",
    artifactBytes: new Uint8Array([1, 2, 3, 4]),
    artifactName: "preview.mp4",
    artifactMimeType: "video/mp4",
    resultJson: JSON.stringify({ ok: true }),
    warn: (message) => {
      warnings.push(message);
    },
    fetchImpl: async (_input, init) => {
      calls.push({
        headers: init?.headers,
        body: init?.body
      });
      if (calls.length === 1) {
        return jsonErrorResponse(502, "Bad gateway");
      }
      return new Response(null, { status: 200 });
    }
  });

  assert.equal(result.mode, "raw");
  assert.equal(calls.length, 2);
  assert.match(warnings[0] ?? "", /job-1 \(502\); retrying with raw artifact upload\./);
  assert.ok(calls[0]?.body instanceof FormData);
  assert.ok(calls[1]?.body instanceof Uint8Array);

  const fallbackHeaders = calls[1]?.headers as Record<string, string>;
  assert.equal(fallbackHeaders.Authorization, "Bearer token-123");
  assert.equal(fallbackHeaders["Content-Type"], "video/mp4");
  assert.equal(fallbackHeaders["x-stage3-artifact-name"], encodeURIComponent("preview.mp4"));
  assert.equal(fallbackHeaders["x-stage3-artifact-mime-type"], encodeURIComponent("video/mp4"));
  assert.equal(
    Buffer.from(fallbackHeaders["x-stage3-result-json"] ?? "", "base64url").toString("utf-8"),
    JSON.stringify({ ok: true })
  );
});

test("completeRemoteStage3Artifact does not raw-retry after non-retryable multipart 409", async () => {
  let callCount = 0;

  await assert.rejects(
    completeRemoteStage3Artifact({
      url: "https://clips.example.com/api/stage3/worker/jobs/job-2/complete",
      authHeaders: {
        Authorization: "Bearer token-456"
      },
      jobId: "job-2",
      artifactBytes: new Uint8Array([9, 8, 7]),
      artifactName: "render.mp4",
      artifactMimeType: "video/mp4",
      resultJson: null,
      fetchImpl: async () => {
        callCount += 1;
        return jsonErrorResponse(409, "Job already completed");
      }
    }),
    /Job already completed/
  );

  assert.equal(callCount, 1);
});

test("completeRemoteStage3Artifact retries with raw upload after multipart network failure", async () => {
  const calls: Array<{ headers: HeadersInit | undefined; body: BodyInit | null | undefined }> = [];

  const result = await completeRemoteStage3Artifact({
    url: "https://clips.example.com/api/stage3/worker/jobs/job-3/complete",
    authHeaders: {
      Authorization: "Bearer token-789"
    },
    jobId: "job-3",
    artifactBytes: new Uint8Array([5, 6, 7]),
    artifactName: "proxy.mp4",
    artifactMimeType: "video/mp4",
    resultJson: null,
    fetchImpl: async (_input, init) => {
      calls.push({
        headers: init?.headers,
        body: init?.body
      });
      if (calls.length === 1) {
        throw new Error("socket hang up");
      }
      return new Response(null, { status: 200 });
    }
  });

  assert.equal(result.mode, "raw");
  assert.equal(calls.length, 2);
  assert.ok(calls[1]?.body instanceof Uint8Array);
});
