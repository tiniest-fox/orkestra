# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Philosophy

This project has no external users yet. Don't add backwards-compatibility shims or deprecation paths — just make the breaking change directly. Database schema changes still go through migrations (so local databases don't break), but don't worry about migrating existing data gracefully. Code quality and architectural rigor still matter; it's only the external compatibility burden that doesn't.

## Naming Guide: Trak vs Task

"Trak" is the user-facing name for what the codebase internally calls a "task." The CLI subcommand is `ork trak` (with `ork task` as a hidden alias). All user-visible text uses "Trak" — UI strings, help text, agent prompts, documentation. CLI output and JSON/YAML use lowercase `trak`. All code uses "task" — Rust types, database tables, API methods, variables, file paths.

| Use "Trak" / "Traks" (prose) or `trak` (CLI/JSON) | Keep "task" / "tasks" |
|---|---|
| CLI subcommand: `ork trak list` | Rust types: `Task`, `TaskAction`, `task_id` |
| CLI help text and output messages | Database: `workflow_tasks`, column names |
| Frontend UI strings | API methods: `create_task`, `merge_task` |
| Agent prompt prose | Template variables: `{{task_id}}` |
| Documentation and headings | Git branch prefix: `task/` |
| Section labels: "Your Current Trak" | File/module names: `task_crud.rs` |
| | Component names: `NewTaskForm`, `TaskDrawer` |
| | WebSocket events: `task_updated` |

When adding new user-facing prose (UI strings, help text, error messages, documentation), use "Trak". Lowercase `trak` is for symbolic/structured contexts only: CLI subcommand names, JSON keys, YAML fields, and machine-readable output. When adding new code identifiers, use "task".

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

### Module Structure

Modules are organized using building blocks from this toolkit. Assemble the pieces your module needs — not every module requires all layers.

| Building Block | File(s) | When to Use |
|----------------|---------|-------------|
| **Interactions** | `interactions/{domain}/*.rs` | Always — this is where business logic lives. One file per operation, one `execute()` entry point per file. |
| **Types** | `types.rs` | When the module has its own error types or domain models. |
| **Interface** (trait) | `interface.rs` | When you need polymorphism: multiple implementations, mocking, or dependency injection. |
| **Service** | `service.rs` | When you need to group interactions behind a trait with shared state (connections, config). Thin dispatcher — delegates each method to one interaction. |
| **Mock** | `mock.rs` | When callers need a test double. Behind `testutil` feature flag. |

A module with pure functions and no polymorphism (like `orkestra-schema`) only needs types + logic files. A module with I/O and test doubles (like `orkestra-git`) uses all five layers.

**Rules:**

- **One `execute()` per interaction.** This is the only public entry point. `execute()` is always the first function in the file. Private helpers go below it in a `// -- Helpers --` subsection.
- **Interactions are nested by domain.** Navigate with: "What kind of thing am I operating on?" → directory. "What action?" → file. Within the same domain, compose via `super::action::execute()`. Across domains, use `crate::interactions::domain::action::execute()`.
- **Interactions can compose other interactions.** Shared logic that doesn't warrant its own interaction stays as a private function inside the file that needs it.
- **The service is a thin dispatcher.** It holds shared state (connections, config) and delegates each trait method to exactly one interaction's `execute()`. No business logic in the service layer.
- **Multi-step orchestration stays in the caller.** If a workflow requires calling `rebase()` then `merge()` then `push()`, the caller (e.g., `integration.rs` in orkestra-core) owns that sequence and its domain-specific error handling. Don't push composed workflows into the module.
- **No separate utilities layer.** There is no `utilities/` directory. If multiple interactions need the same logic, either one interaction calls the other, or the logic is extracted into its own interaction.
- **Small files are intentional.** A 12-line interaction that wraps a single git command is correct. Predictability and findability beat conciseness.
- **Errors propagate, not swallow.** Interactions return `Result` and use `?`. Only swallow errors when there's an obvious fallback the caller wouldn't care about (e.g., file-not-found → `Ok(None)`).

**Exemplars:** `crates/orkestra-git/` demonstrates all five layers (trait + service + mock). `crates/orkestra-schema/` demonstrates a simpler module (pure functions, types only, no trait).

### File Structure Conventions

Three levels of visual structure keep files scannable without being noisy:

| Level | Syntax | Use for | Skip when |
|-------|--------|---------|-----------|
| File header | `//!` | Every file — one sentence purpose | Never skip |
| Section | `// ====` (76 chars total) | Major divisions: types, impl blocks, tests | File has one concern |
| Subsection | `// -- Name --` | Grouping methods by domain within an impl/trait | <6 methods in block |

**File header** (`//!`) — Every file opens with a doc comment. One sentence for the purpose, optional paragraph for context. This is idiomatic Rust.

**Sections** (`// ====`) — Major structural divisions within a file. Use when a file has multiple distinct concerns (types + impl, helpers + main struct, public API + internals). Tests always get their own section:

```rust
// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
```

**Subsections** (`// --`) — Lightweight grouping within an impl block or trait. Use when methods naturally cluster by domain. Trait definitions and their impls should use matching subsections:

```rust
    // -- Worktree --

    fn create_worktree(...) { ... }
    fn ensure_worktree(...) { ... }
```

**Exemplar:** `crates/orkestra-git/src/interface.rs`, `service.rs`, and `mock.rs` demonstrate all three levels.

## Releasing

Use `bin/release` to cut a release. It handles everything: version bumping, pre-flight checks, committing, tagging, and pushing.

```bash
bin/release 0.2.0   # bump to a specific version
bin/release         # auto-detect: bumps patch if current tag is live, retags HEAD if not
```

The script will prompt before pushing. It requires a clean working tree on `main`.

**Never update version numbers by hand.** `bin/bump-version` is the single source of truth — it updates all 19 `Cargo.toml` files, `package.json`, `src-tauri/tauri.conf.json`, and regenerates `Cargo.lock` atomically. Running `bin/release` calls it automatically.

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

## Verification

Before considering any code change complete, run the full verification suite. All commands must pass with **zero warnings and zero errors**.

```bash
cargo fmt --all -- --check   # Formatting (fix with: cargo fmt --all)
cargo clippy --workspace     # Lints — zero warnings required
cargo test --workspace       # All tests pass
```

When working on a single crate, run crate-level checks first for faster feedback, then the full workspace suite before finishing:

```bash
cargo test -p orkestra-core          # Fast: single crate
cargo test --workspace               # Full: before declaring done
```

## LSP Tools

This project has LSP support for Rust (rust-analyzer) and TypeScript. Prefer the LSP tool over Grep when navigating by symbol: finding definitions, locating all usages, tracing call hierarchies, or finding trait/interface implementations. Grep is still correct for text and pattern searches (string literals, comments, free-form patterns).

LSP operations are position-based — Read the file first to find the line, then call the LSP tool with that position.

## CLI Usage During Development

Run `ork` commands during development using the wrapper script:

```bash
bin/ork trak list
bin/ork trak show <task-id>
bin/ork trak create -t "Title" -d "Description"
```

The `bin/ork` wrapper handles building and running the CLI automatically.

For comprehensive CLI documentation, see [`docs/cli-guide.md`](docs/cli-guide.md).

## Editing Agent Skills

Skills live in `.claude/skills/`. Use `bin/update-skill` to create or modify them — it supports three operations:

```bash
# Replace entire skill file with stdin
echo "content" | bin/update-skill <name> write

# Replace lines start-end with stdin
echo "new content" | bin/update-skill <name> patch <start> <end>

# Delete lines start-end
bin/update-skill <name> delete <start> <end>
```

`<name>` is the skill filename without `.md` (e.g., `storybook`, `e2e-testing`). **Never edit skill files by hand with sed/awk** — use this script so edits are auditable and line-range operations are safe.

## Build Performance

The project uses two caching mechanisms for faster builds:

- **sccache** - Caches Rust compilation artifacts. Configured in `.cargo/config.toml`. Clean builds with warm cache: ~24s (vs ~64s without). If you get inexplicable type errors after changing a crate's public API, sccache may be serving stale artifacts — `touch crates/<crate>/src/lib.rs` forces recompilation.
- **pnpm** - Uses a global content-addressable store with hard links. Fresh `node_modules` install with warm cache: ~1.2s. **If `pnpm install` fails with EACCES on `/opt/pnpm-store`** (root-owned, not world-writable), use a local store: `pnpm install --store-dir ~/.pnpm-store`. The gate script (`checks.sh`) skips `pnpm install` when `node_modules` already exists, so a fully-populated `node_modules` also resolves this.
- **Stale cargo lock files** - If a `cargo` command (or the gate) blocks indefinitely acquiring the build lock, a previous SIGTERM'd cargo process may have left a stale `.cargo-lock` file. Remove with: `rm -f target/debug/.cargo-lock` (and the same path under any worktrees). Worktree paths follow the pattern `.orkestra/.worktrees/<task-id>/target/debug/.cargo-lock`.

## Testing

### Philosophy

Unit tests live alongside the code they test (in `#[cfg(test)]` modules). Any meaningful logic, core behavior, or cross-module flow must also be represented in an e2e test. The goal is: unit tests validate individual components in isolation, e2e tests validate that the system works as a whole.

The core e2e tests are in `crates/orkestra-core/tests/e2e/`. They use `TestEnv` (real SQLite, real orchestrator loop, `MockAgentRunner`). See `crates/orkestra-core/CLAUDE.md` for test infrastructure details, or load the `/e2e-testing` skill for patterns and test-writing guidance.

**E2e test files:**

| File | Covers |
|------|--------|
| `workflow.rs` | Full stage pipelines, approval/rejection loops, questions, flows, gate scripts, interrupt/resume |
| `subtasks.rs` | Subtask creation, dependencies, parent advancement, integration |
| `task_creation.rs` | Task setup, worktree creation, title generation, base branch handling |
| `startup.rs` | Startup recovery (stale PIDs, orphaned worktrees, stuck integrations) |
| `cleanup.rs` | Process killing, zombie cleanup |
| `multi_project.rs` | Multiple projects sharing a database |
| `assistant.rs` | Assistant chat sessions |

## Schema Evolution

**When adding or modifying database migrations:**

1. **Check the highest existing version first** — list `crates/orkestra-store/src/migrations/` and use the next number. Concurrent task branches may have claimed intermediate versions, causing a collision that breaks Refinery's sequential migration requirement.
2. Create the migration file in `crates/orkestra-store/src/migrations/` (follow Refinery naming: `VN__description.sql`)
3. Update `SCHEMA.md` to reflect the schema changes

This ensures schema documentation stays synchronized with the actual database structure.

**Removing serialized enum variants:** Types stored as JSON in SQLite (e.g., `LogEntry` in the logs table) will fail to deserialize with a hard error if you remove a variant that exists in old rows. Per project policy this is acceptable — if you hit this on a local database, delete the affected rows or reset the database (`rm .orkestra/.database/orkestra.db`).

## Cross-Cutting Flow Documentation

These docs trace operations that span multiple files. Read these instead of exploring when working on these flows.

| Flow | Documentation | Key Files |
|------|--------------|-----------|
| **Workflow pipeline** (stages, capabilities, routing, phase transitions) | [`docs/flows/workflow-pipeline.md`](docs/flows/workflow-pipeline.md) | `stage.rs`, `agent_actions.rs`, `human_actions.rs`, `orchestrator.rs` |
| **Stage execution** (orchestrator -> spawn -> prompt -> output) | [`docs/flows/stage-execution.md`](docs/flows/stage-execution.md) | `orchestrator.rs`, `stage_execution.rs`, `agent_execution.rs`, `provider_registry.rs`, `agent_actions.rs`, `prompt.rs` |
| **Task integration** (merge, conflict recovery, cleanup) | [`docs/flows/task-integration.md`](docs/flows/task-integration.md) | `orchestrator.rs`, `integration.rs`, `orkestra-git` |
| **Subtask lifecycle** (breakdown, creation, deps, parent advance) | [`docs/flows/subtask-lifecycle.md`](docs/flows/subtask-lifecycle.md) | `agent_actions.rs`, `human_actions.rs`, `subtask_service.rs`, `orchestrator.rs` |

## Architecture Overview

Orkestra is a task orchestration system that spawns AI coding agents (Claude Code, OpenCode, etc.) to plan and implement software development tasks with human oversight.

### Workspace Structure

- **`crates/orkestra-core/`** - Core library containing task management, agent spawning, and domain logic
- **`crates/orkestra-git/`** - Git operations crate (worktrees, branches, merging, diffs). Reference implementation of the module structure pattern.
- **`crates/orkestra-networking/`** - WebSocket server crate for remote control. Exposes the full WorkflowApi over an authenticated WebSocket connection; consumed by `daemon/`. Also owns the **shared command handler layer** (`interactions/command/`) — functions with signature `fn(&CommandContext, &Value) -> Result<Value, ErrorPayload>` that are called by both Tauri commands and WebSocket dispatch to prevent drift. The command registry (`interactions/command/registry.rs`) is the single source of truth for which commands exist and how they are categorized (shared, desktop-only, transport-specific, WebSocket-only); drift-prevention tests enforce that the WebSocket dispatch table matches. **Note:** Auth interactions (`generate_pairing_code`, `pair_device`, `list_devices`, `revoke_device`, `verify_token`) currently live here as pure database operations with no networking logic — they belong in `orkestra-store` but haven't been moved yet. If you need auth functionality from the CLI, depend on `orkestra-networking` for now.
- **`cli/`** - CLI binary (`ork`) for task management
- **`crates/orkestra-service/`** - Service layer: project provisioning, devcontainer management, toolbox, auth/pairing. **Read [`docs/service-architecture.md`](docs/service-architecture.md) before making changes here.**
- **`service/`** - `ork-service` binary entry point (HTTP API server, project manager).
- **`daemon/`** - Headless daemon binary. Runs the orchestrator and serves the WebSocket API from `orkestra-networking` for remote clients (PWA, mobile).
- **`src-tauri/`** - Tauri desktop application backend. **Read `src-tauri/CLAUDE.md` before making changes in this directory.**
- **`src/`** - React/TypeScript frontend (Kanban board UI). **Read `src/CLAUDE.md` before making changes in this directory.**
- **`.orkestra/`** - Runtime data directory (created on first init with sensible defaults)
  - `.database/orkestra.db` - SQLite database for tasks and sessions
  - `.logs/` - Debug and agent output logs
  - `.worktrees/` - Git worktrees for task isolation (one per task)
  - `scripts/worktree_setup.sh` - Script that runs when creating new worktrees (customize for project-specific setup like copying .env files)
  - `agents/` - Agent prompt templates (planner.md, breakdown.md, worker.md, reviewer.md — defaults created on init, customize per project)
  - `workflow.yaml` - Workflow configuration (default created on init matching the 4-stage pipeline: planning → breakdown → work → review)

### Key Design Patterns

- **SQLite storage**: Tasks stored in `.orkestra/.database/orkestra.db` with full ACID guarantees
- **Git worktrees**: Each task gets an isolated worktree at `.orkestra/.worktrees/{task-id}`, allowing parallel work without conflicts
- **Iteration tracking**: Each agent run within a stage creates an iteration. Rejections create new iterations, allowing for feedback loops
- **Project root detection**: Finds workspace root by looking for `Cargo.toml` with `[workspace]` or `.orkestra/` directory
- **Narrow mutex scopes**: When spawning background work that might call back into the API, gather all inputs while holding the lock, then explicitly `drop(lock)` before spawning. This prevents deadlocks. See `orchestrator.rs::start_integrations()` for an example where commit message generation happens in a background thread without holding the API mutex

### Detailed Architecture Reference

For deep architecture documentation (workflow system, agent system, devcontainer, process management, worktree lifecycle), see [`docs/architecture-reference.md`](docs/architecture-reference.md). Crate-specific guidance lives in each crate's `CLAUDE.md` file.
