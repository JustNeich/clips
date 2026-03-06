import { listLegacyStage3VersionsByMedia } from "../../../../../../lib/chat-history";
import {
  buildStage3VersionFromStoreVersion,
  getSessionTimeline,
  Stage3TimelinePayload
} from "../../../../../../lib/stage3-session-store";
import { Stage3Version } from "../../../../../../app/components/types";
import { getChatById } from "../../../../../../lib/chat-history";
import { requireAuth, requireChannelVisibility } from "../../../../../../lib/auth/guards";

export const runtime = "nodejs";

type TimelineResponse = Stage3TimelinePayload & {
  legacyVersions: Stage3Version[];
  uiVersions: Stage3Version[];
};

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;

  try {
    const auth = await requireAuth();
    const timeline = await getSessionTimeline(id);
    const chat = await getChatById(timeline.session.projectId);
    if (!chat) {
      return Response.json({ error: "Project chat not found." }, { status: 404 });
    }
    await requireChannelVisibility(auth, chat.channelId);

    const legacyVersions = await listLegacyStage3VersionsByMedia(timeline.session.mediaId).catch(() => []);
    const versionById = new Map(timeline.versions.map((version) => [version.id, version]));
    const uiVersions = timeline.versions.map((version, index) =>
      buildStage3VersionFromStoreVersion(
        version,
        version.parentVersionId ? versionById.get(version.parentVersionId) ?? null : null,
        index + 1,
        version.id
      )
    );

    const response: TimelineResponse = {
      ...timeline,
      legacyVersions,
      uiVersions
    };
    return Response.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof Error && error.message === "Session not found.") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load timeline." },
      { status: 500 }
    );
  }
}
