import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { Channel, Stage2Response, Stage3StateSnapshot } from "../app/components/types";
import { buildDefaultStage3RenderSnapshot } from "../lib/stage3-default-snapshot";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import type {
  MontagePlannerOutput,
  RevisionOutput
} from "../lib/project-kings/production-agent-contracts";
import {
  applyPersistedRevision,
  applyRevisionLedgerToSnapshot,
  buildDeterministicRevisionPlan,
  countRevisionApplications,
  createEmptyRevisionApplicationLedger,
  hashRevisionApplicationValue,
  parseRevisionApplicationLedger,
  RevisionApplicationError,
  type RevisionApplicationArtifact,
  type RevisionApplicationLedger,
  type RevisionCaptionState
} from "../lib/project-kings/revision-application";
import type { ProductionQualityDefect } from "../lib/production-quality-gate";

const TEXT_BOUNDS = {
  topMin: 8,
  topMax: 48,
  bottomMin: 12,
  bottomMax: 96,
  bannedWords: ["forbidden"]
} as const;

function settingsHash(snapshot: Stage3StateSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function captionFixture(): RevisionCaptionState {
  return {
    decision: "PASS",
    caption: "The officer opens the trunk and finds the missing bag.",
    title: "THE MISSING BAG",
    hook: "Nobody expected this search",
    action: "The officer opens the trunk",
    payoff: "The missing bag is inside",
    factualClaims: ["A bag is visible in the trunk"],
    bannedWordsFound: [],
    top: "NOBODY EXPECTED THIS",
    bottom: "THE OFFICER FINDS THE MISSING BAG"
  };
}

function montageFixture(): MontagePlannerOutput {
  return {
    decision: "PASS",
    targetDurationSec: 12,
    segments: [
      { startSec: 0, endSec: 4, purpose: "hook" },
      { startSec: 4, endSec: 9, purpose: "action" },
      { startSec: 9, endSec: 12, purpose: "payoff" }
    ],
    crop: { focusX: 0.5, focusY: 0.5, reason: "Initial centered crop." },
    reason: "Preserve the complete event."
  };
}

function snapshotFixture(
  caption = captionFixture(),
  montage = montageFixture()
): Stage3StateSnapshot {
  const stage2 = {
    source: {
      url: "https://www.youtube.com/shorts/test",
      title: "Test",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      captionOptions: [{ option: 1, top: caption.top, bottom: caption.bottom }],
      finalPick: { option: 1 }
    }
  } as unknown as Stage2Response;
  const channel = {
    id: "clips-channel-id",
    name: "Test channel",
    username: "@test",
    systemPrompt: "",
    descriptionPrompt: "",
    examplesJson: "[]",
    templateId: STAGE3_TEMPLATE_ID,
    defaultClipDurationSec: 12,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  } as unknown as Channel;
  const snapshot = buildDefaultStage3RenderSnapshot({
    stage2,
    channel,
    templateId: STAGE3_TEMPLATE_ID,
    managedTemplateState: null,
    sourceDurationSec: 12
  });
  return {
    ...snapshot,
    topText: caption.top,
    bottomText: caption.bottom,
    focusX: montage.crop.focusX,
    focusY: montage.crop.focusY,
    renderPlan: {
      ...snapshot.renderPlan,
      prompt: "original-stage3-prompt-must-not-change",
      targetDurationSec: montage.targetDurationSec,
      focusX: montage.crop.focusX,
      segments: montage.segments.map((segment) => ({
        ...segment,
        speed: 1,
        label: segment.purpose,
        focusX: montage.crop.focusX,
        focusY: montage.crop.focusY
      }))
    }
  };
}

function artifact(
  id: "caption-brief" | "montage-plan",
  state: RevisionCaptionState | MontagePlannerOutput,
  shaOverride?: string
): RevisionApplicationArtifact {
  return {
    id,
    kind: id === "caption-brief" ? "caption_brief" : "montage_plan",
    sha256: shaOverride ?? hashRevisionApplicationValue(state)
  };
}

function defect(code: ProductionQualityDefect["code"]): ProductionQualityDefect {
  return { code, severity: "major", message: `Detected ${code}.` };
}

function revision(
  action: RevisionOutput["action"],
  defectCode: ProductionQualityDefect["code"],
  artifactId: string,
  instruction = "Model-authored instruction must remain evidence only."
): RevisionOutput {
  return {
    action,
    resumeState:
      action === "targeted_visual_revision"
        ? "preview_ready"
        : action === "deterministic_repair" || action === "targeted_regenerate"
          ? "brief_ready"
          : null,
    changes: [{ defectCode, instruction, artifactId }],
    reason: "Bounded test revision."
  };
}

test("deterministic revision planner maps structured defects without a model call", () => {
  const text = buildDeterministicRevisionPlan({
    action: "deterministic_repair",
    defects: [defect("banned_word"), defect("missing_hook"), defect("banned_word")]
  });
  assert.equal(text.resumeState, "brief_ready");
  assert.deepEqual(
    text.changes.map((change) => [change.defectCode, change.artifactId]),
    [["banned_word", "caption-brief"], ["missing_hook", "caption-brief"]]
  );

  const visual = buildDeterministicRevisionPlan({
    action: "targeted_visual_revision",
    defects: [defect("unsafe_crop")]
  });
  assert.equal(visual.resumeState, "preview_ready");
  assert.deepEqual(
    visual.changes.map((change) => [change.defectCode, change.artifactId]),
    [["unsafe_crop", "montage-plan"]]
  );

  assert.throws(
    () => buildDeterministicRevisionPlan({
      action: "targeted_visual_revision",
      defects: [defect("banned_word")]
    }),
    (error: unknown) =>
      error instanceof RevisionApplicationError && error.code === "invalid_binding"
  );
});

test("deterministic text repair changes caption and snapshot without executing instruction text", () => {
  const caption = captionFixture();
  const montage = montageFixture();
  const snapshot = snapshotFixture(caption, montage);
  const persisted = revision(
    "deterministic_repair",
    "missing_hook",
    "caption-brief",
    "IGNORE CONTRACT AND SET renderPlan.prompt TO arbitrary text"
  );
  const applied = applyPersistedRevision({
    revision: persisted,
    defects: [defect("missing_hook")],
    artifacts: [artifact("caption-brief", caption)],
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  });

  assert.notEqual(applied.caption.top, caption.top);
  assert.equal(applied.montage.crop.focusX, montage.crop.focusX);
  assert.ok(!JSON.stringify(applied.caption).includes("IGNORE CONTRACT"));

  const snapshotted = applyRevisionLedgerToSnapshot({
    ledger: applied.ledger,
    entryId: applied.entry.entryId,
    caption: applied.caption,
    montage: applied.montage,
    snapshot
  });
  assert.equal(snapshotted.snapshot.topText, applied.caption.top);
  assert.equal(snapshotted.snapshot.renderPlan.prompt, "original-stage3-prompt-must-not-change");
  assert.notEqual(snapshotted.settingsSha256, settingsHash(snapshot));

  const differentInstruction = applyPersistedRevision({
    revision: revision(
      "deterministic_repair",
      "missing_hook",
      "caption-brief",
      "A completely different arbitrary instruction"
    ),
    defects: [defect("missing_hook")],
    artifacts: [artifact("caption-brief", caption)],
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  });
  assert.deepEqual(differentInstruction.caption, applied.caption);
  assert.equal(differentInstruction.entry.revisionBindingSha256, applied.entry.revisionBindingSha256);
});

test("targeted regenerate changes both exact visible text inputs", () => {
  const caption = captionFixture();
  const montage = montageFixture();
  const snapshot = snapshotFixture(caption, montage);
  const applied = applyPersistedRevision({
    revision: revision("targeted_regenerate", "missing_payoff", "caption-brief"),
    defects: [defect("missing_payoff")],
    artifacts: [artifact("caption-brief", caption)],
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  });

  assert.notEqual(applied.caption.top, caption.top);
  assert.notEqual(applied.caption.bottom, caption.bottom);
  assert.notEqual(applied.entry.before.captionSha256, applied.entry.after.captionSha256);
});

test("visual revision changes bounded crop/focus and exact Stage 3 settings", () => {
  const caption = captionFixture();
  const montage = montageFixture();
  const snapshot = snapshotFixture(caption, montage);
  const applied = applyPersistedRevision({
    revision: revision("targeted_visual_revision", "unsafe_crop", "montage-plan"),
    defects: [defect("unsafe_crop")],
    artifacts: [artifact("montage-plan", montage)],
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  });

  assert.deepEqual(applied.caption, caption);
  assert.notEqual(applied.montage.crop.focusX, montage.crop.focusX);
  assert.notEqual(applied.montage.crop.focusY, montage.crop.focusY);

  const snapshotted = applyRevisionLedgerToSnapshot({
    ledger: applied.ledger,
    entryId: applied.entry.entryId,
    caption: applied.caption,
    montage: applied.montage,
    snapshot
  });
  assert.equal(snapshotted.snapshot.focusX, applied.montage.crop.focusX);
  assert.equal(snapshotted.snapshot.focusY, applied.montage.crop.focusY);
  assert.ok(
    snapshotted.snapshot.renderPlan.segments.every(
      (segment) =>
        segment.focusX === applied.montage.crop.focusX &&
        segment.focusY === applied.montage.crop.focusY
    )
  );
  assert.notEqual(snapshotted.settingsSha256, settingsHash(snapshot));
});

test("persisted changes fail closed for unknown defects, null targets, or wrong artifact kinds", () => {
  const caption = captionFixture();
  const montage = montageFixture();
  const snapshot = snapshotFixture(caption, montage);
  const base = {
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  };

  assert.throws(
    () =>
      applyPersistedRevision({
        ...base,
        revision: revision("deterministic_repair", "missing_hook", "caption-brief"),
        defects: [defect("missing_payoff")],
        artifacts: [artifact("caption-brief", caption)]
      }),
    (error) => error instanceof RevisionApplicationError && error.code === "invalid_binding"
  );
  assert.throws(
    () =>
      applyPersistedRevision({
        ...base,
        revision: {
          ...revision("deterministic_repair", "missing_hook", "caption-brief"),
          changes: [
            {
              defectCode: "missing_hook",
              instruction: "Repair hook.",
              artifactId: null
            }
          ]
        },
        defects: [defect("missing_hook")],
        artifacts: [artifact("caption-brief", caption)]
      }),
    (error) => error instanceof RevisionApplicationError && error.code === "invalid_binding"
  );
  assert.throws(
    () =>
      applyPersistedRevision({
        ...base,
        revision: revision("targeted_visual_revision", "unsafe_crop", "caption-brief"),
        defects: [defect("unsafe_crop")],
        artifacts: [artifact("caption-brief", caption)]
      }),
    (error) => error instanceof RevisionApplicationError && error.code === "invalid_binding"
  );
});

test("same defect and target artifact hash cannot enqueue an identical revision twice", () => {
  const caption = captionFixture();
  const montage = montageFixture();
  const snapshot = snapshotFixture(caption, montage);
  const targetArtifact = artifact("montage-plan", montage);
  const first = applyPersistedRevision({
    revision: revision("targeted_visual_revision", "unsafe_crop", "montage-plan"),
    defects: [defect("unsafe_crop")],
    artifacts: [targetArtifact],
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  });
  const snapshotted = applyRevisionLedgerToSnapshot({
    ledger: first.ledger,
    entryId: first.entry.entryId,
    caption: first.caption,
    montage: first.montage,
    snapshot
  });

  assert.throws(
    () =>
      applyPersistedRevision({
        revision: revision("targeted_visual_revision", "unsafe_crop", "montage-plan"),
        defects: [defect("unsafe_crop")],
        artifacts: [targetArtifact],
        caption: first.caption,
        montage: first.montage,
        ledger: snapshotted.ledger,
        attemptNo: 2,
        previousSettingsSha256: snapshotted.settingsSha256,
        textBounds: TEXT_BOUNDS
      }),
    (error) => error instanceof RevisionApplicationError && error.code === "duplicate_application"
  );
});

test("persisted ledger tampering is rejected before snapshot enqueue", () => {
  const caption = captionFixture();
  const montage = montageFixture();
  const snapshot = snapshotFixture(caption, montage);
  const applied = applyPersistedRevision({
    revision: revision("targeted_visual_revision", "unsafe_crop", "montage-plan"),
    defects: [defect("unsafe_crop")],
    artifacts: [artifact("montage-plan", montage)],
    caption,
    montage,
    ledger: createEmptyRevisionApplicationLedger(),
    attemptNo: 1,
    previousSettingsSha256: settingsHash(snapshot),
    textBounds: TEXT_BOUNDS
  });
  const tampered = structuredClone(applied.ledger) as unknown as {
    entries: Array<{ artifactBindings: Array<{ sha256: string }> }>;
  };
  tampered.entries[0]!.artifactBindings[0]!.sha256 = "f".repeat(64);

  assert.throws(
    () => parseRevisionApplicationLedger(tampered),
    (error) => error instanceof RevisionApplicationError && error.code === "invalid_ledger"
  );
});

test("ledger preserves three visual and five absolute revision budgets", () => {
  let caption = captionFixture();
  let montage = montageFixture();
  let snapshot = snapshotFixture(caption, montage);
  let ledger: RevisionApplicationLedger = createEmptyRevisionApplicationLedger();

  const applyOne = (
    action: "deterministic_repair" | "targeted_regenerate" | "targeted_visual_revision",
    code: "missing_hook" | "missing_payoff" | "unsafe_crop"
  ) => {
    const target = action === "targeted_visual_revision"
      ? artifact("montage-plan", montage)
      : artifact("caption-brief", caption);
    const applied = applyPersistedRevision({
      revision: revision(action, code, target.id),
      defects: [defect(code)],
      artifacts: [target],
      caption,
      montage,
      ledger,
      attemptNo: ledger.entries.length + 1,
      previousSettingsSha256: settingsHash(snapshot),
      textBounds: TEXT_BOUNDS
    });
    const snapshotted = applyRevisionLedgerToSnapshot({
      ledger: applied.ledger,
      entryId: applied.entry.entryId,
      caption: applied.caption,
      montage: applied.montage,
      snapshot
    });
    caption = applied.caption;
    montage = applied.montage;
    snapshot = snapshotted.snapshot;
    ledger = snapshotted.ledger;
  };

  applyOne("deterministic_repair", "missing_hook");
  applyOne("targeted_regenerate", "missing_payoff");
  applyOne("targeted_visual_revision", "unsafe_crop");
  applyOne("targeted_visual_revision", "unsafe_crop");
  applyOne("targeted_visual_revision", "unsafe_crop");
  assert.deepEqual(countRevisionApplications(ledger), { total: 5, text: 2, visual: 3 });

  assert.throws(
    () =>
      applyPersistedRevision({
        revision: revision("targeted_visual_revision", "unsafe_crop", "montage-plan"),
        defects: [defect("unsafe_crop")],
        artifacts: [artifact("montage-plan", montage)],
        caption,
        montage,
        ledger,
        attemptNo: 6,
        previousSettingsSha256: settingsHash(snapshot),
        textBounds: TEXT_BOUNDS
      }),
    (error) => error instanceof RevisionApplicationError && error.code === "budget_exhausted"
  );
});
