# Phase 0 — Resolve Open Design Questions

**Status:** Done

## Goal

Walk every open question left in the design doc to an actual decision, and update `design.md` to reflect the resolutions rather than leaving them as unresolved checkboxes.

## Resolved

- [x] `micro` flow's no-review contradiction — dissolved; no mandatory-verification floor in the runtime at all (see `design.md`, Non-negotiables + Mechanism vs. policy)
- [x] Migration/rollout approach — hard cutover, no coexistence period
- [x] Default/floor Technique when nothing matches — no separate default entry; orchestrator baseline scaffolding + optional lightweight instruction
- [x] Technique selection mechanism — title+description index exposed every time, no tags taxonomy
- [x] Composition-proposal schema — concrete `Proposal { steps: [Step], clearance }` shape
- [x] Escalation thresholds — no mechanical count; infinite retries + hardcoded self-recognition prompting
- [x] `NeedsRecomposition` cycle cap — no hard cap; same self-recognition principle one level up
- [x] Formatting-only bypass criteria — dropped, moot once the verification floor was removed
- [x] Composer session lifetime — dissolved; only the initial bootstrap chat is a live session, every later invocation is fresh
- [x] `pinned_when` mechanism — dropped entirely, folded into `COMPOSITION.md` prose guidance

## Exit criteria

- [x] Every open question from the original design doc has an explicit resolution, not a placeholder
- [x] `design.md` reflects the resolutions and their rationale, including corrections made after further review (the verification-floor removal and the `pinned_when` removal both happened in a second pass, after the first resolution round)
