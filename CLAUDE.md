# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Philosophy

This project is in early development. Prioritize getting things working over backwards compatibility or data consistency. Feel free to make breaking changes to data formats, APIs, or schemas as needed. Old tasks in `.orkestra/tasks.jsonl` can be deleted if they cause issues with new code.

## Build & Development Commands

```bash
# Build all Rust components (CLI, core library, Tauri app)
cargo build

# Build in release mode
cargo build --release

# Run the Tauri desktop app (includes frontend dev server)
npm run tauri dev

# Build production Tauri app
npm run tauri build

# Run frontend dev server only (without Tauri)
npm run dev

# Build frontend only
npm run build

# Run Rust tests
cargo test

# Run specific crate tests
cargo test -p orkestra-core
```

## Architecture Overview

Orkestra is a task orchestration system that spawns Claude Code instances (agents) to plan and implement software development tasks with human oversight.

### Workspace Structure

- **`crates/orkestra-core/`** - Core library containing task management, agent spawning, and domain logic
- **`cli/`** - CLI binary (`ork`) for task management
- **`src-tauri/`** - Tauri desktop application backend
- **`src/`** - React/TypeScript frontend (Kanban board UI)
- **`.orkestra/`** - Runtime data directory (auto-created)
  - `tasks.jsonl` - Append-only task database
  - `agents/` - Agent definition markdown files (planner.md, worker.md)

### Core Library Architecture (`crates/orkestra-core/`)

The core uses a hexagonal architecture with domain/ports/adapters:

- **`domain/`** - Core domain models (`Task`, `TaskStatus`, `LogEntry`)
- **`ports/`** - Trait interfaces (`TaskStore`, `ProcessSpawner`, `Clock`)
- **`adapters/`** - Implementations (`JsonlTaskStore`, `ClaudeSpawner`, `SystemClock`)
- **`services/`** - Business logic (`TaskService`, `AgentService`)
- **`prompt/`** - Agent prompt builders (planner.rs, worker.rs)

Legacy modules (`tasks.rs`, `agents.rs`, `project.rs`) are being migrated to this new structure.

### Task Workflow State Machine

```
Pending → Planning → AwaitingApproval → InProgress → ReadyForReview → Done
                  ↖ request changes  ↙           ↖ review changes ↙
                       Planning                       InProgress
```

Any state can transition to `Failed` or `Blocked`.

### Agent System

Agents are Claude Code instances spawned with:
1. A prompt built from agent definition markdown + task details
2. Streaming JSON output captured as task logs
3. Access to the `ork` CLI for reporting completion/failure

Agent types:
- **Planner**: Analyzes task, creates implementation plan (does not write code)
- **Worker**: Implements approved plan, reports completion via `ork task complete`

### Tauri Commands

The desktop app exposes these IPC commands (see `src-tauri/src/lib.rs`):
- `get_tasks`, `create_task`, `create_and_start_task`
- `approve_plan`, `request_plan_changes`
- `request_review_changes`, `approve_review`
- `resume_task`, `get_task_logs`

### CLI Commands (`ork`)

The `ork` CLI is used for task management. Agents can use `ork` directly as Orkestra adds the CLI to their PATH automatically. From the main repo or git worktrees, the CLI will be found automatically.

```bash
ork task list [--status STATUS]         # List tasks
ork task show ID                        # Show task details
ork task create -t TITLE -d DESC        # Create task
ork task complete ID --summary MSG      # Mark ready for review (used by workers)
ork task fail ID --reason MSG           # Mark failed
ork task block ID --reason MSG          # Mark blocked
ork task set-plan ID --plan "..."       # Set plan (used by planners)
ork task approve ID                     # Approve plan, spawn worker
ork task request-changes ID --feedback  # Request plan revisions
```

### Key Design Patterns

- **Append-only JSONL**: Tasks stored in `.orkestra/tasks.jsonl` - later entries override earlier ones for the same task ID
- **Session tracking**: Each agent run creates a session (plan, work, review_0, review_1...) enabling resume after interruption
- **Project root detection**: Finds workspace root by looking for `Cargo.toml` with `[workspace]` or `.orkestra/` directory
