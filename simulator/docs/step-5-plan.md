# Bước 5 Implementation Plan

Goal: Fault tolerant execution, drift reconciliation, crash replay, edge suite, Monte Carlo and deterministic reports.
Spec: ../../docs/simulator/spec-v3.1.md and user-approved step 5 scope.
Architecture: Ordered write plans commit acknowledged entities. Daily rules consume snapshots. Console edits affect fake API; reconcile before rules. Suite/MC/report consume account results.
Constraints: Only simulator; no dependencies; TDD; unchanged golden expectations; rule changes require regression.

- [ ] Executor: RED retries/retry-after/partial commit/permanent and programming errors/hourly failures; GREEN ordered WritePlan.
- [ ] Reconcile: RED read/stale/drift tests; GREEN fake reads, policies, console manual edits; preserve windows/anchor.
- [ ] Daily/crash: RED crash 1/2/5/half/last then replay; GREEN runDaily and CrashingPort.
- [ ] Edge: RED invariant probes and measured results; GREEN A1–E6 and chaos fixtures.
- [ ] MC: RED 3-seed and worker parity; GREEN mature same-window reevaluation, workers, compare and summary.
- [ ] Report: RED renderer completeness/determinism; GREEN standalone SVG HTML and Markdown.
- [ ] Verify all tests/typecheck; execute 100+200 seed MC/edge/report; document evidence.

Review focus: stale ack; permanent item errors; crash after remote ack; partial campaign/target; PAUSED_AUTO console resume.
Ruling: user explicitly authorized direct implementation with no approval gate; stay in simulator. Independent suite/MC/report delegated through parallel-agent skill.
