import { requireOwnerOrMcpMachineScope } from "../../../../../../../lib/auth/guards";
import { createNodeFileResponse } from "../../../../../../../lib/node-file-response";
import { getChatById } from "../../../../../../../lib/chat-history";
import {
  getSourceDecompositionForChat,
  resolveDecompositionFramePath
} from "../../../../../../../lib/source-decomposition-store";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store"
} as const;

type RouteContext = {
  params: Promise<{ chatId: string; index: string }>;
};

/**
 * AGENT-ONLY frame image endpoint for the Stage-1 decomposition artifact.
 * Gated on `flow:read` and scoped to the caller's workspace. Serves one
 * sampled frame jpg so an agent can fetch frames by the URL returned from
 * `clips_flow_get_source_decomposition`.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpMachineScope(request, "flow:read");
    const { chatId, index } = await context.params;
    const chat = await getChatById(chatId);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Chat not found." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const record = getSourceDecompositionForChat(auth.workspace.id, chatId);
    if (!record) {
      return Response.json(
        { error: "source_decomposition_not_found", chatId },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    const frameIndex = Number.parseInt(index, 10);
    if (!Number.isInteger(frameIndex) || frameIndex < 0) {
      return Response.json({ error: "Invalid frame index." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const framePath = resolveDecompositionFramePath(record, frameIndex);
    if (!framePath) {
      return Response.json({ error: "Frame not found." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return createNodeFileResponse({
      request,
      filePath: framePath,
      signal: request.signal,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=900"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Frame fetch failed." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
