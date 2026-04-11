import assert from "node:assert/strict";
import test from "node:test";

import {
  isRecoverableDynamicImportError,
  loadDynamicImportWithRecovery,
  type DynamicImportRecoveryStorage
} from "../lib/dynamic-import-recovery";

function createMemoryStorage(
  initial: Record<string, string> = {}
): DynamicImportRecoveryStorage & { dump(): Record<string, string> } {
  const state = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return state.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      state.set(key, value);
    },
    removeItem(key: string) {
      state.delete(key);
    },
    dump() {
      return Object.fromEntries(state.entries());
    }
  };
}

test("isRecoverableDynamicImportError recognizes known lazy chunk failures", () => {
  assert.equal(isRecoverableDynamicImportError(new Error("Loading chunk 123 failed.")), true);
  assert.equal(isRecoverableDynamicImportError(new Error("Failed to fetch dynamically imported module")), true);

  const chunkLoadError = new Error("boom");
  chunkLoadError.name = "ChunkLoadError";
  assert.equal(isRecoverableDynamicImportError(chunkLoadError), true);

  assert.equal(isRecoverableDynamicImportError(new Error("Network timeout")), false);
  assert.equal(isRecoverableDynamicImportError("ChunkLoadError"), false);
});

test("loadDynamicImportWithRecovery clears stale recovery markers after a successful import", async () => {
  const storage = createMemoryStorage({
    "clips:dynamic-import-recovery:Step3RenderTemplate": "1"
  });

  const result = await loadDynamicImportWithRecovery(
    async () => ({ ok: true }),
    {
      id: "Step3RenderTemplate",
      storage,
      isClient: true
    }
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(storage.dump(), {});
});

test("loadDynamicImportWithRecovery reloads once on the first recoverable chunk failure", async () => {
  const storage = createMemoryStorage();
  let reloadCalls = 0;
  const error = new Error("Loading chunk step3 failed.");

  await assert.rejects(
    () =>
      loadDynamicImportWithRecovery(
        async () => {
          throw error;
        },
        {
          id: "Step3RenderTemplate",
          storage,
          isClient: true,
          reload: () => {
            reloadCalls += 1;
          }
        }
      ),
    error
  );

  assert.equal(reloadCalls, 1);
  assert.deepEqual(storage.dump(), {
    "clips:dynamic-import-recovery:Step3RenderTemplate": "1"
  });
});

test("loadDynamicImportWithRecovery stops reloading after one failed recovery attempt", async () => {
  const storage = createMemoryStorage({
    "clips:dynamic-import-recovery:Step3RenderTemplate": "1"
  });
  let reloadCalls = 0;
  const error = new Error("Failed to fetch dynamically imported module");

  await assert.rejects(
    () =>
      loadDynamicImportWithRecovery(
        async () => {
          throw error;
        },
        {
          id: "Step3RenderTemplate",
          storage,
          isClient: true,
          reload: () => {
            reloadCalls += 1;
          }
        }
      ),
    error
  );

  assert.equal(reloadCalls, 0);
  assert.deepEqual(storage.dump(), {});
});
