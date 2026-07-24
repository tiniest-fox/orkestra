# Phase 7 — Frontend / API Contract Rework

**Status:** Blocked
**Blocked by:** [Phase 3](./03-composed-step-execution.md)
**Parallel with:** Phases 4–6 — only depends on the composed-step data shape existing, not composer intelligence

## Goal

Replace `config.flows[task.flow].stages` lookups with a live "this task's composed stage list" API across Kanban, `FlowPicker`, `SendToStageModal`, `HistoricalRunView`.

## Approach

This is a bigger workstream than it sounds, and the one the original design doc underscoped. `WorkflowConfig.flows: Record<string, FlowConfig>` is loaded once via `get_config`/`get_startup_data`, which just serializes the whole static config — there's no per-task stage list from the backend today. Every stage-progress surface resolves through one chokepoint: `resolveFlowStageNames(task.flow, config)`, which does nothing more than `config.flows[taskFlow]?.stages.map(s => s.name)`. A composed Trak has no named flow to key into, so this chokepoint has nothing to look up — it needs a real replacement, not a workaround.

## Steps

- [ ] Add a backend endpoint returning a task's actual composed stage list (derived from its executed/proposed steps, not a config lookup)
- [ ] Repoint `resolveFlowStageNames`'s call site to the new endpoint, or replace it outright — it's the single chokepoint every other surface already goes through
- [ ] Verify each dependent surface individually: Kanban progress bars, `FlowPicker`, `SendToStageModal`, `HistoricalRunView`'s flow-scoped stage lookup

## Touches

- `src/types/workflow.ts:93-98` (`WorkflowConfig.flows`)
- `src/utils/workflowNavigation.ts:6` (`resolveFlowStageNames` — the chokepoint)
- `src/utils/pipelineSegments.ts:31`
- `FlowPicker.tsx`, `SendToStageModal.tsx`, `HistoricalRunView.tsx`
- `query.rs:22-36` (`get_config`/`get_startup_data`, backend side to extend)

## Exit criteria

- [ ] Every stage-rendering surface reads from the live API
- [ ] Verified end-to-end in the running app, not just unit tests
