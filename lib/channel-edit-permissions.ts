import type { AppRole } from "./team-store";
import type { Stage2PromptConfig } from "./stage2-pipeline";

type RestrictedChannelPatch = Partial<{
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  stage2PromptConfig: Stage2PromptConfig;
  stage2HardConstraints: unknown;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  defaultClipDurationSec: number;
}>;

export function getRestrictedChannelEditError(
  role: AppRole,
  patch: RestrictedChannelPatch | null | undefined
): string | null {
  if (!patch || typeof patch !== "object") {
    return null;
  }

  if (
    (role === "redactor" || role === "redactor_limited") &&
    (typeof patch.systemPrompt === "string" || typeof patch.descriptionPrompt === "string")
  ) {
    return "Редактор не может менять системные промпты канала.";
  }

  return null;
}
