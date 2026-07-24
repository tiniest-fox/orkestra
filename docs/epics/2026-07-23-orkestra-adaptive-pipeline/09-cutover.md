# Phase 9 — Cutover

**Status:** Blocked
**Blocked by:** [Phase 2](./02-technique-library-content.md), [Phase 5](./05-recovery-and-escalation.md), [Phase 6](./06-subtask-composition-unification.md), [Phase 7](./07-frontend-api-rework.md), [Phase 8](./08-composer-clearance.md)

## Goal

Delete `workflow.yaml` flows and the legacy stage-config path in one commit. Hard cutover, no coexistence — in-flight Traks resolved manually first.

## Approach

No transition period, on purpose — this project's own policy is no backwards-compatibility shims for a codebase with no external users yet, and maintaining two parallel pipeline-shape mechanisms (named-flow lookup and composed-step execution) across the orchestrator, frontend, and test suite simultaneously would cost real ongoing complexity for a transition this project doesn't need. Single-user codebase makes the one real cost — resolving in-flight Traks — cheap: clear them manually before cutover rather than building migration logic for them.

## Steps

- [ ] Confirm every phase this depends on is actually done, not just "mostly working" — this is the one commit with no partial-rollback path once `workflow.yaml`'s flow definitions are gone
- [ ] Delete the flow-based loading path (`workflow/config/loader.rs`'s flow parsing) and the static `StageConfig`-driven execution it fed
- [ ] Full e2e suite green against the composed system alone, no flow-based tests remaining to skip

## Exit criteria

- [ ] Legacy path deleted
- [ ] Full e2e suite green
- [ ] No in-flight Traks on the old system
- [ ] Frontend fully renders composed Traks (Phase 7 verified in production use, not just its own exit criteria)
