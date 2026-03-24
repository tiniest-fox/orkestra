# Flow: Task Integration

How a completed task's branch gets merged back to its base branch — covering the one-tick delay, squash strategy, sync merge for conflict detection, AI commit message generation, and no-fast-forward merge.

## Files Involved

| File | Role |
|------|------|
| `workflow/services/orchestrator.rs` | Tick loop: detects done tasks (one-tick delay), calls `mark_integrating` then `integrate_task` |
| `workflow/integration/interactions/find_next_candidate.rs` | `execute()`: selects next Done + Idle + has worktree candidate (subtasks always auto-merge; top-level tasks respect `auto_merge` config). `mark_integrating()` in `api.rs` sets phase to Integrating |
| `workflow/integration/service.rs` | `integrate_task()`: drives the full pipeline. `integration_succeeded()`: Done -> Archived. `integration_failed()`: routes to recovery stage |
| `workflow/integration/interactions/squash_rebase_merge.rs` | Main integration git pipeline: safety-net commit → squash → sync merge → AI message → merge to target |
| `workflow/integration/interactions/generate_commit_message.rs` | `execute_for_squash()`: builds diff summary, calls `CommitMessageGenerator`, falls back to task title |
| `workflow/integration/interactions/commit_worktree.rs` | Safety-net commit of any pending changes before squash |
| `workflow/integration/interactions/integration_succeeded.rs` | Records Archived status in DB, removes worktree |
| `workflow/integration/interactions/integration_failed.rs` | Creates pseudo-iteration, routes to recovery stage |
| `orkestra-git/src/interface.rs` | `GitService` trait: `squash_commits`, `merge_into_worktree`, `merge_to_branch`, `remove_worktree` |
| `orkestra-git/src/service.rs` | `Git2GitService`: production implementation, delegates to `interactions/` |
| `workflow/services/task_setup.rs` | `spawn_setup()`: creates worktree and branch during task creation (upstream of integration) |

Orchestration paths relative to `crates/orkestra-core/src/`. Git operations in `crates/orkestra-git/src/`.

## Step Summary

1. **Orchestrator detects done task (one-tick delay)** — `orchestrator.rs::start_integrations()` calls `integration_interactions::find_next_candidate::execute()` which returns the next Done + Idle phase + has worktree candidate. Subtasks always auto-merge (they merge into their parent branch); top-level tasks respect the `auto_merge` config. Tasks must have been Done at end of the *previous* tick (tracked via `prev_done_task_ids`), preventing same-tick races between output processing and integration.

2. **Mark integrating** — `api.mark_integrating(task_id)` sets phase to `Integrating`, preventing double-integration on subsequent ticks.

3. **Commit pending changes (safety net)** — `squash_rebase_merge.rs::execute()` commits any uncommitted work in the worktree. This is a safety net — the Finishing pipeline should have already committed staged output, but this catches stragglers from manual recovery or direct API calls. If commit fails, integration fails immediately (routes to recovery).

4. **Determine target branch** — Uses `task.base_branch` (always set at task creation from UI branch selection, or parent's branch for subtasks). Errors immediately if not set.

5. **Squash commits** — `git.squash_commits(worktree, target_branch, fallback_message)` collapses all commits since the merge-base into a single commit. The squash commit uses a simple fallback message (task title or "Task {id}") — the final human-readable message goes on the merge commit in step 8. This applies to all tasks, including subtasks.

6. **Sync merge into task branch** — `git.merge_into_worktree(worktree, target_branch)` merges the target branch *into* the task branch (the opposite of the final merge). This is the conflict detection step: if the target has diverged from the task branch and the changes conflict, the merge fails here with conflict markers left in the worktree. On conflict, routes to recovery without wasting an AI call. On success, the task branch now contains both sets of changes and the final merge in step 8 is guaranteed to produce a clean commit.

7. **Generate AI commit message** — `generate_commit_message::execute_for_squash()` builds a diff summary from the final state of the task branch, then calls `CommitMessageGenerator` (Claude Haiku via `ClaudeCommitMessageGenerator`, or `MockCommitMessageGenerator` in tests). The message includes: task title, description summary, diff summary, and model attribution (`Co-authored-by:` trailers + `⚡ Powered by Orkestra`). Falls back to the task title if generation fails. Generation is deferred to this point to avoid wasting an AI call when merge conflicts would cause integration to fail anyway.

8. **Merge to target branch (no-fast-forward)** — `git.merge_to_branch(branch, target, Some(message))` uses `--no-ff -m <message>` to create an explicit merge commit on the target branch with the AI-generated message. For top-level tasks, the merge commit lands on `main` (or base branch) and its second parent is the squash commit. For subtasks, the merge commit lands on the parent task's branch and its second parent is the squash commit (same as top-level tasks). Then pushes the target branch to remote (skipped for subtask branches, which target a local task branch).

9. **Cleanup** — `integration_succeeded()` records `Archived` status in DB *first*, then `git.remove_worktree(task_id, delete_branch: true)` removes the physical worktree and deletes the associated branch. The DB write precedes cleanup so a crash between the two leaves the task correctly Archived with an orphaned worktree (handled by `cleanup_orphaned_worktrees()` on next startup).

## State Transitions

```
Done + Idle ──[mark_integrating]──> Done + Integrating ──[merge succeeds]──> Archived + Idle
                                                          [merge conflicts]──> Active(recovery_stage) + Idle
```

## Conflict Recovery

When the sync merge (step 6) or the final merge (step 8) fails with conflicts:

1. `integration_failed()` creates a pseudo-iteration in stage "integration" with `Outcome::IntegrationFailed { error, conflict_files }`
2. Determines recovery stage via `effective_integration_on_failure(task.flow)` — checks flow's `integration.on_failure` override first, then falls back to global `workflow.integration.on_failure` (default: "work")
3. Sets task status to `Active(recovery_stage)`, clears `completed_at`
4. Creates new iteration in recovery stage with `IterationTrigger::Integration { message, conflict_files }`
5. Orchestrator picks up the task on next tick, spawns agent with integration resume prompt telling it to resolve conflicts and re-commit

## Startup Recovery

If the app crashes during integration (task stuck in `Phase::Integrating`):

1. Startup checks `is_branch_already_merged()` via `git.is_branch_merged()`
2. If already merged: archives task directly, cleans up worktree
3. If not merged: re-attempts full integration
4. If still stuck: resets phase to Idle for retry on next tick

## Non-Obvious Behaviors

- **DB before cleanup**: `integration_succeeded()` saves `Archived` status *before* removing the worktree. If the app crashes between these, the task is correctly Archived and the orphaned worktree gets cleaned up on startup.
- **Worktree path preserved**: `worktree_path` stays on the task record even after the physical worktree is removed. Used for log file access.
- **Subtasks use the same squash path**: Subtasks get their own worktrees and branches. When a subtask reaches Done, it goes through the same integration flow as top-level tasks — including the squash step (step 5) — and merges to the parent's branch (stored in `base_branch`) instead of `main`, producing one squash commit and one merge commit on the parent's branch. After all subtasks are Archived, the parent advances (see subtask-lifecycle.md).
- **Nondeterministic integration order**: When multiple tasks are eligible for integration in the same tick, `start_integrations()` processes them in whatever order `get_tasks_needing_integration()` returns them. If two independent subtasks both reach Done and modify the same files, whichever integrates first succeeds cleanly and the other hits a sync merge conflict and routes to recovery. Tests must not assume a specific integration order.
- **One-tick delay rationale**: Without it, a task could become Done and start integrating in the same tick. If another operation in that tick also touches the task, you get a race condition.
- **Commit message generation is deferred**: The AI call happens in step 7, after the sync merge (step 6) confirms there are no conflicts. Generating the message before detecting conflicts would waste an API call on a failed integration. Generation happens in a background thread without holding the API mutex.
- **Sync merge catches conflicts, not rebase**: There is no rebase step. The sync merge (`merge_into_worktree`) merges the target *into* the task branch — this detects conflicts without touching the target branch. The final `merge_to_branch` (step 8) always succeeds cleanly after a successful sync merge.
- **Squash commit is the second parent**: After squash + sync merge + `--no-ff` merge, the merge commit on the target branch has two parents: the previous tip of the target branch and the squash commit (which contains the task's work). The squash commit itself is not a "real" commit on the target — it's only reachable through the merge commit.
