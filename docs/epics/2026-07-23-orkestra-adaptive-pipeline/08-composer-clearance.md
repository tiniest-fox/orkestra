# Phase 8 — Turn On Composer Clearance

**Status:** Blocked
**Blocked by:** [Phase 4](./04-composer-agent.md)

## Goal

Start letting high-confidence proposals skip confirmation — narrow at first (single-Technique steps), widening gradually.

## Approach

Composer clearance is the same shape of risk as a worker judging its own work needs no review — accepted anyway, per `design.md`, because the stakes are bounded: whatever a PR-ending Trak produces still has to clear a human at merge time, and a bad result routes straight back through composer re-invocation (Phase 5) on "Request Changes."

That bound doesn't mean clearance should start wide, though. Phase 4 validates composition *quality* with a human watching every proposal; this phase is the separate question of how much of that quality can be trusted to skip the watching. Widen the eligible subset only as real Traks accumulate evidence, not on a fixed schedule.

## Steps

- [ ] Start clearance eligibility narrow — e.g. single-Technique steps only, or steps the composer itself marks self-evident per the `quick`-flow precedent
- [ ] Track clearance decisions against outcomes (did the human later request changes on something clearance waved through) as the actual widening signal
- [ ] Widen incrementally; there's no target end-state where clearance applies unconditionally — that would reintroduce the auto-mode/clearance conflation `design.md` explicitly separated

## Exit criteria

- [ ] Clearance live for a defined narrow subset
- [ ] Observed correct across a minimum number of real Traks before considering widening further
