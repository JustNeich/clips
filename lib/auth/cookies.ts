export const APP_SESSION_COOKIE = "clips_session";

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

export function readAppSessionCookieFromHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const chunk of cookieHeader.split(";")) {
    const [name, ...valueParts] = chunk.split("=");
    if (name?.trim() !== APP_SESSION_COOKIE) {
      continue;
    }
    const value = decodeCookieValue(valueParts.join("=").trim());
    return value || null;
  }

  return null;
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

export async function readAppSessionCookie(): Promise<string | null> {
  const store = await getCookieStore();
  const value = store.get(APP_SESSION_COOKIE)?.value?.trim();
  return value || null;
}
