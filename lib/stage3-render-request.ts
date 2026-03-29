export type Stage3RenderRequestDedupeInput = {
  requestId?: string;
};

export function buildStage3RenderRequestDedupeKey(
  body: Stage3RenderRequestDedupeInput,
  scope?: { workspaceId?: string | null; userId?: string | null }
): string | null {
  const requestId = body.requestId?.trim() ?? "";
  if (!requestId) {
    return null;
  }
  const workspaceId = scope?.workspaceId?.trim() ?? "";
  const userId = scope?.userId?.trim() ?? "";
  if (!workspaceId || !userId) {
    return `render-request:global:${requestId}`;
  }
  return `render-request:${workspaceId}:${userId}:${requestId}`;
}
