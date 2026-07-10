import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROJECT_KINGS_INSTAGRAM_DONOR_POLICY,
  ProjectKingsInstagramDiscoveryError,
  assertAllowedProjectKingsInstagramFetchUrl,
  canonicalizeInstagramReelUrl,
  discoverProjectKingsInstagramDonors,
  hashProjectKingsInstagramDiscoveryEvidence,
  verifyProjectKingsInstagramDiscoveryPacket,
  type ProjectKingsInstagramFetch
} from "../lib/project-kings/instagram-donor-discovery";
import {
  parseProjectKingsInstagramDiscoveryCliArgs,
  runProjectKingsInstagramDiscoveryCli
} from "../scripts/discover-project-kings-instagram-donors";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(
  repoRoot,
  "tests/fixtures/project-kings-instagram-discovery"
);
const EPHEMERAL_MID = "MID_EPHEMERAL_SECRET";
const EPHEMERAL_CSRF = "CSRF_EPHEMERAL_SECRET";

async function fixture(name: string): Promise<string> {
  return await fs.readFile(path.join(fixtureRoot, name), "utf8");
}

function bootstrapResponse(): Response {
  const headers = new Headers({ "content-type": "text/html" });
  headers.append("set-cookie", `mid=${EPHEMERAL_MID}; Path=/; Secure; HttpOnly`);
  headers.append("set-cookie", `csrftoken=${EPHEMERAL_CSRF}; Path=/; Secure`);
  return new Response("<html>public web session</html>", { status: 200, headers });
}

function assertSessionHeaders(init: RequestInit | undefined): void {
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("x-ig-app-id"), "936619743392459");
  assert.equal(headers.get("x-csrftoken"), EPHEMERAL_CSRF);
  assert.match(headers.get("cookie") ?? "", /csrftoken=CSRF_EPHEMERAL_SECRET/);
  assert.match(headers.get("cookie") ?? "", /mid=MID_EPHEMERAL_SECRET/);
}

function createFixtureFetch(input: {
  profileBody: string;
  pageOneBody: string;
  pageTwoBody: string;
  onActive?: (active: number) => void;
}): ProjectKingsInstagramFetch {
  let active = 0;
  return async (rawUrl, init) => {
    active += 1;
    input.onActive?.(active);
    try {
      await Promise.resolve();
      const url = new URL(String(rawUrl));
      assert.equal(init?.redirect, "manual");
      if (url.pathname === "/") {
        const headers = new Headers(init?.headers);
        assert.equal(headers.has("cookie"), false);
        assert.equal(headers.has("x-csrftoken"), false);
        return bootstrapResponse();
      }
      assertSessionHeaders(init);
      if (url.pathname === "/api/v1/users/web_profile_info/") {
        assert.equal(url.searchParams.get("username"), "learnaifaster");
        return new Response(input.profileBody, {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      assert.equal(url.pathname, "/api/v1/clips/user/");
      assert.equal(init?.method, "POST");
      const body = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(body.get("target_user_id"), "9876543210");
      assert.equal(body.get("page_size"), "12");
      const maxId = body.get("max_id");
      if (!maxId) {
        return new Response(input.pageOneBody, {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      assert.equal(maxId, "cursor-page-2");
      return new Response(input.pageTwoBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    } finally {
      active -= 1;
    }
  };
}

function assertNoSessionMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(EPHEMERAL_MID), false);
  assert.equal(serialized.includes(EPHEMERAL_CSRF), false);
  const forbiddenKeys = new Set([
    "cookie",
    "cookies",
    "authorization",
    "csrftoken",
    "x-csrftoken",
    "mid"
  ]);
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    for (const [key, nested] of Object.entries(entry)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden packet key: ${key}`);
      visit(nested);
    }
  };
  visit(value);
}

function rehashEvidence(value: Record<string, unknown> & { evidenceSha256: string }): void {
  const { evidenceSha256: ignored, ...payload } = value;
  void ignored;
  value.evidenceSha256 = hashProjectKingsInstagramDiscoveryEvidence(payload);
}

test("frozen donor policy and HTTPS allowlists cannot be widened by runtime input", () => {
  assert.deepEqual(PROJECT_KINGS_INSTAGRAM_DONOR_POLICY, {
    "dark-joy-boy": [
      "kodyantle",
      "spidermonkeywinston",
      "myrtlebeachsafari",
      "realdiddykong"
    ],
    "light-kingdom": ["learnaifaster"],
    "copscopes-x2e": ["copscopes"]
  });
  assert.equal(
    canonicalizeInstagramReelUrl(
      "https://www.instagram.com/learnaifaster/reel/ABC_def-1/?igsh=tracking"
    ),
    "https://www.instagram.com/reel/ABC_def-1/"
  );
  assert.equal(
    assertAllowedProjectKingsInstagramFetchUrl(
      "https://www.instagram.com/api/v1/clips/user/"
    ).hostname,
    "www.instagram.com"
  );
  assert.throws(
    () => assertAllowedProjectKingsInstagramFetchUrl("http://www.instagram.com/"),
    ProjectKingsInstagramDiscoveryError
  );
  assert.throws(
    () => assertAllowedProjectKingsInstagramFetchUrl("https://evil.example/api/v1/clips/user/"),
    ProjectKingsInstagramDiscoveryError
  );
  assert.throws(
    () => assertAllowedProjectKingsInstagramFetchUrl("https://www.instagram.com:444/api/v1/clips/user/"),
    ProjectKingsInstagramDiscoveryError
  );
  assert.throws(
    () => assertAllowedProjectKingsInstagramFetchUrl("https://user:secret@www.instagram.com/"),
    ProjectKingsInstagramDiscoveryError
  );
  assert.throws(
    () => assertAllowedProjectKingsInstagramFetchUrl("https://www.instagram.com/accounts/login/"),
    ProjectKingsInstagramDiscoveryError
  );
});

test("public-web discovery normalizes, hash-binds, dedupes and excludes known Reels without qualification", async () => {
  const [profileBody, pageOneBody, pageTwoBody] = await Promise.all([
    fixture("web-profile-info.json"),
    fixture("clips-page-1.json"),
    fixture("clips-page-2.json")
  ]);
  let maximumActiveRequests = 0;
  const packet = await discoverProjectKingsInstagramDonors({
    profileKeys: ["light-kingdom"],
    knownCanonicalUrls: ["https://www.instagram.com/reel/KNOWN1/?igsh=remove"],
    capturedAt: "2026-07-10T18:00:00.000Z",
    fetchImpl: createFixtureFetch({
      profileBody,
      pageOneBody,
      pageTwoBody,
      onActive: (active) => {
        maximumActiveRequests = Math.max(maximumActiveRequests, active);
      }
    }),
    sleep: async () => undefined
  });

  assert.equal(maximumActiveRequests, 1);
  assert.equal(packet.summary.candidateCount, 2);
  assert.equal(packet.summary.excludedKnownCount, 1);
  assert.equal(packet.summary.duplicateCount, 1);
  assert.equal(packet.summary.issueCount, 1);
  assert.equal(packet.knownCanonicalUrlCount, 1);
  assert.equal(packet.provider, "instagram_public_web");
  const donor = packet.profiles[0]?.donors[0];
  assert.ok(donor);
  assert.equal(donor.pagesFetched, 2);
  assert.equal(donor.itemsSeen, 5);
  assert.equal(donor.paginationExhausted, true);
  assert.equal(donor.status, "partial");
  assert.equal(donor.requestEvidence.length, 3);
  assert.deepEqual(
    donor.requestEvidence.map((entry) => entry.endpoint),
    ["profile_lookup", "clips_page", "clips_page"]
  );
  const first = donor.candidates[0];
  assert.equal(first?.shortcode, "NEW_One-1");
  assert.equal(first?.canonicalUrl, "https://www.instagram.com/reel/NEW_One-1/");
  assert.equal(first?.caption, "First line\n\nSecond line");
  assert.equal(first?.viewCount, 12345);
  assert.equal(first?.takenAtEpochSeconds, 1783663200);
  assert.equal(first?.takenAt, "2026-07-10T06:00:00.000Z");
  assert.equal(first?.discoveryState, "discovery_only");
  assert.equal(first?.semanticDecision, null);
  assert.equal(first?.automaticQualification, false);
  assert.deepEqual(
    donor.exclusions.find((entry) => entry.reason === "duplicate")?.duplicateDimensions,
    ["shortcode", "canonical_url"]
  );
  assert.equal(donor.issues[0]?.code, "instagram_invalid_item");
  verifyProjectKingsInstagramDiscoveryPacket(packet);
  assertNoSessionMaterial(packet);

  const tampered = structuredClone(packet) as unknown as {
    profiles: Array<{ donors: Array<{ candidates: Array<{ caption: string }> }> }>;
  };
  tampered.profiles[0]!.donors[0]!.candidates[0]!.caption = "tampered";
  assert.throws(
    () => verifyProjectKingsInstagramDiscoveryPacket(
      tampered as unknown as Parameters<typeof verifyProjectKingsInstagramDiscoveryPacket>[0]
    ),
    /evidence hash mismatch/
  );

  const forgedSummary = structuredClone(packet) as unknown as Record<string, unknown> & {
    evidenceSha256: string;
    summary: { candidateCount: number };
  };
  forgedSummary.summary.candidateCount = 999;
  rehashEvidence(forgedSummary);
  assert.throws(
    () => verifyProjectKingsInstagramDiscoveryPacket(
      forgedSummary as unknown as Parameters<typeof verifyProjectKingsInstagramDiscoveryPacket>[0]
    ),
    /summary is inconsistent/
  );

  const forgedPageBinding = structuredClone(packet) as unknown as Record<string, unknown> & {
    evidenceSha256: string;
    profiles: Array<Record<string, unknown> & {
      evidenceSha256: string;
      donors: Array<Record<string, unknown> & {
        evidenceSha256: string;
        candidates: Array<Record<string, unknown> & {
          evidenceSha256: string;
          pageResponseSha256: string;
        }>;
      }>;
    }>;
  };
  const forgedProfile = forgedPageBinding.profiles[0]!;
  const forgedDonor = forgedProfile.donors[0]!;
  const forgedCandidate = forgedDonor.candidates[0]!;
  forgedCandidate.pageResponseSha256 = "0".repeat(64);
  rehashEvidence(forgedCandidate);
  rehashEvidence(forgedDonor);
  rehashEvidence(forgedProfile);
  rehashEvidence(forgedPageBinding);
  assert.throws(
    () => verifyProjectKingsInstagramDiscoveryPacket(
      forgedPageBinding as unknown as Parameters<typeof verifyProjectKingsInstagramDiscoveryPacket>[0]
    ),
    /not bound to its donor and clips-page evidence/
  );
});

for (const [status, expectedCode, expectedClassification, expectedCalls] of [
  [401, "instagram_auth_required", "authentication_required", 1],
  [403, "instagram_access_forbidden", "access_forbidden", 1],
  [429, "instagram_rate_limited", "rate_limited", 3]
] as const) {
  test(`HTTP ${status} receives a bounded, explicit discovery classification`, async () => {
    let profileCalls = 0;
    const retryDelays: number[] = [];
    const packet = await discoverProjectKingsInstagramDonors({
      profileKeys: ["light-kingdom"],
      capturedAt: "2026-07-10T18:00:00.000Z",
      maxAttempts: 3,
      fetchImpl: async (rawUrl) => {
        const url = new URL(String(rawUrl));
        if (url.pathname === "/") return bootstrapResponse();
        profileCalls += 1;
        return new Response("not persisted", { status });
      },
      sleep: async (delayMs) => {
        retryDelays.push(delayMs);
      }
    });
    const issue = packet.profiles[0]?.donors[0]?.issues[0];
    assert.equal(profileCalls, expectedCalls);
    assert.equal(issue?.code, expectedCode);
    assert.equal(issue?.classification, expectedClassification);
    assert.equal(issue?.attempts, expectedCalls);
    assert.equal(retryDelays.length, expectedCalls - 1);
    assert.equal(packet.summary.candidateCount, 0);
    verifyProjectKingsInstagramDiscoveryPacket(packet);
    assertNoSessionMaterial(packet);
  });
}

test("network/timeout failures and response sizes stop at their configured limits", async () => {
  let timeoutCalls = 0;
  const timeoutPacket = await discoverProjectKingsInstagramDonors({
    profileKeys: ["light-kingdom"],
    capturedAt: "2026-07-10T18:00:00.000Z",
    timeoutMs: 250,
    maxAttempts: 2,
    fetchImpl: async () => {
      timeoutCalls += 1;
      return await new Promise<Response>(() => undefined);
    },
    sleep: async () => undefined
  });
  assert.equal(timeoutCalls, 2);
  assert.equal(timeoutPacket.profiles[0]?.issues[0]?.code, "instagram_timeout");

  const bodyTimeoutStartedAt = Date.now();
  let bodyCancelCalled = false;
  const bodyTimeoutPacket = await discoverProjectKingsInstagramDonors({
    profileKeys: ["light-kingdom"],
    capturedAt: "2026-07-10T18:00:00.000Z",
    timeoutMs: 250,
    maxAttempts: 1,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        bodyCancelCalled = true;
      }
    }), { status: 200 }),
    sleep: async () => undefined
  });
  assert.equal(bodyTimeoutPacket.profiles[0]?.issues[0]?.code, "instagram_timeout");
  assert.ok(Date.now() - bodyTimeoutStartedAt < 1_000);
  assert.equal(bodyCancelCalled, true);

  const oversizedPacket = await discoverProjectKingsInstagramDonors({
    profileKeys: ["light-kingdom"],
    capturedAt: "2026-07-10T18:00:00.000Z",
    maxResponseBytes: 1_024,
    fetchImpl: async () => new Response("ignored", {
      status: 200,
      headers: { "content-length": "1025" }
    }),
    sleep: async () => undefined
  });
  assert.equal(
    oversizedPacket.profiles[0]?.issues[0]?.code,
    "instagram_response_too_large"
  );

  const chunkedOversizedPacket = await discoverProjectKingsInstagramDonors({
    profileKeys: ["light-kingdom"],
    capturedAt: "2026-07-10T18:00:00.000Z",
    maxResponseBytes: 1_024,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      }
    }), { status: 200 }),
    sleep: async () => undefined
  });
  assert.equal(
    chunkedOversizedPacket.profiles[0]?.issues[0]?.code,
    "instagram_response_too_large"
  );
});

test("missing session cookies fail closed and numeric request budgets cannot exceed hard caps", async () => {
  let calls = 0;
  const packet = await discoverProjectKingsInstagramDonors({
    profileKeys: ["light-kingdom"],
    capturedAt: "2026-07-10T18:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      return new Response("<html>no session cookies</html>", { status: 200 });
    }
  });
  assert.equal(calls, 1);
  assert.equal(packet.profiles[0]?.donors.length, 0);
  assert.equal(packet.profiles[0]?.issues[0]?.code, "instagram_session_bootstrap_failed");

  await assert.rejects(
    discoverProjectKingsInstagramDonors({ pagesPerDonor: 6 }),
    /pagesPerDonor must be an integer between 1 and 5/
  );
  await assert.rejects(
    discoverProjectKingsInstagramDonors({ itemsPerDonor: 101 }),
    /itemsPerDonor must be an integer between 1 and 100/
  );
  await assert.rejects(
    discoverProjectKingsInstagramDonors({ maxAttempts: 4 }),
    /maxAttempts must be an integer between 1 and 3/
  );
});

test("all frozen profiles remain sequential even when every public request is asynchronous", async () => {
  let active = 0;
  let maximumActive = 0;
  const fetchImpl: ProjectKingsInstagramFetch = async (rawUrl, init) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const url = new URL(String(rawUrl));
      if (url.pathname === "/") return bootstrapResponse();
      assertSessionHeaders(init);
      if (url.pathname === "/api/v1/users/web_profile_info/") {
        const username = url.searchParams.get("username") ?? "missing";
        return Response.json({ data: { user: { id: `id-${username}` } } });
      }
      const body = new URLSearchParams(String(init?.body ?? ""));
      const userId = body.get("target_user_id") ?? "missing";
      return Response.json({
        items: [{ media: { code: `${userId.replace(/[^A-Za-z0-9_-]/g, "_")}_clip` } }],
        paging_info: { more_available: false }
      });
    } finally {
      active -= 1;
    }
  };
  const packet = await discoverProjectKingsInstagramDonors({
    capturedAt: "2026-07-10T18:00:00.000Z",
    pagesPerDonor: 1,
    itemsPerDonor: 1,
    pageSize: 1,
    fetchImpl,
    sleep: async () => undefined
  });
  assert.equal(maximumActive, 1);
  assert.equal(packet.summary.profileCount, 3);
  assert.equal(packet.summary.donorCount, 6);
  assert.equal(packet.summary.candidateCount, 6);
  assert.equal(packet.summary.complete, true);
});

test("CLI writes a verified mode-0600 packet and prints only a safe summary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-instagram-discovery-"));
  try {
    const [profileBody, pageOneBody, pageTwoBody] = await Promise.all([
      fixture("web-profile-info.json"),
      fixture("clips-page-1.json"),
      fixture("clips-page-2.json")
    ]);
    const knownUrlsPath = path.join(root, "known.json");
    const outputPath = path.join(root, "packet.json");
    await fs.writeFile(knownUrlsPath, JSON.stringify({
      knownCanonicalUrls: ["https://www.instagram.com/reel/KNOWN1/"]
    }));
    const stdout: string[] = [];
    const result = await runProjectKingsInstagramDiscoveryCli([
      "--output", outputPath,
      "--known-urls", knownUrlsPath,
      "--profiles", "light-kingdom",
      "--captured-at", "2026-07-10T18:00:00.000Z"
    ], {
      fetchImpl: createFixtureFetch({ profileBody, pageOneBody, pageTwoBody }),
      sleep: async () => undefined,
      stdout: (line) => stdout.push(line)
    });
    const packet = JSON.parse(await fs.readFile(outputPath, "utf8"));
    verifyProjectKingsInstagramDiscoveryPacket(packet);
    assert.equal((await fs.stat(outputPath)).mode & 0o777, 0o600);
    assert.equal(result.evidenceSha256, packet.evidenceSha256);
    assert.equal(stdout.length, 1);
    assert.equal(stdout[0]?.includes(EPHEMERAL_MID), false);
    assert.equal(stdout[0]?.includes(EPHEMERAL_CSRF), false);
    assertNoSessionMaterial(packet);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI requires an output and rejects profile policy overrides", () => {
  assert.throws(() => parseProjectKingsInstagramDiscoveryCliArgs([]), /--output is required/);
  assert.throws(
    () => parseProjectKingsInstagramDiscoveryCliArgs([
      "--output", "packet.json",
      "--profiles", "unapproved-profile"
    ]),
    /Unsupported Project Kings profile/
  );
  for (const prototypeKey of ["toString", "constructor", "__proto__"]) {
    assert.throws(
      () => parseProjectKingsInstagramDiscoveryCliArgs([
        "--output", "packet.json",
        "--profiles", prototypeKey
      ]),
      /Unsupported Project Kings profile/
    );
  }
});

test("CLI stderr never echoes malformed known-URLs file content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-instagram-cli-error-"));
  const sentinel = "EPHEMERAL_SECRET_MUST_NOT_LEAK";
  try {
    const knownUrlsPath = path.join(root, "known.json");
    await fs.writeFile(knownUrlsPath, sentinel);
    const result = spawnSync(process.execPath, [
      "--import", "tsx",
      path.join(repoRoot, "scripts/discover-project-kings-instagram-donors.ts"),
      "--output", path.join(root, "packet.json"),
      "--known-urls", knownUrlsPath,
      "--profiles", "light-kingdom"
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Known-URLs file is not valid JSON/);
    assert.equal(result.stderr.includes(sentinel), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("library rejects prototype profile keys before making any request", async () => {
  let fetchCalls = 0;
  for (const prototypeKey of ["toString", "constructor", "__proto__"]) {
    await assert.rejects(
      discoverProjectKingsInstagramDonors({
        profileKeys: [prototypeKey as "light-kingdom"],
        fetchImpl: async () => {
          fetchCalls += 1;
          return bootstrapResponse();
        }
      }),
      /Unsupported profile key/
    );
  }
  assert.equal(fetchCalls, 0);
});
