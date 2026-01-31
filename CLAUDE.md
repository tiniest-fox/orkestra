# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Philosophy

This project is in early development. Prioritize getting things working over backwards compatibility or data consistency. Feel free to make breaking changes to data formats, APIs, or schemas as needed.

## Architectural Principles

These principles guide code organization and design decisions. They are listed in priority order—when principles conflict, earlier principles take precedence.

### 1. Clear Boundaries

Modules, files, and functions should expose simple interfaces and hide implementation details. Callers interact through a well-defined API without needing to understand internal mechanics.

**Apply this by:**
- Defining public interfaces that abstract complexity
- Keeping internal helpers private to their module
- Avoiding "reaching into" other modules' internals
- Favoring composition over deep inheritance chains

**Testing implication:** Tests should not know the internals of other modules. Each module tests its own internals; tests for module A only interact with module B through B's public API. If testing A requires mocking B's internals, the boundary is wrong.

**Quick test:** Can someone use this function correctly by reading only its signature and docstring?

**Signs of violation:** Functions that require understanding another module's data structures; changes to internal logic that break distant callers; tests that mock internal details of other modules; imports that reach multiple levels into another module's directory structure.

### 2. Single Source of Truth

Business rules, configuration, and domain logic should live in one canonical location. Other code references that source rather than duplicating it.

**Apply this by:**
- Centralizing validation rules, constants, and type definitions
- Having one authoritative module for each domain concept
- Using references and imports rather than copy-paste

**Performance exception:** Caching and denormalization are acceptable when the authoritative source is clearly marked and synchronization is explicit. The cache knows it's a cache.

**Quick test:** If this rule changes, how many files do I need to modify?

**Signs of violation:** The same validation logic in multiple places; magic numbers scattered across files; "update this here and also over there" comments; bugs fixed in one place that reappear elsewhere; schema definitions that drift between layers.

### 3. Explicit Dependencies

Components should receive their dependencies rather than reaching out to obtain them. This makes dependencies visible, testable, and swappable.

**Apply this by:**
- Passing dependencies as parameters rather than importing singletons
- Using traits/interfaces for external services (database, network, filesystem)
- Making the dependency graph visible at construction time

**Quick test:** Can I test this component without modifying global state or environment variables?

**Signs of violation:** Functions that internally construct database connections; modules that import global state; test setup that requires complex manipulation of module internals.

### 4. Single Responsibility

Each component should own one coherent responsibility. A function solves one problem. A module handles one domain concern. A file groups related functionality.

**Apply this by:**
- Asking "what is this component's one job?"
- Splitting when a component manages unrelated concerns
- Naming components after their single responsibility

**Granularity heuristic:** A component has one responsibility if you can describe what changes would require modifying it without saying "or." If the answer is "changes to password hashing or session expiry or permission rules"—it's too broad.

**Quick test:** Can I describe what this does in one sentence without using "and" or "or"?

**Signs of violation:** Components with "and" in their description; functions that take boolean flags to do different things; functions with more than 3-4 optional parameters controlling behavior; classes that require reading the whole implementation to understand.

### 5. Fail Fast

Validate inputs at system boundaries and fail immediately with clear errors. Don't let invalid state propagate deep into the system.

**Apply this by:**
- Validating at API boundaries (user input, external services, configuration)
- Using type systems to make invalid states unrepresentable
- Returning errors rather than silently continuing with defaults
- Making error messages actionable: what failed, why, how to fix

**Error handling philosophy:** Only catch errors when you have a clear solution and the error is part of an expected API contract. Unexpected errors should propagate up—don't catch exceptions just to log and rethrow, or to convert to a generic error. If you can't handle it meaningfully, let it bubble.

**Quick test:** If this input is invalid, will the error message point directly to the problem?

**Signs of violation:** Errors that surface far from their cause; silent fallbacks that hide bugs; validation scattered throughout call stacks; catch blocks that log and rethrow without adding value; generic "something went wrong" errors.

### 6. Isolate Side Effects

Separate pure logic from code that touches the outside world. Push I/O and state mutation to the edges.

**Apply this by:**
- Writing core business logic as pure transformations (input → output)
- Concentrating I/O (files, network, database) in dedicated adapter layers
- Making state changes explicit and localized
- Structuring code as: gather inputs → pure transformation → apply outputs

**Quick test:** Could this function's core logic run in a unit test without mocking anything?

**Signs of violation:** Business logic that directly writes files or calls APIs; pure calculations interspersed with database calls; functions where the return value is incidental to their side effects; difficulty testing without extensive mocking.

### 7. Push Complexity Down

High-level code should read like a clear narrative of intent. Implementation details—edge cases, parsing, protocol handling—belong in lower-level helpers that encapsulate that complexity.

**Apply this by:**
- Writing top-level functions as sequences of well-named calls
- Extracting gnarly logic into dedicated helper functions
- Keeping conditionals and loops shallow at high levels
- Making each line in a high-level function represent one logical step

**Caveat:** "Down" means into cohesive abstractions, not arbitrary depth. If a helper requires understanding its caller's context to make sense, the boundary is wrong. Prefer fewer layers with clear contracts over many thin layers.

**Quick test:** Can I understand this function's purpose by reading just the first screen of code?

**Signs of violation:** Top-level functions with deeply nested logic; business logic mixed with serialization/parsing; orchestration code that handles error formatting; more than 2 levels of nesting in high-level functions; high-level code containing byte manipulation or protocol details.

### 8. Small Components Are Fine

A module with one function, a struct with one field, a file with twenty lines—these are perfectly valid if they encapsulate a distinct concept. The goal is clarity of responsibility, not minimum line counts.

**Apply this by:**
- Creating small, focused abstractions without guilt
- Valuing conceptual clarity over "efficiency" of file count
- Trusting that good naming makes small components discoverable

**Balance:** Many small files are fine if naming and organization make them discoverable. If developers frequently struggle to find where something lives, the structure may be too granular or poorly organized.

**When to consolidate:** Two small components that always change together and are never used independently can be merged.

**Quick test:** Does this component have a clear name that isn't just restating its one-line implementation?

**Signs of violation:** Mega-files justified by "might as well put it here"; reluctance to extract because "it's only one function"; unrelated utilities dumped in a `misc` or `utils` module; files containing grab-bags of unrelated helpers.

### 9. Precise Naming

Names should accurately describe what something does. Misleading names are worse than verbose ones. Generic names are a smell.

**Apply this by:**
- Using verbs for functions (`validate_user`), nouns for data (`user_config`)
- Avoiding vague names: `handle`, `process`, `do`, `manage`, `data`, `info`, `utils`
- Renaming when behavior changes—don't let names drift from reality
- Preferring longer descriptive names over short ambiguous ones

**Quick test:** Could someone guess what this does from the name alone?

**Signs of violation:** Functions named `process` that validate and transform and persist; variables named `data` or `result` or `tmp`; outdated names left after refactoring; `utils` modules that grow unboundedly.

### Resolving Conflicts

When principles conflict, use this hierarchy (earlier wins):

1. **Clear Boundaries** over Single Responsibility—don't expose internals just to achieve a cleaner split
2. **Single Source of Truth** over Clear Boundaries—wide dependencies on canonical definitions are acceptable
3. **Fail Fast** over convenience—surface errors early even if it requires more validation code
4. **Readability** over theoretical purity—if following a principle makes code harder to understand, reconsider

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
  - `agents/` - Agent prompt templates (markdown files: planner.md, worker.md, etc.)
  - `workflow.yaml` - Optional workflow configuration file (uses default if not present)

### Core Library Architecture (`crates/orkestra-core/`)

The core library is organized around the `workflow/` module, which provides a configurable workflow system:

- **`workflow/adapters/`** - Storage implementations (`SqliteWorkflowStore`, `InMemoryWorkflowStore`, `Git2GitService`)
- **`workflow/config/`** - Workflow configuration loading and stage definitions
- **`workflow/domain/`** - Core domain models (`Task`, `Iteration`, `Question`, `LogEntry`, `StageSession`)
- **`workflow/execution/`** - Agent execution logic (`AgentRunner`, `PromptBuilder`, `StageOutput`)
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
- **`StageConfig`** (`stage.rs`) — A stage has a `name`, `artifact` (output name), `inputs` (artifacts from earlier stages), `capabilities`, and either a `prompt` (agent stage) or `script` (script stage). Agent stages default to `.orkestra/agents/{name}.md` when no explicit prompt is set.
- **`StageCapabilities`** (`stage.rs`) — Flags that control what output types the stage's JSON schema includes: `ask_questions`, `produce_subtasks`, `subtask_flow: Option<String>`, `supports_restage: Vec<String>`.
- **`ScriptStageConfig`** (`stage.rs`) — Shell command, timeout, optional `on_failure` stage for recovery.
- **`FlowConfig`** (`workflow.rs`) — Named alternate flow (shortened pipeline). Has a `description`, optional `icon`, and an ordered list of `FlowStageEntry`s referencing a subset of global stages with optional overrides.
- **`FlowStageEntry`** (`workflow.rs`) — A stage reference in a flow, with optional `FlowStageOverride` for `prompt` and `capabilities` (full replacement, not merge).

**Runtime types** (`workflow/runtime/`, `workflow/domain/`):

- **`Phase`** — Current execution state: `Idle`, `SettingUp`, `AgentWorking`, `AwaitingReview`, `Integrating`.
- **`Iteration`** — Each agent/script run within a stage. Rejections create new iterations with feedback.
- **`Artifact`** — Named output content stored on the task, keyed by artifact name.

#### How Stages Execute

The `OrchestratorLoop` (`workflow/services/orchestrator.rs`) runs a 100ms tick loop:

1. **Poll completed executions** — `StageExecutionService` reports finished agents/scripts
2. **Process output** — `WorkflowApi::process_agent_output()` stores the artifact and transitions the task (to `AwaitingReview` or auto-advances if `is_automated`)
3. **Start new executions** — finds tasks in `Idle` phase with an active stage, spawns via `StageExecutionService`
4. **Start integrations** — merges Done tasks' branches into their base branch, falling back to primary (one-tick delay to avoid same-tick race)

For **agent stages**, `StageExecutionService` (`workflow/services/stage_execution.rs`) delegates to `AgentExecutionService` (`workflow/services/agent_execution.rs`), which:
- Builds a prompt via `PromptBuilder` (`workflow/execution/prompt.rs`) — loads the agent's `.md` template, injects task context and input artifacts
- Generates a JSON schema via `generate_stage_schema()` (`prompts/mod.rs`) — composes schema components based on `StageCapabilities`
- Spawns Claude Code with `--output-format json --json-schema <schema>`

For **script stages**, `StageExecutionService` runs the command via `sh -c` in the task's worktree directory.

#### JSON Schema Generation

`generate_stage_schema()` in `prompts/mod.rs` builds a discriminated union schema from reusable components in `prompts/schemas/components/`:

- **Always included**: `artifact.json` (produces content), `terminal.json` (failed/blocked states)
- **If `ask_questions`**: adds `questions.json` (array of questions with options)
- **If `produce_subtasks`**: adds `subtasks.json` (array of subtasks with dependencies)
- **If `supports_restage` is non-empty**: adds `restage.json` (target stage + feedback)

The `type` field enum is built dynamically: always `[artifact_name, "failed", "blocked"]`, plus capability-specific types. Custom schemas can override this via `schema_file` on `StageConfig`.

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
- `restage` targets and script `on_failure` targets must be within the flow's stage list

This project defines two flows: `quick` (skips breakdown and compound) and `hotfix` (skips planning, breakdown, and compound).

#### Subtask System

Stages with `produce_subtasks: true` (e.g., breakdown) can output a list of subtasks. When their artifact is approved, `SubtaskService` (`workflow/services/subtask_service.rs`) creates child tasks:

- **Parent-child relationship**: Subtasks have `parent_id` linking to the parent task. They don't appear on the Kanban board — only the parent does.
- **Flow assignment**: Subtasks use the flow specified by `subtask_flow` on the stage's capabilities (e.g., breakdown produces subtasks that run through the `quick` flow). If `subtask_flow` is None, subtasks use the full pipeline.
- **Dependencies**: Subtasks can depend on other subtasks (by index in the breakdown output). The orchestrator's `get_tasks_needing_agents()` only schedules subtasks whose dependencies are all done.
- **Artifact inheritance**: Each subtask inherits the parent's plan artifact so agents have context.
- **Parent lifecycle**: After creating subtasks, the parent enters `WaitingOnChildren` status. `advance_completed_parents()` in the orchestrator checks each tick whether all subtasks are done — if so, the parent advances to its next stage. If any subtask fails, the parent is marked failed.
- **Kanban display**: The parent task is visually placed in the breakdown column while subtasks are running. The frontend shows a subtasks tab with progress tracking.

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
- **compound.md**: Captures learnings and fixes stale documentation

The prompt builder injects task context (description, artifacts, questions, feedback) into these templates.

Note: Title generation uses a separate internal template (`prompts/templates/title_generator.md`) since it's a utility function, not a configurable stage agent.

### Tauri Commands

Commands are organized in `src-tauri/src/commands/` by concern:

**Task CRUD** (`task_crud.rs`):
- `workflow_get_tasks`, `workflow_get_task`, `workflow_create_task`, `workflow_create_subtask`, `workflow_delete_task`, `workflow_list_subtasks`

**Human Actions** (`human_actions.rs`):
- `workflow_approve` - Approve current stage, advance to next
- `workflow_reject` - Reject with feedback, create new iteration
- `workflow_answer_questions` - Answer pending agent questions
- `workflow_integrate_task` - Merge task branch to its base branch (defaults to primary)

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
- **Session-based recovery**: Session IDs are stored in the database before agent spawn, enabling `--resume` on restart

### Worktree Setup

When a new worktree is created for a task, `.orkestra/worktree_setup.sh` runs automatically. Use this for project-specific setup:

```bash
WORKTREE_PATH="$1"
# Copy .env, run pnpm install, etc.
```
