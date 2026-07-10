# Project Kings Production Pipeline v1

Status: `implementation-in-progress / acceptance-blocked`.

This is the amended engineering contract after the mandatory First Pass Audit. Code created before the audit is provisional until it is included in one immutable release candidate and all affected gates pass. This file is not completion evidence.

## 1. Outcome

One autonomous Clips Automations pipeline executes:

`release plan -> source discovery -> policy -> Source Fit -> caption/montage -> render -> independent QA -> targeted rework -> publication -> YouTube public verification`

Pilot channels:

- Dark Joy Boy;
- THE LIGHT KINGDOM;
- COP SCOPES.

One accepted live run must create three new `public_verified` Shorts per channel. A normal daily run must not depend on the main chat, manual source or slot selection, manual preview review, state transfer between chats, or manual retry.

The deterministic orchestrator owns decisions about state, leases, budgets and retries. Models are used only for content understanding. Waiting, scheduling and polling never consume reasoning tokens.

## 2. Release identity and evidence

No shadow or live deployment may start from an unfrozen tree.

`ProductionReleaseManifest` binds:

- Git base object plus SHA-256 and size of every changed shipping file;
- an explicit shipping allow-list;
- prohibited owner/scratch paths: `AGENTS.md`, `.tmp/**`, `experiments/**`;
- schema and migration hashes;
- three profile snapshot hashes and explicit approval bindings;
- rights/policy, prompt, model-route and template hashes;
- source-buffer evidence hash;
- feature flags and shadow/live scope;
- exact test commands and raw output hashes;
- First Pass Audit and runtime-contract hashes.

Any change to a bound byte creates a new `releaseCandidateSha256`. A prior test, approval, canary, reviewer verdict or evidence packet cannot be copied to a new candidate without rerunning every affected gate.

The final `evidence-index.json` is keyed by the same release candidate hash. Missing evidence or `NOT_MEASURED` never becomes PASS.

## 3. Control-plane contracts

### ChannelProductionProfile

Each channel has an immutable, versioned profile containing:

- exact Clips and YouTube channel IDs;
- expected destination title;
- narrow `ConceptContract`, inclusions, exclusions and examples;
- approved discovery routes and fallback order;
- template ID and exact snapshot SHA-256;
- timezone, exact allowed slots and daily limit;
- quality, rights and sensitive-content policy hashes;
- separate candidate, revision, technical-retry and semantic-call budgets;
- benchmark-selected primary/fallback model routes;
- credential references, never secret values.

Frozen profile hash включает точные `qualityPolicyVersion/qualityPolicySha256`, `sourcePolicyVersion/sourcePolicySha256`, hash разрешённых source designations и hash model-route manifest. Изменение любого из этих правил создаёт новую версию профиля и инвалидирует старое approval. Канонический QA policy находится в `lib/project-kings/production-quality-policy.ts`; исполняемый quality gate использует его retry/duration defaults, а не отдельные несвязанные числа.

Instagram evidence defines the category. YouTube may validate demand or supply an explicitly allowed source for THE LIGHT KINGDOM, but cannot widen a category. A category must be a repeatable market theme with coherent audience, source, event, emotion, reason to watch and format. It cannot be one video idea or a mixture such as lighters, pyramids, Rome and nuclear tests.

### Explicit approval lifecycle

Profile lifecycle:

`draft -> shadow(scope=shadow) -> active(scope=live) -> retired`

- `prepare` creates drafts only.
- `approve` binds exact profile ID, version, profile hash, status, scope, owner identity and time.
- Shadow requires a valid shadow or live approval binding.
- Live requires a valid live approval binding.
- Legacy `approved_at` fields without the approval binding do not authorize execution.
- `start` never creates, activates or approves a profile.
- Daily runs reuse the approved profile and policy; they do not ask again.

Approval commands:

- `clips_owner_prepare_production_profiles`;
- `clips_owner_approve_production_profile`;
- `clips_owner_validate_production_profile`.

### Rights and sensitive-content policy

Rights/policy is separate from Concept Fit.

The owner approves one exact version/hash of the donor/source-route policy. Per candidate, the system then creates a hash-bound policy verdict over exact source provenance, decoded media hash and independent sensitive-content assessment. This does not require a new owner action for every daily source.

Fail-closed rules:

- dynamic discovery remains `discovery_only` until the controlled qualification path finishes;
- unknown or rejected rights evidence is `policy_blocked`;
- donor or route outside the approved policy is `policy_blocked`;
- missing, unknown or hash-drifted assessment is `policy_blocked`;
- graphic violence, unsupported allegations, minors in sensitive incidents and realistic political/public-figure deepfakes are blocked;
- a policy PASS is an internal operational gate, not a legal guarantee.

## 4. Source architecture

### Buffer

- Refill starts below 6 qualified available sources.
- Operational cap is 12.
- A run-channel may reserve at most 9 distinct candidate IDs to produce three videos.
- The counter is atomic at `production_run_channels`, not per item.
- Candidate 10 is refused even under a reservation race.
- Reposts of the same bytes or story event count once.
- Shadow release retains provenance and rotates recently used sources to the back of the pool.

### Discovery and qualification

`frozen_catalog_bootstrap_sync` only imports already-qualified frozen evidence. It is not called discovery.

The autonomous refill path is:

`CandidateProvider -> exact media bytes -> decode -> OCR/ASR -> content/event dedupe -> policy verdict -> Source Fit -> ready buffer`

Rules:

- Instagram requests are sequential per profile; channels may run in parallel.
- Public ephemeral Instagram session is allowed when it works; session cookies stay in memory and are never logged or persisted.
- Authenticated Clips/AdsPower download is an approved fallback and never exposes cookies.
- YouTube Ask is allowed only for THE LIGHT KINGDOM.
- Provider attempts are bounded; 401/403, 429 and exhaustion are classified separately.
- `NO_RESULT` or provider failure blocks only that channel and activates an already benchmarked fallback/reserve source.
- Discovery helpers cannot manufacture rights, Source Fit PASS or qualification.

## 5. Durable state and external effects

Required durable records:

- `production_profiles`;
- `production_runs`;
- `production_run_channels`;
- `production_items`;
- `channel_source_candidates`;
- `production_events`;
- `production_outbox`;
- `agent_attempts`;
- `quality_verdicts`;
- `public_verifications`;
- persistent daemon and worker leases.

Primary item path:

`reserved -> source_ingested -> source_qualified -> brief_ready -> preview_ready -> preview_approved -> final_rendered -> final_approved -> publication_scheduled -> public_verified`

Recovery/terminal states:

`rework`, `replaced`, `quarantined`, `policy_blocked`, `upload_outcome_unknown`, `cancel_requested`, `canceled`, `failed`.

Rules:

- The same profile version + logical date + mode + item slot returns the existing run/item.
- Every external side effect starts from a committed outbox intent.
- Approvals are bound to source, preview, template, settings and final hashes.
- One publication intent can bind only one upload session and one YouTube video ID.
- A timeout after upload never triggers blind re-upload. The system first reconciles the original remote identity.
- Ambiguous upload remains `upload_outcome_unknown` or quarantined; it cannot be replaced until reconciled.
- Cancellation after bytes may have reached YouTube stops future automation and reconciles. It never deletes, privates or reschedules an existing video without a separate owner instruction.
- Disabling v1 fences new intents, drains or quarantines existing outbox work and does not delete durable records.

## 6. Runtime topology

Render is the durable control plane. Zoro is the execution plane.

```text
Render/Clips DB + deterministic orchestrator
  -> production_outbox
  -> Stage3 durable jobs
      -> Zoro Semantic Worker (Source Fit/Caption/Montage/Vision QA, max 3)
      -> Zoro Render Worker (preview/final, max 1)
  -> publication worker (max 2 global, max 1/channel)
  -> public verifier
```

Semantic jobs use a dedicated `production-semantic` type. A typed packet contains content-addressed artifact references, never server-local absolute paths or main-chat history. The worker downloads only inputs for the exact leased job, verifies size/SHA-256 and returns a hash-bound structured result. Only Clips validates the result, records attempts/verdicts and transitions production state.

One role equals one job. Caption and Montage Planner remain separate for route selection, retry and telemetry.

Authoritative concurrency is durable:

- Stage3 transactional claim limits running semantic jobs to 3;
- render claim limits preview/final work to 1 per render worker;
- production outbox claim limits publication to 2 global/1 channel and source ingest to 1 channel;
- process-local `globalThis` semaphores may wake work but never prove a global limit.

Worker crash recovery:

- lease expiry requeues the same job;
- stable `invocationKey` and Stage3 dedupe key reuse a completed structured result;
- local atomic result spool prevents a second model call if completion HTTP fails;
- lease loss aborts the model process and is checked again before telemetry, verdict or transition;
- worker advertises semantic capability only after binary, login, runtime and frozen-manifest preflight.

If local Codex login is unavailable, only a separately implemented, benchmarked and approved provider route may be used. Credentials or OAuth sessions are never sent inside a job packet.

## 7. Models and benchmarking

For every semantic role, the frozen benchmark:

1. Uses the same typed schema and representative channel cases.
2. Requires at least 30 independently scored cases per route/reasoning combination before production selection.
3. Rejects schema failures, critical quality errors and insufficient visual capability.
4. Rejects a route whose measured p95 exceeds the stage SLA.
5. Selects the cheapest passing route; at cost difference below 10%, selects the faster route.
6. Selects the minimum passing reasoning level.
7. Freezes a second passing route as fallback.

Three-case route smoke tests prove connectivity only and are labeled `framework_only`. A role that inspects pixels has `requiresVision: true`. Documentation names a model only if it was actually available and won the frozen benchmark.

## 8. Quality gates and recovery

Mandatory gates:

- full source and final MP4 decode;
- exact concept and factual fit;
- content/event dedupe;
- visible `hook -> action -> payoff`;
- no donor UI, CTA, handle, watermark or foreign captions in the final crop;
- caption length, factual and banned-word rules;
- decisive action remains visible after crop;
- exact channel/template identity;
- codec, resolution, duration, audio and flash probes;
- independent Vision QA on preview and final frames;
- deterministic/vision disagreement is FAIL;
- `public_verified` requires matching Clips state, RSS and playable exact Shorts page.

Recovery:

- network/429/5xx: up to 3 attempts with backoff+jitter;
- source provider: 2 attempts, frozen fallback, then reserve source;
- text: deterministic repair, 1 targeted regeneration, then replacement;
- visual defect: 3 targeted revisions, absolute maximum 5, then replacement;
- completed MP4 handoff error: durable outbox, no rerender;
- model failure: frozen fallback only;
- OAuth, rights, policy ambiguity or source exhaustion blocks only the item/channel.

Credentials and quality thresholds never change automatically.

## 9. Publication and canary policy

Live default is `first_item_per_channel_public_verified`:

- one explicit item per channel is the canary;
- three canaries may progress in parallel;
- only after a channel's own canary passes Clips + RSS + exact playable page do that channel's remaining two items release;
- one channel cannot release another channel's items;
- `canaryPolicy=none` is not used for v1 acceptance and remains fenced off from normal live execution.

Slots, timezone, daily limit and collision checks come from the exact approved profile. A scheduled/private/unplayable item is not published. More than five minutes to public verification records an external SLO miss and keeps reconciliation active; it fails the pilot's five-minute acceptance metric rather than inventing success.

## 10. Atomic delivery phases

### Phase 0 — Stop line and candidate freeze

- Task: establish the exact audited candidate and baseline.
- Implementation: repair critical fixtures, capture publications/config, run First Pass Audit, create release manifest.
- Test: environment proof, three sequential skeptics, opposite-model review, hashes and dirty-path policy.
- Rollback: evidence-only; feature flags remain off.

### Phase 1 — Approve control contracts

- Task: freeze profiles, rights, slots, cancellation and model policies.
- Implementation: prepare/approve lifecycle and versioned policy artifacts.
- Test: start rejects draft, legacy implicit approval, hash/version drift and rights ambiguity.
- Rollback: retire or revert to the prior approved profile version; never mutate one in place.

### Phase 2 — Correct the execution safety spine

- Task: durable state, budgets, leases, outbox and worker ownership.
- Implementation: aggregate candidate cap, per-channel canaries, semantic jobs, content-addressed inputs, durable claim limits and legacy/v1 fence.
- Test: candidate 9/10 race, result-only reuse, lease loss abort, crash/restart, stale bindings and mutual exclusion.
- Rollback: disable enqueue, fence workers and preserve queued jobs/data.

### Phase 3 — Prove one real no-publication vertical

- Task: one real source reaches `final_approved` without YouTube upload.
- Implementation: real discovery/download, OCR/ASR, policy, Source Fit, caption, montage, preview, independent QA, rework and final render.
- Test: immutable artifact chain, no manual state edits, exact hashes and full media probes.
- Rollback: stop dispatch; release shadow reservation with provenance retained.

### Phase 4 — Prove portfolio isolation and source capacity

- Task: run all three channel profiles in shadow and prove refill/exhaustion behavior.
- Implementation: one item per channel, induced one-channel blocker, restart, recovery, source rotation and bounded dynamic refill.
- Test: unaffected channels complete; exhausted/fallback paths are classified; buffer and attempt caps hold.
- Rollback: disarm refiller/dispatcher; keep discoveries as non-qualified evidence.

### Phase 5 — Authorize quality gate

- Task: prove independent QA on a frozen 120-case corpus.
- Implementation: 40 clean + 80 defective final artifacts, two blind annotations, adjudication and three judge runs.
- Test: 100% critical recall, >=95% all-defect recall, >=90% clean PASS precision, >=90% clean acceptance and zero critical false-pass in all three runs.
- Rollback: freeze launch as blocked; never lower a threshold.

### Phase 6 — Rehearse migration and persistent shadow deployment

- Task: prove the exact migration/runtime on production-shaped state.
- Implementation: isolated production snapshot, restore/forward rehearsal, exact candidate deploy, Zoro workers in shadow, watchdog and kill switch.
- Test: row/index/FK/integrity comparison, idempotent migration, lease takeover, reboot, disk pressure, credential redaction and post-stop zero intents.
- Rollback: kill switch + flags off; restore original snapshot/config; no record deletion.

### Phase 7 — Adapter replays and controlled live 3x3

- Task: prove failure recovery and create nine new public videos.
- Implementation: three adapter-boundary replays, then one run with one canary per channel and six gated remaining items.
- Test: exact nine public chains, no duplicates/critical defects, safe restart and complete metrics.
- Rollback: stop future intents and reconcile anything that may have reached YouTube; no automatic deletion/private mutation.

### Phase 8 — Independent closure and Workspace map

- Task: challenge the accepted evidence and make the system understandable.
- Implementation: freeze evidence packet; run Blind Spot Auditor and Improvement Reviewer independently; remediate; then create the Workspace component.
- Test: no open P0/P1, both reviewers bound to the same packet hash, Workspace API readback and SuperApp visual verification.
- Rollback: any P0/P1 returns acceptance to blocked; remove only the unaccepted new Workspace component, never alter `Автоматизация`.

## 11. Automated and live acceptance

Automated suites cover:

- transitions, dedupe, idempotency, hash invalidation, budgets, leases, outbox and fallback;
- category separation and repost/event collapse;
- corrupt mux, flash, wrong template, lost audio and wrong resolution;
- CTA, watermark, lost action, banned word and unsupported fact;
- worker crash, restart, 429/502, disk full and interrupted upload;
- scheduled but private/unplayable publication;
- result-only semantic reuse and stale worker/input/result bindings.

Three required replays use real adapter boundaries:

1. July 9 media/process replay with external publication disabled.
2. Restart, 429/502, worker loss, outbox and upload-resume faults.
3. Duplicate/category/crop/stale-approval and automatic replacement faults.

The live 3x3 acceptance requires:

- 9/9 exact Shorts in `public_verified`;
- 3 per named channel;
- zero duplicate publication or story event;
- zero critical content/media defect;
- one channel failure does not stop the others;
- restart continues the same run;
- ready buffer -> 9 QA-approved/scheduled: p50 <=45 minutes and nearest-rank p95-of-9 <=60 minutes;
- each publication verified <=5 minutes after slot;
- mean visual revisions <=1.5;
- technical retries / 9 <0.3;
- prepared-source rerender cache hits / eligible rerenders >=80%;
- all primary, failed and fallback semantic calls / public videos <=8;
- measured LLM tokens / public video at least 50% below a raw July 9 baseline;
- if July 9 raw tokens cannot be reconstructed, this metric is `NOT_MEASURED` and blocks full acceptance;
- 100% of stages record role, route, model, reasoning, timestamps, duration, tokens, cost, attempts, outcome and error class.

The timing clock starts at durable `production.run.started`. The creation clock stops when all nine items are `publication_scheduled`; slot waiting is reported separately. Public-verification latency starts at the scheduled slot and stops at the first valid three-surface proof.

## 12. Final evidence and reviewers

The frozen packet contains at minimum:

- release manifest;
- owner/profile/policy approvals;
- migration rehearsal;
- real vertical and three-channel shadow runs;
- refill exhaustion/fallback evidence;
- 120-case corpus, annotations, adjudication and three raw eval runs;
- deployment/worker/watchdog evidence;
- three replay packets;
- candidate-budget race evidence;
- live 3x3 per-item chains;
- acceptance matrix with formulas/raw values;
- rollback/kill-switch evidence.

Blind Spot Auditor and Improvement Reviewer receive that same packet, no author reasoning and no peer output. Any P0/P1 blocks completion. A fix creates a new packet and reruns affected tests, all three replays, both reviewers and a new limited live canary when external publication behavior changed.

Only then may the component `Shorts Production Pipeline — исходник → публикация` be created in `TOP 10k \\ от первых принципов`. `Автоматизация` remains unchanged. Every stage passport shows what happens, input/output, function/agent/worker, actual model/reasoning, parallelism, measured p50/p95, PASS, retries, next stage and evidence/code/run links. API readback and visual SuperApp inspection must show a readable graph with no dangling or duplicate edges.
