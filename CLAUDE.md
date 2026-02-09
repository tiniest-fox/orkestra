# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Philosophy

This project is in early development. Prioritize getting things working over backwards compatibility or data consistency. Feel free to make breaking changes to data formats, APIs, or schemas as needed.

## Architectural Principles

Listed in priority order. When principles conflict, earlier ones win.

1. **Clear Boundaries** — Modules expose simple interfaces, hide internals. Callers never reach into another module's private types or helpers. Tests for module A never mock B's internals — if you need to, the boundary is wrong.
2. **Single Source of Truth** — Every business rule, validation, and domain concept lives in one canonical location. Other code references it, never duplicates it. Caching is fine if the cache knows it's a cache.
3. **Explicit Dependencies** — Pass dependencies as parameters. Use traits for external services (database, network, filesystem). No singletons, no reaching for global state. You should be able to test any component without modifying global state.
4. **Single Responsibility** — If describing a component requires "and" or "or", split it. One function solves one problem. One module handles one domain concern. Boolean flags that switch behavior are a smell.
5. **Fail Fast** — Validate at system boundaries, fail immediately with actionable errors. Only catch errors you can meaningfully handle — unexpected errors propagate up. No catch-log-rethrow, no silent fallbacks, no generic "something went wrong."
6. **Isolate Side Effects** — Pure logic in the core, I/O at the edges. Structure as: gather inputs → pure transformation → apply outputs. Business logic should never directly call APIs or write files.
7. **Push Complexity Down** — Top-level code reads as narrative of intent. Edge cases, parsing, protocol details live in lower-level helpers. Max 2 levels of nesting in high-level functions. "Down" means into cohesive abstractions, not arbitrary depth.
8. **Small Components Are Fine** — A 20-line module for one concept is valid. Don't merge unrelated code for "efficiency." But consolidate components that always change together and are never used independently.
9. **Precise Naming** — No `handle`, `process`, `do`, `manage`, `data`, `info`, `utils`. Verbs for functions, nouns for data. Rename when behavior changes. A longer descriptive name beats a short ambiguous one.

**Conflict resolution:** Clear Boundaries > Single Source of Truth > Fail Fast. Readability overrides theoretical purity — if following a principle makes code harder to understand, reconsider.

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

## CLI Usage During Development

Run `ork` commands during development using the wrapper script:

```bash
bin/ork task list
bin/ork task show <task-id>
bin/ork task create -t "Title" -d "Description"
```

The `bin/ork` wrapper handles building and running the CLI automatically.

## Build Performance

The project uses two caching mechanisms for faster builds:

- **sccache** - Caches Rust compilation artifacts. Configured in `.cargo/config.toml`. Clean builds with warm cache: ~24s (vs ~64s without).
- **pnpm** - Uses a global content-addressable store with hard links. Fresh `node_modules` install with warm cache: ~1.2s.

## Testing

### Philosophy

Unit tests live alongside the code they test (in `#[cfg(test)]` modules). Any meaningful logic, core behavior, or cross-module flow must also be represented in an e2e test. The goal is: unit tests validate individual components in isolation, e2e tests validate that the system works as a whole.

### Core Library (`crates/orkestra-core/`)

The core has ~60 files with unit tests and ~150 e2e tests. This is the most thoroughly tested part of the codebase.

**Unit tests** — inline `#[cfg(test)]` modules throughout `src/`. Cover parsing, config validation, state transitions, domain logic, etc.

**E2e tests** — located at `crates/orkestra-core/tests/e2e/`. These use a `TestEnv` that wires up real SQLite, a real orchestrator loop, and a `MockAgentRunner` (no actual CLI agents). Each test creates tasks, sets mock agent outputs, advances the orchestrator, and asserts on resulting state.

```bash
# Run all core tests (unit + e2e)
cargo test -p orkestra-core

# Run only e2e tests
cargo test -p orkestra-core --test e2e
```

**E2e test files:**

| File | Covers |
|------|--------|
| `workflow.rs` | Full stage pipelines, approval/rejection loops, questions, flows, script stages |
| `subtasks.rs` | Subtask creation, dependencies, parent advancement, integration |
| `task_creation.rs` | Task setup, worktree creation, title generation, base branch handling |
| `startup.rs` | Startup recovery (stale PIDs, orphaned worktrees, stuck integrations) |
| `cleanup.rs` | Process killing, zombie cleanup |
| `multi_project.rs` | Multiple projects sharing a database |
| `assistant.rs` | Assistant chat sessions |

**Test helpers** (`tests/e2e/helpers.rs`):

- `TestEnv` — unified test environment. Two constructors: `with_workflow(wf)` for script-only tests (no git), `with_git(wf, agents)` for agent tests with real git repos and prompt files.
- `MockAgentOutput` — ergonomic builder for simulated agent responses (questions, artifacts, approvals, subtasks, failures, blocked).
- `workflows` module — pre-built workflow configs for common test scenarios (`sleep_script`, `with_subtasks`, `instant_script`).
- Helper methods for advancing the orchestrator, setting mock outputs, asserting on prompts, and querying state.

**Agent-specific tests** (`tests/e2e/agents/`):

These are `#[ignore]` tests that spawn **real CLI agents** (Claude Code, OpenCode) against real APIs. They require the CLI tools installed and API keys configured. Run them manually:

```bash
# Run Claude Code agent tests (requires claude CLI + API key)
cargo test -p orkestra-core --test e2e agents::claudecode -- --ignored

# Run OpenCode agent tests (requires opencode CLI + API key)
cargo test -p orkestra-core --test e2e agents::opencode -- --ignored
```

These have their own `AgentTestEnv` (in `tests/e2e/agents/helpers.rs`) that uses real process spawners instead of mocks.

### Frontend (`src/`)

Has basic test infrastructure. TODO: integration/e2e tests.

### Tauri Backend (`src-tauri/`)

Inline unit tests where appropriate. Commands are thin wrappers around `WorkflowApi` — core logic is tested via orkestra-core. TODO: integration tests.

### CLI (`cli/`)

Inline unit tests where appropriate. TODO: e2e tests.

## Schema Evolution

**When adding or modifying database migrations:**

1. Create the migration file in `crates/orkestra-core/src/adapters/sqlite/migrations/` (follow Refinery naming: `VN__description.sql`)
2. Update `SCHEMA.md` to reflect the schema changes
3. Update the Database Schema section in this file if the changes are architecturally significant

This ensures schema documentation stays synchronized with the actual database structure.

## Cross-Cutting Flow Documentation

These docs trace operations that span multiple files. Read these instead of exploring when working on these flows.

| Flow | Documentation | Key Files |
|------|--------------|-----------|
| **Stage execution** (orchestrator -> spawn -> prompt -> output) | [`docs/flows/stage-execution.md`](docs/flows/stage-execution.md) | `orchestrator.rs`, `stage_execution.rs`, `agent_execution.rs`, `provider_registry.rs`, `agent_actions.rs`, `prompt.rs` |
| **Task integration** (merge, conflict recovery, cleanup) | [`docs/flows/task-integration.md`](docs/flows/task-integration.md) | `orchestrator.rs`, `integration.rs`, `git_service.rs` |
| **Subtask lifecycle** (breakdown, creation, deps, parent advance) | [`docs/flows/subtask-lifecycle.md`](docs/flows/subtask-lifecycle.md) | `agent_actions.rs`, `human_actions.rs`, `subtask_service.rs`, `orchestrator.rs` |

## Architecture Overview

Orkestra is a task orchestration system that spawns AI coding agents (Claude Code, OpenCode, etc.) to plan and implement software development tasks with human oversight.

### Workspace Structure

- **`crates/orkestra-core/`** - Core library containing task management, agent spawning, and domain logic
- **`cli/`** - CLI binary (`ork`) for task management
- **`src-tauri/`** - Tauri desktop application backend. **Read `src-tauri/CLAUDE.md` before making changes in this directory.**
- **`src/`** - React/TypeScript frontend (Kanban board UI). **Read `src/CLAUDE.md` before making changes in this directory.**
- **`.orkestra/`** - Runtime data directory (created on first init with sensible defaults)
  - `.database/orkestra.db` - SQLite database for tasks and sessions
  - `.logs/` - Debug and agent output logs
  - `.worktrees/` - Git worktrees for task isolation (one per task)
  - `scripts/worktree_setup.sh` - Script that runs when creating new worktrees (customize for project-specific setup like copying .env files)
  - `agents/` - Agent prompt templates (planner.md, breakdown.md, worker.md, reviewer.md — defaults created on init, customize per project)
  - `workflow.yaml` - Workflow configuration (default created on init matching the 4-stage pipeline: planning → breakdown → work → review)

### Core Library Architecture (`crates/orkestra-core/`)

The core library is organized around the `workflow/` module, which provides a configurable workflow system:

- **`workflow/adapters/`** - Storage and process implementations (`SqliteWorkflowStore`, `InMemoryWorkflowStore`, `Git2GitService`, `ClaudeProcessSpawner`, `OpenCodeProcessSpawner`)
- **`workflow/config/`** - Workflow configuration loading and stage definitions
- **`workflow/domain/`** - Core domain models (`Task`, `Iteration`, `Question`, `LogEntry`, `StageSession`)
- **`workflow/execution/`** - Agent execution logic (`AgentRunner`, `ProviderRegistry`, `PromptBuilder`, `StageOutput`)
- **`workflow/ports/`** - Trait interfaces (`WorkflowStore`, `GitService`, `ProcessSpawner`)
- **`workflow/runtime/`** - Runtime state management (`Artifact`, `ArtifactStore`, `Phase`, `Status`, `Transition`)
- **`workflow/services/`** - Business logic (`WorkflowApi`, `TaskExecutionService`, `OrchestratorLoop`)

Other top-level modules:
- **`adapters/`** - Database connection utilities
- **`prompts/`** - JSON schemas for agent outputs and prompt templates
- **`process.rs`** - Process spawning and management
- **`project.rs`** - Project root detection

### Database Schema

Orkestra stores workflow state in SQLite (`.orkestra/.database/orkestra.db`). The schema consists of four tables:

- **`workflow_tasks`** — Task definitions, status, artifacts, git state, and configuration
- **`workflow_iterations`** — Individual agent/script runs within stages (tracks rejections and feedback loops)
- **`workflow_stage_sessions`** — Agent process session tracking for recovery across restarts
- **`log_entries`** — Structured logs from agent sessions

See [`SCHEMA.md`](SCHEMA.md) for full column definitions, relationships, and indexes.

### Configurable Workflow System

Tasks progress through an ordered list of stages defined in `StageConfig` structs (`workflow/config/stage.rs`). The workflow is loaded from `.orkestra/workflow.yaml` by `load_workflow_for_project()` in `workflow/config/loader.rs`. The file must exist — `ensure_orkestra_project()` creates it on first init.

**Key domain types** (`workflow/config/`):

- **`WorkflowConfig`** (`workflow.rs`) — Ordered list of `StageConfig` plus `IntegrationConfig`. Validated on load (no forward artifact references, unique names).
- **`StageConfig`** (`stage.rs`) — A stage has a `name`, `artifact` (output name), `inputs` (artifacts from earlier stages), `capabilities`, optional `model` (provider/model spec like `"claudecode/sonnet"`), and either a `prompt` (agent stage) or `script` (script stage). Agent stages default to `.orkestra/agents/{name}.md` when no explicit prompt is set.
- **`StageCapabilities`** (`stage.rs`) — Flags that control what output types the stage's JSON schema includes: `ask_questions`, `subtasks: Option<SubtaskCapabilities>` (with `flow` and `completion_stage`), `approval: Option<ApprovalCapabilities>` (with optional `rejection_stage`).
- **`ScriptStageConfig`** (`stage.rs`) — Shell command, timeout, optional `on_failure` stage for recovery.
- **`FlowConfig`** (`workflow.rs`) — Named alternate flow (shortened pipeline). Has a `description`, optional `icon`, and an ordered list of `FlowStageEntry`s referencing a subset of global stages with optional overrides.
- **`FlowStageEntry`** (`workflow.rs`) — A stage reference in a flow, with optional `FlowStageOverride` for `prompt` and `capabilities` (full replacement, not merge).

**Runtime types** (`workflow/runtime/`, `workflow/domain/`):

- **`Phase`** — Current execution state: `Idle`, `SettingUp`, `AgentWorking`, `AwaitingReview`, `Integrating`.
- **`Iteration`** — Each agent/script run within a stage. Rejections create new iterations with feedback.
- **`Artifact`** — Named output content stored on the task, keyed by artifact name.

#### How Stages Execute

See [`docs/flows/stage-execution.md`](docs/flows/stage-execution.md) for the full execution flow. In brief: the `OrchestratorLoop` runs a 100ms tick loop that polls completed agents, processes their output, starts new executions for idle tasks, and triggers integration for done tasks. Agent stages get a dynamically built prompt + JSON schema; script stages run via `sh -c` in the worktree.

#### Adding a New Stage

To add a stage to this project's workflow:

1. Create a prompt template at `.orkestra/agents/{agent_type}.md`
2. Add the stage entry to `.orkestra/workflow.yaml`
3. No Rust changes needed — the config loader, schema generator, and orchestrator handle it generically

The standard workflow template (created by `ensure_orkestra_project()` on init) defines: `planning → breakdown → work → review`. This project's `.orkestra/workflow.yaml` extends it to: `planning → breakdown → work → checks (script) → review → compound`.

#### Flows (Alternate Pipelines)

Flows let tasks skip stages by defining a subset of the global stage list. Each flow is a named alternate pipeline declared under `flows:` in `workflow.yaml`. Tasks use the full pipeline by default; setting `flow: Some("flow_name")` on a task restricts it to that flow's stages.

Key behaviors:
- Flow stages must be a subset of global stages (validated on config load)
- Flows can override `prompt` and `capabilities` per stage (full replacement, not merge)
- Stage navigation (`first_stage_in_flow`, `next_stage_in_flow`) respects flow ordering
- Script stages in flows cannot have overrides
- The name "default" is reserved and cannot be used as a flow name
- Approval `rejection_stage` targets and script `on_failure` targets must be within the flow's stage list

This project defines three flows: `quick` (skips breakdown and compound), `hotfix` (skips planning, breakdown, and compound), and `opencode-test` (work stage only, using OpenCode with Kimi 2.5).

#### Subtask System

See [`docs/flows/subtask-lifecycle.md`](docs/flows/subtask-lifecycle.md) for the full lifecycle. In brief: stages with `subtasks` capabilities output subtask JSON. On approval, `SubtaskService` creates child tasks with dependencies, flow assignment (via `subtasks.flow`), and inherited artifacts. Parent enters `WaitingOnChildren` until all subtasks complete, then advances to `subtasks.completion_stage` if configured. Each subtask gets its own worktree and branch, created from the parent's branch when its dependencies are satisfied.

### Agent System

Agents are spawned via a **provider registry** that supports multiple CLI backends. Each stage can specify a `model` field (e.g., `claudecode/sonnet`, `opencode/kimi-k2`) to select a provider and model. The `ProviderRegistry` (`workflow/execution/provider_registry.rs`) resolves model specs to a `ProcessSpawner` implementation with provider-specific capabilities.

**Supported providers:**
- **claudecode** (default) — Claude Code CLI. Supports `--json-schema` for structured output and `--resume` for session recovery. Aliases: `sonnet`, `opus`, `haiku`.
- **opencode** — OpenCode CLI (`opencode run`). Uses `--format json` (no native JSON schema enforcement) and `--continue` for session recovery. Aliases: `kimi-k2`, `kimi-k2.5`.

**Model spec resolution:**
- `None` → default provider's default model
- `"sonnet"` → shorthand, searches all provider alias tables
- `"claudecode/sonnet"` → explicit provider + alias
- `"claudecode/claude-sonnet-4-20250514"` → explicit provider + raw model ID

**Provider capabilities** (`ProviderCapabilities`) affect execution: when `supports_json_schema` is false, the JSON schema is embedded in the prompt text instead of passed as a CLI flag.

Agent prompt templates (in `.orkestra/agents/`):
- **planner.md**: Creates implementation plan, can ask clarifying questions
- **breakdown.md**: Decomposes complex tasks into subtasks with dependencies
- **worker.md**: Implements approved plan, outputs completion/failure/blocked status
- **reviewer.md**: Reviews completed work, approves or requests changes
- **compound.md**: Captures learnings and fixes stale documentation

The prompt builder injects task context (description, artifacts, questions, feedback) into these templates.

Note: Title generation uses a separate internal template (`prompts/templates/title_generator.md`) since it's a utility function, not a configurable stage agent.

### Tauri Commands

Commands in `src-tauri/src/commands/` are thin wrappers around `WorkflowApi` methods, organized by concern: task CRUD, human actions (approve/reject/answer), read-only queries, and external tools. See `src-tauri/CLAUDE.md` for details on adding new commands.

### CLI Commands (`ork`)

The `ork` CLI is the primary tool for inspecting task state, investigating issues, and managing tasks outside the UI. Use it to check why a task is stuck, view iteration history, inspect artifacts, and verify git/worktree state. Agents output structured JSON instead of using CLI commands.

**For comprehensive CLI documentation**, see [`docs/cli-guide.md`](docs/cli-guide.md) — a complete reference covering all commands, options, output formats, status values, phase descriptions, and usage patterns.

**Quick reference**:

```bash
ork task list [--status STATUS]         # List tasks (filter: active, done, failed, blocked)
ork task show ID                        # Show task details, artifacts, and iterations
ork task create -t TITLE -d DESC        # Create a new task (creates worktree if git available)
ork task approve ID                     # Approve current stage artifact
ork task reject ID --feedback MSG       # Reject with feedback (creates new iteration)
```

When investigating task issues, `ork task show` is the starting point — it displays the current stage, phase, artifacts, and iteration history. Combine with `git -C .orkestra/.worktrees/<task-id>` commands to inspect worktree state directly.

### Key Design Patterns

- **SQLite storage**: Tasks stored in `.orkestra/.database/orkestra.db` with full ACID guarantees
- **Git worktrees**: Each task gets an isolated worktree at `.orkestra/.worktrees/{task-id}`, allowing parallel work without conflicts
- **Iteration tracking**: Each agent run within a stage creates an iteration. Rejections create new iterations, allowing for feedback loops
- **Project root detection**: Finds workspace root by looking for `Cargo.toml` with `[workspace]` or `.orkestra/` directory

### Process Management

Agent processes are managed with multiple cleanup mechanisms:

- **Signal handlers**: SIGTERM/SIGINT/SIGHUP trigger cleanup before exit
- **Startup orphan cleanup**: Kills any orphaned agents from previous crashes on app start
- **ProcessGuard**: RAII guard that kills processes on drop (defense against panics)
- **Recursive tree killing**: Kills entire process trees including child shells
- **Session-based recovery**: Session IDs are stored in the database before agent spawn. Resume behavior is provider-specific (Claude Code uses `--resume`, OpenCode uses `--continue`).

### Worktree Setup

When a new worktree is created for a task, `.orkestra/scripts/worktree_setup.sh` runs automatically. Use this for project-specific setup:

```bash
WORKTREE_PATH="$1"
# Copy .env, run pnpm install, etc.
```
