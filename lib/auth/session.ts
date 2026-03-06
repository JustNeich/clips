import { readAppSessionCookie } from "./cookies";
import { getAuthContextByToken, type AuthContext } from "../team-store";

export async function getCurrentAuthContext(): Promise<AuthContext | null> {
  const token = await readAppSessionCookie();
  if (!token) {
    return null;
  }
  return getAuthContextByToken(token);
}
