import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMacPublicRoute,
  countMacTcpTimeWait,
  findOrphanedStage3Browsers,
  parseMacTcpPortPressure
} from "../scripts/clips-macmini-healthcheck.mjs";

test("Mac mini healthcheck accepts direct and tunnel public routes", () => {
  assert.deepEqual(
    classifyMacPublicRoute({ ok: true, stdout: "route to: 1.1.1.1\ninterface: en1", stderr: "" }),
    { status: "ok", detail: "interface=en1 mode=direct" }
  );
  assert.deepEqual(
    classifyMacPublicRoute({ ok: true, stdout: "route to: 1.1.1.1\ninterface: utun7", stderr: "" }),
    { status: "ok", detail: "interface=utun7 mode=tunnel" }
  );
  assert.deepEqual(
    classifyMacPublicRoute({ ok: false, stdout: "", stderr: "route unavailable" }),
    { status: "warn", detail: "route unavailable" }
  );
});

test("Mac mini healthcheck parses ephemeral TCP pressure", () => {
  assert.deepEqual(parseMacTcpPortPressure("8192\n49152\n65535\n"), {
    count: 8192,
    first: 49152,
    last: 65535,
    capacity: 16_384,
    ratio: 0.5
  });
  assert.equal(parseMacTcpPortPressure("broken"), null);
});

test("Mac mini healthcheck counts TIME_WAIT sockets", () => {
  assert.equal(
    countMacTcpTimeWait(
      [
        "tcp4 0 0 127.0.0.1.50000 127.0.0.1.443 TIME_WAIT",
        "tcp4 0 0 127.0.0.1.50001 127.0.0.1.443 ESTABLISHED",
        "tcp4 0 0 127.0.0.1.50002 127.0.0.1.443 TIME_WAIT"
      ].join("\n")
    ),
    2
  );
});

test("Mac mini healthcheck reports only orphaned worker-owned headless browsers", () => {
  const home = "/Users/tester";
  const records = findOrphanedStage3Browsers(
    [
      "101 1 /Users/tester/Library/Application Support/Clips Stage3 Worker/cache/chrome-headless-shell",
      "102 55 /Users/tester/Library/Application Support/Clips Stage3 Worker/cache/chrome-headless-shell",
      "103 1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ].join("\n"),
    home
  );
  assert.deepEqual(records.map((record) => record.pid), [101]);
});
