import { cookies } from "next/headers";

export const APP_SESSION_COOKIE = "clips_session";

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function setAppSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(APP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt
  });
}

export async function clearAppSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(APP_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0)
  });
}

export async function readAppSessionCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(APP_SESSION_COOKIE)?.value?.trim();
  return value || null;
}
