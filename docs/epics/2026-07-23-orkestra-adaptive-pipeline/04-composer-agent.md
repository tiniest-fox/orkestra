# Phase 4 — Composer Agent, Human-Confirmed by Default

**Status:** Blocked
**Blocked by:** [Phase 3](./03-composed-step-execution.md)

## Goal

Chat entry point produces real `Proposal` output. Clearance off by default — every proposal needs human confirmation.

## Approach

The schema side of this is already fully specified in `design.md`:

```
Proposal:
  steps: [Step]       # ordered, the composer's proposed sequence
  clearance: bool     # composer's own judgment — skip human confirmation?

Step:
  artifact_name: string
  techniques: [string]       # 0+ Technique name references; empty is valid
  instruction: string?       # optional lightweight freeform text
```

Model/checks/tools are never composer-authored; they resolve downstream via Phase 1's functions once a step's Technique list is known.

What this phase actually has to find out, which hasn't been explored yet, is where the current chat/assistant session invocation code lives and how it currently hands off into stage execution — that's this phase's first real task, not something to assume from here. `crates/orkestra-core/tests/e2e/assistant.rs` (assistant chat sessions) is the natural home for new coverage.

## Steps

- [ ] Locate and trace today's chat-to-stage-execution handoff before writing anything new
- [ ] Wire the composer to emit a real `Proposal` at that boundary, resolved into composed steps by Phase 3's execution path
- [ ] Composer clearance stays off — every proposal pauses for human confirmation regardless of confidence, so this phase validates composition quality in isolation from the clearance question (Phase 8)
- [ ] Validate against all three worked use cases from `design.md`, plus a handful of real Traks

## Open questions

- [ ] Current chat/bootstrap invocation code path not yet traced this session — first concrete task when this phase starts, not assumed here.

## Note on scope

With both the mandatory-verification rule and `pinned_when` removed (see `design.md`), this phase's human-confirmation period is the *only* mechanical-ish safety net left before a Trak reaches PR-merge — there's no other backstop besides the composer's own judgment and whatever the human catches at merge time. Worth running this phase against a real, non-trivial number of Traks before considering Phase 8 (clearance rollout), not just the three worked examples.

## Exit criteria

- [ ] All three worked use cases produce correct proposals
- [ ] Validated manually against real Traks, not just the worked examples
