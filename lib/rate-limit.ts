type RateLimitInput = {
  request: Request;
  scope: string;
  key?: string | null;
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

const buckets = new Map<string, RateLimitBucket>();

function getClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwardedFor ||
    "unknown"
  );
}

function cleanupBuckets(nowMs: number): void {
  if (buckets.size < 2048) {
    return;
  }
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAtMs <= nowMs) {
      buckets.delete(key);
    }
  }
}

export function enforceRateLimit(input: RateLimitInput): void {
  const nowMs = Date.now();
  cleanupBuckets(nowMs);

  const key = [
    input.scope,
    getClientKey(input.request),
    input.key?.trim().toLowerCase() || "-"
  ].join(":");
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAtMs > nowMs
      ? existing
      : {
          count: 0,
          resetAtMs: nowMs + input.windowMs
        };

  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count <= input.limit) {
    return;
  }

  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000));
  throw new Response(JSON.stringify({ error: "Слишком много попыток. Повторите позже." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec)
    }
  });
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
