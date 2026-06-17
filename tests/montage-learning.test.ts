import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeuristicCausalEdits,
  buildEffectiveRenderPlan,
  buildMontageLearningCase,
  buildMontageLearningParams,
  buildMontageLearningPlaybook,
  findMissingCausalReasoningForChangedActions,
  isCanonicalMontagePublication,
  selectFinalStage3Job
} from "../lib/montage-learning";

test("montage learning effective render plan fills canonical defaults", () => {
  const effective = buildEffectiveRenderPlan({
    rawRenderPlan: {},
    snapshot: {}
  });
  const params = buildMontageLearningParams({
    rawRenderPlan: {},
    snapshot: {},
    effective
  });

  assert.equal(effective.focusX, 0.5);
  assert.equal(effective.focusY, 0.5);
  assert.equal(effective.videoZoom, 1);
  assert.equal(effective.videoFit, "cover");
  assert.equal(effective.clipStartSec, 0);
  assert.equal(effective.clipDurationSec, null);
  assert.equal(effective.mirrorEnabled, true);
  assert.deepEqual(effective.segments, []);
  assert.deepEqual(params.focusX, {
    raw_saved_value: null,
    effective_value: 0.5
  });
  assert.deepEqual(params.videoZoom, {
    raw_saved_value: null,
    effective_value: 1
  });
});

test("montage learning builds causal edits for changed montage actions", () => {
  const effective = buildEffectiveRenderPlan({
    rawRenderPlan: {
      focusX: 0.72,
      videoZoom: 1.33,
      videoFit: "contain",
      mirrorEnabled: false,
      sourceCrop: {
        enabled: true,
        x: 0.02,
        y: 0.08,
        width: 0.92,
        height: 0.84,
        confidence: 0.9,
        source: "editor-final"
      }
    },
    snapshot: { focusY: 0.64, clipStartSec: 3.25, clipDurationSec: 8 }
  });

  const edits = buildHeuristicCausalEdits({
    effective,
    frameManifest: {
      source: { requested: true, count: 3, files: ["source-1.png", "source-2.png", "source-3.png"], status: "available" },
      template_naive: { requested: true, count: 3, files: ["naive-1.png", "naive-2.png", "naive-3.png"], status: "available" },
      final: { requested: true, count: 3, files: ["final-1.png", "final-2.png", "final-3.png"], status: "available" }
    }
  });

  assert.ok(edits.some((edit) => edit.parameter_or_action === "sourceCrop"));
  assert.ok(edits.some((edit) => edit.parameter_or_action === "focusX"));
  assert.ok(edits.some((edit) => edit.parameter_or_action === "focusY"));
  assert.ok(edits.some((edit) => edit.parameter_or_action === "videoZoom"));
  assert.ok(edits.some((edit) => edit.parameter_or_action === "videoFit"));
  assert.ok(edits.some((edit) => edit.parameter_or_action === "clip_window"));
  assert.ok(edits.some((edit) => edit.parameter_or_action === "mirrorEnabled"));
  assert.equal(edits[0]?.evidence_frames.template_naive.length, 3);
  assert.match(edits.find((edit) => edit.parameter_or_action === "sourceCrop")?.reusable_rule ?? "", /donor provenance/i);
});

test("montage learning does not require causal edit for default video scale", () => {
  const effective = buildEffectiveRenderPlan({
    rawRenderPlan: {
      videoScaleX: 1,
      videoScaleY: 1,
      segments: [
        {
          startSec: 0,
          endSec: 6,
          speed: 1
        }
      ]
    },
    snapshot: { clipStartSec: 0, clipDurationSec: 6 }
  });

  assert.deepEqual(
    findMissingCausalReasoningForChangedActions(effective, [
      {
        parameter_or_action: "segments",
        before_observation: "The naive state has a longer source window than the final clip.",
        problem_class: "clip_window_choice",
        change_applied: "Selected the first six seconds.",
        after_observation: "The final edited state uses a focused source window.",
        intent: "Choose the clearest moment.",
        tradeoff: "Later source context is omitted.",
        reusable_rule: "Explain clip-window changes when a segment is selected.",
        evidence_frames: {
          source_raw: ["source.png"],
          template_naive: ["naive.png"],
          final_edited: ["final.png"]
        }
      }
    ]),
    []
  );
});

test("montage learning filters canonical publication statuses", () => {
  assert.equal(isCanonicalMontagePublication({ status: "published" }), true);
  assert.equal(isCanonicalMontagePublication({ status: "scheduled" }), true);
  assert.equal(isCanonicalMontagePublication({ status: "queued" }), true);
  assert.equal(isCanonicalMontagePublication({ status: "paused" }), true);
  assert.equal(isCanonicalMontagePublication({ status: "failed" }), false);
  assert.equal(isCanonicalMontagePublication({ status: "canceled" }), false);
  assert.equal(isCanonicalMontagePublication({ status: "uploading" }), false);
});

test("montage learning prefers the flow final stage3 render job", () => {
  const selected = selectFinalStage3Job({
    flow: {
      stage3JobId: "render-final"
    },
    jobs: [
      {
        id: "preview-newer",
        kind: "preview",
        status: "completed",
        updatedAt: "2026-06-17T12:00:00.000Z"
      },
      {
        id: "render-final",
        kind: "render",
        status: "completed",
        updatedAt: "2026-06-17T11:00:00.000Z"
      }
    ]
  });

  assert.equal(selected?.id, "render-final");
});

test("montage learning uses latest completed render when flow has no final id", () => {
  const selected = selectFinalStage3Job({
    flow: {},
    jobs: [
      {
        id: "preview-newer",
        kind: "preview",
        status: "completed",
        updatedAt: "2026-06-17T12:00:00.000Z"
      },
      {
        id: "render-older",
        kind: "render",
        status: "completed",
        updatedAt: "2026-06-17T10:00:00.000Z"
      }
    ]
  });

  assert.equal(selected?.id, "render-older");
});

test("montage learning exports Ranger-like final parameters from stage3Jobs", () => {
  const caseItem = buildMontageLearningCase({
    publication: {
      id: "pub-ranger-1",
      channelId: "channel-ranger",
      chatId: "chat-ranger-1",
      renderExportId: "render-export-1",
      status: "published",
      title: "Spotting a Fake Gold Bar",
      sourceUrl: "https://www.instagram.com/reel/source",
      renderFileName: "VIDEO_BY_RANGER.mp4",
      youtubeVideoId: "yt-1",
      youtubeVideoUrl: "https://youtube.com/shorts/yt-1",
      publishedAt: "2026-06-17T10:00:00.000Z",
      createdAt: "2026-06-17T09:00:00.000Z",
      updatedAt: "2026-06-17T10:05:00.000Z"
    },
    channel: {
      id: "channel-ranger",
      name: "Ranger Roary",
      username: "RangerRoary",
      templateId: "after-the-curtain-ea250e5f"
    },
    flow: {
      flow: {
        chatId: "chat-ranger-1",
        channelId: "channel-ranger",
        channelName: "Ranger Roary",
        channelUsername: "RangerRoary",
        sourceUrl: "https://www.instagram.com/reel/source",
        stage3JobId: "stage3-final"
      },
      stage3Jobs: [
        {
          id: "stage3-final",
          kind: "render",
          status: "completed",
          updatedAt: "2026-06-17T10:04:00.000Z",
          payload: {
            snapshot: {
              focusY: 0.64,
              clipStartSec: 3.25,
              clipDurationSec: 8,
              renderPlan: {
                templateId: "after-the-curtain-ea250e5f",
                focusX: 0.72,
                videoZoom: 1.33,
                videoFit: "contain",
                mirrorEnabled: false,
                sourceCrop: {
                  enabled: true,
                  x: 0.02,
                  y: 0.08,
                  width: 0.92,
                  height: 0.84,
                  confidence: 0.9,
                  source: "editor-final"
                },
                segments: [
                  {
                    startSec: 3.25,
                    endSec: 11.25,
                    speed: 1,
                    label: "Final window",
                    focusX: 0.74,
                    focusY: 0.62,
                    videoZoom: 1.25,
                    mirrorEnabled: false
                  }
                ]
              }
            }
          }
        }
      ]
    }
  });

  assert.equal(caseItem.final.stage3_job_id, "stage3-final");
  assert.equal(caseItem.params.focusX.raw_saved_value, 0.72);
  assert.equal(caseItem.params.focusX.effective_value, 0.72);
  assert.equal(caseItem.params.focusY.raw_saved_value, 0.64);
  assert.equal(caseItem.params.focusY.effective_value, 0.64);
  assert.equal(caseItem.params.videoZoom.raw_saved_value, 1.33);
  assert.equal(caseItem.params.videoZoom.effective_value, 1.33);
  assert.equal(caseItem.params.videoFit.effective_value, "contain");
  assert.equal(caseItem.params.mirrorEnabled.effective_value, false);
  assert.equal(caseItem.params.segments.effective_value.length, 1);
  assert.equal(caseItem.params.segments.effective_value[0]?.startSec, 3.3);
  assert.equal(caseItem.params.segments.effective_value[0]?.focusX, 0.74);
  assert.equal(caseItem.final_render_plan_effective.sourceCrop?.source, "editor-final");
  assert.equal(caseItem.states.source_raw.status, "not_requested");
  assert.equal(caseItem.states.template_naive.status, "not_requested");
  assert.equal(caseItem.states.final_edited.status, "not_requested");
  assert.equal(caseItem.training_split, "candidate");
  assert.ok(caseItem.analysis.causal_edits.some((edit) => edit.parameter_or_action === "sourceCrop"));
  assert.equal(caseItem.clean_training_candidate, false);
  assert.ok(caseItem.exclusion_reasons.includes("judge_not_passed"));
  assert.ok(caseItem.exclusion_reasons.includes("template_naive_frames_missing"));
  assert.ok(caseItem.exclusion_reasons.includes("source_frames_missing"));
  assert.ok(caseItem.exclusion_reasons.includes("final_frames_missing"));
});

test("montage playbook only promotes confirmed clean causal cases", () => {
  const caseItem = buildMontageLearningCase({
    publication: {
      id: "pub-candidate",
      channelId: "channel-ranger",
      chatId: "chat-candidate",
      status: "published",
      sourceUrl: "https://www.instagram.com/reel/source"
    },
    flow: {
      flow: {
        chatId: "chat-candidate",
        channelId: "channel-ranger",
        sourceUrl: "https://www.instagram.com/reel/source",
        stage3JobId: "stage3-final"
      },
      stage3Jobs: [
        {
          id: "stage3-final",
          kind: "render",
          status: "completed",
          payload: {
            snapshot: {
              renderPlan: {
                sourceCrop: {
                  enabled: true,
                  x: 0,
                  y: 0.1,
                  width: 1,
                  height: 0.8,
                  confidence: 0.9,
                  source: "editor-clean-inner-media"
                }
              }
            }
          }
        }
      ]
    }
  });

  const playbook = buildMontageLearningPlaybook([caseItem]);
  assert.match(playbook, /Causal Montage Playbook v2/);
  assert.match(playbook, /no clean causal cases yet/i);
  assert.match(playbook, /No confirmed causal edits yet/);
  assert.match(playbook, /baked inside the useful source area/i);
  assert.match(playbook, /failed causal edit/i);
});
