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

## CLI-Only Mode (No UI, No Daemon)

Run Orkestra as a standalone CLI tool: `ork run -t "Fix auth bug" -d "..."` creates a task and drives it through the entire workflow to completion, then exits. No Tauri, no orchestrator loop, no daemon process.

### Why this is feasible

The core architecture is already UI-agnostic. `WorkflowApi` is the single API surface — Tauri commands are thin wrappers. The orchestrator loop (`OrchestratorLoop`) is complex because it handles N tasks in parallel with human interaction, but a single-task auto-mode runner doesn't need any of that. Blocking on `child.wait()` is the desired behavior for a CLI tool.

### Architecture: Linear Pipeline Runner

Instead of the tick-based orchestrator, build a synchronous `run_task_to_completion()` function:

```
ork run -t "Title" -d "Description" [--flow quick] [--base-branch main]
  │
  ├─ create task + setup worktree (already sync)
  │
  ├─ for each stage in workflow (respecting flow):
  │   ├─ build prompt (reuse PromptBuilder)
  │   ├─ spawn agent process (reuse ProcessSpawner)
  │   ├─ child.wait() — block until agent exits
  │   ├─ parse JSON output (reuse StageOutput parsing)
  │   ├─ handle output:
  │   │   ├─ artifact → auto-approve, commit, advance
  │   │   ├─ questions → auto-answer, re-run stage
  │   │   ├─ rejection → route to rejection_stage, re-run
  │   │   ├─ subtasks → create children, run each, then advance parent
  │   │   ├─ failure/blocked → exit with error
  │   │   └─ script stage → run command, check exit code
  │   └─ advance to next stage
  │
  ├─ all stages complete → integrate (rebase + merge to base branch)
  └─ exit 0
```

No polling. No daemon. No event callbacks. Just a sequential function that reuses all existing components.

### What already exists and can be reused

- **PromptBuilder** — builds agent prompts with context, artifacts, schema
- **ProcessSpawner** (ClaudeProcessSpawner, OpenCodeProcessSpawner) — spawns agent CLIs
- **StageOutput parsing** — JSON output → artifacts, questions, subtasks, approvals
- **Auto-mode logic** (`agent_actions.rs`) — auto-approve, auto-answer questions
- **Git operations** (Git2GitService) — worktree setup, commit, rebase, merge
- **WorkflowConfig** — stage ordering, flow resolution, capability flags
- **SubtaskService** — subtask creation with dependencies and flow assignment

### Phased implementation

**Phase 1: Single task, no subtasks (~200-300 lines)**
- New function: `run_task_to_completion(api, task_id)` in a new module (e.g., `workflow/services/runner.rs`)
- Drives a single task through all stages sequentially
- Auto-approves artifacts, auto-answers questions, handles rejections
- Commits after each agent stage, runs script stages inline
- Integrates (rebase + merge) on completion
- New CLI command: `ork run` that creates a task and calls the runner
- Streams progress to stderr (stage transitions, agent status)
- Skip: subtasks, crash recovery, parallelism

**Phase 2: Subtask support (~150-200 lines)**
- When a stage outputs subtasks: create them, then run each to completion serially
- Recursive: `run_task_to_completion()` calls itself for each subtask
- After all subtasks complete, advance parent to `completion_stage`
- Handle subtask dependencies (topological sort, run in dependency order)
- Each subtask gets its own worktree branched from parent

**Phase 3: Polish (~100-150 lines)**
- Better error reporting (which stage failed, agent output on failure)
- Timeout per stage (kill agent after N minutes)
- `--dry-run` flag (show what stages would execute without running)
- Exit codes (0 = success, 1 = agent failure, 2 = config error)
- Optional: `--no-integrate` flag to skip final merge

**Phase 4: Nice-to-haves (future)**
- Parallel subtask execution (spawn threads, join all)
- Session resume on crash (store session ID, detect incomplete runs)
- `ork run --watch` mode (poll for new tasks, run each to completion)
- Progress bar / TUI output for long-running agents

### Key design decisions

- **No `OrchestratorLoop` reuse** — the runner is a new, simpler code path. The orchestrator handles concerns (multi-task, polling, human interaction) that don't apply here.
- **Auto-mode is implicit** — all tasks created via `ork run` are auto-mode. No flag needed.
- **Commit inline** — instead of spawning background commit threads, commit synchronously after each stage. The commit message generation (which calls an LLM) blocks, but that's fine for CLI.
- **Integration is opt-out** — by default, merge the result back to base branch. `--no-integrate` skips this.
- **Subtasks are serial** — parallel execution is a Phase 4 optimization. Serial is correct and simple.

## UI Feature Ideas

- [ ] **Icon stage history in task cards** - Display a visual timeline of completed stages using icons on task cards, allowing quick identification of a task's current position in the workflow without opening details.
- [ ] **Assistant panel on the left** - Add a collapsible left sidebar with a conversational assistant for task creation, workflow guidance, and quick actions, reducing friction for common operations.
- [ ] **Chat with an issue** - Enable direct conversation with task context, allowing users to ask questions, request clarifications, or provide feedback inline without switching to separate approval/rejection flows.

