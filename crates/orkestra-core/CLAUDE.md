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

1. **Setup awaiting tasks** → `task::setup_awaiting::execute()`
2. **Check parent completions** → `stage::check_parent_completions::execute()`
3. **Process completed executions** → `agent::dispatch_completion::execute()`
4. **Commit pipeline** → `stage::advance_all_committed::execute()`
5. **Find spawn candidates** → `task::find_spawn_candidates::execute()`
6. **Integration** → `integration::find_next_candidate::execute()`

Business logic lives in interactions; orchestrator handles I/O plumbing (locks, threads, events).

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

### Title/Commit Generators Are Internal

Title generation (`title.rs`) and commit message generation (`commit_message.rs`) use internal templates, not configurable agent prompts. They're utility functions, not workflow stages.

## Critical Documentation

Read these before modifying cross-cutting flows:

| Flow | Doc | Key Files |
|------|-----|-----------|
| Workflow pipeline | `docs/flows/workflow-pipeline.md` | `workflow/stage/`, `workflow/agent/`, `workflow/human/`, `workflow/orchestrator/` |
| Stage execution | `docs/flows/stage-execution.md` | `orchestrator.rs`, `stage_execution.rs`, `agent_execution.rs` |
| Task integration | `docs/flows/task-integration.md` | `orchestrator.rs`, `integration.rs`, `orkestra-git` |
| Subtask lifecycle | `docs/flows/subtask-lifecycle.md` | `workflow/agent/interactions/handle_subtasks.rs`, `workflow/stage/interactions/create_subtasks.rs`, `workflow/stage/interactions/check_parent_completions.rs` |

### `DerivedTaskState::build()` — Approval vs. Rejection Detection

`DerivedTaskState` detects two pending-human states asymmetrically:

- **`pending_rejection`**: Detected by `Outcome::AwaitingRejectionReview` on the latest iteration. The outcome is set *before* the iteration ends, so it's a reliable signal.
- **`pending_approval`**: There is no equivalent distinguishing outcome. When a task is `AwaitingApproval`, the current iteration stays open with `outcome = None`. Detection requires two conditions: state is `AwaitingApproval` **and** the current stage has an agentic gate (`WorkflowConfig::stage(&task.flow, stage_name)?.has_agentic_gate()`).

The key insight: `AwaitingApproval` + approval-capability stage is unambiguous. All agent output paths (approval, artifact, gate success, subtasks) route through `auto_advance_or_review`, which either advances immediately (when `auto_mode=true`) or pauses at `AwaitingApproval` (when `auto_mode=false`). When a human then confirms via the approve endpoint, `enter_commit_pipeline` is called and atomically sets both `Outcome::Approved` and `Finishing` state — so `AwaitingApproval + Outcome::Approved` never coexists in a stable poll cycle.

`DerivedTaskState::build()` requires `WorkflowConfig` as a parameter for this config lookup. When adding new call sites, ensure the workflow config is available — don't try to detect approval state without it.

## Lock File E2E Tests

Tests that verify lock contention (e.g., "second orchestrator is blocked") must use a real running process — either a live `OrchestratorLoop` or a subprocess. Writing `current_pid:fresh_ts` into the lock file does **not** work: `acquire()` sees a fresh timestamp + alive PID, enters the backoff loop, but the call returns `Ok(Stopped)` instead of blocking to `TimedOut`. Root cause is unclear, but the workaround is reliable: spin up a real orchestrator A with `build_orchestrator()`, wait for its lock file to appear, then run orchestrator B.

`ACQUIRE_TIMEOUT_SECS = 2` in test mode, so any test that exercises the blocking path takes ~4s (backoff schedule: 250ms → 500ms → 1s → 2s cap before timeout).

## Anti-Patterns

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

### Known Test Gaps in `init.rs`

Two gaps exist in `test_checks_script_is_executable` (the `ensure_orkestra_project` test):

1. **No assertion that agent prompt files land on disk.** The test calls `ensure_orkestra_project` and checks scripts and README exist, but never asserts files under `agents/` are created. Adding `assert!(orkestra_dir.join("agents/compound.md").exists())` (and similar for all five prompt files) would close this.

2. **No workflow-to-prompt coherence check.** No test validates that every `prompt:` reference in the default `workflow.yaml` has a corresponding entry in `DEFAULT_PROMPTS`. A coherence test would catch init-time breakage when prompt files are added or renamed.

