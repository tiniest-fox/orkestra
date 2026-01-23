# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Philosophy

This project is in early development. Prioritize getting things working over backwards compatibility or data consistency. Feel free to make breaking changes to data formats, APIs, or schemas as needed.

## Build & Development Commands

```bash
# Build all Rust components (CLI, core library, Tauri app)
cargo build

# Build in release mode
cargo build --release

# Run the Tauri desktop app (includes frontend dev server)
pnpm tauri dev

# Build production Tauri app
pnpm tauri build

# Run frontend dev server only (without Tauri)
pnpm dev

# Build frontend only
pnpm build

# Install frontend dependencies
pnpm install

# Run Rust tests
cargo test

# Run specific crate tests
cargo test -p orkestra-core
```

## Build Performance

The project uses two caching mechanisms for faster builds:

- **sccache** - Caches Rust compilation artifacts. Configured in `.cargo/config.toml`. Clean builds with warm cache: ~24s (vs ~64s without).
- **pnpm** - Uses a global content-addressable store with hard links. Fresh `node_modules` install with warm cache: ~1.2s.

## Architecture Overview

Orkestra is a task orchestration system that spawns Claude Code instances (agents) to plan and implement software development tasks with human oversight.

### Workspace Structure

- **`crates/orkestra-core/`** - Core library containing task management, agent spawning, and domain logic
- **`cli/`** - CLI binary (`ork`) for task management
- **`src-tauri/`** - Tauri desktop application backend
- **`src/`** - React/TypeScript frontend (Kanban board UI)
- **`.orkestra/`** - Runtime data directory (auto-created)
  - `orkestra.db` - SQLite database for tasks and sessions
  - `worktrees/` - Git worktrees for task isolation (one per task)
  - `worktree_setup.sh` - Script that runs when creating new worktrees (customize for project-specific setup like copying .env files)

### Core Library Architecture (`crates/orkestra-core/`)

The core uses a hexagonal architecture with domain/ports/adapters:

- **`domain/`** - Core domain models (`Task`, `TaskStatus`, `LogEntry`)
- **`ports/`** - Trait interfaces (`TaskStore`, `ProcessSpawner`, `Clock`)
- **`adapters/`** - Implementations (`SqliteStore`, `ClaudeSpawner`, `SystemClock`)
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

- **SQLite storage**: Tasks stored in `.orkestra/orkestra.db` with full ACID guarantees
- **Git worktrees**: Each task gets an isolated worktree at `.orkestra/worktrees/{task-id}`, allowing parallel work without conflicts
- **Session tracking**: Each agent run creates a session (plan, work, review_0, review_1...) enabling resume after interruption
- **Project root detection**: Finds workspace root by looking for `Cargo.toml` with `[workspace]` or `.orkestra/` directory

### Process Management

Agent processes (Claude Code instances) are managed with multiple cleanup mechanisms:

- **Signal handlers**: SIGTERM/SIGINT/SIGHUP trigger cleanup before exit
- **Startup orphan cleanup**: Kills any orphaned agents from previous crashes on app start
- **ProcessGuard**: RAII guard that kills processes on drop (defense against panics)
- **Recursive tree killing**: Kills entire process trees including child shells

### Worktree Setup

When a new worktree is created for a task, `.orkestra/worktree_setup.sh` runs automatically. Use this for project-specific setup:

```bash
WORKTREE_PATH="$1"
# Copy .env, run pnpm install, etc.
```
