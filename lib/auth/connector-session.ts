import { readConnectorSessionCookieFromRequest } from "./cookies";
import { getAuthContextByToken, type AuthContext } from "../team-store";

export function getConnectorAuthContextFromRequest(request: Request): AuthContext | null {
  const token = readConnectorSessionCookieFromRequest(request);
  if (!token) {
    return null;
  }
  const auth = getAuthContextByToken(token, "connector");
  if (!auth || auth.membership.role !== "channel_connector") {
    return null;
  }
  return auth;
}
