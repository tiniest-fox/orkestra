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

## Build Performance

The project uses two caching mechanisms for faster builds:

- **sccache** - Caches Rust compilation artifacts. Configured in `.cargo/config.toml`. Clean builds with warm cache: ~24s (vs ~64s without).
- **pnpm** - Uses a global content-addressable store with hard links. Fresh `node_modules` install with warm cache: ~1.2s.

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
- **`.orkestra/`** - Runtime data directory (auto-created)
  - `orkestra.db` - SQLite database for tasks and sessions
  - `worktrees/` - Git worktrees for task isolation (one per task)
  - `worktree_setup.sh` - Script that runs when creating new worktrees (customize for project-specific setup like copying .env files)
  - `agents/` - Agent prompt templates (markdown files: planner.md, worker.md, etc.)
  - `workflow.yaml` - Optional workflow configuration file (uses default if not present)

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

### Configurable Workflow System

Tasks progress through an ordered list of stages defined in `StageConfig` structs (`workflow/config/stage.rs`). The workflow is loaded from `.orkestra/workflow.yaml` by `load_workflow_for_project()` in `workflow/config/loader.rs`, falling back to `WorkflowConfig::default()` if absent.

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

The built-in default workflow (`WorkflowConfig::default()` in `workflow.rs`) defines: `planning → breakdown → work → review`. This project's `.orkestra/workflow.yaml` extends it to: `planning → breakdown → work → checks (script) → review → compound`.

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

See [`docs/flows/subtask-lifecycle.md`](docs/flows/subtask-lifecycle.md) for the full lifecycle. In brief: stages with `subtasks` capabilities output subtask JSON. On approval, `SubtaskService` creates child tasks with dependencies, flow assignment (via `subtasks.flow`), and inherited artifacts. Parent enters `WaitingOnChildren` until all subtasks complete, then advances to `subtasks.completion_stage` if configured. Subtasks share the parent's worktree.

### Agent System

Agents are spawned via a **provider registry** that supports multiple CLI backends. Each stage can specify a `model` field (e.g., `claudecode/sonnet`, `opencode/kimi-k2`) to select a provider and model. The `ProviderRegistry` (`workflow/execution/provider_registry.rs`) resolves model specs to a `ProcessSpawner` implementation with provider-specific capabilities.

**Supported providers:**
- **claudecode** (default) — Claude Code CLI. Supports `--json-schema` for structured output and `--resume` for session recovery. Aliases: `sonnet`, `opus`, `haiku`.
- **opencode** — OpenCode CLI (`opencode run`). Uses `--format json` (no native JSON schema enforcement) and `--continue` for session recovery. Aliases: `kimi-k2`, `kimi-k2.5`.

**Model spec resolution:**
- `None` → default provider's default model
- `"sonnet"` → shorthand, searches all provider alias tables
- `"claudecode/sonnet"` → explicit provider + alias
- `"claudecode/claude-sonnet-4-5-20250514"` → explicit provider + raw model ID

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

Agent processes are managed with multiple cleanup mechanisms:

- **Signal handlers**: SIGTERM/SIGINT/SIGHUP trigger cleanup before exit
- **Startup orphan cleanup**: Kills any orphaned agents from previous crashes on app start
- **ProcessGuard**: RAII guard that kills processes on drop (defense against panics)
- **Recursive tree killing**: Kills entire process trees including child shells
- **Session-based recovery**: Session IDs are stored in the database before agent spawn. Resume behavior is provider-specific (Claude Code uses `--resume`, OpenCode uses `--continue`).

### Worktree Setup

When a new worktree is created for a task, `.orkestra/worktree_setup.sh` runs automatically. Use this for project-specific setup:

```bash
WORKTREE_PATH="$1"
# Copy .env, run pnpm install, etc.
```
