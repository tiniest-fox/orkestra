# orkestra-core

Main orchestration library for Orkestra. Provides the unified API, orchestrator loop, and integrates all other orkestra crates into a cohesive task management system.

## Key Components

### WorkflowApi

The primary entry point for all workflow operations. Tauri commands, CLI, and tests interact through this unified interface.

```rust
use orkestra_core::workflow::{WorkflowApi, SqliteWorkflowStore, load_workflow_for_project};
use std::sync::Arc;

let workflow = load_workflow_for_project(&project_root)?;
let store = Arc::new(SqliteWorkflowStore::open(&db_path)?);
let api = WorkflowApi::with_git(workflow, store, git_service);

// Create tasks, approve stages, answer questions, etc.
let task = api.create_task("Fix bug", "Fix the login bug", None)?;
api.approve(&task.id)?;
```

### OrchestratorLoop

The main execution loop that drives task progression. Runs a reconciliation loop that:

1. Sets up tasks whose dependencies are satisfied
2. Advances parents when subtasks complete
3. Processes completed agent/script executions
4. Starts new executions for ready tasks
5. Triggers integration for done tasks

```rust
use orkestra_core::workflow::{OrchestratorLoop, OrchestratorEvent};

let orchestrator = OrchestratorLoop::for_project(api, workflow, project_root, store);

// Run the loop (blocks until stop() is called)
orchestrator.run(|event| match event {
    OrchestratorEvent::AgentSpawned { task_id, stage, pid } => { /* ... */ }
    OrchestratorEvent::IntegrationCompleted { task_id } => { /* ... */ }
    // ...
});
```

### Project Initialization

```rust
use orkestra_core::{ensure_orkestra_project, find_project_root, get_orkestra_dir};

// Find workspace root (handles git worktrees correctly)
let root = find_project_root()?;

// Ensure .orkestra/ structure exists with defaults
ensure_orkestra_project(&root.join(".orkestra"))?;

// Get the .orkestra directory path
let orkestra_dir = get_orkestra_dir();
```

## Re-exports

This crate re-exports types from other orkestra crates for convenience:

- **Git types**: `GitService`, `GitError`, `CommitInfo`, `MergeResult`, `WorktreeCreated`
- **Process utilities**: `ProcessGuard`, `kill_process_tree`, `is_process_running`, `ParsedStreamEvent`
- **Generators**: `TitleGenerator`, `CommitMessageGenerator`, `PrDescriptionGenerator`
- **Runtime types**: `Task`, `TaskState`, `Artifact`, `Iteration`, `Question`

## Configuration

Workflow configuration is loaded from `.orkestra/workflow.yaml`:

```rust
use orkestra_core::workflow::load_workflow_for_project;

let workflow = load_workflow_for_project(&project_root)?;

// Access stage configuration
let stage = workflow.stage("planning")?;
let next = workflow.next_stage("planning");
```

## Test Utilities

Enable the `testutil` feature for test helpers:

```toml
[dev-dependencies]
orkestra-core = { path = "../orkestra-core", features = ["testutil"] }
```

Available utilities:

- `InMemoryWorkflowStore` — In-memory store for unit tests
- `MockAgentRunner` — Mock agent execution for e2e tests
- `MockTitleGenerator`, `MockCommitMessageGenerator`, `MockPrDescriptionGenerator` — Mock generators
- Git helpers: `create_temp_git_repo`, `create_and_commit_file`, `make_commit`
- Fixtures: Pre-built workflow configs and test data

## Crate Dependencies

orkestra-core integrates these crates:

| Crate | Purpose |
|-------|---------|
| `orkestra-types` | Shared domain and runtime types |
| `orkestra-schema` | JSON schema generation for agent outputs |
| `orkestra-parser` | Agent output parsing and validation |
| `orkestra-prompt` | Prompt building and context injection |
| `orkestra-agent` | Agent execution and provider registry |
| `orkestra-process` | Process spawning and lifecycle management |
| `orkestra-store` | SQLite persistence layer |
| `orkestra-git` | Git operations (worktrees, branches, merging) |
| `orkestra-utility` | Lightweight AI utility tasks |
| `orkestra-debug` | Debug logging infrastructure |
