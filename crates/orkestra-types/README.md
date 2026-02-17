# orkestra-types

Shared domain and runtime types for the Orkestra workflow system. This crate defines the core data structures used across all Orkestra crates, with no I/O or storage dependencies.

## Purpose

orkestra-types is the foundational type definitions layer. It provides:

- **Domain types**: Task, Iteration, Question, LogEntry, StageSession, AssistantSession
- **Runtime types**: TaskState, Artifact, ArtifactStore, Outcome
- **Config types**: WorkflowConfig, StageConfig, FlowConfig, StageCapabilities

All types are designed for serialization (JSON/YAML) and derive standard traits like `Clone`, `Serialize`, and `Deserialize`.

## Modules

| Module | Purpose |
|--------|---------|
| `config` | Workflow configuration types loaded from YAML |
| `domain` | Core domain models representing tasks and their state |
| `runtime` | Runtime state types for workflow execution |

## Key Exports

```rust
use orkestra_types::config::{WorkflowConfig, StageConfig, FlowConfig};
use orkestra_types::domain::{Task, Iteration, Question};
use orkestra_types::runtime::{TaskState, Artifact, ArtifactStore};
```

## Example

```rust
use orkestra_types::domain::Task;
use orkestra_types::runtime::TaskState;

// Create a new task
let task = Task::new(
    "task-123",
    "Implement login",
    "Add user authentication",
    "planning",
    "2025-01-01T00:00:00Z",
);

// Query task state
assert_eq!(task.current_stage(), Some("planning"));
assert!(!task.is_terminal());
```

## Design Notes

This crate intentionally has no I/O. Types are pure data structures with validation and query methods. Business logic that requires storage or side effects belongs in `orkestra-core`.
