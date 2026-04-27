import {
  createChannel,
  getChannelAccessForUser,
  listChannelsWithStats
} from "../../../lib/chat-history";
import { requireAuth } from "../../../lib/auth/guards";
import { resolveChannelPermissions } from "../../../lib/acl";
import { getRestrictedChannelEditError } from "../../../lib/channel-edit-permissions";
import { readManagedTemplate } from "../../../lib/managed-template-store";
import { getChannelPublishIntegration, getChannelPublishSettings } from "../../../lib/publication-store";
import { Stage2PromptConfig } from "../../../lib/stage2-pipeline";
import { Stage2ExamplesConfig, Stage2HardConstraints } from "../../../lib/stage2-channel-config";
import { Stage2StyleProfile } from "../../../lib/stage2-channel-learning";
import {
  getWorkspaceStage3ExecutionTarget,
  getWorkspaceCodexModelConfig,
  getWorkspaceStage2CaptionProviderConfig,
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2HardConstraints
} from "../../../lib/team-store";
import { resolveStage3Execution } from "../../../lib/stage3-execution";
import { resolveWorkspaceCodexModelConfig } from "../../../lib/workspace-codex-models";
import { getWorkspaceAnthropicStatus } from "../../../lib/workspace-anthropic";
import { getWorkspaceOpenRouterStatus } from "../../../lib/workspace-openrouter";

export const runtime = "nodejs";

type CreateChannelBody = {
  name?: string;
  username?: string;
  systemPrompt?: string;
  descriptionPrompt?: string;
  examplesJson?: string;
  stage2WorkerProfileId?: string | null;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  stage2HardConstraints?: Stage2HardConstraints;
  stage2PromptConfig?: Stage2PromptConfig;
  stage2StyleProfile?: Stage2StyleProfile;
  templateId?: string;
};

async function ensureChannelTemplateSelectable(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  templateId: string | null | undefined
): Promise<string | null> {
  const candidate = templateId?.trim();
  if (!candidate) {
    return null;
  }
  const template = await readManagedTemplate(candidate, { workspaceId: auth.workspace.id });
  return template ? template.id : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request);
    const channels = await listChannelsWithStats(auth.workspace.id);
    const workspaceAnthropicIntegration =
      auth.membership.role === "owner"
        ? await getWorkspaceAnthropicStatus(auth)
        : null;
    const workspaceOpenRouterIntegration =
      auth.membership.role === "owner"
        ? await getWorkspaceOpenRouterStatus(auth)
        : null;
    const stage3ExecutionTarget = getWorkspaceStage3ExecutionTarget(auth.workspace.id);
    const stage3Execution = resolveStage3Execution(stage3ExecutionTarget);
    const visibleChannels = await Promise.all(
      channels.map(async (channel) => {
        const explicitAccess = await getChannelAccessForUser(channel.id, auth.user.id);
        const permissions = resolveChannelPermissions({
          membership: auth.membership,
          channel,
          explicitAccess
        });
        if (!permissions.isVisible) {
          return null;
        }
        return {
          ...channel,
          publishSettings: getChannelPublishSettings(channel.id),
          publishIntegration: getChannelPublishIntegration(channel.id),
          currentUserCanOperate: permissions.canOperate,
          currentUserCanEditSetup: permissions.canEditSetup,
          currentUserCanManageAccess: permissions.canManageAccess,
          currentUserCanDelete: permissions.canDelete,
          isVisibleToCurrentUser: permissions.isVisible
        };
      })
    );

    return Response.json(
      {
        channels: visibleChannels.filter(Boolean),
        workspaceStage2ExamplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(auth.workspace.id),
        workspaceStage2HardConstraints: getWorkspaceStage2HardConstraints(auth.workspace.id),
        workspaceStage2PromptConfig: auth.workspace.stage2PromptConfig,
        workspaceCodexModelConfig: getWorkspaceCodexModelConfig(auth.workspace.id),
        workspaceStage2CaptionProviderConfig: getWorkspaceStage2CaptionProviderConfig(auth.workspace.id),
        workspaceStage3ExecutionTarget: stage3Execution.configuredTarget,
        workspaceResolvedStage3ExecutionTarget: stage3Execution.resolvedTarget,
        workspaceStage3ExecutionCapabilities: stage3Execution.capabilities,
        workspaceAnthropicIntegration,
        workspaceOpenRouterIntegration,
        workspaceResolvedCodexModelConfig: resolveWorkspaceCodexModelConfig({
          config: getWorkspaceCodexModelConfig(auth.workspace.id),
          deployStage2Model: process.env.CODEX_STAGE2_MODEL,
          deployStage2SeoModel: process.env.CODEX_STAGE2_DESCRIPTION_MODEL,
          deployStage3Model: process.env.CODEX_STAGE3_MODEL
        })
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить каналы." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CreateChannelBody | null;
  try {
    const auth = await requireAuth(request);
    if (auth.membership.role === "redactor_limited") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const restrictedError = getRestrictedChannelEditError(auth.membership.role, body);
    if (restrictedError) {
      return Response.json({ error: restrictedError }, { status: 403 });
    }
    if (typeof body?.templateId === "string" && !(await ensureChannelTemplateSelectable(auth, body.templateId))) {
      return Response.json({ error: "Template not found." }, { status: 404 });
    }
    const channel = await createChannel({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      name: body?.name,
      username: body?.username,
      systemPrompt: body?.systemPrompt,
      descriptionPrompt: body?.descriptionPrompt,
      examplesJson: body?.examplesJson,
      stage2ExamplesConfig: body?.stage2ExamplesConfig,
      stage2HardConstraints: body?.stage2HardConstraints,
      stage2PromptConfig: body?.stage2PromptConfig,
      stage2StyleProfile: body?.stage2StyleProfile,
      templateId: body?.templateId
    });
    return Response.json({ channel }, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось создать канал." },
      { status: 400 }
    );
  }
}
