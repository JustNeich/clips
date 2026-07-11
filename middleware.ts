import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/setup/bootstrap-owner",
  "/accept-invite"
]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isApiPublic(pathname: string): boolean {
  return (
    (process.env.NODE_ENV !== "production" && pathname.startsWith("/api/design/")) ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/register") ||
    pathname.startsWith("/api/auth/bootstrap-owner") ||
    pathname.startsWith("/api/auth/accept-invite") ||
    pathname.startsWith("/api/stage3/worker/")
  );
}

function canUseBearerForApi(pathname: string, request: NextRequest): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const hasBearer = /^Bearer\s+.+$/i.test(authorization);
  const method = request.method.toUpperCase();
  return (
    hasBearer &&
    (pathname === "/api/auth/machine-session" ||
      /^\/api\/channels\/[^/]+\/publishing\/youtube\/connect\/?$/.test(pathname) ||
      pathname.startsWith("/api/admin/flows") ||
      pathname === "/api/admin/audit-events" ||
      pathname === "/api/admin/control" ||
      pathname === "/api/admin/control/copscopes" ||
      (pathname === "/api/admin/project-kings/source-buffer" &&
        (method === "GET" || method === "POST")) ||
      pathname.startsWith("/api/admin/render-exports/") ||
      pathname.startsWith("/api/admin/source-decomposition/"))
  );
}

function isSameOriginBrowserMutation(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  // Compare HOSTS (not full origins). Behind Render's TLS-terminating proxy
  // request.nextUrl.origin resolves to the internal http origin, so comparing the
  // browser's https Origin against it 403'd every legitimate mutation. Match the
  // Origin/Referer host against any host the server actually saw — the forwarded
  // host (public), the Host header, or nextUrl.host — which is proxy-proof and
  // ignores the http/https difference the proxy introduces, while still blocking
  // genuine cross-origin (different host) requests.
  const candidateHosts = new Set<string>();
  for (const raw of [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    request.nextUrl.host
  ]) {
    if (!raw) {
      continue;
    }
    for (const part of raw.split(",")) {
      const host = part.trim().toLowerCase();
      if (host) {
        candidateHosts.add(host);
      }
    }
  }

  const hostMatches = (value: string | null): boolean => {
    if (!value) {
      return false;
    }
    try {
      return candidateHosts.has(new URL(value).host.toLowerCase());
    } catch {
      return false;
    }
  };

  const origin = request.headers.get("origin");
  if (origin) {
    return hostMatches(origin);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return hostMatches(referer);
  }

  return true;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isDevDesignRoute = pathname.startsWith("/design/") && process.env.NODE_ENV !== "production";
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/stage3-worker/") ||
    pathname.startsWith("/api/")
  ) {
    if (pathname.startsWith("/api/") && !isSameOriginBrowserMutation(request)) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
    if (
      pathname.startsWith("/api/") &&
      !isApiPublic(pathname) &&
      !request.cookies.get("clips_session") &&
      !canUseBearerForApi(pathname, request)
    ) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname) || isDevDesignRoute) {
    return NextResponse.next();
  }

  if (!request.cookies.get("clips_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/stage3/worker/|.*\\..*).*)"]
};
