import { resolvePublicAppOrigin } from "../../../../../lib/public-app-origin";
import { resolveChannelPermissions } from "../../../../../lib/acl";
import {
  buildConnectorChannelIdentity,
  importConnectorChannelAvatar
} from "../../../../../lib/connector-channel-onboarding";
import { getChannelAccessForUser, getChannelById } from "../../../../../lib/chat-history";
import {
  consumeChannelYoutubeOAuthState,
  pruneExpiredChannelYoutubeOAuthStates,
  saveChannelPublishIntegration
} from "../../../../../lib/publication-store";
import { getMembership, getUserById } from "../../../../../lib/team-store";
import { exchangeYouTubeOAuthCode } from "../../../../../lib/youtube-publishing";

export const runtime = "nodejs";

function buildPopupCallbackHtml(request: Request, payload: Record<string, unknown>): Response {
  const origin = resolvePublicAppOrigin(request);
  const json = JSON.stringify(payload);
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>YouTube OAuth</title>
  </head>
  <body>
    <script>
      (function () {
        var payload = ${json};
        try {
          if (window.opener && typeof window.opener.postMessage === "function") {
            window.opener.postMessage(payload, ${JSON.stringify(origin)});
            window.close();
            return;
          }
        } catch (_) {}
        window.location.replace(${JSON.stringify(origin)});
      })();
    </script>
    <p>You can close this window.</p>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      }
    }
  );
}

export async function GET(request: Request): Promise<Response> {
  pruneExpiredChannelYoutubeOAuthStates();
  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";
  const error = url.searchParams.get("error")?.trim() ?? "";

  if (!stateParam) {
    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: false,
      error: "OAuth state is missing."
    });
  }

  const state = consumeChannelYoutubeOAuthState(stateParam);
  if (!state) {
    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: false,
      error: "OAuth state expired or is invalid."
    });
  }

  if (error) {
    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: false,
      channelId: state.channel_id,
      error
    });
  }

  if (!code) {
    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: false,
      channelId: state.channel_id,
      error: "Google OAuth did not return a code."
    });
  }

  try {
    const channel = await getChannelById(state.channel_id);
    const user = getUserById(state.user_id);
    const membership = getMembership(state.user_id, state.workspace_id);
    if (
      !channel ||
      channel.workspaceId !== state.workspace_id ||
      channel.archivedAt ||
      !user ||
      user.status !== "active" ||
      !membership
    ) {
      throw new Error("OAuth access is no longer active.");
    }
    const isConnector = membership.role === "channel_connector";
    if (isConnector) {
      if (channel.creatorUserId !== state.user_id) {
        throw new Error("OAuth access to this channel was revoked.");
      }
    } else {
      const explicitAccess = await getChannelAccessForUser(channel.id, state.user_id);
      const permissions = resolveChannelPermissions({ membership, channel, explicitAccess });
      if (!permissions.canEditSetup) {
        throw new Error("OAuth access to this channel was revoked.");
      }
    }

    const result = await exchangeYouTubeOAuthCode({
      request,
      code,
      oauthClientKey: state.oauth_client_key
    });
    const selected = result.availableChannels.length === 1 ? result.availableChannels[0]! : null;
    const channelIdentity = isConnector && selected ? buildConnectorChannelIdentity(selected) : null;
    const integration = saveChannelPublishIntegration({
      workspaceId: state.workspace_id,
      channelId: state.channel_id,
      userId: state.user_id,
      status: selected ? "connected" : "pending_selection",
      oauthClientKey: state.oauth_client_key,
      credential: result.credential,
      googleAccountEmail: result.googleAccountEmail,
      selectedYoutubeChannelId: selected?.id ?? null,
      selectedYoutubeChannelTitle: selected?.title ?? null,
      selectedYoutubeChannelCustomUrl: selected?.customUrl ?? null,
      availableChannels: result.availableChannels,
      scopes: result.credential.scopes,
      channelIdentity
    });
    const avatar =
      isConnector && selected
        ? await importConnectorChannelAvatar({
            channelId: channel.id,
            thumbnailUrl: selected.thumbnailUrl
          }).catch(() => ({ imported: false, reason: "avatar_import_failed" }))
        : null;

    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: true,
      channelId: state.channel_id,
      integration,
      channel: channelIdentity,
      avatar
    });
  } catch (callbackError) {
    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: false,
      channelId: state.channel_id,
      error:
        callbackError instanceof Error
          ? callbackError.message
          : "Не удалось завершить YouTube OAuth подключение."
    });
  }
}
