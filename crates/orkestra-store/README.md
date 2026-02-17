# orkestra-store

Workflow persistence layer for the Orkestra system.

## Overview

orkestra-store provides the `WorkflowStore` trait and implementations for SQLite and in-memory storage backends. It abstracts over storage backends, allowing the workflow system to persist and retrieve tasks, iterations, stage sessions, and log entries.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
orkestra-store = { path = "../orkestra-store" }
```

For testing, enable the `testutil` feature:

```toml
[dev-dependencies]
orkestra-store = { path = "../orkestra-store", features = ["testutil"] }
```

## Usage

### Production (SQLite)

```rust
use std::path::Path;
use orkestra_store::{DatabaseConnection, SqliteWorkflowStore, WorkflowStore};

// Open a database (creates file if needed, runs migrations)
let db = DatabaseConnection::open(Path::new(".orkestra/.database/orkestra.db"))?;

// Create the store with the shared connection
let store = SqliteWorkflowStore::new(db.shared());

// Use the store
let task = store.get_task("task-id")?;
```

### Testing (In-Memory)

```rust
use orkestra_store::{InMemoryWorkflowStore, WorkflowStore};

let store = InMemoryWorkflowStore::new();
store.save_task(&task)?;
```

## Key Types

### `WorkflowStore` trait

The main persistence abstraction with methods for:

- **Task** — `get_task`, `save_task`, `list_tasks`, `list_task_headers`, `list_subtasks`, `delete_task`, `next_task_id`, `next_subtask_id`
- **Iteration** — `get_iterations`, `get_active_iteration`, `get_latest_iteration`, `save_iteration`, `delete_iterations`
- **Stage Session** — `get_stage_session`, `get_stage_sessions`, `get_sessions_with_pids`, `save_stage_session`, `delete_stage_sessions`
- **Log Entry** — `append_log_entry`, `get_log_entries`, `delete_log_entries_for_task`
- **Assistant Session** — `get_assistant_session`, `save_assistant_session`, `list_assistant_sessions`, `delete_assistant_session`
- **Bulk Operations** — `list_all_iterations`, `list_iterations_for_tasks`, `list_stage_sessions_for_tasks`, `delete_task_tree`

### `SqliteWorkflowStore`

Production SQLite backend. Wraps an `Arc<Mutex<Connection>>` for thread-safe access.

### `InMemoryWorkflowStore`

In-memory implementation for testing. Available with the `testutil` feature.

### `DatabaseConnection`

SQLite connection wrapper that handles:

- WAL mode for concurrent access
- Automatic migration execution
- Corruption detection and recovery
- Checkpoint/flush operations

### `WorkflowError`

Error enum covering:

- `TaskNotFound`, `IterationNotFound`, `StageSessionNotFound`
- `InvalidTransition`, `InvalidState`
- `Storage` (database errors)
- `Lock` (mutex poisoning)
- `IntegrationFailed`, `GitError`

## Migration System

Database migrations use [Refinery](https://github.com/rust-db/refinery). Migration files live in `src/migrations/` and are embedded at compile time.

Tables created:

- `workflow_tasks` — Task definitions, status, artifacts, git state
- `workflow_iterations` — Individual agent/script runs within stages
- `workflow_stage_sessions` — Agent process session tracking
- `log_entries` — Structured logs from agent sessions
- `assistant_sessions` — Assistant chat sessions
- `assistant_log_entries` — Logs for assistant sessions
