export const APP_SESSION_COOKIE = "clips_session";
export const CONNECTOR_SESSION_COOKIE = "clips_connector_session";

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

async function getCookieStore() {
  const { cookies } = await import("next/headers");
  return cookies();
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildSessionSetCookieHeader(name: string, token: string, expiresAt: Date): string {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`
  ];
  if (cookieSecure()) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildAppSessionSetCookieHeader(token: string, expiresAt: Date): string {
  return buildSessionSetCookieHeader(APP_SESSION_COOKIE, token, expiresAt);
}

export function buildConnectorSessionSetCookieHeader(token: string, expiresAt: Date): string {
  return buildSessionSetCookieHeader(CONNECTOR_SESSION_COOKIE, token, expiresAt);
}

export function readAppSessionCookieFromHeader(cookieHeader: string | null | undefined): string | null {
  return readSessionCookieFromHeader(cookieHeader, APP_SESSION_COOKIE);
}

function readSessionCookieFromHeader(
  cookieHeader: string | null | undefined,
  cookieName: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const chunk of cookieHeader.split(";")) {
    const [name, ...valueParts] = chunk.split("=");
    if (name?.trim() !== cookieName) {
      continue;
    }
    const value = decodeCookieValue(valueParts.join("=").trim());
    return value || null;
  }

  return null;
}

export function readConnectorSessionCookieFromRequest(request: Request): string | null {
  return readSessionCookieFromHeader(request.headers.get("cookie"), CONNECTOR_SESSION_COOKIE);
}

export function readAppSessionCookieFromRequest(request: Request): string | null {
  return readAppSessionCookieFromHeader(request.headers.get("cookie"));
}

export async function setAppSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await getCookieStore();
  store.set(APP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt
  });
}

export async function setConnectorSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await getCookieStore();
  store.set(CONNECTOR_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt
  });
}

export async function clearAppSessionCookie(): Promise<void> {
  const store = await getCookieStore();
  store.set(APP_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0)
  });
}

export async function clearConnectorSessionCookie(): Promise<void> {
  const store = await getCookieStore();
  store.set(CONNECTOR_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0)
  });
}

export async function readAppSessionCookie(): Promise<string | null> {
  const store = await getCookieStore();
  const value = store.get(APP_SESSION_COOKIE)?.value?.trim();
  return value || null;
}
