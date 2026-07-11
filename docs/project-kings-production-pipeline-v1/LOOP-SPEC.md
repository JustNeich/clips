# Project Kings recurring pipeline — MVP loop contract

Version: `project-kings-mvp-loop-v1`

Status: `plan-ready / execution-acceptance-blocked`

Current autonomy: `L3 Isolated`
Target autonomy: `L5 Governed autonomous`, reached only through the promotion gate below

## 1. Outcome and acceptance

The product outcome is ongoing automatic management of Dark Joy Boy, THE LIGHT KINGDOM, and COP SCOPES—not merely a successful test run.

The first public proof is accepted only when:

1. one controlled live run creates exactly three new Shorts for each named channel;
2. all nine reach durable state `public_verified`;
3. each video is public, playable, on the expected stable YouTube channel ID, and linked to one unique publication intent;
4. there are no duplicate story events, duplicate uploads, unresolved upload identities, or policy/quality bypasses;
5. the run ledger points to the exact release candidate, profile versions, source hashes, verdicts, publication IDs, YouTube IDs, and verification evidence;
6. rollback and the global kill switch remain usable;
7. after the real QA and recurring-refill gates pass, the owner separately approves L5 promotion and the next scheduled logical day is observed starting without chat or a new per-day approval.

`Готово=` the three channels have one verified live `3x3`, the owner has separately approved the hash-bound L5 promotion, and the first scheduled unattended wake has been observed entering normal durable processing without chat context, manual selection, or unsafe extra effects. A safe blocked wake proves fail-closed behavior but does not complete the task until its cause is fixed and a later scheduled wake starts normally.

## 2. Trigger, scope, and stop states

Trigger: one persistent Zoro portfolio daemon evaluates the configured Project Kings logical day and publication slots in `Europe/Moscow`. It may wake repeatedly, but the portfolio-run identity binds the workspace, sorted stable Clips profile IDs, profile versions/hashes, logical date, mode, canary policy, and daemon config hash. Item uniqueness additionally binds the stable YouTube channel ID, Clips profile ID/version, run, and item slot.

Daily scope:

- 3 channels;
- target 3 accepted items per channel;
- ready source buffer minimum 6 and cap 12 per channel;
- maximum 9 distinct candidate reservations per channel/run;
- semantic concurrency 3 globally;
- render concurrency 1 per render worker;
- publication concurrency 2 globally and 1 per channel.

Time and partial-result rules:

- the logical date is captured when the run is created and does not roll over until that run reaches a terminal state;
- no next logical-day run starts while the prior live run is incomplete, quarantined, or `8/9`;
- public verification targets five minutes after a slot but has a hard deadline of 24 hours per publication intent;
- delayed YouTube processing waits and rechecks the original remote identity until the deadline;
- `8/9` is not success: known-safe failures may use only the same run's remaining bounded retry/replacement budget, while an ambiguous upload is reconciled and never blindly replaced or re-uploaded;
- after the hard deadline the unresolved item/run is quarantined or blocked, unattended recurrence stays off, and the ledger records the exact next action.

Normal stop states:

- `completed`: all required items are `public_verified`;
- `waiting_for_slot`: outputs are approved and safely scheduled;
- `waiting_for_retry`: a bounded retry has a durable next-attempt time;
- `channel_blocked`: one channel exhausted its approved sources or a gate, while other channels may finish;
- `acceptance_blocked`: a release or promotion gate is missing;
- `quarantined`: ambiguous upload, policy uncertainty, hash drift, or untrusted result;
- `stopped_by_kill_switch`: no new external intents may be created.

No infinite polling, unbounded candidate search, hidden retry, or reasoning-token wait is allowed.

## 3. One work-item loop

Deterministic maker path:

`reserve qualified source -> ingest exact bytes -> Source Fit -> brief -> caption -> montage plan -> preview render -> Vision QA -> targeted rework if allowed -> final render -> independent final QA -> publication intent -> upload/schedule -> public verification`

Durable item path:

`reserved -> source_ingested -> source_qualified -> brief_ready -> preview_ready -> preview_approved -> final_rendered -> final_approved -> publication_scheduled -> public_verified`

Checker rules:

- source policy and Source Fit are independent fail-closed gates;
- the checker receives typed artifacts and exact hashes, not maker reasoning or chat history;
- policy, concept fit, duplicate detection, technical QA, visual QA, and public verification must each produce a durable result;
- only deterministic orchestrator code changes state or creates an external-effect intent;
- a model result cannot approve itself and cannot write directly to publication state.

Retry rules stay bounded by the approved profile and canonical quality policy. Infrastructure errors may retry with the same idempotency key. Content failures may use only the explicitly allowed rework budget or replace the source within the nine-candidate cap. A timeout after upload triggers reconciliation, never blind re-upload.

## 4. Release and evidence model

Use two layers:

1. **Runtime release candidate** — immutable Git/code/config/schema/migration/profile-template/route-policy identity. It contains only bytes needed to decide what will execute.
2. **Acceptance and run index** — append-only evidence keyed by the runtime candidate: tests, audit verdicts, migration rehearsal, profile approvals, buffer readiness, preflight, shadow, canary, live results, public verification, rollback, and promotion.

Acceptance evidence never changes the runtime candidate hash. A runtime-byte change creates a new candidate and invalidates only the affected acceptance gates. Historical failed evidence remains append-only and clearly classified.

### Immutable gate manifest

One candidate-bound `MvpGateManifest` stores the exact artifact path, SHA-256, threshold inputs, result, checked time, freshness rule, and invalidation reasons for every gate. The daemon validates its applicable record and the current hashes on every wake; missing, expired, or drifted evidence is fail-closed.

| Gate | Exact PASS rule | Freshness | Invalidated by |
| --- | --- | --- | --- |
| coherent runtime | no production v2 binding; profile, loader, installer, runner and config resolve one v4 ID/schema/SHA | candidate-bound | any bound runtime/config/profile byte |
| launch buffer | qualification-v2 readiness is `6/6/6` after shadow accounting; zero duplicate event IDs | recounted within 24h before Approval A | reservation/use/quarantine or profile/policy/source hash drift |
| runtime preflight | deployed schema/config hashes match; Zoro worker command proves exact Node, Codex and Luna capability; credentials/channel IDs validate read-only | within 2h of Approval A; repeated before Approval B if changed | deploy, worker/config/credential/channel drift |
| real shadow | one `final_approved` no-publication artifact per channel, independent QA, restart/lease/isolation/kill-switch PASS | exact candidate and profiles | candidate/profile/policy/template/worker change |
| fault replays | all three PASS: July-9 media/process with effects disabled; restart+429/502+worker/outbox/upload recovery; duplicate+category+crop+stale-approval+replacement | candidate-bound | affected adapter/state/retry code change |
| Vision QA | frozen 120 unique cases (40 clean, 80 defective), three blind runs; each has 100% critical recall, >=95% all-defect recall, >=90% clean-PASS precision, and zero critical false-pass | candidate/route/prompt/corpus-bound | judge route/prompt/schema/taxonomy/corpus change |
| recurring refill | one below-minimum channel reaches at least 6 qualification-v2 sources within cap/budgets, with no duplicate/policy bypass/publication | exact refiller/provider/policy config; current provider preflight within 2h | refiller/provider/qualification/policy/config drift |
| rollback/kill switch | new intents stop, existing effects reconcile, unrelated production writes survive; restart uses the same durable run | exercised on deployed candidate within 24h before each approval | deploy/schema/outbox/daemon config change |
| controlled live | exact Approval A run reaches `3/3` canaries, then `9/9 public_verified`; zero ambiguous/duplicate/bypass effects | exact logical date and approval expiry | any bound hash/slot/channel change |
| unattended wake | after Approval B, the first scheduled wake validates promotion and enters normal durable processing without manual input | first next configured logical day | any bound hash, expired promotion, or kill switch |

## 5. Human checkpoints and machine records

Before L5, explicit owner approval is required for:

- mutating Node/Codex/runtime services on Zoro;
- deploying the new runtime/database schema to Render;
- approving exact profile, source-policy, quality-policy, route, and template hashes for shadow or live scope;
- enabling the first controlled live `3x3` (**Approval A**);
- after `9/9 public_verified` and all full L5 evidence exists, promoting the system from controlled live operation to unattended L5 (**Approval B**).

`LiveApprovalRecord` (Approval A) binds the runtime candidate, exact profile/policy/route/template hashes, the three stable Clips and YouTube channel IDs, logical date, nine slots, daemon config hash, expiry, and the automatic `1x3 -> 2x3` effect caps.

`L5PromotionRecord` (Approval B) binds the same identities plus exact Vision-QA, refill, fault-replay, rollback/kill-switch, and successful live-`3x3` evidence hashes. Approval A never implies Approval B. Neither record is inferred from a chat message or from `9/9`; it is an explicit durable owner action.

After L5 promotion, no per-source, per-video, or per-day approval is required when all hashes, profiles, limits, policies, and gates remain unchanged. Any drift, new channel, new policy, new template, new route, credential change, ambiguous upload, or kill switch returns the loop to a blocked approval state.

### Executable mode/effect matrix

The old release-manifest booleans are descriptive only until Phase 0 maps them to executable daemon/server settings. Runtime authorization uses this exact matrix:

| Mode | Zoro daemon | Server flags | Required record | Maximum publication effect |
| --- | --- | --- | --- | --- |
| disabled/predeploy | `ARMED=0` | `V1=0`, `POST_CANARY=0` | none | 0 |
| shadow | `ARMED=1`, `MODE=shadow`, `CANARY=none` | `V1=0`, `POST_CANARY=0` | exact shadow profile approvals | 0 |
| controlled live | `ARMED=1`, `MODE=live`, `CANARY=first_item_per_channel_public_verified` | `V1=1`, `POST_CANARY=0` | unexpired Approval A | first 3 total (one/channel); only after all three are `public_verified`, remaining 6 |
| unattended L5 | `ARMED=1`, `MODE=live`, `CANARY=first_item_per_channel_public_verified` | `V1=1`, `POST_CANARY=0` | unexpired Approval B plus unchanged approved profiles/policies | every day uses the same automatic 3-then-6 canary; no manual checkpoint |

For the actual environment the abbreviated flags above mean `PORTFOLIO_PIPELINE_V1_ENABLED` and `PORTFOLIO_PIPELINE_POST_CANARY_ENABLED`. Skipping the daily automatic canary is not part of this MVP.

`POST_CANARY_ENABLED=0` disables the separate no-canary/bypass mode; it does **not** prevent the six post-canary items in a `first_item_per_channel_public_verified` run. The current orchestrator releases those six only after all three channel canaries are `public_verified`.

## 6. Minimal launch phases

### Phase 0 — make the candidate coherent

Task: produce one internally compatible runtime candidate.

Implementation:

- Replace v2 route bindings with v4 across runtime, profiles, installers, defaults, runners, and tests.
- Regenerate the profile snapshot and verify loader/installer schema compatibility.
- Introduce the two-layer release/evidence identity.
- Implement/verify `MvpGateManifest`, `LiveApprovalRecord`, and `L5PromotionRecord` enforcement at daemon wake and external-intent creation.
- Run only affected unit/integration tests, typecheck, and manifest compatibility checks.

Test: one coherent candidate hash; no legacy production binding; the compatibility suite proves profile, loader, installer, runner and config use the same v4 ID/schema/SHA; audit can trace every executable contract.

Rollback: revert the candidate commit; production flags remain off.

### Phase 1 — build the minimum real source buffer

Task: create only the launch-sized qualified source reserve.

Implementation:

- Reuse saved exact media bytes.
- Run current qualification-v2 over six unique, policy-approved, concept-fit sources per channel.
- Bind provenance, decoded media SHA, content/event dedupe, policy verdict, and Source Fit verdict.
- Do not schedule autonomous discovery yet.

Test: `6/6/6` qualification-v2 available sources, zero duplicate story events, exact provenance/media hashes, and a current readiness record.

Rollback: quarantine only the invalid candidates; source bytes remain preserved.

### Phase 2 — prepare execution planes with live effects disabled

Task: make Render and Zoro shadow-ready without permitting publication.

Implementation:

- Refresh Zoro and Render truth.
- Pin compatible Node and Codex CLI; verify Luna by the actual worker command.
- Rehearse the exact migration candidate again if its bytes changed.
- Deploy with the executable shadow row from the mode/effect matrix.
- Prepare new profiles and approve shadow scope only.

Test: current preflight is green, services report exact versions/capabilities, the migration is compatible/idempotent, and an attempted live publication intent is rejected.

Rollback: disable services/flags and roll forward or remove only the newly introduced behavior. Database work uses expand/contract migrations so the prior application stays compatible and unrelated concurrent writes survive. Restoring a full snapshot is a separately approved disaster operation only after writes are quiesced and accounted for; it is not the normal rollback.

### Phase 3 — one real shadow item per channel

Task: prove one real no-publication vertical on each channel.

Implementation:

- Process one qualified source per channel through real semantic workers and real render.
- Prove channel isolation, lease expiry/restart recovery, result hash verification, and no-publication boundary.
- Inspect the three final outputs and record independent QA.

Test: three real `final_approved` shadow outputs, one per channel; restart/lease/isolation assertions PASS; no publication intent, upload session or YouTube identity exists.

Rollback: kill switch, drain/quarantine outbox, retain artifacts for diagnosis.

### Phase 4 — pre-live gate, Approval A, and controlled `3x3`

Task: produce the first bounded public `3x3` without authorizing recurrence.

Implementation:

- Recount the live-eligible buffer after shadow: `6/6/6` is required immediately before approval. A shadow artifact may be promoted without regeneration only when every source/profile/route/policy/template/render hash is unchanged and independent QA is repeated; otherwise its consumed source is excluded from readiness.
- Pass the pre-live rows of `MvpGateManifest`: coherent runtime, launch buffer, current preflight, real shadow, upload-ambiguity test, and rollback/kill switch.
- Present the exact Approval A action packet and create an expiring `LiveApprovalRecord` only after the owner confirms it.
- Run automatic canaries: one publication per channel. Only after all three are `public_verified` may the same run release the remaining two per channel. There is no item-by-item manual review.
- Verify all nine through owner-side state and public YouTube evidence. Keep the logical date fixed and apply the 24-hour rules above.

Test: `3/3` canaries are public-verified before the remaining six are released; final result is `9/9 public_verified`, exactly three per channel, no ambiguous/duplicate/bypass effect, and unattended recurrence remains disabled.

Rollback: disarm new intents immediately; reconcile already-started uploads; never silently delete, private, reschedule, replace, or re-upload an ambiguous public effect.

### Phase 5 — full L5 gate and Approval B

Task: authorize unattended recurrence only from complete post-live evidence.

Implementation:

- Complete the frozen 120-case real Vision QA gate.
- Pass the three exact adapter-boundary/fault replays.
- Connect the autonomous qualification-v2 refiller to the daemon and prove one bounded below-minimum-to-ready cycle without publication.
- Refresh rollback/kill-switch evidence and close all P0/P1 audit concerns.
- Build an exact L5 packet. Only a new explicit owner action creates `L5PromotionRecord`; successful Approval A or `9/9` cannot create it automatically.

Test: all full-L5 manifest rows PASS, the daemon rejects a missing/drifted/expired promotion, and accepts the exact unexpired Approval B. Daily automatic `1x3 -> 2x3` is authorized only while all hashes stay exact.

Rollback: remain at controlled L4; no unattended daily start.

### Phase 6 — observe the first unattended wake

Task: prove recurrence from the real schedule rather than a chat-triggered dry run.

Implementation:

- Leave the daemon on the configured schedule; do not trigger it from chat.
- On the first next logical day, prove it validates Approval B and all hashes, creates/reuses exactly one run, and enters normal durable processing.
- Record success or the exact safe stop. A safe stop triggers repair and another scheduled observation; it does not silently broaden authority.

Test: one observed scheduled wake validates Approval B, creates/reuses exactly one logical-day run, and enters normal processing without manual input or unsafe extra effects.

Rollback: kill switch/disarm stops new intents; reconcile existing effects and retain the run ledger.

## 7. Tests that matter for the first release

Required before shadow:

- route/profile/installer compatibility test;
- typecheck and changed critical suite;
- migration rehearsal for the exact candidate;
- deterministic state/outbox/retry/lease tests;
- qualification-v2 readiness verifier;
- no-publication boundary test.

Required before live:

- one real shadow item per channel;
- channel-isolation and kill-switch test;
- upload ambiguity/reconciliation fault test;
- current owner-side channel/profile/credential preflight;
- independent QA of exact outputs.

Required before unattended L5:

- real 120-case Vision QA gate;
- bounded recurring refiller proof;
- successful controlled live `3x3`;
- separate explicit Approval B bound to all L5 evidence;
- observed first next-day scheduled daemon wake, not a manually invoked dry run;
- no unresolved P0/P1 First Pass Audit concern.

Broader benchmarks, all historical-evidence re-freezing, 30-channel generalization, cost optimization, and second-provider fallback are explicitly post-MVP.

## 8. Minimum run ledger

Every build, rehearsal, shadow, canary, live, and promotion attempt appends one immutable record containing:

- `run_id`, `loop_version`, `mode`, `trigger_ref`, and `work_item_ref`;
- release candidate Git SHA and runtime candidate SHA;
- exact profile IDs, versions, hashes, channel IDs, logical date, and slots;
- start/finish timestamps and attempt number;
- maker artifact references and checker verdict references;
- source provenance and exact media/content/event hashes;
- side effects and remote identities;
- retries, replacements, blocks, and quarantine reasons;
- stop state, rollback/kill-switch result, and exact next action;
- for live, public URLs/YouTube IDs and the owner-side plus public verification references.

The initial handoff record lives at `evidence/mvp-run-ledger.jsonl`.

## 9. Non-goals until the first L5 cycle

- supporting 30 channels;
- redesigning the whole Clips application;
- rerunning all model benchmarks;
- optimizing token cost or p95 before measuring one real vertical;
- introducing another model provider;
- pruning historical evidence;
- automating broad source discovery before the 18-source launch buffer exists;
- adding dashboards that do not change a launch decision.

## 10. Current exact next action

Align the v4 model-route contract everywhere and prove the regenerated profile snapshot and worker installer consume the same manifest. This is the only implementation step authorized by this planning handoff; production mutation and publication remain separately approval-gated.
