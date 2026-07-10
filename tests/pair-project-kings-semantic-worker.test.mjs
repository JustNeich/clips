import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pairProjectKingsSemanticWorker } from "../scripts/pair-project-kings-semantic-worker.mjs";

test("semantic worker pairing stores a dedicated 0600 config and never returns credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-worker-pair-"));
  const outputPath = path.join(root, "worker-config.json");
  let calls = 0;
  try {
    const result = await pairProjectKingsSemanticWorker({
      serverOrigin: "https://clips.example.test",
      pairingToken: "short-lived-pairing-token",
      outputPath,
      label: "Zoro semantic supervisor",
      fetchImpl: async (_url, init) => {
        calls += 1;
        const request = JSON.parse(String(init?.body));
        assert.equal(request.pairingToken, "short-lived-pairing-token");
        assert.equal(request.capabilities.maxConcurrentJobsPerProcess, 3);
        return Response.json({
          worker: { id: "semantic-worker-id", label: "Zoro semantic supervisor" },
          sessionToken: "private-session-token"
        });
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.credentialsPrinted, false);
    assert.doesNotMatch(JSON.stringify(result), /pairing-token|private-session-token/);
    const stored = JSON.parse(await readFile(outputPath, "utf-8"));
    assert.equal(stored.sessionToken, "private-session-token");
    if (process.platform !== "win32") {
      assert.equal((await stat(outputPath)).mode & 0o077, 0);
    }

    await assert.rejects(
      pairProjectKingsSemanticWorker({
        serverOrigin: "https://clips.example.test",
        pairingToken: "another-token",
        outputPath,
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 500 });
        }
      }),
      /already exists/
    );
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
