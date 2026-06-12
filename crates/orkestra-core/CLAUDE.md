# CLAUDE.md — orkestra-core

AI-focused guide for working in this crate.

## Module Structure

orkestra-core follows a domain-oriented architecture. The `workflow/` module is the heart of the crate.

### Top-Level Modules

| Module | Purpose |
|--------|---------|
| `workflow/` | Core workflow system (see detailed breakdown below) |
| `adapters/` | Database connection utilities (`DatabaseConnection`) |
| `init.rs` | Project initialization (`ensure_orkestra_project`) |
| `project.rs` | Project root detection (handles git worktrees) |
| `process.rs` | Process management re-exports from orkestra-process and orkestra-agent |
| `title.rs` | Title generation (LLM-based, with mock) |
| `commit_message.rs` | Commit message generation (LLM-based, with mock) |
| `pr_description.rs` | PR description generation (LLM-based, with mock) |
| `utility/` | Re-exports from orkestra-utility (lightweight AI tasks) |
| `debug_log.rs` | Re-exports from orkestra-debug |
| `prompts/` | Embedded JSON schema components |
| `testutil/` | Git helpers and fixtures (feature-gated) |

### workflow/ Module Map

```
workflow/
├── api.rs              # WorkflowApi — main entry point, holds all services
├── orchestrator/       # OrchestratorLoop — tick loop, recovery, commit pipeline
│
├── config/             # Configuration loading
│   ├── loader.rs       # load_workflow_for_project(), load_workflow()
│   └── auto_task.rs    # AutoTaskTemplate for subtask config
│
├── domain/             # Domain model re-exports + UI types
│   ├── mod.rs          # Re-exports all types from orkestra-types::domain
│   └── task_view.rs    # TaskView (UI-ready), DerivedTaskState, SubtaskProgress
│
├── agent/              # Agent domain (processing agent output)
│   ├── interactions/   # dispatch_completion, record_output, etc.
│   └── service.rs      # AgentActionService
│
├── assistant/          # Assistant domain (chat sessions with AI assistants)
│   └── service.rs      # AssistantService
│
├── human/              # Human domain (approve, reject, answer, interrupt, resume)
│   ├── interactions/   # approve, reject, answer_questions, interrupt, resume
│   └── service.rs      # HumanActionService
│
├── integration/        # Integration domain (merge, PR creation)
│   ├── interactions/   # mark_integrating, generate_commit_message, etc.
│   ├── merge.rs        # run_integration() background thread
│   └── pr_creation.rs  # run_pr_creation() background thread
│
├── query/              # Query domain (read-only operations)
│   ├── interactions/   # diff, file_content, logs, iterations, artifacts
│   └── service.rs      # QueryService
│
├── task/               # Task domain (creation, setup, lifecycle)
│   ├── interactions/   # create, setup_awaiting, find_spawn_candidates, etc.
│   └── setup.rs        # TaskSetupService (worktree creation, title gen)
│
├── stage/              # Stage domain (execution, advancement)
│   ├── interactions/   # check_parent_completions, advance_all_committed, etc.
│   ├── service.rs      # StageExecutionService (spawn agents/scripts)
│   └── session.rs      # SessionSpawnContext
│
├── execution/          # Prompt building + re-exports from orkestra-agent/orkestra-parser
├── adapters/           # Storage implementations (SqliteWorkflowStore, Git2GitService)
├── ports/              # Trait interfaces (WorkflowStore, GitService, PrService)
└── runtime/            # Runtime state (TaskState, Artifact, ArtifactStore)
```

## Key Patterns

### WorkflowApi is the Unified Entry Point

All operations go through `WorkflowApi`. It holds references to all services and exposes unified methods:

```rust
// Good: Use WorkflowApi methods
api.approve(&task_id)?;
api.create_task("title", "desc", None)?;

// Bad: Don't bypass for direct store access
store.save_task(&task)?;  // Only in interactions
```

### Orchestrator Tick Loop

The orchestrator is a thin sequencer that dispatches to domain interactions:

1. **Adopt prewarm worktrees** → `task::retry_pending_adoptions::execute()` — adopt any `WorktreeRecord` whose task is now `Ready`
2. **Setup awaiting tasks** → `task::setup_awaiting::execute()`
3. **Check parent completions** → `stage::check_parent_completions::execute()`
4. **Process completed executions** → `agent::dispatch_completion::execute()`
5. **Commit pipeline** → `stage::advance_all_committed::execute()`
6. **Find spawn candidates** → `task::find_spawn_candidates::execute()`
7. **Integration OR PR creation** → `tick_integration_or_pr()` helper — `else if` mutual exclusion: at most one of these runs per tick.

Business logic lives in interactions; orchestrator handles I/O plumbing (locks, threads, events).

**`auto_pr` vs `auto_merge` precedence**: `find_next_candidate` (merge) skips tasks with `auto_pr=true` via a `!h.auto_pr` guard; `find_pr_candidate` then picks them up in the `else if` branch. Subtasks are always merged via `auto_merge` regardless of `auto_pr`. Result: for top-level tasks, `auto_pr` wins over `auto_merge` — they never both apply to the same task.

**`auto_resolve` implies `auto_pr`**: `create::execute` sets `auto_pr = auto_pr || auto_resolve`. This is the single source of truth — the CLI layer must pass `auto_pr` from its own flag only and let the interaction enforce the implication. Do not re-apply `auto_pr || auto_resolve` in CLI argument parsing or any caller above `create::execute`.

### Narrow Mutex Scopes

When spawning background work that might call back into the API, gather inputs while holding the lock, then explicitly `drop(lock)` before spawning:

```rust
// Good: Release lock before background work
let (task, workflow) = {
    let api = self.api.lock()?;
    (api.get_task(&id)?, api.workflow.clone())
};
drop(api);  // Explicit drop before spawning
std::thread::spawn(move || { /* background work */ });

// Bad: Holding lock during background operation risks deadlock
let api = self.api.lock()?;
std::thread::spawn(move || {
    api.something();  // Deadlock if callback acquires lock
});
```

### Background Threads for Integration

Merge and PR creation run on background threads to avoid blocking the tick loop:

- `integration::merge::run_integration()` — merges branch, handles conflicts
- `integration::pr_creation::run_pr_creation()` — creates PR via GitHub API

These threads take cloned inputs (no lock held) and call back via `Arc<Mutex<WorkflowApi>>`.

**Known gap in `run_pr_creation`**: lock-poison and save errors inside the callback are silently dropped (`if let Ok(api) = api.lock() { let _ = ... }`). The merge path logs lock-poison via `workflow_warn!`; the PR path doesn't. This won't cause incorrect behavior but makes PR creation failures harder to diagnose. If you're debugging a PR creation issue and see no log output, add `workflow_warn!` calls on the error arms to match the merge path.

### Title/Commit Generators Are Internal

Title generation (`title.rs`) and commit message generation (`commit_message.rs`) use internal templates, not configurable agent prompts. They're utility functions, not workflow stages.

### Optional vs. Required Config File Loading

Functions in `execution/prompt.rs` that load config files follow two distinct patterns:

- **Required** (e.g., `load_agent_definition`): returns `std::io::Result<T>`. All errors — including `NotFound` — propagate.
- **Optional** (e.g., `load_universal_prompt`): returns `std::io::Result<Option<T>>`. `io::ErrorKind::NotFound` becomes `Ok(None)`; all other I/O errors propagate.

Don't collapse optional loaders to `Option<T>` — that silently swallows real I/O errors and violates Fail Fast.

## Critical Documentation

Read these before modifying cross-cutting flows:

| Flow | Doc | Key Files |
|------|-----|-----------|
| Workflow pipeline | `docs/flows/workflow-pipeline.md` | `workflow/stage/`, `workflow/agent/`, `workflow/human/`, `workflow/orchestrator/` |
| Stage execution | `docs/flows/stage-execution.md` | `orchestrator.rs`, `stage_execution.rs`, `agent_execution.rs` |
| Task integration | `docs/flows/task-integration.md` | `orchestrator.rs`, `integration.rs`, `orkestra-git` |
| Subtask lifecycle | `docs/flows/subtask-lifecycle.md` | `workflow/agent/interactions/handle_subtasks.rs`, `workflow/stage/interactions/create_subtasks.rs`, `workflow/stage/interactions/check_parent_completions.rs` |

### Chat Task Domain Invariants

Chat tasks are a distinct task type that live outside the normal workflow pipeline. Key invariants:

- **Quiescent state**: `flow = ""` and `state = Queued { stage: "chat" }`. A chat task sitting idle is not queued for agent execution — it's waiting for the human to chat or promote it.
- **Orchestrator filtering**: `find_spawn_candidates` filters out chat tasks via `.filter(|h| !h.is_chat())`. Chat tasks are never spawned into the stage pipeline while they remain chat tasks.
- **Promotion**: `promote_to_flow` transitions a chat task to `AwaitingSetup` with `flow` set to the target flow, killing any active assistant sessions. After promotion it behaves identically to a normal task.
- **`is_chat` on `TaskHeader`**: This flag enables cheap filtering in `find_spawn_candidates` without loading full task artifacts. When adding new orchestrator filters, `TaskHeader` (not `Task`) is the right type to check.
- **Working directory**: Chat tasks receive a worktree via prewarm — the worktree is created the moment the user opens the New Chat dialog and adopted into the task on creation. `AssistantService::send_task_scoped_message` falls back to `project_root` when `task.worktree_path` is `None` (e.g., a task created before prewarm was introduced), but for newly created chat tasks the worktree path will be set.
- **System prompt injection flags differ by spawner**: The assistant spawner (`workflow/assistant/service.rs`) passes `--system-prompt` on every invocation (initial and resume). The agent spawner (`crates/orkestra-agent/src/interactions/spawner/claude.rs`) passes `--append-system-prompt` unconditionally. Both are intentional — `--system-prompt` replaces the full system prompt, while `--append-system-prompt` appends to Claude Code's built-in prompt. Don't conflate them when modifying prompt injection logic.

### `DerivedTaskState::build()` — Approval vs. Rejection Detection

`DerivedTaskState` detects two pending-human states asymmetrically:

- **`pending_rejection`**: Detected by `Outcome::AwaitingRejectionReview` on the latest iteration. The outcome is set *before* the iteration ends, so it's a reliable signal.
- **`pending_approval`**: There is no equivalent distinguishing outcome. When a task is `AwaitingApproval`, the current iteration stays open with `outcome = None`. Detection requires two conditions: state is `AwaitingApproval` **and** the current stage has an agentic gate (`WorkflowConfig::stage(&task.flow, stage_name)?.has_agentic_gate()`).

The key insight: `AwaitingApproval` + approval-capability stage is unambiguous. All agent output paths (approval, artifact, gate success, subtasks) route through `auto_advance_or_review`, which either advances immediately (when `auto_mode=true`) or pauses at `AwaitingApproval` (when `auto_mode=false`). When a human then confirms via the approve endpoint, `enter_commit_pipeline` is called and atomically sets both `Outcome::Approved` and `Finishing` state — so `AwaitingApproval + Outcome::Approved` never coexists in a stable poll cycle.

`DerivedTaskState::build()` requires `WorkflowConfig` as a parameter for this config lookup. When adding new call sites, ensure the workflow config is available — don't try to detect approval state without it.

**`build()` signature evolution**: The function takes individual primitive params for values that require external computation (process liveness, network state) and can't be derived from `Task` alone. Currently `assistant_active: bool` and `chat_needs_review: bool` both fit this category — two trailing bools is the documented threshold. The next time a new external input is needed, replace the accumulating bools with a single `DerivedTaskContext` struct to keep the signature stable.

**`build_single_top_level_view()` in `task_views.rs`**: Already at 8 parameters (`#[allow(clippy::too_many_arguments)]`). Do not add more parameters — the next addition should replace the individual params with a context struct instead.

### Stage Session Supersession Rules

`should_supersede::execute()` in `stage/interactions/session/` decides whether to wipe the existing session before spawning. The canonical rule table (keep this in sync with the doc comment in that file):

| Trigger           | Condition                            | Supersede? |
|-------------------|--------------------------------------|------------|
| `Rejection`       | —                                    | Yes        |
| `Integration`     | —                                    | Yes        |
| `PrFeedback`      | —                                    | Yes        |
| `Redirect`        | —                                    | Yes        |
| `Restart`         | —                                    | Yes        |
| `UserMessage`     | —                                    | No         |
| `GateFailure`     | —                                    | No         |
| `Answers`         | —                                    | No         |
| `MalformedOutput` | —                                    | No         |
| `Interrupted`     | —                                    | No         |
| `None`            | Active iteration has `stage_session_id` set | No — crash recovery |
| `None`            | Active iteration has `stage_session_id = None` OR no active iteration | Yes — clean re-entry |

**`AgentPlainText` parks without a new iteration or trigger.** When an agent produces prose with no structured output (`ExtractionResult::NotFound`), `dispatch_completion` calls `park_plain_text`, which moves the task directly to `AwaitingApproval` — current iteration stays open with `outcome = None`. No new iteration is created, no corrective prompt is sent. The previous artifact remains visible in the UI. The human approves or rejects as normal. Activity flag is still persisted so any future respawn resumes the existing session rather than starting fresh.

**`MalformedOutput` retry path is `run_async`-only.** Only `AgentCompletionError::MalformedOutput` (from `run_async`) feeds into the `IterationTrigger::MalformedOutput` → retry loop. `run_sync`'s `ParseFailed` does not. If `run_sync` is ever wired into the orchestrator, parse failures would need a separate retry path.

**Why `stage_session_id` and not just `ended_at IS NULL`:** `finalize_advancement` pre-creates the next stage's iteration with `stage_session_id = None` before the spawn. `on_spawn_starting` links it to the session when the agent actually runs. So a crash-recovery iteration (agent was mid-run) has `stage_session_id IS NOT NULL`; a clean re-entry iteration (pre-created, agent hasn't run yet) has `stage_session_id IS NULL`.

## Lock File E2E Tests

Tests that verify lock contention (e.g., "second orchestrator is blocked") must use a real running process — either a live `OrchestratorLoop` or a subprocess. Writing `current_pid:fresh_ts` into the lock file does **not** work: `acquire()` sees a fresh timestamp + alive PID, enters the backoff loop, but the call returns `Ok(Stopped)` instead of blocking to `TimedOut`. The root cause: `std::fs::write` truncates the file to zero before writing, creating a brief window where a concurrent reader sees `LockState::Corrupt` and steals the lock. The lock writes are now atomic (write to `.tmp`, rename over target), but the manual-file-write approach still races because the test's write also truncates. Workaround: spin up a real orchestrator A with `build_orchestrator()`, wait for its lock file to appear, then run orchestrator B.

`ACQUIRE_TIMEOUT_SECS = 2` in test mode, so any test that exercises the blocking path takes ~4s (backoff schedule: 250ms → 500ms → 1s → 2s cap before timeout).

### Auto-Resolve PR Feedback

`GhPrMonitor` polls `repos/{owner}/{repo}/pulls/{number}/comments` — these are **review-thread comments only**. Issue-level comments (e.g., posted via `gh pr comment`) are **not** fetched. This is intentional: issue comments include the agent's own summary posts, which would cause a self-triggering loop. Side-effect: reviewer feedback posted as top-level PR comments (not in a review thread) won't trigger auto-resolve.

**CHANGES_REQUESTED escalation is one-iteration-then-handoff by design.** When `GhPrMonitor` detects a CHANGES_REQUESTED review that persists after the agent's iteration completes, it sets `auto_resolve=false` and marks the task for human review. GitHub never auto-clears review state, so the first poll after an iteration will always see it and escalate. This is the intended conservative model: the agent gets one shot; if the reviewer still has unresolved concerns, a human takes over. Don't "fix" this timing — it's not a bug.

**Limit enforcement lives in `trigger_feedback::execute` Step 6.** `auto_resolve` is set to `false` only at the start of the next poll (when the check fires), not immediately after the 10th trigger. When writing limit tests, seed `count` at the limit value (`count=10`), not one below — seeding `count=9` tests the increment path, not the enforcement gate.

## Anti-Patterns

- **Test-only `WorkflowApi` methods must carry `#[cfg(feature = "testutil")]`** — Methods on `WorkflowApi` (or any service struct) that are only called from tests must be gated with this attribute to keep them out of production binaries. The pattern is established in `workflow/api.rs` under the `// Test helpers (testutil feature only)` section. `set_home_dir`, `clear_session_id`, and `set_session_id` are canonical examples. Missing the attribute compiles silently but violates isolation.

- **Don't embed test-only configuration in production constructors** — If a production `new()` delegates to a shared builder method (e.g., `with_runner()`), any feature added to that shared method silently applies to production. Instead, expose test-only configuration as a separate opt-in builder callable *after* construction (e.g., `StageExecutionService::with_skip_env_resolution()`). Use `Arc::get_mut()` when the builder needs mutable access — safe as long as tests call it immediately after construction before any clones exist.

- **Don't bypass WorkflowApi** — Store access should go through API methods or interactions
- **Don't hold locks during async/background ops** — Causes deadlocks
- **Don't put business logic in orchestrator** — It's a thin sequencer; logic goes in interactions
- **Don't mix concerns in interactions** — One `execute()` per file, single responsibility
- **Don't hardcode stage names** — Stage names are user-defined in `workflow.yaml`. Never write `"planning"` or any other stage name as a hardcoded fallback. Use `workflow.first_stage_in_flow(&flow).ok_or_else(...)` or return `WorkflowError::InvalidTransition` instead. Hardcoded names silently route tasks to the wrong pipeline when a project uses custom stage names.

## Rust Anti-Patterns to Avoid

### `is_some_and()` + `unwrap()` is a double-traversal

It traverses the `Option` twice and introduces a panic site. Use `if let Some(x) = opt.filter(...)` instead:

```rust
// Bad — two traversals, unwrap panic risk
if file.diff_content.is_some_and(|d| !d.is_empty()) {
    let content = file.diff_content.unwrap();
}

// Good — single traversal, no unwrap
if let Some(content) = file.diff_content.as_ref().filter(|d| !d.is_empty()) {
}
```

### `ok_or_else()` not `unwrap_or_default()` on required Optional fields

Domain model fields like `branch_name: Option<String>` that represent required state at a given phase must fail fast with an actionable error when `None`. Use `ok_or_else(|| WorkflowError::InvalidState("branch_name missing".into()))?` rather than `.unwrap_or_default()`. `unwrap_or_default()` silently converts `None` to empty string, masking bugs and violating Fail Fast. This is a HIGH-severity pattern violation.

### `Instant::elapsed()` over `checked_sub()`

`Instant::now().checked_sub(duration).unwrap()` panics on recently-booted macOS (uptime < `duration`) because `Instant` is anchored to boot time. Use `last_used.elapsed() < duration` instead — semantically identical, always safe.

### Use canonical `get_agent_schema` — never duplicate

When any new code path needs to build an agent JSON schema, always use the canonical two-step pattern:

```rust
let stage = workflow.stage(&task.flow, stage_name)
    .ok_or_else(|| AgentConfigError::UnknownStage(stage_name.to_string()))?;
let schema = get_agent_schema(stage, project_root)?;
```

Never build a `SchemaConfig` inline or compute a schema independently — it diverges silently (e.g., skipping `schema_file` lookup breaks per-project schema overrides). This is a HIGH-severity duplication that reviewers always catch.

### `PathBuf::join` absolute path injection

When user-supplied input is passed to `PathBuf::join`, a value starting with `/` **replaces** the entire base path on Unix — it does not append. When allowing internal slashes in validated input (e.g., org/repo slugs), explicitly guard against leading slashes:

```rust
// Allows org/repo slugs but blocks /etc/passwd-style injection
if name.starts_with('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
    return Err(...);
}
```

This is a HIGH-severity security finding.

### Store parameter convention for interactions

Synchronous interactions take `&dyn WorkflowStore`. Interactions that spawn a background thread take `&Arc<dyn WorkflowStore>` and clone internally — the clone is an implementation detail, not a caller concern:

```rust
// Good — caller borrows; interaction clones internally for the thread
pub fn execute(store: &Arc<dyn WorkflowStore>, ...) -> Result<()> {
    let store = Arc::clone(store);
    std::thread::spawn(move || { store.do_something(); });
    Ok(())
}

// Bad — caller must move; leaks the thread-spawn detail into the signature
pub fn execute(store: Arc<dyn WorkflowStore>, ...) -> Result<()> { ... }
```

Never take an owned `Arc<dyn WorkflowStore>` — it forces the caller to move rather than borrow and misleads readers about lifetime requirements. See `setup_worktree.rs` for the canonical example.

### `apply_to_task()` is the Single Source of Truth for WorktreeRecord Adoption

When a prewarm `WorktreeRecord` is adopted into a task, **always** use `apply_to_task()` in `workflow/task/interactions/adopt_worktree.rs`. Do not copy `WorktreeRecord` fields (worktree path, branch name, base commit, base branch) inline — that pattern caused a HIGH-severity bug where `branch_name`/`base_commit` were never set, making the integration step silently skip the merge and discard all agent work.

```rust
// Good — canonical, all fields in one place
apply_to_task(&mut task, record);

// Bad — inline field copies diverge across create.rs and create_chat.rs
task.worktree_path = Some(record.worktree_path.clone());
// (branch_name, base_commit often forgotten here)
```

The `is_empty()` guard on `base_branch` is intentional: explicit constructor parameters win over worktree record values.

### Trace all downstream requirements when enabling a new state

When a Trak says "enable operation X from state Y (it's just a gating change)", trace the full execution path of X — not just the gate. Even when the gate change is one line, the operation itself may read fields from the task object (e.g., `task.current_stage()`, `task.branch_name()`) that are `Option<T>` and return `None` for the new state.

Before submitting:
1. Find the gate (e.g., `can_bypass()`)
2. Find every operation that goes through this gate
3. For each operation, trace what it reads from the task object
4. Verify those fields are populated for every state you're adding to the gate

## Test Infrastructure

The crate has extensive e2e tests in `tests/e2e/`:

- `TestEnv` — Unified test environment with `with_workflow()`, `with_git()`, `with_mock_git()` constructors
- `MockAgentOutput` — Builder for simulated agent responses
- `workflows` module — Pre-built workflow configs

For unit tests, use `InMemoryWorkflowStore` and mock generators.

### `with_git` Takes Stage Names, Not Artifact Names

`TestEnv::with_git(&["planning", "work"])` expects **stage names** (matching keys in `workflow.yaml`), not artifact names. The stage name determines the prompt file — e.g., stage `"planning"` loads `planning.md`. Passing artifact names like `&["plan", "summary"]` silently loads the wrong prompt or hits a missing file and causes confusing test failures.

### Manual State Advancement Requires a Matching Iteration

Unit tests that directly set `task.state = TaskState::agent_working("stage_name")` must also call `create_iteration` for that stage. `process_agent_output` (and `dispatch_output`) require an active iteration row to exist — they fail fast with `InvalidState` when none is found. The pattern used by tests throughout `workflow/agent/service.rs`:

```rust
// Advance state manually
task.state = TaskState::agent_working("review");
api.task_service.save_task(&task).unwrap();

// REQUIRED: create the matching iteration
api.iteration_service.create_iteration(&task.id, "review", None).unwrap();
```

Forgetting this used to produce a silent fallback artifact ID. Now it surfaces as an error, exposing the gap.

### PTY E2E Tests

PTY orchestrator-level tests live in `tests/e2e/agents/pty.rs`. Two tests (`pty_full_orchestrator_run`, `pty_session_resume_after_rejection`) use `AgentTestEnv::new_pty_mock()` with a `mock_claude_pty.sh` injected via PATH. Both are `#[ignore]` — run with `--ignored` on a developer machine (require PTY support and Python3).

**Remaining gap**: no test exercises the error path where `claude` is absent from PATH (task should fail with a clear error rather than hang).

**`ORK_CAPTURE_ARGS_FILE` args-capture sidecar**: PTY crash/resume tests verify spawn args (`--session-id` vs `--resume`) by setting this env var to a temp file path. The mock PTY script appends its args to the file on each invocation; the test reads it back after each run to assert spawn behavior across crash/rejection cycles. Example from `pty_crash_recovery_resumes_session`:

```rust
let args_file = tempfile::NamedTempFile::new()?;
std::env::set_var("ORK_CAPTURE_ARGS_FILE", args_file.path());
// ... run test, then:
let lines: Vec<&str> = std::fs::read_to_string(args_file.path())?.lines().collect();
assert!(lines[0].starts_with("--session-id"));  // first spawn: fresh session
assert!(lines[1].starts_with("--session-id"));  // second spawn: Restart clears session
std::env::remove_var("ORK_CAPTURE_ARGS_FILE");   // clean up — prevent leakage
```

This pattern is the correct way to verify multi-spawn arg sequences; direct mock inspection can't capture ordering across crash boundaries.

### Prewarm Recovery Test Assertions

When testing that `cleanup_orphaned_worktree_records` preserved a `Ready` record so that adoption could succeed, **do not assert the raw store record still exists after `run_startup_recovery`**. The `retry_pending_adoptions` phase runs *inside* the same recovery pass and consumes (adopts + deletes) the record. Asserting the record exists post-recovery always fails.

Instead, assert the observable downstream effect:

```rust
// Bad — retry_pending_adoptions consumes the record during recovery
let records = store.list_worktree_records().unwrap();
assert!(records.iter().any(|r| r.task_id == task.id));

// Good — proves the record was preserved long enough for adoption to succeed
let task = api.get_task(&task_id).unwrap();
assert!(task.worktree_path.is_some());
```

This pattern applies to any assertion about intermediate store state when the recovery pass itself transforms that state.

### Known Test Gaps in `init.rs`

Two gaps exist in `test_checks_script_is_executable` (the `ensure_orkestra_project` test):

1. **No assertion that agent prompt files land on disk.** The test calls `ensure_orkestra_project` and checks scripts and README exist, but never asserts files under `agents/` are created. Adding `assert!(orkestra_dir.join("agents/compound.md").exists())` (and similar for all five prompt files) would close this.

2. **No workflow-to-prompt coherence check.** No test validates that every `prompt:` reference in the default `workflow.yaml` has a corresponding entry in `DEFAULT_PROMPTS`. A coherence test would catch init-time breakage when prompt files are added or renamed.

