const APP_BUILD_STARTED_AT = new Date().toISOString();

export const APP_BUILD_META_NAME = "clips-app-build-id";
export const APP_BUILD_FALLBACK_PREFIX = "local-";

export function getAppBuildId(env: NodeJS.ProcessEnv = process.env): string {
  const explicit =
    env.NEXT_PUBLIC_APP_BUILD_ID ??
    env.VERCEL_GIT_COMMIT_SHA ??
    env.RENDER_GIT_COMMIT ??
    env.SOURCE_VERSION ??
    null;
  const normalized = typeof explicit === "string" ? explicit.trim() : "";
  return normalized || `${APP_BUILD_FALLBACK_PREFIX}${APP_BUILD_STARTED_AT}`;
}

export function isFallbackAppBuildId(buildId: string | null | undefined): boolean {
  const normalized = typeof buildId === "string" ? buildId.trim() : "";
  return normalized.startsWith(APP_BUILD_FALLBACK_PREFIX);
}

export function shouldReloadForBuildMismatch(
  clientBuildId: string | null | undefined,
  serverBuildId: string | null | undefined
): boolean {
  const client = typeof clientBuildId === "string" ? clientBuildId.trim() : "";
  const server = typeof serverBuildId === "string" ? serverBuildId.trim() : "";
  if (!client || !server) {
    return false;
  }
  if (isFallbackAppBuildId(client) || isFallbackAppBuildId(server)) {
    return false;
  }
  return client !== server;
}
