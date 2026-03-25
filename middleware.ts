import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/setup/bootstrap-owner",
  "/accept-invite"
]);

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

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isDevDesignRoute = pathname.startsWith("/design/") && process.env.NODE_ENV !== "production";
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/stage3-worker/") ||
    pathname.startsWith("/api/")
  ) {
    if (pathname.startsWith("/api/") && !isApiPublic(pathname) && !request.cookies.get("clips_session")) {
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
