import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTFOLIO_RESOURCE_LIMITS,
  PortfolioProductionResourceLimiter,
  PortfolioResourceLimitError,
  classifyPortfolioOutboxResource,
  createResourceLimitedPortfolioOutboxDispatcher
} from "../lib/portfolio-production-resource-limits";

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
}

test("source ingest serializes one profile/channel while other channels continue in parallel", async () => {
  const limiter = new PortfolioProductionResourceLimiter();
  const firstA = await limiter.acquire({ lane: "source_ingest", profileId: "profile-a", channelId: "channel-a" });
  let secondAGranted = false;
  const secondAPromise = limiter.acquire({
    lane: "source_ingest",
    profileId: "profile-a",
    channelId: "channel-a"
  }).then((lease) => {
    secondAGranted = true;
    return lease;
  });
  const firstB = await limiter.acquire({ lane: "source_ingest", profileId: "profile-b", channelId: "channel-b" });

  await nextMicrotask();
  assert.equal(secondAGranted, false);
  assert.equal(limiter.getSnapshot().activeByLane.source_ingest, 2);
  assert.equal(limiter.getSnapshot().pendingByLane.source_ingest, 1);

  firstA.release();
  const secondA = await secondAPromise;
  assert.equal(secondAGranted, true);
  assert.equal(limiter.getSnapshot().activeByLane.source_ingest, 2);
  secondA.release();
  firstB.release();
  assert.equal(limiter.getSnapshot().activeLeaseCount, 0);
});

test("semantic model lane grants at most three calls and keeps FIFO order for contenders", async () => {
  const limiter = new PortfolioProductionResourceLimiter();
  const active = await Promise.all([
    limiter.acquire({ lane: "semantic_model" }),
    limiter.acquire({ lane: "semantic_model" }),
    limiter.acquire({ lane: "semantic_model" })
  ]);
  const grantedOrder: number[] = [];
  const fourthPromise = limiter.acquire({ lane: "semantic_model" }).then((lease) => {
    grantedOrder.push(4);
    return lease;
  });
  const fifthPromise = limiter.acquire({ lane: "semantic_model" }).then((lease) => {
    grantedOrder.push(5);
    return lease;
  });
  await nextMicrotask();
  assert.equal(limiter.getSnapshot().activeByLane.semantic_model, PORTFOLIO_RESOURCE_LIMITS.semanticModelGlobal);
  assert.equal(limiter.getSnapshot().pendingByLane.semantic_model, 2);

  active[0].release();
  const fourth = await fourthPromise;
  assert.deepEqual(grantedOrder, [4]);
  active[1].release();
  const fifth = await fifthPromise;
  assert.deepEqual(grantedOrder, [4, 5]);

  active[2].release();
  fourth.release();
  fifth.release();
  assert.equal(limiter.getSnapshot().activeLeaseCount, 0);
});

test("render lane is global-one and withLease releases capacity after an exception", async () => {
  const limiter = new PortfolioProductionResourceLimiter();
  const first = await limiter.acquire({ lane: "render" });
  let secondGranted = false;
  const secondPromise = limiter.acquire({ lane: "render" }).then((lease) => {
    secondGranted = true;
    return lease;
  });
  await nextMicrotask();
  assert.equal(secondGranted, false);
  assert.equal(limiter.getSnapshot().activeByLane.render, PORTFOLIO_RESOURCE_LIMITS.renderGlobal);
  first.release();
  const second = await secondPromise;
  second.release();

  await assert.rejects(
    limiter.withLease({ lane: "render" }, async () => {
      throw new Error("render failed");
    }),
    /render failed/
  );
  assert.equal(limiter.getSnapshot().activeByLane.render, 0);
});

test("publication enforces one per channel and two globally without blocking unrelated channels", async () => {
  const limiter = new PortfolioProductionResourceLimiter();
  const firstA = await limiter.acquire({ lane: "publication", channelId: "channel-a" });
  const firstB = await limiter.acquire({ lane: "publication", channelId: "channel-b" });
  let secondAGranted = false;
  let firstCGranted = false;
  const secondAPromise = limiter.acquire({ lane: "publication", channelId: "channel-a" }).then((lease) => {
    secondAGranted = true;
    return lease;
  });
  const firstCPromise = limiter.acquire({ lane: "publication", channelId: "channel-c" }).then((lease) => {
    firstCGranted = true;
    return lease;
  });
  await nextMicrotask();
  assert.equal(limiter.getSnapshot().activeByResource["publication:global"], 2);
  assert.equal(limiter.getSnapshot().pendingByLane.publication, 2);

  firstB.release();
  const firstC = await firstCPromise;
  assert.equal(firstCGranted, true);
  assert.equal(secondAGranted, false);
  assert.equal(limiter.getSnapshot().activeByResource["publication:global"], 2);

  firstA.release();
  const secondA = await secondAPromise;
  assert.equal(secondAGranted, true);
  assert.equal(limiter.getSnapshot().activeByResource["publication:channel:channel-a"], 1);

  firstC.release();
  secondA.release();
  assert.equal(limiter.getSnapshot().activeLeaseCount, 0);
});

test("expired leases are reclaimed deterministically and stale release cannot steal a new lease", async () => {
  let clockMs = 1_000;
  const limiter = new PortfolioProductionResourceLimiter({ now: () => clockMs, defaultLeaseMs: 10 });
  const stale = await limiter.acquire({ lane: "render" });
  const nextPromise = limiter.acquire({ lane: "render" });
  assert.equal(limiter.getSnapshot().pendingByLane.render, 1);

  clockMs = 1_011;
  assert.equal(limiter.sweepExpiredLeases(), 1);
  const current = await nextPromise;
  assert.equal(current.acquiredAtMs, 1_011);
  assert.equal(stale.released, true);
  assert.equal(stale.release(), false);
  assert.equal(limiter.getSnapshot().activeByLane.render, 1);

  clockMs = 1_015;
  assert.equal(current.renew(20), true);
  assert.equal(current.expiresAtMs, 1_035);
  current.release();
  assert.equal(limiter.getSnapshot().activeLeaseCount, 0);
});

test("pending acquisition can be canceled without affecting the active holder", async () => {
  const limiter = new PortfolioProductionResourceLimiter();
  const active = await limiter.acquire({ lane: "render" });
  const controller = new AbortController();
  const pending = limiter.acquire({ lane: "render", signal: controller.signal });
  assert.equal(limiter.getSnapshot().pendingCount, 1);
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof PortfolioResourceLimitError && error.code === "acquire_aborted"
  );
  assert.equal(limiter.getSnapshot().pendingCount, 0);
  assert.equal(limiter.getSnapshot().activeByLane.render, 1);
  active.release();
});

test("public verification cannot request reasoning tokens and otherwise has no token-polling semaphore", async () => {
  const limiter = new PortfolioProductionResourceLimiter();
  await assert.rejects(
    limiter.acquire({ lane: "public_verification" }),
    (error: unknown) => error instanceof PortfolioResourceLimitError && error.code === "reasoning_tokens_forbidden"
  );
  await assert.rejects(
    limiter.acquire({ lane: "public_verification", usesReasoningTokens: true }),
    (error: unknown) => error instanceof PortfolioResourceLimitError && error.code === "reasoning_tokens_forbidden"
  );
  const leases = await Promise.all(Array.from({ length: 12 }, () => limiter.acquire({
    lane: "public_verification",
    usesReasoningTokens: false
  })));
  assert.equal(limiter.getSnapshot().activeByLane.public_verification, 12);
  assert.deepEqual(limiter.getSnapshot().activeByResource, {});
  leases.forEach((lease) => lease.release());
});

test("outbox classifier and wrapper apply a lease and always release it on dispatcher failure", async () => {
  type Event = { eventKind: string; channelId: string };
  const limiter = new PortfolioProductionResourceLimiter();
  const classified = classifyPortfolioOutboxResource(
    { eventKind: "source_ingest.requested", channelId: "channel-a" },
    { profileId: "profile-a" }
  );
  assert.deepEqual(classified, {
    lane: "source_ingest",
    channelId: "channel-a",
    profileId: "profile-a",
    usesReasoningTokens: undefined,
    leaseMs: undefined
  });
  assert.equal(
    classifyPortfolioOutboxResource({ eventKind: "production.item.public_verified", channelId: "channel-a" }),
    null
  );
  assert.equal(
    classifyPortfolioOutboxResource({ eventKind: "preview_revision.requested", channelId: "channel-a" })?.lane,
    "render"
  );

  let observedActiveLease = false;
  const wrapped = createResourceLimitedPortfolioOutboxDispatcher<Event>({
    limiter,
    resolveRequest: (event) => classifyPortfolioOutboxResource(event, { profileId: "profile-a" }),
    dispatcher: async () => {
      const snapshot = limiter.getSnapshot();
      assert.equal(snapshot.activeByLane.source_ingest, 1);
      observedActiveLease = true;
      throw new Error("dispatcher failed");
    }
  });
  await assert.rejects(wrapped({ eventKind: "source_ingest.requested", channelId: "channel-a" }), /dispatcher failed/);
  assert.equal(observedActiveLease, true);
  assert.equal(limiter.getSnapshot().activeLeaseCount, 0);

  let publicDispatcherCalled = false;
  const forbiddenPublic = createResourceLimitedPortfolioOutboxDispatcher<Event>({
    limiter,
    resolveRequest: (event) => classifyPortfolioOutboxResource(event, { usesReasoningTokens: true }),
    dispatcher: async () => {
      publicDispatcherCalled = true;
    }
  });
  await assert.rejects(
    forbiddenPublic({ eventKind: "public_verify.requested", channelId: "channel-a" }),
    (error: unknown) => error instanceof PortfolioResourceLimitError && error.code === "reasoning_tokens_forbidden"
  );
  assert.equal(publicDispatcherCalled, false);
});
