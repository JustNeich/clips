function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);
  return first || null;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function hostLooksUnusable(host: string | null): boolean {
  if (!host) {
    return true;
  }
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "0.0.0.0" ||
    normalized.startsWith("0.0.0.0:") ||
    normalized === "[::]" ||
    normalized.startsWith("[::]:") ||
    normalized === "::" ||
    normalized.startsWith(":::")
  );
}

export function resolvePublicAppOrigin(request: Request): string {
  const envOrigin = normalizeOrigin(
    process.env.PUBLIC_APP_ORIGIN ||
      process.env.APP_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_ORIGIN ||
      null
  );
  if (envOrigin) {
    return envOrigin;
  }

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = firstHeaderValue(request.headers.get("host"));
  const requestOrigin = normalizeOrigin(request.url);
  const requestProtocol = requestOrigin ? new URL(requestOrigin).protocol.replace(/:$/, "") : "https";
  const forwardedProto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    firstHeaderValue(request.headers.get("x-forwarded-protocol")) ||
    requestProtocol;

  const publicHost = !hostLooksUnusable(forwardedHost)
    ? forwardedHost
    : !hostLooksUnusable(host)
      ? host
      : null;

  if (publicHost) {
    return `${forwardedProto}://${publicHost}`.replace(/\/+$/, "");
  }

  if (requestOrigin && !hostLooksUnusable(new URL(requestOrigin).host)) {
    return requestOrigin;
  }

  return "http://localhost:3000";
}
