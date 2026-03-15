import type { Readable } from "node:stream";

type NodeStreamResponseOptions = {
  stream: Readable;
  headers?: HeadersInit;
  status?: number;
  signal?: AbortSignal;
};

function isControllerClosedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeCode = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (maybeCode === "ERR_INVALID_STATE") {
    return true;
  }
  const maybeMessage = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return maybeMessage.includes("Controller is already closed");
}

function isExpectedStreamShutdownError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeCode = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return maybeCode === "ERR_STREAM_DESTROYED" || maybeCode === "ERR_STREAM_PREMATURE_CLOSE";
}

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk);
  }
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }
  return new Uint8Array(0);
}

function destroyStream(stream: Readable): void {
  if (stream.destroyed) {
    return;
  }
  try {
    stream.destroy();
  } catch {
    // Ignore teardown errors when response has been cancelled.
  }
}

export function createNodeStreamResponse({
  stream,
  headers,
  status = 200,
  signal
}: NodeStreamResponseOptions): Response {
  let cancelled = false;
  let closed = false;
  let pullGate: Promise<void> | null = null;
  let pullResolver: (() => void) | null = null;

  const releasePullGate = () => {
    if (!pullResolver) {
      return;
    }
    const resolve = pullResolver;
    pullResolver = null;
    pullGate = null;
    resolve();
  };

  const waitForPullIfNeeded = (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> | null => {
    if (controller.desiredSize === null || controller.desiredSize > 0) {
      return null;
    }
    if (!pullGate) {
      pullGate = new Promise<void>((resolve) => {
        pullResolver = resolve;
      });
    }
    return pullGate;
  };

  const safeClose = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      controller.close();
    } catch {
      // Ignore close races (response aborts / double-close).
    }
  };

  const safeError = (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      controller.error(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // Ignore error races when controller is already closed or detached.
    }
  };

  const cancelStream = () => {
    cancelled = true;
    releasePullGate();
    destroyStream(stream);
  };

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal?.aborted) {
        cancelStream();
        safeClose(controller);
        return;
      }

      const onAbort = () => {
        cancelStream();
        safeClose(controller);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const detachAbort = () => {
        signal?.removeEventListener("abort", onAbort);
      };

      (async () => {
        try {
          for await (const chunk of stream) {
            if (cancelled || closed) {
              break;
            }
            try {
              controller.enqueue(toUint8Array(chunk));
            } catch (enqueueError) {
              if (isControllerClosedError(enqueueError)) {
                cancelStream();
                break;
              }
              throw enqueueError;
            }
            const gate = waitForPullIfNeeded(controller);
            if (gate) {
              await gate;
            }
          }
          if (!cancelled) {
            safeClose(controller);
          }
        } catch (error) {
          if (cancelled || isExpectedStreamShutdownError(error)) {
            safeClose(controller);
            return;
          }
          safeError(controller, error);
        } finally {
          detachAbort();
          releasePullGate();
        }
      })().catch((error) => {
        safeError(controller, error);
      });
    },
    pull() {
      releasePullGate();
    },
    cancel() {
      cancelStream();
    }
  });

  return new Response(webStream, {
    status,
    headers
  });
}
