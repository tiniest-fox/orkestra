# Phase 3 — Composed-Step Execution (Static)

**Status:** Blocked
**Blocked by:** [Phase 1](./01-mechanical-resolution-logic.md)
**Unlocks:** [Phase 7](./07-frontend-api-rework.md) can start as soon as this lands

## Goal

Wire Phase 1's resolver into real stage execution — the sequence is still hand-specified. This isolates "does composed execution work" from "can an LLM compose well" (that's Phase 4).

## Approach

The good news, confirmed by tracing the actual spawn path: the execution machinery doesn't need to change at all, only what feeds it does.

- `execute_agent.rs`'s `execute()` already reads `stage_config.model` (line 92), resolves it through `ProviderRegistry::resolve()` (line 93), and applies `disallowed_tools` (lines 112-115) before building the `RunConfig` that actually gets spawned (line 705).
- Gates run through a separate path — the orchestrator's `do_spawn_gate` reads `StageConfig::gate_config()` and hands off to `ScriptExecutionService::spawn_gate`, which decides pass/fail purely from `ScriptResult::is_success()` (exit code 0, not timed out).

A composed step's Technique list, once resolved by Phase 1's functions, produces exactly the shape both paths already expect — a `model` string, a set of `disallowed_tools`, an optional gate. This phase is substitution, not new plumbing.

## Steps

- [ ] Pick one flow to reimplement as a hand-specified list of Technique-composed steps instead of static `StageConfig` entries. **Confirm which existing flow actually has a real gate configured before picking** — `quick` is the obvious low-friction candidate, but if it has no gate, this phase's exit criteria won't exercise check-union resolution at all, only model/tool-restriction paths.
- [ ] Feed Phase 1's resolver output into the same `model` / `disallowed_tools` / `gate` fields `execute_agent.rs` and `orchestrator/mod.rs` already consume — no change to the spawn or gate-polling code itself.
- [ ] Confirm e2e coverage for that flow still passes against the composed version.

## Known e2e test risk

`crates/orkestra-core/tests/e2e/workflow.rs` currently asserts **exact stage-name strings** against a fixed named flow (e.g. `task.current_stage() == Some("planning")`). Those assertions will need rewriting for the composed version — but `MockAgentRunner` itself is keyed only by `task_id`, not stage name, so the mock mechanism tolerates dynamic composition fine. It's the assertions that are brittle, not the test infrastructure.

## Touches

- `crates/orkestra-core/src/workflow/execution/.../stage/interactions/execute_agent.rs:35,83,92,93,112-115,705`
- `crates/orkestra-agent/src/registry.rs:185` (`resolve`)
- `crates/orkestra-core/src/workflow/orchestrator/mod.rs:702` (`do_spawn_gate`)
- `crates/orkestra-types/src/config/stage.rs:84,115,120,133` (`StageConfig` fields being replaced)
- `crates/orkestra-core/tests/e2e/workflow.rs` (assertions to rewrite)

## Exit criteria

- [ ] One existing flow runs end-to-end as a composed sequence
- [ ] e2e coverage matches today's for that flow (rewritten assertions, not a coverage regression)
