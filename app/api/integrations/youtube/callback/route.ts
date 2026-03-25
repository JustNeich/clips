import { resolvePublicAppOrigin } from "../../../../../lib/public-app-origin";
import {
  consumeChannelYoutubeOAuthState,
  pruneExpiredChannelYoutubeOAuthStates,
  saveChannelPublishIntegration
} from "../../../../../lib/publication-store";
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
    const result = await exchangeYouTubeOAuthCode({
      request,
      code
    });
    const selected = result.availableChannels.length === 1 ? result.availableChannels[0]! : null;
    const integration = saveChannelPublishIntegration({
      workspaceId: state.workspace_id,
      channelId: state.channel_id,
      userId: state.user_id,
      status: selected ? "connected" : "pending_selection",
      credential: result.credential,
      googleAccountEmail: result.googleAccountEmail,
      selectedYoutubeChannelId: selected?.id ?? null,
      selectedYoutubeChannelTitle: selected?.title ?? null,
      selectedYoutubeChannelCustomUrl: selected?.customUrl ?? null,
      availableChannels: result.availableChannels,
      scopes: result.credential.scopes
    });

    return buildPopupCallbackHtml(request, {
      type: "youtube-oauth-result",
      ok: true,
      channelId: state.channel_id,
      integration
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
