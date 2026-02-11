# TODO

Technical debt and future improvements.

## Bugs

- [ ] **Fix session resume for early agent failures** - When an agent process starts successfully (gets PID) but fails immediately before producing valid output (e.g., API limit errors, auth failures), the session ID is saved and `spawn_count` is incremented. Subsequent spawn attempts try to resume the broken session with `--resume`, which fails because no valid Claude Code session state exists. Need to detect these early failures and clear the session ID so the next spawn starts fresh. See investigation notes from deeply-factual-koel task failure (2026-02-04).

## CLI Improvements

- [ ] **`ork task list --parent <ID>`** — List subtasks of a parent task. Currently requires querying the database directly to see which subtasks belong to a parent.
- [ ] **`ork task show <ID> --iterations`** — Show iteration history (rejections, feedback, outcomes). Useful for debugging why a task is stuck in a feedback loop.
- [ ] **`ork task show <ID> --git`** — Show git state (branch, worktree HEAD, dirty status). Needed when diagnosing stale worktree or merge issues.
- [ ] **`ork logs <task-id>`** — Stream or tail log entries for a task's current (or specified) stage session. Logs exist in the `log_entries` table but are only viewable through the UI.
- [ ] **`ork logs <task-id> --session <session-id>`** — View logs for a specific stage session. Useful when a task has been through multiple sessions (retries, rejections).
- [ ] **`ork task show <ID> --sessions`** — Show stage session history (spawn count, session state, agent PIDs). Needed when debugging session resume failures or orphaned agents.
- [ ] **`ork task list --status blocked`** — Already works, but add `--depends-on <ID>` to find all tasks waiting on a specific dependency.

## Performance

- [ ] **Replace DB Mutex with RwLock** — `Arc<Mutex<Connection>>` serializes all DB access despite SQLite WAL mode supporting concurrent readers. Consider `parking_lot::RwLock` or `r2d2-sqlite` connection pool to allow concurrent reads. File: `crates/orkestra-core/src/adapters/sqlite/connection.rs`.
- [ ] **Cache topological sort in `list_task_views()`** — `topological_sort()` runs on subtasks for each parent on every 2s poll. Could cache sorted order and invalidate on subtask status change. File: `crates/orkestra-core/src/workflow/services/queries.rs`.

## UI Feature Ideas

- [ ] **Icon stage history in task cards** - Display a visual timeline of completed stages using icons on task cards, allowing quick identification of a task's current position in the workflow without opening details.
- [ ] **Assistant panel on the left** - Add a collapsible left sidebar with a conversational assistant for task creation, workflow guidance, and quick actions, reducing friction for common operations.
- [ ] **Chat with an issue** - Enable direct conversation with task context, allowing users to ask questions, request clarifications, or provide feedback inline without switching to separate approval/rejection flows.

