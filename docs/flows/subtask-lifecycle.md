# Flow: Subtask Lifecycle

How a parent task gets broken into subtasks, how subtasks execute with dependency ordering, and how the parent advances when all subtasks complete.

## Files Involved

| File | Role |
|------|------|
| `workflow/services/agent_actions.rs` | `handle_subtasks_output()`: stores breakdown JSON + markdown artifact. `advance_completed_parents()`: checks if all subtasks done, advances parent |
| `workflow/services/human_actions.rs` | `approve()`: detects subtask stage, calls `approve_with_subtask_creation()`. `auto_approve_stage()`: same path for auto-mode |
| `workflow/services/subtask_service.rs` | `create_subtasks_from_breakdown()`: creates Task records with dependencies, flow, inherited artifacts |
| `workflow/services/task_setup.rs` | `spawn_subtask_setup()`: transitions subtasks from SettingUp to Idle (no worktree creation) |
| `workflow/services/orchestrator.rs` | `get_tasks_needing_agents()`: filters subtasks by dependency satisfaction. `check_parent_completions()`: calls `advance_completed_parents()` each tick |
| `workflow/services/api.rs` | `get_tasks_needing_agents()`: skips tasks whose `depends_on` entries aren't all done/archived |
| `workflow/execution/output.rs` | `StageOutput::Subtasks`: parsed breakdown output with title, description, depends_on per subtask |
| `workflow/execution/breakdown.rs` | `subtasks_to_markdown()`: converts subtask list to readable markdown for the artifact |
| `workflow/config/stage.rs` | `StageCapabilities`: `produce_subtasks` flag + `subtask_flow` option |

All paths relative to `crates/orkestra-core/src/`.

## Step Summary

1. **Agent produces subtasks** — A stage with `produce_subtasks: true` (typically "breakdown") outputs `StageOutput::Subtasks`. `agent_actions.rs::handle_subtasks_output()` stores two things: a markdown artifact (human-readable) and a `{artifact_name}_structured` artifact (JSON for later Task creation). No Task records are created yet.

2. **Human approves breakdown** — `human_actions.rs::approve()` detects the stage has `produce_subtasks` capability and structured data exists, calls `approve_with_subtask_creation()`.

3. **SubtaskService creates Task records** — `subtask_service.rs::create_subtasks_from_breakdown()` parses the structured JSON and creates tasks in two passes:
   - **Pass 1**: Create all tasks with IDs, assign flow from `subtask_flow` capability, inherit parent's worktree/branch/auto_mode, copy parent's plan artifact
   - **Pass 2**: Resolve `depends_on` indices to actual task IDs
   - **Save**: Persist each task, create initial iterations, spawn subtask setup (SettingUp -> Idle, no worktree)

4. **Parent enters WaitingOnChildren** — Parent status set to `WaitingOnChildren(next_stage)` where `next_stage` is the stage after breakdown. Parent phase is Idle.

5. **Orchestrator schedules subtasks by dependency** — `api.get_tasks_needing_agents()` includes subtasks only if all entries in `depends_on` are Done or Archived. Subtasks with no dependencies start immediately. Others wait.

6. **Subtasks execute through their flow** — Each subtask runs through its assigned flow's stages (e.g., "quick" flow skips breakdown and compound). They share the parent's worktree and branch.

7. **Parent advances when all subtasks done** — `orchestrator.rs::check_parent_completions()` calls `api.advance_completed_parents()` each tick. For each `WaitingOnChildren` parent: if all subtasks are done/archived, parent advances to `next_stage` with a new iteration. If any subtask failed, parent is marked Failed.

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

## Breakdown Skip

If the breakdown agent decides the task is simple enough to not need subtasks, it outputs an empty subtasks list with a `skip_reason`. On approval, `approve_with_subtask_creation()` sees zero tasks created and falls through to `apply_standard_approval()` — the parent advances normally as if it were a regular stage.

## Non-Obvious Behaviors

- **Deferred creation**: Subtask Task records don't exist until the breakdown is approved. Before approval, only the JSON artifact exists. This means you can reject a breakdown and get a new one without orphaned tasks.
- **Shared worktree**: Subtasks inherit `worktree_path` and `branch_name` from the parent. They don't get their own worktrees or branches. All subtasks and the parent operate on the same git branch.
- **Plan inheritance**: Each subtask gets a copy of the parent's `plan` artifact, so the worker agent has context about the overall task.
- **Flow assignment**: Subtasks use the flow specified by `subtask_flow` on the breakdown stage's capabilities (e.g., `subtask_flow: "quick"`). If not set, subtasks use the full pipeline.
- **Subtask setup is minimal**: `spawn_subtask_setup()` only transitions SettingUp -> Idle. No worktree creation, no title generation. This is near-instant.
- **Parent not visible on Kanban during subtask execution**: The parent stays in `WaitingOnChildren` status. The frontend shows it in the breakdown column with a subtasks progress tab.
- **Auto-mode propagation**: Subtasks inherit `auto_mode` from the parent. If the parent is in auto-mode, all subtasks auto-advance through their stages.
- **Failure propagation**: If *any* subtask fails, the parent is marked Failed immediately. There's no partial success — all subtasks must complete for the parent to advance.
