import type { ProductionOutboxRecord } from "./portfolio-production-store";
import {
  classifyPortfolioDurableResourceLane,
  PORTFOLIO_RESOURCE_LIMITS
} from "./portfolio-production-resource-policy";

export { PORTFOLIO_RESOURCE_LIMITS } from "./portfolio-production-resource-policy";

export type PortfolioResourceLane =
  | "source_ingest"
  | "semantic_model"
  | "render"
  | "publication"
  | "public_verification";

export type PortfolioResourceRequest = {
  lane: PortfolioResourceLane;
  profileId?: string | null;
  channelId?: string | null;
  leaseMs?: number | null;
  usesReasoningTokens?: boolean | null;
  signal?: AbortSignal | null;
};

export type PortfolioResourceLease = {
  readonly id: string;
  readonly lane: PortfolioResourceLane;
  readonly profileId: string | null;
  readonly channelId: string | null;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
  readonly released: boolean;
  renew(leaseMs?: number): boolean;
  release(): boolean;
};

export type PortfolioResourceSnapshot = {
  activeLeaseCount: number;
  pendingCount: number;
  activeByLane: Record<PortfolioResourceLane, number>;
  pendingByLane: Record<PortfolioResourceLane, number>;
  activeByResource: Record<string, number>;
};

export type PortfolioResourceLimitErrorCode =
  | "invalid_request"
  | "reasoning_tokens_forbidden"
  | "acquire_aborted";

export class PortfolioResourceLimitError extends Error {
  readonly code: PortfolioResourceLimitErrorCode;

  constructor(code: PortfolioResourceLimitErrorCode, message: string) {
    super(message);
    this.name = "PortfolioResourceLimitError";
    this.code = code;
  }
}

type ResourceRequirement = {
  key: string;
  capacity: number;
};

type NormalizedRequest = {
  lane: PortfolioResourceLane;
  profileId: string | null;
  channelId: string | null;
  leaseMs: number;
  requirements: ResourceRequirement[];
  signal: AbortSignal | null;
};

type PendingRequest = {
  id: number;
  request: NormalizedRequest;
  resolve: (lease: PortfolioResourceLease) => void;
  reject: (error: Error) => void;
  abortListener: (() => void) | null;
};

type ActiveLease = {
  id: string;
  request: NormalizedRequest;
  acquiredAtMs: number;
  expiresAtMs: number;
};

const DEFAULT_LEASE_MS = 5 * 60_000;
const MAX_LEASE_MS = 60 * 60_000;

function nonEmpty(value: string | null | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PortfolioResourceLimitError("invalid_request", `${field} is required for this resource lane.`);
  }
  return value.trim();
}

function normalizeLeaseMs(value: number | null | undefined, fallback = DEFAULT_LEASE_MS): number {
  const leaseMs = value ?? fallback;
  if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > MAX_LEASE_MS) {
    throw new PortfolioResourceLimitError(
      "invalid_request",
      `leaseMs must be an integer between 1 and ${MAX_LEASE_MS}.`
    );
  }
  return leaseMs;
}

function emptyLaneCounts(): Record<PortfolioResourceLane, number> {
  return {
    source_ingest: 0,
    semantic_model: 0,
    render: 0,
    publication: 0,
    public_verification: 0
  };
}

function normalizeRequest(request: PortfolioResourceRequest, defaultLeaseMs: number): NormalizedRequest {
  const leaseMs = normalizeLeaseMs(request.leaseMs, defaultLeaseMs);
  const profileId = typeof request.profileId === "string" && request.profileId.trim()
    ? request.profileId.trim()
    : null;
  const channelId = typeof request.channelId === "string" && request.channelId.trim()
    ? request.channelId.trim()
    : null;
  if (request.lane === "public_verification" && request.usesReasoningTokens !== false) {
    throw new PortfolioResourceLimitError(
      "reasoning_tokens_forbidden",
      "Public verification must use deterministic Clips/RSS/page checks and cannot poll with reasoning tokens."
    );
  }

  let requirements: ResourceRequirement[];
  switch (request.lane) {
    case "source_ingest": {
      const exactProfileId = nonEmpty(profileId, "profileId");
      const exactChannelId = nonEmpty(channelId, "channelId");
      requirements = [{
        key: `source_ingest:${exactProfileId}:${exactChannelId}`,
        capacity: PORTFOLIO_RESOURCE_LIMITS.sourceIngestPerProfileChannel
      }];
      break;
    }
    case "semantic_model":
      requirements = [{ key: "semantic_model:global", capacity: PORTFOLIO_RESOURCE_LIMITS.semanticModelGlobal }];
      break;
    case "render":
      requirements = [{ key: "render:global", capacity: PORTFOLIO_RESOURCE_LIMITS.renderGlobal }];
      break;
    case "publication": {
      const exactChannelId = nonEmpty(channelId, "channelId");
      requirements = [
        { key: "publication:global", capacity: PORTFOLIO_RESOURCE_LIMITS.publicationGlobal },
        { key: `publication:channel:${exactChannelId}`, capacity: PORTFOLIO_RESOURCE_LIMITS.publicationPerChannel }
      ];
      break;
    }
    case "public_verification":
      requirements = [];
      break;
    default: {
      const exhaustive: never = request.lane;
      throw new PortfolioResourceLimitError("invalid_request", `Unsupported resource lane: ${String(exhaustive)}`);
    }
  }
  return {
    lane: request.lane,
    profileId,
    channelId,
    leaseMs,
    requirements,
    signal: request.signal ?? null
  };
}

export class PortfolioProductionResourceLimiter {
  private readonly now: () => number;
  private readonly defaultLeaseMs: number;
  private readonly resourceUsage = new Map<string, number>();
  private readonly activeLeases = new Map<string, ActiveLease>();
  private readonly pending: PendingRequest[] = [];
  private nextLeaseId = 1;
  private nextPendingId = 1;
  private draining = false;

  constructor(options: { now?: () => number; defaultLeaseMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.defaultLeaseMs = normalizeLeaseMs(options.defaultLeaseMs, DEFAULT_LEASE_MS);
  }

  acquire(request: PortfolioResourceRequest): Promise<PortfolioResourceLease> {
    let normalized: NormalizedRequest;
    try {
      normalized = normalizeRequest(request, this.defaultLeaseMs);
    } catch (error) {
      return Promise.reject(error);
    }
    if (normalized.signal?.aborted) {
      return Promise.reject(new PortfolioResourceLimitError("acquire_aborted", "Resource acquisition was aborted."));
    }
    this.sweepExpiredLeases();
    return new Promise<PortfolioResourceLease>((resolve, reject) => {
      const pending: PendingRequest = {
        id: this.nextPendingId,
        request: normalized,
        resolve,
        reject,
        abortListener: null
      };
      this.nextPendingId += 1;
      if (normalized.signal) {
        pending.abortListener = () => {
          const index = this.pending.findIndex((entry) => entry.id === pending.id);
          if (index < 0) return;
          this.pending.splice(index, 1);
          pending.reject(new PortfolioResourceLimitError("acquire_aborted", "Resource acquisition was aborted."));
          this.drainQueue();
        };
        normalized.signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.push(pending);
      this.drainQueue();
    });
  }

  async withLease<T>(
    request: PortfolioResourceRequest,
    work: (lease: PortfolioResourceLease) => Promise<T> | T
  ): Promise<T> {
    const lease = await this.acquire(request);
    try {
      return await work(lease);
    } finally {
      lease.release();
    }
  }

  sweepExpiredLeases(): number {
    const stamp = this.now();
    const expired = [...this.activeLeases.values()]
      .filter((lease) => lease.expiresAtMs <= stamp)
      .sort((left, right) => left.acquiredAtMs - right.acquiredAtMs || left.id.localeCompare(right.id));
    for (const lease of expired) {
      this.releaseLease(lease.id, false);
    }
    if (expired.length > 0) this.drainQueue();
    return expired.length;
  }

  getSnapshot(): PortfolioResourceSnapshot {
    this.sweepExpiredLeases();
    const activeByLane = emptyLaneCounts();
    const pendingByLane = emptyLaneCounts();
    for (const lease of this.activeLeases.values()) activeByLane[lease.request.lane] += 1;
    for (const pending of this.pending) pendingByLane[pending.request.lane] += 1;
    return {
      activeLeaseCount: this.activeLeases.size,
      pendingCount: this.pending.length,
      activeByLane,
      pendingByLane,
      activeByResource: Object.fromEntries(
        [...this.resourceUsage.entries()].filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right))
      )
    };
  }

  private canGrant(request: NormalizedRequest): boolean {
    return request.requirements.every(
      (requirement) => (this.resourceUsage.get(requirement.key) ?? 0) < requirement.capacity
    );
  }

  private drainQueue(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      let grantedInPass = true;
      while (grantedInPass) {
        grantedInPass = false;
        for (let index = 0; index < this.pending.length; index += 1) {
          const pending = this.pending[index];
          if (!this.canGrant(pending.request)) continue;
          this.pending.splice(index, 1);
          index -= 1;
          this.grant(pending);
          grantedInPass = true;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private grant(pending: PendingRequest): void {
    if (pending.abortListener && pending.request.signal) {
      pending.request.signal.removeEventListener("abort", pending.abortListener);
    }
    const acquiredAtMs = this.now();
    const id = `portfolio-resource-${this.nextLeaseId}`;
    this.nextLeaseId += 1;
    const active: ActiveLease = {
      id,
      request: pending.request,
      acquiredAtMs,
      expiresAtMs: acquiredAtMs + pending.request.leaseMs
    };
    for (const requirement of pending.request.requirements) {
      this.resourceUsage.set(requirement.key, (this.resourceUsage.get(requirement.key) ?? 0) + 1);
    }
    this.activeLeases.set(id, active);
    const limiter = this;
    pending.resolve({
      id,
      lane: pending.request.lane,
      profileId: pending.request.profileId,
      channelId: pending.request.channelId,
      acquiredAtMs,
      get expiresAtMs() {
        return limiter.activeLeases.get(id)?.expiresAtMs ?? active.expiresAtMs;
      },
      get released() {
        return !limiter.activeLeases.has(id);
      },
      renew(leaseMs = pending.request.leaseMs) {
        return limiter.renewLease(id, leaseMs);
      },
      release() {
        return limiter.releaseLease(id, true);
      }
    });
  }

  private renewLease(id: string, leaseMs: number): boolean {
    const duration = normalizeLeaseMs(leaseMs, this.defaultLeaseMs);
    const active = this.activeLeases.get(id);
    if (!active) return false;
    const stamp = this.now();
    if (active.expiresAtMs <= stamp) {
      this.releaseLease(id, true);
      return false;
    }
    active.expiresAtMs = stamp + duration;
    return true;
  }

  private releaseLease(id: string, drain: boolean): boolean {
    const active = this.activeLeases.get(id);
    if (!active) return false;
    this.activeLeases.delete(id);
    for (const requirement of active.request.requirements) {
      const next = Math.max(0, (this.resourceUsage.get(requirement.key) ?? 0) - 1);
      if (next === 0) this.resourceUsage.delete(requirement.key);
      else this.resourceUsage.set(requirement.key, next);
    }
    if (drain) this.drainQueue();
    return true;
  }
}

export type PortfolioOutboxResourceContext = {
  profileId?: string | null;
  usesReasoningTokens?: boolean | null;
  leaseMs?: number | null;
};

export function classifyPortfolioOutboxResource(
  event: Pick<ProductionOutboxRecord, "eventKind" | "channelId">,
  context: PortfolioOutboxResourceContext = {}
): PortfolioResourceRequest | null {
  const base = {
    channelId: event.channelId,
    profileId: context.profileId,
    usesReasoningTokens: context.usesReasoningTokens,
    leaseMs: context.leaseMs
  };
  switch (classifyPortfolioDurableResourceLane(event.eventKind)) {
    case "source_ingest":
      return { ...base, lane: "source_ingest" };
    case "semantic_model":
      return { ...base, lane: "semantic_model" };
    case "render":
      return { ...base, lane: "render" };
    case "publication":
      return { ...base, lane: "publication" };
    case "public_verification":
      return { ...base, lane: "public_verification", usesReasoningTokens: context.usesReasoningTokens ?? false };
    case "unclassified":
      return null;
  }
}

export function createResourceLimitedPortfolioOutboxDispatcher<TEvent>(input: {
  limiter: PortfolioProductionResourceLimiter;
  dispatcher: (event: TEvent) => Promise<void>;
  resolveRequest: (
    event: TEvent
  ) => PortfolioResourceRequest | null | Promise<PortfolioResourceRequest | null>;
}): (event: TEvent) => Promise<void> {
  return async (event) => {
    const request = await input.resolveRequest(event);
    if (!request) {
      await input.dispatcher(event);
      return;
    }
    await input.limiter.withLease(request, async () => input.dispatcher(event));
  };
}
