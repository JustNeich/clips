export type Stage3PreviewMediaMode = "mapped" | "linear";

export function resolveStage3ReportedSourceDuration(
  mediaMode: Stage3PreviewMediaMode,
  mediaDurationSec: number | null
): number | null | undefined {
  return mediaMode === "mapped" ? mediaDurationSec : undefined;
}
