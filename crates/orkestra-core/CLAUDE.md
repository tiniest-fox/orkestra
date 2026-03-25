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

## Anti-Patterns

- **Don't bypass WorkflowApi** — Store access should go through API methods or interactions
- **Don't hold locks during async/background ops** — Causes deadlocks
- **Don't put business logic in orchestrator** — It's a thin sequencer; logic goes in interactions
- **Don't mix concerns in interactions** — One `execute()` per file, single responsibility

## Test Infrastructure

The crate has extensive e2e tests in `tests/e2e/`:

- `TestEnv` — Unified test environment with `with_workflow()`, `with_git()`, `with_mock_git()` constructors
- `MockAgentOutput` — Builder for simulated agent responses
- `workflows` module — Pre-built workflow configs

For unit tests, use `InMemoryWorkflowStore` and mock generators.
