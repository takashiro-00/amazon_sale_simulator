# Step 4 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Each task follows test → observed failure → implementation → passing verification. Execute in this session without delegation.

**Goal:** Implement R10–R21B and the account simulation requested in the Step 4 brief.

**Architecture:** Keep rules pure and let the engine validate proposals through G6. A runner-owned executor performs port writes and commits acknowledged effects; harvest verification is a separate persisted phase. Keep the campaign-only entry point and its existing golden expectations.

**Tech Stack:** Existing TypeScript, Vitest, Luxon; no dependencies added.

**Spec:** `../../docs/simulator/spec-v3.1.md`, `../../docs/simulator/00-roadmap-and-edge-cases.md`, and the user's Step 4 brief (its explicit refinements control).

## Global Constraints

- Only edit `simulator/`; preserve unrelated work.
- Rules read `RuleContext` and return `Proposal | null`; never call ports or mutate inputs.
- All base changes, including new targets, go through G6; no direct outbound bid writes.
- Use G1 N2/N3/N2h/N17; configurable `r10r11Clicks=15`, `hourlyClicks=40`.
- PT calendar windows end D-2; bitemporal reads use the run's asOf.
- Existing tests, including campaign goldens, retain expectations.
- Every ambiguous choice gets an ambiguity flag and a `// SPEC-AMBIGUITY:` comment at use.
- If full-account smoke expectations fail, stop and report measurements; do not tune rules to pass.

## Review Focus

1. Rolling target windows must survive target and campaign resets; current `resolveWindow` clips even rolling windows at memory start.
2. Cent rounding and low hourly factors must preserve both the $0.20 floor and ToS cap across all 24 hours.
3. API partial success or invisible creation must never authorize a source negative before a positive list read.
4. UTC instants identify hourly writes through both repeated 01:00 hours on 2026-11-01.
5. A campaign decision must suppress the entire target group before its cooldown gate hides cross-level skip auditing.

## Baseline

2026-10-20: `npm run typecheck` passed; `npm test` passed 15 files / 182 tests. Registry R10–R21B evaluators are stubs. `runCampaignLoop` executes campaign rules only, forces EXACT, and constructs its faulty port with faults disabled.

## Task 1 — Engine, state and safety contract

**Modify:** `config/defaults.ts`, `src/engine/{types,priority}.ts`, `src/audit/log.ts`, `src/guards/bid.ts`, `src/domain/state.ts`, `src/scenario/schema.ts`.
**Create:** `src/invariants/target.ts`, `test/step4-engine.test.ts`.

**Interfaces:** Extend EngineState with campaign negatives and pending harvests; add harvest provenance/verification metadata so the safety invariant can check a committed negative. Preserve existing fixtures by supplying defaults at the account boundary. Add `SKIPPED_CROSS_LEVEL`, pause/timeout notifications, config thresholds and weekday.

- [x] Write and run failing tests: ToS-only changes leave all bases untouched; max-24h factor constrains a base increase; a new target is clamped with oldBase=proposedBase and initial anchor; status PAUSE is allowed, direct bid writes rejected.
- [x] Test campaign-first suppression of every TARGET rule and error-policy conflict independently of cooldown. Existing error-detection tests explicitly select error policy where their premise requires it.
- [x] Implement those contracts. Remove target-first and default to campaign-first. A new target resolves product thresholds from its destination campaign.
- [x] Add invariant tests for outbound floor/max/ToS, unique base writes per target/run, tag factor [.70,1], waste/R14, paused hourly updates, normalized duplicates and unverified harvest negatives.
- [x] Implement invariant checks using actual cent-rounded submissions and run focused tests plus the existing engine/guard suite.

## Task 2 — Windows and target rules

**Modify:** `src/data/{windows,metrics}.ts`, `src/rules/registry.ts`.
**Create:** `src/rules/target/{shared,r10,r11,r12,r13,r14}.ts`, `test/target.test.ts`.

**Interfaces:** Generalize metrics aggregation without double counting daily/hourly/placement facts. Rolling target rules call resolveWindow with the target's creation origin, while post rules use its own windowStartAt. R13's additional-click interval starts on the PT date of r12LastAt.

- [x] Write failing table tests for each rule's match, threshold-minus-one, tag/status, cooldown, flags and no-op boundary; assert proposals do not mutate context or write engine timestamps.
- [x] Implement R13 > R12 > R11 > R10 > R14 using G1 thresholds, robust zero checks and the specified floor. Test infinite ACoS at R11.
- [x] Test R14 count reset after flag expiry with `ambiguity.r14CountResetAfterFlag=true`; do not reset it by mutating state during evaluation of a null proposal.
- [x] Run target tests and all previous tests; verify a reset does not truncate R10/R13/R14 calendar data.

## Task 3 — Placement rules

**Create:** `src/rules/placement/{shared,r18,r19}.ts`, `test/placement.test.ts`.
**Modify:** metrics and registry.

**Interfaces:** Placement metrics filter campaign TOP/REST facts inside a resolved placement-post window. Rejected rules expose diagnostics through pure returned evaluation data consumed by the engine, never audit mutation inside evaluate; retain public Proposal|null evaluation contract.

- [x] Test post14/min7 anchored to placement lastChangeAt or campaign createdAt, R19 priority, cooldown and 0/100 no-ops.
- [x] Test R18 uses campaign CVR only if REST clicks <30; REST CVR=0 with ≥30 clicks uses the literal multiplication comparison.
- [x] Test R18 returns null with audit TOS_CAP if any enabled target's maximum hourly bid breaks the proposed cap; paused targets do not veto. R19 decrease always allowed; infinite ACoS eligible.
- [x] Implement with `ambiguity.placementWindow='post14-min7'`; verify bases unchanged and route placement writes exclusively to updatePlacement.

## Task 4 — Search rules and two-phase harvest executor

**Create:** `src/rules/searchTerm/{shared,r15,r16,r17}.ts`, `src/runner/harvest.ts`, `test/search-term.test.ts`, `test/harvest.test.ts`.
**Modify:** engine proposal effects/types, scenario matchType/destination validation and registry.

**Interfaces:** Search ref identifies source campaign, source target and normalized query; fact key is `${targetId}:search:${query}`. R15 proposes creation; executor acknowledges createKeywords before recording pending state, then listKeywords verifies the exact keyword ID before source createNegatives. Retry pending verification every daily run independently of Sunday.

- [x] Test PHRASE/BROAD/AUTO eligibility, Sunday PT, ≥2 orders, CPC clamping, disabled existing exact deduplication, destination fallback and NO_DESTINATION.
- [x] Test R16/R17 thresholds and robust zeros, normalized negative deduplication, same-ASIN enabled Exact exception with EXACT_KEYWORD_EXISTS.
- [x] Test create failure produces no pending/negative; invisible creation stays pending; visibility adds exactly one negative; >7-day timeout emits R15_VERIFY_TIMEOUT with no negative.
- [x] Implement pure rules and executor; use successful per-item results, stable idempotency keys and persisted verification evidence. Run tests against real FaultyFakePort.

## Task 5 — Weekly analysis and hourly submission

**Create:** `src/rules/hourly/{analysis,r20,r21,r21b}.ts`, `test/hourly.test.ts`.
**Modify:** registry and runner support.

**Interfaces:** Weekly analysis returns only hourlyFactor memory proposals. R21B computes desired cent-rounded bids; executor groups changed targets into one call per endpoint and tracks acknowledged outbound bids by UTC boundary. It never changes base/cooldown/window.

- [x] Test 28-day D-2 window, configured weekday (Monday default), campaign and target scope, 40-click boundaries, R20 priority per hour and neutral factor reset.
- [x] Test R20 max(.70,.20/base), R21 product and ToS caps including rounding, non-NORMAL boost suppression and paused exclusion.
- [x] Test unchanged boundaries call nothing, mixed endpoints each call once, weekly analysis makes no API write, and both DST repeated-hour instants execute once.
- [x] Implement `ambiguity.hourlyScope='campaign'`; verify hourly invariant after each acknowledged batch.

## Task 6 — Market and deterministic scripts

**Modify:** `src/market/{driver,model,scripted}.ts`, scenario schema.
**Create:** `test/account-market.test.ts`.

**Interfaces:** EntityView contains dynamically created targets with source/term truth provenance and campaign negatives. Runtime truth lookup supports created IDs without changing original scenario truth. ScriptedDay gains optional per-target, placement, query and hourly distributions, retaining old fallback.

- [x] Test inferred harvested truth equals source CVR×term multiplier, source CTR/auction parameters and impressions×term weight/total weight.
- [x] Test normalized campaign negative removes the query from every target and scales impressions by retained weight rather than redistributing the removed share; all-negative campaigns produce zero traffic.
- [x] Test script totals conserve metrics across target/placement/query/hour dimensions on 23/24/25-hour days; old campaign script goldens remain unchanged.
- [x] Implement and run market/reporting/script tests.

## Task 7 — Account loop and integration goldens

**Modify:** `src/runner/campaignLoop.ts`; add focused executor modules if needed.
**Create:** `test/account-loop.test.ts`, `test/target-golden.test.ts`, `test/account-edges.test.ts`.

**Interfaces:** Export runAccountLoop(options), keeping runCampaignLoop campaign-only. Account daily order: manual/R01 → budget history → R09 tracker → CAMPAIGN → PLACEMENT → TARGET → pending verification → SEARCHTERM → weekly analysis. Every UTC hour executes R21B before market using acknowledged outbound state.

- [x] Write failing integration tests for complete daily order and port fault configuration from scenario/eventContext; never publish a failed write as acknowledged market state.
- [x] Golden zero-order target: use $30/BE40%, initial $.80; days 0–3 each have five clicks/$2.80, day 4 has zero, day 5 has ten clicks/$5.60. At day 5, D-2 includes days 0–3: 20 clicks/$11.20 → R12 $.64. At day 6, D-2 includes day 4: still 20 clicks. At day 7, D-2 includes day 5: 30 clicks/$16.80, including ten clicks on r12LastAt's day → R13 PAUSED despite bid cooldown. All target orders are zero; assert these exact dates with hand-calculation comments.
- [x] Ensure scripted campaign includes other converting targets so R06 cannot hide R13.
- [x] Add B4 campaign-first and error variants, B5 30-day waste floor, C1 layered decay with ≥$.20 submissions, C4 price drop warning/hard correction, C5 later bid/hourly caps, D3 zero sales, E1 verification/timeout, E5 repeated negative dedup, E6 traffic loss and C2 >30-day stalled target reporting.
- [x] Run all old golden tests without changing expected snapshots.

## Task 8 — Full account, CLI and README

**Create:** `scenarios/full-account.json`, `test/full-account.test.ts`.
**Modify:** `src/cli/sim.ts`, timeline renderer, `README.md`.

- [x] Write CLI test accepting --rules all and asserting decisions/audit/notifications/port-calls JSONL plus target/search-term/ToS timeline and per-target initial/final bid/status.
- [x] Add fixed-seed 60-day AUTO source and MANUAL destination with winner, bleeder, low-impression target, good and waste terms. Before running, document expected necessary sample/spend conditions.
- [x] Run smoke; require R12→R13, waste negative, Sunday harvest with verified-only source negative, ≤3 R14 raises per flag cycle and ≥7 days between raises and no invariant violations. Stop with measured thresholds if any expectation fails. Scenario adjustments require a stated missing condition, not rule changes.
- [x] Run `npm run sim -- scenarios/full-account.json --rules all --out out/full-account`; count port operations by type and successful/failed outcome.
- [x] Document Step 4 order, policy, negative/harvest market, ambiguity table, zero-order golden and actual smoke results. Report stalled targets and cumulative bid decay versus anchor.
- [x] Final verification: `npm run typecheck`, `npm test`, full CLI run. Review diff scope; report actual file list, test count, timeline, API counts and every new ambiguity.

## Approval gate

The supplied brief already fixes the functional design. The writing-plans skill explicitly requires review of this written implementation plan before implementation. Gate đã được project lead duyệt; toàn bộ triển khai và kiểm chứng đã hoàn tất (xem step-4-status.md).
