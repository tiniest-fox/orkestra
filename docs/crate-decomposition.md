# Crate Decomposition Plan

Split `orkestra-core` (33k lines, 81 files) into 9 focused crates for faster incremental builds.

## Motivation

Clippy takes ~40s because every change recompiles the entire 33k-line monolith. The codebase already follows a ports/adapters pattern with clean internal boundaries — the module structure maps directly to crate boundaries.

**Expected improvement**: ~60% faster incremental clippy for the most common case (service/orchestration changes). Clean builds benefit from 4 levels of parallelism.

## Target Structure

| Crate | ~Lines | What it owns | Heavy deps |
|-------|--------|-------------|------------|
| **orkestra-types** | 8.7k | Domain types, config, port traits | serde, chrono |
| **orkestra-process** | 850 | ProcessGuard, kill/spawn, ProcessSpawner trait | libc only |
| **orkestra-git** | 1.9k | Git2GitService, diffs | git2 (C code) |
| **orkestra-store** | 2.0k | SQLite/InMemory stores, migrations | rusqlite (C code) |
| **orkestra-schema** | 530 | JSON schema generation | — |
| **orkestra-prompt** | 1.9k | Prompt template rendering | handlebars |
| **orkestra-parser** | 2.9k | Claude/OpenCode output parsing | jsonschema, regex |
| **orkestra-agent** | 2.4k | AgentRunner, ScriptRunner, ProviderRegistry | — |
| **orkestra-core** | 11.5k | Orchestration, API, all services | everything |

## Dependency Graph

```
    orkestra-types          orkestra-process
   /   |    |    \               |
 git  store schema parser      agent (also → parser + types)
               \    /
              prompt (also → schema + types)
                |
              core (→ all)
```

Clean build parallelism:
1. **types** + **process** (parallel, zero orkestra deps)
2. **git** + **store** + **schema** + **parser** (parallel, only need types)
3. **prompt** + **agent** (parallel, need types + one other)
4. **core** (needs everything)

## Incremental Build Impact

| What you change | What recompiles | Before | After |
|----------------|-----------------|--------|-------|
| Orchestrator logic | core only | 33k lines | 11.5k lines |
| Agent parser | parser + agent + core | 33k lines | ~17k lines |
| Git operations | git + core | 33k lines | ~13k lines |
| SQLite queries | store + core | 33k lines | ~13k lines |
| Prompt templates | prompt + core | 33k lines | ~13k lines |
| Domain type | types + everything | 33k lines | 33k lines (same, but rare) |

---

## Crate Details

### 1. `orkestra-types` — Domain types, config, port traits

The foundation crate. Pure data types, serialization, and trait contracts. No side effects except config file loading.

**Dependencies**: serde, serde_json, serde_yaml, chrono, thiserror, indexmap, dirs, pulldown-cmark

**Why standalone**: Domain types change rarely. Everything depends on them but they depend on nothing. Keeping them stable means downstream crates stay cached.

**Design note**: `WorkflowStore` and `GitService` port traits live here because they reference domain types and are imported everywhere. `ProcessSpawner` trait does NOT — it depends on `ProcessGuard` which needs libc for kill-on-drop, so it goes in orkestra-process.

#### File inventory

| File | Lines | Current location |
|------|-------|-----------------|
| `domain/task.rs` | 388 | `workflow/domain/` |
| `domain/iteration.rs` | 376 | `workflow/domain/` |
| `domain/question.rs` | 210 | `workflow/domain/` |
| `domain/log_entry.rs` | 281 | `workflow/domain/` |
| `domain/stage_session.rs` | 316 | `workflow/domain/` |
| `domain/assistant_session.rs` | 232 | `workflow/domain/` |
| `domain/task_view.rs` | 570 | `workflow/domain/` |
| `domain/mod.rs` | 20 | `workflow/domain/` |
| `runtime/artifact.rs` | 299 | `workflow/runtime/` |
| `runtime/status.rs` | 302 | `workflow/runtime/` |
| `runtime/outcome.rs` | 500 | `workflow/runtime/` |
| `runtime/transition.rs` | 479 | `workflow/runtime/` |
| `runtime/markdown.rs` | 61 | `workflow/runtime/` |
| `runtime/mod.rs` | 16 | `workflow/runtime/` |
| `config/stage.rs` | 689 | `workflow/config/` |
| `config/workflow.rs` | 1300 | `workflow/config/` |
| `config/loader.rs` | 159 | `workflow/config/` |
| `config/auto_task.rs` | 318 | `workflow/config/` |
| `config/mod.rs` | 16 | `workflow/config/` |
| `ports/store.rs` | 731 | `workflow/ports/` |
| `ports/git_service.rs` | 579 | `workflow/ports/` |
| `ports/mod.rs` | 20 | `workflow/ports/` |
| `project.rs` | 166 | top-level |
| `debug_log.rs` | 283 | top-level |
| `error.rs` | 50 | top-level |

---

### 2. `orkestra-process` — Process management

Low-level process spawning, killing, and lifecycle management. Zero domain knowledge.

**Dependencies**: libc (no orkestra deps)

**Why standalone**: Process management is a standalone concern. Used by agent execution and orchestration but knows nothing about either.

#### File inventory

| File | Lines | Notes |
|------|-------|-------|
| Generic parts of `process.rs` | ~400 | `ProcessGuard`, `kill_process_tree`, `is_process_running`, `ParsedStreamEvent`, signal handling |
| `ports/process_spawner.rs` | 309 | `ProcessSpawner` trait |

**What stays behind**: Claude/OpenCode-specific spawn helpers (`spawn_claude_process`, `prepare_path_env`, `write_prompt_to_stdin`) move to orkestra-agent alongside their ProcessSpawner implementations.

---

### 3. `orkestra-git` — Git operations ✅ COMPLETE

**Extracted.** First crate to follow the standard module structure (interface → service → interactions → utilities → types → mock). See `crates/orkestra-git/` and the Module Structure section in `CLAUDE.md`.

- 24 interactions, each a single `execute()` leaf operation
- Shared helpers in `utilities/` (stash, diff parsing, git2 helpers, CLI resolution)
- `MockGitService` behind `testutil` feature
- orkestra-core re-exports types via `workflow::ports` — no downstream breakage
- 16 unit tests in crate, all 868 orkestra-core tests pass

---

### 4. `orkestra-store` — Persistence

SQLite and in-memory implementations of the WorkflowStore trait. The "ORM" layer.

**Dependencies**: orkestra-types (for WorkflowStore trait + domain types), rusqlite (bundled), refinery, petname, serde_json

**Why standalone**: rusqlite with bundled SQLite compiles C code (~1-2s). Database queries change independently from orchestration logic. Unit tests can exercise every query in isolation.

#### File inventory

| File | Lines | Current location |
|------|-------|-----------------|
| `sqlite.rs` | 1320 | `workflow/adapters/` |
| `memory.rs` | 448 | `workflow/adapters/` |
| `connection.rs` | 196 | top-level `adapters/sqlite/` |
| `migrations/` | — | `adapters/sqlite/migrations/` |

---

### 5. `orkestra-schema` — JSON schema generation

Generates JSON schemas dynamically from stage configuration. Tells agents what output format to produce.

**Dependencies**: serde_json, jsonschema (no orkestra-types — `SchemaConfig` uses plain booleans)

**Why standalone**: Pure logic, zero I/O. Schema generation is a distinct concern from prompt rendering. Tests validate schema correctness without needing templates or handlebars.

#### File inventory

| File | Lines | Current location |
|------|-------|-----------------|
| `prompts/mod.rs` | 323 | top-level `prompts/` |
| `prompts/examples.rs` | 203 | top-level `prompts/` |

Plus embedded JSON schema files from `prompts/schemas/`.

---

### 6. `orkestra-prompt` — Prompt template rendering

Builds the full prompt sent to agents by combining templates, task context, artifacts, and schemas.

**Dependencies**: orkestra-types (config + domain types), orkestra-schema (for schema injection), handlebars

**Why standalone**: Prompt construction is independently testable. You can verify prompt correctness without spawning agents. Changes to prompt format don't recompile parsers or process code.

#### File inventory

| File | Lines | Current location |
|------|-------|-----------------|
| `prompt.rs` | 1725 | `workflow/execution/` |
| `prompt_service.rs` | 180 | `workflow/services/` |

---

### 7. `orkestra-parser` — Agent output parsing

Parses and validates structured output from Claude Code and OpenCode agents.

**Dependencies**: orkestra-types (for domain types), jsonschema, serde_json, strip-ansi-escapes

**Why standalone**: Parser tests are the most numerous and most valuable to run fast. Pure logic, zero I/O. Adding a new agent provider means adding a parser here without touching orchestration.

**Key type**: `StageOutput` enum (Artifact, Questions, Subtasks, Approval, Failed, Blocked) — the universal output type consumed by all services.

#### File inventory

| File | Lines | Current location |
|------|-------|-----------------|
| `output.rs` | 595 | `workflow/execution/` |
| `parser/mod.rs` | 343 | `workflow/execution/parser/` |
| `parser/claude.rs` | 645 | `workflow/execution/parser/` |
| `parser/opencode.rs` | 1310 | `workflow/execution/parser/` |

The 3 pure parsing functions from `session_logs.rs` (`parse_resume_marker`, `extract_tool_result_content`, `parse_tool_input`) also move here since they're consumed by parsers and have no service deps.

---

### 8. `orkestra-agent` — Agent & script execution runtime

Spawns and manages agent processes. Bridges the process layer with the parsing layer.

**Dependencies**: orkestra-types, orkestra-process (for ProcessGuard/ProcessSpawner), orkestra-parser (for StageOutput/parsing)

**Why standalone**: Adding a new agent provider (e.g., Cursor, Aider) means adding a process spawner + parser, both isolated from orchestration. MockAgentRunner is the test seam — exposed via feature flag for integration tests.

**Key types**: `AgentRunner` (trait + impl), `MockAgentRunner` (behind `testutil` feature), `ProviderRegistry`, `ScriptHandle`

#### File inventory

| File | Lines | Current location |
|------|-------|-----------------|
| `runner.rs` | 992 | `workflow/execution/` |
| `script_runner.rs` | 535 | `workflow/execution/` |
| `provider_registry.rs` | 657 | `workflow/execution/` |
| `claude_process.rs` | 91 | `workflow/adapters/` |
| `opencode_process.rs` | 129 | `workflow/adapters/` |

Plus Claude-specific spawn helpers (~140 lines) from `process.rs` (`spawn_claude_process`, `prepare_path_env`, `write_prompt_to_stdin`).

---

### 9. `orkestra-core` — Orchestration, API, services (slimmed)

The "application layer" that wires everything together. Contains the orchestrator loop, all business logic services, and the public API.

**Dependencies**: all other orkestra crates

**Why still one crate**: Services are tightly coupled through WorkflowApi — agent_actions, human_actions, orchestrator, integration all reference each other. Splitting further would require heavy trait indirection for marginal build time gain. At 11.5k lines (down from 33k) it's a reasonable compilation unit.

**Future split opportunity**: If core grows, the orchestrator + execution coordination (~2.4k lines) could split from state management services (~3.5k lines).

#### File inventory

| File | Lines | Module |
|------|-------|--------|
| `orchestrator.rs` | 1156 | Tick loop, state machine |
| `api.rs` | 386 | WorkflowApi entry point |
| `agent_actions.rs` | 1435 | Process agent output |
| `human_actions.rs` | 1068 | Approve/reject/answer |
| `stage_execution.rs` | 740 | Spawn/poll execution |
| `agent_execution.rs` | 635 | Agent-specific execution |
| `script_execution.rs` | 467 | Script-specific execution |
| `integration.rs` | 588 | Git integration (merge/rebase) |
| `session_service.rs` | 852 | Session lifecycle |
| `session_logs.rs` | ~380 | Log persistence (pure fns moved to parser) |
| `queries.rs` | 829 | Read-only queries |
| `task_crud.rs` | 517 | Task CRUD |
| `task_setup.rs` | 241 | Worktree/branch setup |
| `subtask_service.rs` | 147 | Subtask creation |
| `iteration_service.rs` | 263 | Iteration tracking |
| `log_service.rs` | 110 | Log persistence |
| `assistant.rs` | 613 | Assistant chat |
| `cleanup.rs` | 148 | Process cleanup |
| `periodic.rs` | 118 | Periodic scheduling |
| `init.rs` | 111 | .orkestra setup |
| `utility/mod.rs` | 457 | Title generation, utility runner |
| `title.rs` | 153 | Title prompt template |
| `testutil/` | 516 | Test helpers + fixtures |

---

## Implementation Phases

### Phase 1: Extract `orkestra-types` (foundation)

This is the largest extraction and unblocks everything else.

- [ ] Create `crates/orkestra-types/Cargo.toml` with deps: serde, serde_json, serde_yaml, chrono, thiserror, indexmap, dirs, pulldown-cmark
- [ ] Move `workflow/domain/` → `orkestra-types/src/domain/`
- [ ] Move `workflow/runtime/` → `orkestra-types/src/runtime/`
- [ ] Move `workflow/config/` → `orkestra-types/src/config/`
- [ ] Move `workflow/ports/store.rs` and `workflow/ports/git_service.rs` → `orkestra-types/src/ports/`
- [ ] Move `project.rs`, `debug_log.rs`, `error.rs` → `orkestra-types/src/`
- [ ] Do NOT move `ports/process_spawner.rs` (depends on ProcessGuard/libc)
- [ ] Write `orkestra-types/src/lib.rs` re-exporting all public types
- [ ] Add `orkestra-types` as dependency in orkestra-core's Cargo.toml
- [ ] Re-export everything from orkestra-core's lib.rs so downstream (CLI, Tauri) doesn't break
- [ ] Update all `crate::workflow::domain::` imports in orkestra-core to use `orkestra_types::`
- [ ] `cargo test -p orkestra-types` — unit tests pass
- [ ] `cargo test -p orkestra-core` — all tests still pass

### Phase 2: Extract `orkestra-process`

Small, quick extraction.

- [ ] Create `crates/orkestra-process/Cargo.toml` with dep: libc
- [ ] Move generic parts of `process.rs` → `orkestra-process/src/lib.rs` (`ProcessGuard`, `kill_process_tree`, `is_process_running`, `ParsedStreamEvent`, signal handling)
- [ ] Move `workflow/ports/process_spawner.rs` → `orkestra-process/src/spawner.rs`
- [ ] Leave Claude-specific spawn helpers in orkestra-core temporarily (they move to orkestra-agent in Phase 5)
- [ ] `cargo test -p orkestra-process` — unit tests pass
- [ ] `cargo test -p orkestra-core` — all tests still pass

### Phase 3: Extract `orkestra-git` and `orkestra-store` (parallel)

Both depend only on orkestra-types. Can be done simultaneously.

**orkestra-git:** ✅ COMPLETE — extracted with 5-layer module structure (interface, service, interactions, utilities, types, mock)

**orkestra-store:**
- [ ] Create `crates/orkestra-store/Cargo.toml` with deps: orkestra-types, rusqlite (bundled), refinery, petname, serde_json
- [ ] Move `workflow/adapters/sqlite.rs` → `orkestra-store/src/sqlite.rs`
- [ ] Move `workflow/adapters/memory.rs` → `orkestra-store/src/memory.rs`
- [ ] Move `adapters/sqlite/connection.rs` → `orkestra-store/src/connection.rs`
- [ ] Move `adapters/sqlite/migrations/` → `orkestra-store/src/migrations/`
- [ ] `cargo test -p orkestra-store` — unit tests pass

- [ ] `cargo test -p orkestra-core` — all tests still pass after both extractions

### Phase 4: Extract `orkestra-schema` and `orkestra-parser` (parallel)

**orkestra-schema:** ✅ DONE
- [x] Create `crates/orkestra-schema/Cargo.toml` with deps: serde_json, jsonschema
- [x] Move schema generation → `generate_schema.rs`, types → `types.rs`, examples → `examples.rs`
- [x] Move embedded JSON schema files
- [x] `SchemaConfig` uses plain booleans (no orkestra-types dependency needed)
- [x] orkestra-core re-exports via `prompts/mod.rs` — zero import changes for callers
- [x] `cargo test -p orkestra-schema` — 12 tests pass

**orkestra-parser:**
- [ ] Create `crates/orkestra-parser/Cargo.toml` with deps: orkestra-types, jsonschema, serde_json, strip-ansi-escapes
- [ ] Move `workflow/execution/output.rs` → `orkestra-parser/src/output.rs`
- [ ] Move `workflow/execution/parser/` → `orkestra-parser/src/parser/`
- [ ] Move 3 pure parsing functions from `session_logs.rs` → `orkestra-parser/src/log_parsing.rs`
- [ ] `cargo test -p orkestra-parser` — unit tests pass

- [ ] `cargo test -p orkestra-core` — all tests still pass after both extractions

### Phase 5: Extract `orkestra-prompt` and `orkestra-agent` (parallel)

**orkestra-prompt:** ✅ DONE
- [x] Create `crates/orkestra-prompt/Cargo.toml` with deps: orkestra-types, orkestra-schema, handlebars
- [x] Extract pure prompt logic from `prompt.rs` into orkestra-prompt (interactions/build/, interactions/resume/, service, types)
- [x] Slim orkestra-core `prompt.rs` to I/O wrapper + re-exports
- [x] `cargo test -p orkestra-prompt` — 31 unit tests pass
- [x] `cargo test -p orkestra-core` — all 346+138 tests pass
- [x] `cargo clippy --workspace` — zero warnings

**orkestra-agent:**
- [ ] Create `crates/orkestra-agent/Cargo.toml` with deps: orkestra-types, orkestra-process, orkestra-parser
- [ ] Add `testutil` feature flag exposing MockAgentRunner
- [ ] Move `workflow/execution/runner.rs` → `orkestra-agent/src/runner.rs`
- [ ] Move `workflow/execution/script_runner.rs` → `orkestra-agent/src/script_runner.rs`
- [ ] Move `workflow/execution/provider_registry.rs` → `orkestra-agent/src/provider_registry.rs`
- [ ] Move `workflow/adapters/claude_process.rs` → `orkestra-agent/src/claude_process.rs`
- [ ] Move `workflow/adapters/opencode_process.rs` → `orkestra-agent/src/opencode_process.rs`
- [ ] Move Claude-specific spawn helpers from `process.rs` → `orkestra-agent/src/claude_process.rs`
- [ ] `cargo test -p orkestra-agent` — unit tests pass

- [ ] `cargo test -p orkestra-core` — all tests still pass after both extractions

### Phase 6: Clean up orkestra-core

- [ ] Remove all moved modules and files from orkestra-core
- [ ] Update imports in all remaining services to use the new crate paths
- [ ] Add re-exports in orkestra-core `lib.rs` for CLI/Tauri backwards compatibility
- [ ] Remove unused dependencies from orkestra-core's Cargo.toml (git2, rusqlite, refinery, jsonschema, handlebars)
- [ ] `cargo test -p orkestra-core` — all 569+ tests pass
- [ ] `cargo clippy -p orkestra-core` — no warnings

### Phase 7: Update workspace and verify

- [ ] Add all 8 new crates to workspace `Cargo.toml` members list
- [ ] Update CLI (`cli/Cargo.toml`) to depend on new crates as needed
- [ ] Update Tauri (`src-tauri/Cargo.toml`) to depend on new crates as needed
- [ ] Add `[profile.dev.package."*"] opt-level = 2` to root Cargo.toml
- [ ] `cargo build --workspace` — all crates compile
- [ ] `cargo test --workspace` — all tests pass
- [ ] `cargo clippy --workspace` — no new warnings
- [ ] `pnpm tauri dev` — Tauri app works
- [ ] `time cargo clippy -p orkestra-core` — measure improvement vs baseline
- [ ] Test individual crates: `cargo test -p orkestra-parser`, `cargo test -p orkestra-git`, etc.

---

## Coupling Notes and Gotchas

### ProcessSpawner trait placement
The `ProcessSpawner` trait cannot live in orkestra-types even though other port traits do. It depends on `ProcessGuard` which uses libc for kill-on-drop semantics. It lives in orkestra-process instead.

### session_logs.rs split
`session_logs.rs` (579 lines) contains both pure parsing functions and service-level log persistence code. The 3 pure parsing functions (`parse_resume_marker`, `extract_tool_result_content`, `parse_tool_input`) move to orkestra-parser. The remaining ~380 lines of log persistence stay in orkestra-core.

### process.rs split
`process.rs` (540 lines) contains both generic process utilities and Claude-specific spawn helpers. Generic parts (ProcessGuard, kill_process_tree, signal handling) move to orkestra-process. Claude-specific helpers (spawn_claude_process, prepare_path_env, write_prompt_to_stdin) move to orkestra-agent alongside ClaudeProcessSpawner.

### Re-export strategy
After each phase, orkestra-core re-exports moved types so that CLI and Tauri imports don't break until Phase 7. This allows incremental extraction without touching downstream crates until the end.

### Config loader's filesystem access
`config/loader.rs` reads `.orkestra/workflow.yaml` from disk. This is the one I/O operation in orkestra-types. Acceptable because config loading is a foundational concern and the alternative (putting it in core) would force every config type to also live in core.

### InMemoryWorkflowStore for tests
`InMemoryWorkflowStore` is used extensively in orkestra-core's e2e tests. After extraction to orkestra-store, orkestra-core's dev-dependencies must include `orkestra-store`. This is already the normal pattern.

### MockAgentRunner feature flag
`MockAgentRunner` is currently `#[cfg(test)]` in the execution module. After moving to orkestra-agent, it needs to be behind a `testutil` feature flag so orkestra-core's integration tests can use it: `orkestra-agent = { path = "../orkestra-agent", features = ["testutil"] }`.

### E2e tests stay in orkestra-core
The `tests/e2e/` directory and `TestEnv` remain in orkestra-core since they exercise the full integrated stack. Individual crate tests cover unit-level correctness; e2e tests validate the wiring.

### testutil module
`testutil/` (fixtures for tasks, iterations, sessions, git helpers) stays in orkestra-core behind its existing `testutil` feature flag. The fixture types reference domain types from orkestra-types and store types from orkestra-store.

---

## Testing Strategy

- **Unit tests travel with their code** — each crate gets its own `#[cfg(test)]` modules
- **E2e tests stay in orkestra-core** — TestEnv needs the full stack
- **MockAgentRunner** exposed from orkestra-agent via `testutil` feature flag
- **InMemoryWorkflowStore** exposed from orkestra-store (already public)
- Each crate can be tested independently: `cargo test -p orkestra-parser`, etc.
- Run full suite after each phase: `cargo test -p orkestra-core`

## Verification Checklist

After all phases complete:

- [ ] `cargo build --workspace` compiles
- [ ] `cargo test --workspace` — all tests pass
- [ ] `cargo clippy --workspace` — no warnings
- [ ] `pnpm tauri dev` — Tauri app works
- [ ] `bin/ork task list` — CLI works
- [ ] `time cargo clippy -p orkestra-core` — measure improvement
- [ ] Verify individual crate tests: `cargo test -p orkestra-{types,process,git,store,schema,parser,prompt,agent}`
