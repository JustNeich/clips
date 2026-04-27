import type { Stage3StateSnapshot } from "../app/components/types";
import type { TemplateRenderSnapshot } from "./stage3-template-core";
import { buildStage3TextFitHash } from "./stage3-text-fit";

type RenderSnapshotIdentity = Pick<
  TemplateRenderSnapshot,
  "templateId" | "snapshotHash" | "specRevision" | "fitRevision" | "content"
>;

function uniqueSnapshots(
  snapshots: Array<RenderSnapshotIdentity | null | undefined>
): RenderSnapshotIdentity[] {
  const seen = new Set<string>();
  const unique: RenderSnapshotIdentity[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot || seen.has(snapshot.snapshotHash)) {
      continue;
    }
    seen.add(snapshot.snapshotHash);
    unique.push(snapshot);
  }
  return unique;
}

function hasSnapshotHash(
  snapshots: RenderSnapshotIdentity[],
  snapshotHash: string | null | undefined
): boolean {
  return Boolean(snapshotHash && snapshots.some((snapshot) => snapshot.snapshotHash === snapshotHash));
}

function hasSpecRevision(
  snapshots: RenderSnapshotIdentity[],
  specRevision: string | null | undefined
): boolean {
  return Boolean(specRevision && snapshots.some((snapshot) => snapshot.specRevision === specRevision));
}

function hasFitRevision(
  snapshots: RenderSnapshotIdentity[],
  fitRevision: string | null | undefined
): boolean {
  return Boolean(fitRevision && snapshots.some((snapshot) => snapshot.fitRevision === fitRevision));
}

function buildAcceptedTextFitHashes(snapshots: RenderSnapshotIdentity[]): Set<string> {
  return new Set(
    snapshots.map((snapshot) =>
      buildStage3TextFitHash({
        templateId: snapshot.templateId,
        snapshotHash: snapshot.snapshotHash,
        topText: snapshot.content.topText,
        bottomText: snapshot.content.bottomText,
        topFontScale: snapshot.content.topFontScale,
        bottomFontScale: snapshot.content.bottomFontScale
      })
    )
  );
}

export function assertStage3RenderTemplateSnapshotFresh(params: {
  snapshot: Partial<Stage3StateSnapshot> | null | undefined;
  baseTemplateSnapshot: TemplateRenderSnapshot;
  textFitTemplateSnapshot?: TemplateRenderSnapshot | null;
}): void {
  const acceptedSnapshots = uniqueSnapshots([
    params.baseTemplateSnapshot,
    params.textFitTemplateSnapshot
  ]);
  const requestedTemplateSnapshot = params.snapshot?.templateSnapshot;
  const requestedTextFit = params.snapshot?.textFit;

  if (
    requestedTemplateSnapshot?.snapshotHash &&
    !hasSnapshotHash(acceptedSnapshots, requestedTemplateSnapshot.snapshotHash)
  ) {
    throw new Error("Template snapshot drift detected. Обновите preview и повторите render.");
  }
  if (
    requestedTemplateSnapshot?.specRevision &&
    !hasSpecRevision(acceptedSnapshots, requestedTemplateSnapshot.specRevision)
  ) {
    throw new Error("Template spec revision changed. Обновите preview и повторите render.");
  }
  if (
    requestedTemplateSnapshot?.fitRevision &&
    !hasFitRevision(acceptedSnapshots, requestedTemplateSnapshot.fitRevision)
  ) {
    throw new Error("Template fit revision changed. Обновите preview и повторите render.");
  }
  if (
    requestedTextFit?.snapshotHash &&
    !hasSnapshotHash(acceptedSnapshots, requestedTextFit.snapshotHash)
  ) {
    throw new Error("Template text fit drift detected. Обновите preview и повторите render.");
  }
  if (requestedTextFit?.fitHash) {
    const acceptedFitHashes = buildAcceptedTextFitHashes(acceptedSnapshots);
    if (!acceptedFitHashes.has(requestedTextFit.fitHash)) {
      throw new Error("Template text fit changed. Обновите preview и повторите render.");
    }
  }
}
