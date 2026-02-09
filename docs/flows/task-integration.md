# Flow: Task Integration

How a completed task's branch gets merged back to its base branch — covering the one-tick delay, commit-before-rebase ordering, crash-safe state transitions, and conflict recovery.

## Files Involved

| File | Role |
|------|------|
| `workflow/services/orchestrator.rs` | Tick loop: detects done tasks (one-tick delay), calls `mark_integrating` then `integrate_task` |
| `workflow/services/api.rs` | `get_tasks_needing_integration()`: filters for Done + Idle + has worktree + not subtask. `mark_integrating()`: sets phase to Integrating |
| `workflow/services/integration.rs` | `integrate_task()`: commit, rebase, merge. `integration_succeeded()`: Done -> Archived. `integration_failed()`: routes to recovery stage |
| `workflow/services/iteration_service.rs` | Creates pseudo-iteration for integration failures, creates recovery stage iteration with trigger |
| `workflow/ports/git_service.rs` | `GitService` trait: `commit_pending_changes`, `rebase_on_branch`, `merge_to_branch`, `remove_worktree`, `abort_merge`, `is_branch_merged` |
| `workflow/adapters/git_service.rs` | `Git2GitService`: production implementation using git2 crate + CLI for merge/rebase |
| `workflow/services/task_setup.rs` | `spawn_setup()`: creates worktree and branch during task creation (upstream of integration) |

All paths relative to `crates/orkestra-core/src/`.

## Step Summary

1. **Orchestrator detects done task (one-tick delay)** — `orchestrator.rs::start_integrations()` calls `api.get_tasks_needing_integration()` which returns tasks that are Done + Idle phase + have a worktree + not subtasks. Tasks must have been Done at end of the *previous* tick (tracked via `prev_done_task_ids`), preventing same-tick races between output processing and integration.

2. **Mark integrating** — `api.mark_integrating(task_id)` sets phase to `Integrating`, preventing double-integration on subsequent ticks.

3. **Commit pending changes** — `integration.rs::integrate_task()` commits any uncommitted work in the worktree. The commit message is generated via `CommitMessageGenerator` (AI-powered with fallback to task title). If commit fails, integration fails immediately (routes to recovery).

4. **Determine target branch** — Uses `task.base_branch` (always set at task creation from UI branch selection or parent's branch for subtasks). Errors if not set.

5. **Rebase onto target** — `git.rebase_on_branch(worktree, target)`. On conflict: routes to recovery stage. On success: the merge in step 6 is guaranteed to be a clean fast-forward.

6. **Merge to target** — `git.merge_to_branch(branch, target)`. On success: updates DB *first* (Done -> Archived), *then* removes worktree. On conflict: aborts merge, routes to recovery.

7. **Cleanup** — `git.remove_worktree(task_id, delete_branch: true)` removes the physical worktree and deletes the associated branch. Both operations use git2 API consistently (see `docs/solutions/2026-02-09-git2-cli-mixing.md`). This is non-critical — if it fails or the app crashes after step 6, `cleanup_orphaned_worktrees()` handles it on next startup.

## State Transitions

```
Done + Idle ──[mark_integrating]──> Done + Integrating ──[merge succeeds]──> Archived + Idle
                                                          [merge conflicts]──> Active(recovery_stage) + Idle
```

## Conflict Recovery

When rebase or merge fails with conflicts:

1. `integration_failed()` creates a pseudo-iteration in stage "integration" with `Outcome::IntegrationFailed { error, conflict_files }`
2. Determines recovery stage from `workflow.integration.on_failure` config (default: last agent stage, typically "work")
3. Sets task status to `Active(recovery_stage)`, clears `completed_at`
4. Creates new iteration in recovery stage with `IterationTrigger::Integration { message, conflict_files }`
5. Orchestrator picks up the task on next tick, spawns agent with integration resume prompt telling it to run `git rebase main` and resolve conflicts

## Startup Recovery

If the app crashes during integration (task stuck in `Phase::Integrating`):

1. Startup checks `is_branch_already_merged()` via `git.is_branch_merged()`
2. If already merged: archives task directly, cleans up worktree
3. If not merged: re-attempts full integration
4. If still stuck: resets phase to Idle for retry on next tick

## Non-Obvious Behaviors

- **DB before cleanup**: `integration_succeeded()` saves `Archived` status *before* removing the worktree. If the app crashes between these, the task is correctly Archived and the orphaned worktree gets cleaned up on startup.
- **Worktree path preserved**: `worktree_path` stays on the task record even after the physical worktree is removed. Used for log file access.
- **Subtasks are integrated too**: Subtasks get their own worktrees and branches. When a subtask reaches Done, it goes through the same integration flow — but merges to the parent's branch (stored in `base_branch`) instead of primary. After all subtasks are Archived, the parent advances (see subtask-lifecycle.md).
- **Nondeterministic integration order**: When multiple tasks are eligible for integration in the same tick, `start_integrations()` processes them in whatever order `get_tasks_needing_integration()` returns them (store iteration order, which is not guaranteed). This means if two independent subtasks both reach Done and modify the same files, whichever integrates first succeeds cleanly, and the other hits a rebase conflict and routes to recovery. Tests must not assume a specific integration order.
- **One-tick delay rationale**: Without it, a task could become Done and start integrating in the same tick. If another operation in that tick also touches the task, you get a race condition.
- **Commit message generation**: The system attempts to generate a commit message using Claude Haiku (via `CommitMessageGenerator`), passing task title, description, diff summary, and model names used in the workflow. The generated message includes model attribution in the footer. Falls back to task title (or "Task {id}") only if generation fails. Generation happens in a background thread without holding the API mutex.
- **Rebase guarantees clean merge**: The integration does rebase first, then merge. After a successful rebase, the merge is always a fast-forward — a merge conflict at step 6 should be impossible in theory but is handled defensively.
