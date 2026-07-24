# Phase 2 — Author the Technique Library

**Status:** Pending
**Blocked by:** nothing
**Parallel with:** [Phase 1](./01-mechanical-resolution-logic.md) — no shared dependency

## Goal

Convert the ~17 overlapping prompt files into named Technique files; write baseline Techniques; draft `COMPOSITION.md`.

## Approach

Today, `.orkestra/agents/*.md` (planner.md, breakdown.md, worker.md, reviewer.md, subtask-reviewer.md, prompt_reviewer.md, editor.md, compound.md, and flow-specific variants — 18 files) are loaded by `load_agent_definition()` (`crates/orkestra-core/src/workflow/execution/prompt.rs:34-52`) as a single `fs::read_to_string` call — no metadata, no structure. Each one currently bundles "what this stage is for" and "how to do it" into one undifferentiated prompt. This phase pulls the reusable "how" out of each into a Technique file with real frontmatter (Phase 1's shape), and leaves what's left over — Trak-specific framing — as exactly the kind of thing a composed step's lightweight instruction is meant to carry instead.

Keep this phase's scope proportionate: this doesn't need to be an exhaustive audit of every unconditional behavior in the current prompt files. A simple, clearly-worded `COMPOSITION.md` line ("unless changes are exceedingly trivial, include some review to verify the work") covers what used to be enforced by the removed mandatory-verification rule and the removed `pinned_when` mechanism — see `design.md`'s Composition model section. Don't over-engineer replacement machinery for mechanisms that were themselves speculative, not verified protocols.

## Steps

- [ ] Group the 18 files by what they actually do, not their current names — several (`reviewer.md`, `subtask-reviewer.md`, `prompt_reviewer.md`) are the same underlying behavior with a different flavor, and should collapse into one Technique with a lighter/heavier depth dial, not three
- [ ] Write `implementation-conventions` and `standard-verification` as the two baseline Techniques nearly every code-touching step will draw on
- [ ] Draft `COMPOSITION.md` covering at minimum: bug reports without clear repro (start with `red-green`), frontend changes (include a Storybook-story Technique), and the simple review-convention line that replaced the removed mandatory-verification rule
- [ ] Since `standard-verification` and `implementation-conventions` no longer have any mechanical guarantee of inclusion (no more pinning), make sure `COMPOSITION.md` states them plainly and early — not just as one convention among many

## Touches

- `crates/orkestra-core/src/workflow/execution/prompt.rs:34-52` (`load_agent_definition` — the plain read this replaces)
- `.orkestra/agents/*.md` (18 files, source content to redistribute)

## Exit criteria

- [ ] Every current flow's distinguishing content has a corresponding Technique file
- [ ] `COMPOSITION.md` covers the situations named above
- [ ] `implementation-conventions` and `standard-verification` exist and are clearly foregrounded in `COMPOSITION.md`
