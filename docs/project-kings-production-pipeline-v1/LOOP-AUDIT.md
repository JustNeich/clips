# Project Kings pipeline — audit snapshot

Audited at: `2026-07-11 16:30 MSK`

Mode: `AUDIT`

Loop type: recurring production pipeline, currently a finite build-and-release loop

Current autonomy: `L3 Isolated`

Requested steady state: `L5 Governed autonomous`

Stop state: `acceptance_blocked`
Launch verdict: **unsafe to deploy or publish from the current frozen manifest**

Plan audit verdict: **ready for handoff** after three sequential skeptics and an opposite-model Claude review. This does not change the execution/launch verdict above.

This file is the current handoff truth. It preserves the previous implementation instead of discarding it, but it supersedes any statement that the July 11 frozen candidate is launch-compatible.

## 1. Public outcome

The first public MVP is the launch of ongoing management for these three channels in the Project Kings group:

- Dark Joy Boy — Clips profile `4b59c5cf412e4c07b192f3312361c2eb`, YouTube `UCwO37rtHMhHX8caUr5Rc0Bw`;
- THE LIGHT KINGDOM — Clips profile `43923d42c1c0495282f29d4c6e09b0b4`, YouTube `UC0LWZYpYuYAWK55WmvDqxbg`;
- COP SCOPES — Clips profile `6187aeeea7bd47188e08089c5916edc1`, YouTube `UCJhBMXXQ5GrTbrhqjwT1leg`.

The first proof is nine new videos: exactly three `public_verified` videos on each channel (`3x3`). After that proof and the L5 promotion gate, the same approved policies run daily without per-video or per-day owner approval.

## 2. Exact saved state

- Repository: `/Users/neich/Documents/Macedonian Imperium/clips automations`.
- Branch: `wip/project-kings-pipeline-v1-20260710`.
- Audited HEAD: `18c98adedaa38fa6b7fc813fb288770ce51b65a1`.
- Main/origin main at audit: `01661fb44629cb4c9711480409af4c8b121a6d09`.
- Branch state: 14 commits ahead of main, no upstream, not pushed.
- Tracked worktree at takeover: clean.
- Untracked worktree at takeover: `experiments/`, 3,424 files, about 698 MB.
- Ignored operational data that a clone will not contain: `.data/project-kings/` about 509 MB and `.data/source-media-cache/` about 594 MB.
- Previous Claude CLI session: `3e92fca9-56e3-4e8c-9ba1-d2141a325293`; it and its stale tail monitor were stopped after the SPEC commit completed.
- Original Codex task: `019f4add-6f5b-7101-940d-600c898203d9`.

Verified local backup:

`/Users/neich/Documents/Macedonian Imperium/Assistant-data/project-kings-handoff/20260711-162513-18c98ad`

The backup contains the complete Git bundle, `experiments/`, `.data/project-kings/`, `.data/source-media-cache/`, audit material, and both session transcripts. `git bundle verify` passed and all 3,700 recorded checksums passed. Bundle SHA-256: `a336f24ebda6d166e3621e1dbf748b700159ca7512e916422ea73d5310b68f58`.

## 3. What is proven

- 337/337 changed TypeScript tests and 53/53 MJS tests passed in an independent audit run.
- `tsc --noEmit --incremental false` passed.
- Three deterministic, no-network replays pass and do not publish.
- A 2 GB production database snapshot migration completed in 16.7 seconds; a second migration was idempotent; integrity and foreign-key checks passed.
- Durable state, transactional outbox, leases, idempotency, bounded retries, per-channel isolation, canary limits, and fail-closed handling of ambiguous uploads are implemented and tested.
- Real-30 route evidence exists for the main semantic roles. Model-route manifest v4 freezes Luna routes; Vision QA route evidence is still synthetic only.
- Render health endpoint answered HTTP 200 during this audit. That proves service reachability only, not that Project Kings schema, flags, profiles, or workers are current.

## 4. What is declared but not proven

- The July 11 `ProductionReleaseManifest` is structurally hash-valid, but its bound components are not semantically compatible.
- The previous SPEC calls the candidate frozen and acceptance-pending. This is a preserved historical milestone, not a deployable release.
- Old live-preflight evidence shows the three channel identities and YouTube connections as of July 10. Current production database state was not available through an authenticated owner route during this audit.
- Previous Zoro evidence records Node 24 and Codex CLI `0.131.0-alpha.22`. Current Zoro state could not be refreshed because SSH was unreachable.

## 5. Critical blockers

### P0 — model-route contract drift

The production route is v4/schema 3, while runtime/default/profile surfaces still bind `project-kings-model-routes-v2`/schema 1. This includes `pilot-profile-store.ts`, the frozen profile snapshot, `.env.example`, the semantic installer, and the Source Fit runner. The production loader rejects v2 as historical, while the installer expects schema 2. A profile prepared today cannot truthfully authorize the v4 runtime.

### P0 — source buffer is not production-ready

The manifest binds source-buffer readiness v13, whose qualification evidence uses v1. The current verifier intentionally rejects it. Actual qualified-v2 ready count is `0`; minimum deficit is 18 sources, six per channel.

### P0 — release identity mixes code and acceptance evidence

The frozen manifest binds code, tests, audit, source readiness, route evidence, and profile evidence into one circular object. Its git head is `469bfff`; the bound test output says it ran at `2d81c86`; it mixes profiles v2, routes v4, rejected source evidence, and a blocked First Pass Audit. The verifier checks manifest structure and hashes, not cross-component compatibility, and deployment/runtime does not enforce it.

### P0 — no real end-to-end production proof

There is no current evidence of the new schema deployed, v4 profiles prepared and approved, the semantic worker installed, the portfolio daemon installed, the autonomous refiller installed, a real shadow vertical, a controlled canary, or a new live `3x3`.

### P1 — Zoro runtime mismatch

Recorded Zoro Codex CLI `0.131.0-alpha.22` rejects `gpt-5.6-luna`; known-good route evidence used `0.144.1`. Recorded Node is 24 while the portfolio/refiller installers require Node 22. Current values are unknown until a fresh preflight.

### P1 — real Vision QA gate is absent

Vision QA v4 has only synthetic `n=3` evidence. The real corpus gate is 120 cases; the corpus builder currently reports `0/43` approved bases. This does not block a controlled owner-authorized canary, but it blocks promotion to unattended L5 operation.

### P1 — the refiller has two incompatible contours

The new autonomous refiller exists as a one-shot command. The launchd path still runs the legacy frozen-catalog refiller, which explicitly does not discover or qualify new sources. Recurring buffer maintenance is therefore not proven.

### Scope truth

The current daemon and profiles require exactly three hard-coded channels. This is the correct pilot for project “ЗАПУСК 30 КАНАЛОВ”; it is not yet a 30-channel system.

## 6. Overengineering and performance audit

- About 40k lines of runtime, 20k lines of tests, and a very large evidence corpus were created before one real shadow item completed.
- The release manifest enumerates thousands of scratch exclusions and makes audit evidence part of the release identity, causing freeze/audit churn.
- Model benchmark history and binary evidence are stored in Git even when they are not required by the web runtime.
- Source Fit may run twice over the same hash-bound bytes: once during qualification and again during a work item.
- All selected roles depend on Luna; several fallbacks are the same model at another reasoning level or fail-closed. There is no independent provider fallback.
- End-to-end p50/p95 has not been measured. Model-role latency alone suggests the target is plausible with semantic concurrency 3, but no real vertical proves it.
- Too much has been made deterministic at the release-evidence layer, while content interpretation correctly remains model-based. The next iteration must keep state/effects deterministic and keep semantic judgment bounded by typed inputs, outputs, budgets, and independent QA.

## 7. Pareto decision

Preserve the implementation, tests, migration work, route benchmarks, policies, templates, profiles, and local source bytes. Do not restart the project.

For the first working slice, do only the work that can change the launch verdict:

1. Align every runtime, installer, default, profile, and test binding to route manifest v4.
2. Split release identity into an immutable runtime candidate and an append-only acceptance/run evidence index keyed to that candidate.
3. Re-qualify only six existing sources per channel with the production qualification-v2 contract; do not build scheduled discovery first.
4. Refresh Zoro preflight and install exact compatible Node/Codex runtimes without replacing the known-good environment blindly.
5. Deploy with both live flags off; prepare fresh profiles; approve shadow only.
6. Produce one real no-publication shadow item per channel and prove restart/lease/kill-switch behavior.
7. Run one controlled live `3x3` after an exact owner approval packet. No item-by-item approvals are required inside that run.
8. Promote to recurring L5 only after all nine are `public_verified`, the real Vision QA gate passes, the autonomous refiller is connected to the daemon, and rollback/kill-switch evidence is current.

Everything else—30-channel generalization, model cost tuning, evidence pruning, second provider, duplicate Source Fit removal, and broader analytics—belongs to a separate post-MVP improvement stream.

## 8. Exact next evidence-producing step

Patch and test the v4 contract bindings. The step is complete only when one regenerated profile snapshot, the semantic installer, Source Fit runner, runtime loader, `.env.example`, and their tests all resolve the same v4 manifest ID, schema, and SHA. No new broad audit or model benchmark should run before this contradiction is removed.

## 9. Approval boundary

This audit and documentation do not authorize deployment, profile/policy approval, Zoro mutation, live feature flags, upload, scheduling, or publication. Each high-impact action requires a current evidence packet and explicit owner approval immediately before execution.

## 10. First Pass Audit convergence addendum

The audit facts above remain unchanged. The execution plan was corrected to one order:

`coherent candidate -> 6/6/6 source recount -> dark deploy -> three-channel shadow -> pre-live gates -> Approval A -> automatic 1x3 canary -> 3/3 public_verified -> automatic 2x3 remainder -> 9/9 public_verified -> full L5 gates -> Approval B -> L5 promotion -> observed scheduled wake`.

The real 120-case Vision QA blocks unattended L5, not the bounded controlled live run. Approval A and Approval B are distinct machine-enforced records. The first live run retains an automatic one-per-channel canary, database rollback is expand/contract plus roll-forward rather than an unsafe whole-production snapshot restore, and a partial `8/9` never counts as the public MVP.

## 11. Execution progress after the audit snapshot

### Phase 0 — v4 binding alignment: locally complete

The original P0 model-route drift in section 5 is preserved as an audit-time fact. It is now resolved in the local candidate:

- all production app/lib/script/default surfaces bind `project-kings-model-routes-v4`, schema 3, internal manifest SHA `13e867148fdda8c138421218fcc1ebf23cfc06b649c1321ed319e20238f456e5`;
- installer and autonomous refiller accept production schema 2 or 3 and their current defaults use v4;
- the old profile snapshot v1 remains immutable historical evidence;
- the new profile snapshot is `evidence/project-kings-production-profiles-v2.json`, file SHA-256 `484d839b81799e1c978215fc74fad1397daa1adba5af0ea08b119039103baf2e`, internal evidence SHA `3625a38faa401c3771d24dd7aa4facd62a28a37493638f82cb521c1ae8780cc2`;
- new profile hashes are dark `43ebe0669e68f794fa64d755b491bcf3c9a7c5aa4d2eb0a15c183d872cb086d7`, light `0ff186ebde26b16613705f61790b15afa5068c0a54741a2c7c068412738821c0`, cop `82db4221f31a38d688eaaf1bf10191d594bbf77c5bd9b2c3a38a63f68158f362`;
- targeted verification passed: 28 TypeScript tests, 2 MJS installer tests, and `tsc --noEmit --incremental false`.

This is a local candidate result, not deployment or profile approval. The next blocker is the production-ready source buffer `6/6/6`; release freeze is intentionally deferred until current source/runtime/shadow evidence exists.
