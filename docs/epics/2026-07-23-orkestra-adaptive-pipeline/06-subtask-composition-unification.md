# Phase 6 — Subtask Composition Unification

**Status:** Blocked
**Blocked by:** [Phase 4](./04-composer-agent.md), [Phase 5](./05-recovery-and-escalation.md)

## Goal

Breakdown composes its own children in the same invocation; handles divergence via `NeedsRecomposition`; adds the parent's integration-consistency-review step.

## Approach

The key move here is refusing to add a second "compose this child" invocation. Breakdown already has full context of a Trak by the time it writes a child's brief — a subsequent step re-deriving a composition it implicitly already decided would just re-pay for information already in hand. So breakdown's own output becomes a `Subtraks` payload where each child carries its own nested `Proposal` (same schema as Phase 4, not a second one), specified in the same invocation that writes the brief.

For a dependent child, that composition is provisional — if the sibling it depends on finishes with a genuinely different interface than assumed, the child's first step raises `NeedsRecomposition` rather than executing a stale plan, reusing Phase 5's mechanism rather than inventing a subtask-specific version of it.

## Steps

- [ ] Extend breakdown's Technique (per `docs/flows/subtask-lifecycle.md`: agent_actions.rs, human_actions.rs, subtask_service.rs, orchestrator.rs) to emit a nested `Proposal` per child alongside each brief
- [ ] Wire a dependent child's first executed step to check its assumptions against the actual finished sibling interface, raising `NeedsRecomposition` on divergence
- [ ] Add the parent's own closing composed step — an integration-consistency-review Technique — once all children report Done, before the parent itself advances

## Touches

- `agent_actions.rs`, `human_actions.rs`, `subtask_service.rs`, `orchestrator.rs` (per `docs/flows/subtask-lifecycle.md`)

## Exit criteria

- [ ] Nested child proposals work
- [ ] Divergence correctly triggers recomposition
- [ ] Integration review runs after children complete
