# Flow: Subtask Lifecycle

How a parent task gets broken into subtasks, how subtasks execute with dependency ordering, and how the parent advances when all subtasks complete.

## Files Involved

| File | Role |
|------|------|
| `workflow/agent/interactions/handle_subtasks.rs` | Stores breakdown artifact; single subtask → inline on parent; multiple subtasks → artifact + `_structured` JSON. Calls `auto_advance_or_review`. |
| `workflow/human/interactions/approve.rs` | `approve()`: detects subtask stage with `_structured` data present, calls `create_subtasks`. Single-subtask path has no `_structured` data, so it advances normally. |
| `workflow/stage/interactions/create_subtasks.rs` | Creates Task records with dependencies, flow assignment, and inherited artifacts (two-pass: create all, then resolve depends_on indices to IDs) |
| `workflow/task/interactions/setup_awaiting.rs` | Transitions subtasks from SettingUp → Idle; creates worktree + branch from parent's branch when dependencies are satisfied |
| `workflow/orchestrator/mod.rs` | Tick loop: calls `check_parent_completions` each tick; also drives `tasks_needing_agents` to respect dependency ordering |
| `workflow/query/interactions/tasks_needing_agents.rs` | Skips tasks whose `depends_on` entries aren't all done/archived |
| `workflow/stage/interactions/check_parent_completions.rs` | Checks if all subtasks done/archived; advances parent to next stage or marks Failed |
| `workflow/config/mod.rs` | Re-exports `StageCapabilities`: `subtasks: Option<SubtaskCapabilities>` with `flow` and `completion_stage` (types live in `crates/orkestra-types`) |

Paths relative to `crates/orkestra-core/src/` unless otherwise noted. `StageOutput::Subtasks` is parsed in `crates/orkestra-parser/src/types.rs`, re-exported as `workflow::execution::SubtaskOutput` in core.

## Step Summary

1. **Agent produces subtasks** — A stage with `subtasks` capabilities (typically "breakdown") outputs `StageOutput::Subtasks`. `handle_subtasks.rs` handles two cases: (a) single subtask → inline the instructions as a breakdown artifact on the parent, no `_structured` data stored; (b) multiple subtasks → stores a markdown artifact and a `{artifact_name}_structured` JSON artifact for later Task creation. No Task records are created yet.

2. **Human approves breakdown** — `approve.rs` detects whether `_structured` data is present. If present (multiple-subtask path), it calls `create_subtasks` to create child tasks. If absent (single-subtask inlined path), the parent advances normally.

3. **create_subtasks creates Task records** — `create_subtasks.rs` parses the structured JSON and creates tasks in two passes:
   - **Pass 1**: Create all tasks with IDs, assign flow from `subtasks.flow` capability, set `base_branch` to parent's branch, inherit auto_mode, copy parent's plan artifact
   - **Pass 2**: Resolve `depends_on` indices to actual task IDs
   - **Save**: Persist each task, create initial iterations. Subtasks start in SettingUp — worktree creation is deferred to `setup_ready_subtasks()` in the orchestrator tick loop

4. **Parent enters WaitingOnChildren** — Parent status set to `WaitingOnChildren(next_stage)` where `next_stage` is the stage after breakdown. Parent phase is Idle.

5. **Orchestrator schedules subtasks by dependency** — `api.get_tasks_needing_agents()` includes subtasks only if all entries in `depends_on` are Done or Archived. Subtasks with no dependencies start immediately. Others wait.

6. **Subtasks execute through their flow** — Each subtask runs through its assigned flow's stages (e.g., "quick" flow skips breakdown and compound). Each subtask has its own worktree and branch, created from the parent's branch. When a subtask completes, it integrates (rebase + merge) back to the parent's branch.

7. **Parent advances when all subtasks done** — The orchestrator calls `check_parent_completions::execute()` each tick. For each `WaitingOnChildren` parent: if all subtasks are done/archived, parent advances to `next_stage` with a new iteration. If any subtask failed, parent is marked Failed.

## State Transitions

```
Parent:
  Active(breakdown) ──[agent output]──> AwaitingReview
    ──[approve]──> WaitingOnChildren(next_stage) + Idle
    ──[all subtasks done]──> Active(next_stage) + Idle
    ──[any subtask failed]──> Failed + Idle

Subtask:
  SettingUp ──[setup]──> Idle ──[orchestrator + deps satisfied]──> AgentWorking ──...──> Done
```

## Dependency Scheduling

Subtask dependencies are specified as indices in the breakdown output (e.g., subtask 2 depends on subtask 0). `SubtaskService` resolves these to task IDs at creation time.

The orchestrator's `get_tasks_needing_agents()` checks: for each task with `depends_on`, are all referenced tasks Done or Archived? If not, the task is skipped this tick. This means:

- Subtasks with empty `depends_on` start immediately (in parallel)
- Subtasks with dependencies wait until all dependencies complete
- Diamond dependencies work correctly (A depends on B and C, both must finish)

## Single-Subtask Inlining

If the breakdown agent produces exactly one subtask, it is inlined on the parent task — no child task is created, and the parent advances directly to the next stage with the subtask's instructions as context. The breakdown artifact is augmented with an `## Implementation Instructions` section containing the subtask's `detailed_instructions`. Any stale `_structured` artifact data from a previous multi-subtask run is cleared to prevent accidental child task creation.

## Non-Obvious Behaviors

- **Deferred creation**: Subtask Task records don't exist until the breakdown is approved. Before approval, only the JSON artifact exists. This means you can reject a breakdown and get a new one without orphaned tasks.
- **Isolated worktrees**: Each subtask gets its own worktree and branch, created from the parent's branch (`base_branch`). Setup is deferred until dependencies are satisfied, so subtask B (which depends on A) branches after A's changes have been merged back to the parent's branch. This isolation allows parallel work without conflicts, but means independent subtasks editing the same files may conflict during integration (see task-integration.md).
- **Plan inheritance**: Each subtask gets a copy of the parent's `plan` artifact, so the worker agent has context about the overall task.
- **Flow assignment**: Subtasks use the flow specified by `subtask_flow` on the breakdown stage's capabilities (e.g., `subtask_flow: "quick"`). If not set, subtasks use the full pipeline.
- **Deferred subtask setup**: Subtask setup is deferred to the orchestrator tick loop (`setup_ready_subtasks()`). When dependencies are satisfied, it calls `spawn_setup()` which creates a worktree and branch from `base_branch`. No title generation (titles come from the breakdown output).
- **Parent not visible on Kanban during subtask execution**: The parent stays in `WaitingOnChildren` status. The frontend shows it in the breakdown column with a subtasks progress tab.
- **Auto-mode propagation**: Subtasks inherit `auto_mode` from the parent. If the parent is in auto-mode, all subtasks auto-advance through their stages.
- **Failure propagation**: If *any* subtask fails, the parent is marked Failed immediately. There's no partial success — all subtasks must complete for the parent to advance.
