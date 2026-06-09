import type { AppRole } from "./team-store";
import type { Stage2PromptConfig } from "./stage2-pipeline";

type RestrictedChannelPatch = Partial<{
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  examplesJson: string;
  stage2WorkerProfileId: string | null;
  stage2ExamplesConfig: unknown;
  stage2PromptConfig: Stage2PromptConfig;
  stage2HardConstraints: unknown;
  stage2StyleProfile: unknown;
  stage2SourceOverlayConfig: unknown;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  defaultClipDurationSec: number;
}>;

const SENSITIVE_CHANNEL_SETUP_FIELDS: Array<keyof RestrictedChannelPatch> = [
  "systemPrompt",
  "descriptionPrompt",
  "examplesJson",
  "stage2WorkerProfileId",
  "stage2ExamplesConfig",
  "stage2PromptConfig",
  "stage2HardConstraints",
  "stage2StyleProfile",
  "stage2SourceOverlayConfig",
  "templateId"
];

const REDACTOR_CHANNEL_PROMPT_FIELDS = new Set<keyof RestrictedChannelPatch>([
  "stage2PromptConfig"
]);

function hasOwnField<T extends object, K extends PropertyKey>(value: T, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function canRedactorPatchSensitiveField(field: keyof RestrictedChannelPatch): boolean {
  return REDACTOR_CHANNEL_PROMPT_FIELDS.has(field);
}

export function getRestrictedChannelEditError(
  role: AppRole,
  patch: RestrictedChannelPatch | null | undefined
): string | null {
  if (!patch || typeof patch !== "object") {
    return null;
  }

  if (role === "redactor" || role === "redactor_limited") {
    const touchesSensitiveSetup = SENSITIVE_CHANNEL_SETUP_FIELDS.some(
      (field) =>
        hasOwnField(patch, field) &&
        !(role === "redactor" && canRedactorPatchSensitiveField(field))
    );
    if (touchesSensitiveSetup) {
      return "Редактор не может менять внутренние Stage 2 настройки канала.";
    }
  }

  return null;
}
