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
  - `pending-outputs/` - Crash recovery: raw JSON from agents awaiting parse
  - `worktree_setup.sh` - Script that runs when creating new worktrees (customize for project-specific setup like copying .env files)
  - `agents/` - Agent prompt templates (markdown files: planner.md, worker.md, etc.)
  - `workflow.yaml` - Optional workflow configuration file (uses default if not present)

### Core Library Architecture (`crates/orkestra-core/`)

The core library is organized around the `workflow/` module, which provides a configurable workflow system:

- **`workflow/adapters/`** - Storage implementations (`SqliteWorkflowStore`, `InMemoryWorkflowStore`, `Git2GitService`)
- **`workflow/config/`** - Workflow configuration loading and stage definitions
- **`workflow/domain/`** - Core domain models (`Task`, `Iteration`, `Question`, `LogEntry`, `StageSession`)
- **`workflow/execution/`** - Agent execution logic (`AgentRunner`, `PromptBuilder`, `StageOutput`)
- **`workflow/ports/`** - Trait interfaces (`WorkflowStore`, `GitService`, `CrashRecoveryStore`)
- **`workflow/runtime/`** - Runtime state management (`Artifact`, `ArtifactStore`, `Phase`, `Status`, `Transition`)
- **`workflow/services/`** - Business logic (`WorkflowApi`, `TaskExecutionService`, `OrchestratorLoop`)

Other top-level modules:
- **`adapters/`** - Database connection utilities
- **`prompts/`** - JSON schemas for agent outputs and prompt templates
- **`process.rs`** - Process spawning and management
- **`project.rs`** - Project root detection

### Configurable Workflow System

Tasks progress through configurable stages defined in YAML (or using the built-in default). Key concepts:

- **Stage**: A named step in the workflow (e.g., "planning", "work", "review")
- **Artifact**: Named output from a stage (e.g., "plan", "summary")
- **Capabilities**: What a stage can do (`ask_questions`, `produce_subtasks`, `auto_approve`)
- **Phase**: Current execution state (`Idle`, `AgentWorking`, `AwaitingReview`, `Integrating`)
- **Iteration**: Each agent run within a stage (rejection creates a new iteration)

Default workflow: `planning → work` (with optional review stages configurable via YAML)

Stages can be customized by placing a `workflow.yaml` file in `.orkestra/`. Each stage defines:
- Input artifacts it needs
- Output artifact it produces
- Agent capabilities (can it ask questions? produce subtasks?)
- Whether human approval is required

### Agent System

Agents are Claude Code instances spawned with:
1. A prompt built dynamically from markdown templates in `.orkestra/agents/`
2. Structured JSON output via `--output-format json --json-schema <schema>`
3. JSON schemas defined in `crates/orkestra-core/src/prompts/schemas/`

Agent prompt templates (in `.orkestra/agents/`):
- **planner.md**: Creates implementation plan, can ask clarifying questions
- **breakdown.md**: Decomposes complex tasks into subtasks with dependencies
- **worker.md**: Implements approved plan, outputs completion/failure/blocked status
- **reviewer.md**: Reviews completed work, approves or requests changes
- **title-generator.md**: Generates concise task titles from descriptions

The prompt builder injects task context (description, artifacts, questions, feedback) into these templates.

### Tauri Commands

Commands are organized in `src-tauri/src/commands/` by concern:

**Task CRUD** (`task_crud.rs`):
- `workflow_get_tasks`, `workflow_get_task`, `workflow_create_task`, `workflow_create_subtask`, `workflow_delete_task`, `workflow_list_subtasks`

**Human Actions** (`human_actions.rs`):
- `workflow_approve` - Approve current stage, advance to next
- `workflow_reject` - Reject with feedback, create new iteration
- `workflow_answer_questions` - Answer pending agent questions
- `workflow_integrate_task` - Merge task branch to primary

**Queries** (`queries.rs`):
- `workflow_get_config`, `workflow_get_iterations`, `workflow_get_artifact`
- `workflow_get_pending_questions`, `workflow_get_current_stage`, `workflow_get_rejection_feedback`
- `workflow_list_branches`, `workflow_get_logs`

### CLI Commands (`ork`)

The `ork` CLI is a debug tool for viewing and managing workflow tasks. Agents output structured JSON instead of using CLI commands.

```bash
ork task list [--status STATUS]         # List tasks (filter: active, done, failed, blocked)
ork task show ID                        # Show task details, artifacts, and iterations
ork task create -t TITLE -d DESC        # Create a new task (creates worktree if git available)
ork task approve ID                     # Approve current stage artifact
ork task reject ID --feedback MSG       # Reject with feedback (creates new iteration)
```

### Key Design Patterns

- **SQLite storage**: Tasks stored in `.orkestra/orkestra.db` with full ACID guarantees
- **Git worktrees**: Each task gets an isolated worktree at `.orkestra/worktrees/{task-id}`, allowing parallel work without conflicts
- **Iteration tracking**: Each agent run within a stage creates an iteration. Rejections create new iterations, allowing for feedback loops
- **Project root detection**: Finds workspace root by looking for `Cargo.toml` with `[workspace]` or `.orkestra/` directory

### Process Management

Agent processes (Claude Code instances) are managed with multiple cleanup mechanisms:

- **Signal handlers**: SIGTERM/SIGINT/SIGHUP trigger cleanup before exit
- **Startup orphan cleanup**: Kills any orphaned agents from previous crashes on app start
- **ProcessGuard**: RAII guard that kills processes on drop (defense against panics)
- **Recursive tree killing**: Kills entire process trees including child shells
- **Crash recovery**: Agent JSON output is persisted before parsing; recovered on restart

### Worktree Setup

When a new worktree is created for a task, `.orkestra/worktree_setup.sh` runs automatically. Use this for project-specific setup:

```bash
WORKTREE_PATH="$1"
# Copy .env, run pnpm install, etc.
```
