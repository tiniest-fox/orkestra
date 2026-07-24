# Phase 5 — Recovery and Escalation

**Status:** Blocked
**Blocked by:** [Phase 4](./04-composer-agent.md)

## Goal

`NeedsRecomposition` plus fresh-invocation composer re-entry replaces the static `recovery_stage`. Hardcoded self-recognition prompting for systemic failures.

## Approach

This doesn't touch conflict recovery's own machinery. Per `design.md`'s resolution, whatever automatic conflict-recovery already exists in `integration.rs` (per `docs/flows/task-integration.md`: orchestrator.rs, integration.rs, orkestra-git) stays the mechanical first line — composer re-entry is only the new endpoint once that logic already gives up, replacing what used to point at a static `recovery_stage` name.

The other half is prompting, not plumbing: a hardcoded (mechanism, not policy — see `design.md`'s "Mechanism vs. policy") nudge injected into every session's baseline scaffolding — "if this keeps failing and looks systemic, use the bailout" — and the same nudge one level up for the composer itself around repeated recomposition. Neither gets a numeric threshold; infinite retries stay the default, matching current behavior.

## Steps

- [ ] Add the `NeedsRecomposition` trigger as a new output shape alongside the existing Artifact/Questions/Subtraks/Approval/Failed/Blocked set
- [ ] Route PR feedback, gate failure, and post-conflict-recovery-exhaustion all to a fresh composer invocation carrying the Trak's durable history (description, prior proposal, artifacts, the specific trigger reason) as context — never a resumed session
- [ ] Add the self-recognition prompt at both the per-step and per-Trak level
- [ ] Force at least one gate failure and one recomposition loop in e2e tests to confirm the nudge actually fires

## Touches

- `integration.rs`, `orchestrator.rs` (per `docs/flows/task-integration.md` — existing conflict-recovery logic this phase hands off from, not replaces)

## Exit criteria

- [ ] All recovery routes go through a fresh composer invocation
- [ ] Exercised by a forced-failure e2e test, not just unit-level coverage
