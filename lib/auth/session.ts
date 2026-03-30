import { readAppSessionCookie, readAppSessionCookieFromRequest } from "./cookies";
import { getAuthContextByToken, type AuthContext } from "../team-store";

export async function getCurrentAuthContext(): Promise<AuthContext | null> {
  const token = await readAppSessionCookie();
  if (!token) {
    return null;
  }
  return getAuthContextByToken(token);
}

export async function getAuthContextFromRequest(request: Request): Promise<AuthContext | null> {
  const token = readAppSessionCookieFromRequest(request);
  if (!token) {
    return null;
  }
  return getAuthContextByToken(token);
}
