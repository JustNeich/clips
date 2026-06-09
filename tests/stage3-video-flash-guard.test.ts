import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStage3FlashRepairFfmpegArgs,
  buildStage3FlashRepairRanges,
  detectStage3BlankFlashFrames,
  parseStage3SignalStats
} from "../lib/stage3-video-flash-guard";

const SIGNAL_STATS_SAMPLE = `
frame:0    pts:0       pts_time:0
lavfi.signalstats.YMIN=11
lavfi.signalstats.YLOW=76
lavfi.signalstats.YAVG=132.2
lavfi.signalstats.YHIGH=235
lavfi.signalstats.YMAX=251
lavfi.signalstats.UAVG=130.6
lavfi.signalstats.VAVG=125.9
frame:1    pts:512     pts_time:0.0333333
lavfi.signalstats.YMIN=235
lavfi.signalstats.YLOW=235
lavfi.signalstats.YAVG=235
lavfi.signalstats.YHIGH=235
lavfi.signalstats.YMAX=235
lavfi.signalstats.UAVG=128
lavfi.signalstats.VAVG=127
frame:2    pts:1024    pts_time:0.0666667
lavfi.signalstats.YMIN=10
lavfi.signalstats.YLOW=74
lavfi.signalstats.YAVG=131.8
lavfi.signalstats.YHIGH=234
lavfi.signalstats.YMAX=251
lavfi.signalstats.UAVG=130.4
lavfi.signalstats.VAVG=126.1
`;

test("stage3 flash guard parses ffmpeg signalstats output", () => {
  const frames = parseStage3SignalStats(SIGNAL_STATS_SAMPLE);

  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((frame) => frame.frame), [0, 1, 2]);
  assert.equal(frames[1]?.yAvg, 235);
  assert.equal(frames[1]?.uAvg, 128);
});

test("stage3 flash guard detects neutral blank full-frame and media-slot flashes", () => {
  const frames = parseStage3SignalStats(SIGNAL_STATS_SAMPLE);

  assert.deepEqual(
    detectStage3BlankFlashFrames({
      fullFrameStats: frames
    }),
    [1]
  );
  assert.deepEqual(
    detectStage3BlankFlashFrames({
      fullFrameStats: [frames[0]!, frames[2]!],
      mediaStats: frames
    }),
    [1]
  );
  assert.deepEqual(
    detectStage3BlankFlashFrames({
      fullFrameStats: [frames[0]!, frames[2]!],
      mediaStats: [frames[0]!, frames[2]!],
      probeStats: [[frames[0]!, frames[1]!, frames[2]!]]
    }),
    [1]
  );
});

test("stage3 flash guard groups flashes and chooses nearest valid replacement frame", () => {
  assert.deepEqual(buildStage3FlashRepairRanges([0, 1, 5], 8), [
    { first: 0, last: 1, replace: 2 },
    { first: 5, last: 5, replace: 4 }
  ]);
  assert.deepEqual(buildStage3FlashRepairRanges([0], 1), []);
});

test("stage3 flash guard ffmpeg args preserve audio while replacing video frames", () => {
  const args = buildStage3FlashRepairFfmpegArgs({
    inputPath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    ranges: [
      { first: 1, last: 1, replace: 0 },
      { first: 5, last: 6, replace: 4 }
    ]
  });

  const filter = args[args.indexOf("-filter_complex") + 1] ?? "";
  assert.match(filter, /split=3\[base\]\[ref0\]\[ref1\]/);
  assert.match(filter, /freezeframes=first=1:last=1:replace=0/);
  assert.match(filter, /freezeframes=first=5:last=6:replace=4/);
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4), ["-map", "[flash1]", "-map", "0:a?"]);
  assert.ok(args.includes("-c:a"));
  assert.ok(args.includes("copy"));
});
