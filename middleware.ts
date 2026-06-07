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
  return (
    hasBearer &&
    (pathname.startsWith("/api/admin/flows") ||
      pathname === "/api/admin/audit-events" ||
      pathname === "/api/admin/control" ||
      pathname === "/api/admin/control/copscopes")
  );
}

function isSameOriginBrowserMutation(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  const expectedOrigin = request.nextUrl.origin;
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
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
