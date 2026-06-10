# CLAUDE.md - orkestra-types

AI agent guidance for working in the orkestra-types crate.

## Crate Purpose

orkestra-types is the shared types foundation for Orkestra. It defines domain models, runtime state, and configuration types with no I/O dependencies. All other Orkestra crates depend on this one for type definitions.

## Module Structure

```
src/
├── lib.rs              # Re-exports all modules
├── config/
│   ├── mod.rs          # Re-exports config types
│   ├── stage.rs        # StageConfig, StageCapabilities, GateConfig
│   └── workflow.rs     # WorkflowConfig, FlowConfig, IntegrationConfig
├── domain/
│   ├── mod.rs          # Re-exports domain types
│   ├── task.rs         # Task, TaskHeader, TickSnapshot
│   ├── token_usage.rs  # TokenUsage, compute_transcript_path (pub — needed cross-crate by orkestra-agent)
│   ├── iteration.rs    # Iteration, IterationTrigger
│   ├── question.rs     # Question, QuestionOption, QuestionAnswer
│   ├── log_entry.rs    # LogEntry, OrkAction, ToolInput
│   ├── stage_session.rs # StageSession, SessionState
│   └── assistant_session.rs # AssistantSession
└── runtime/
    ├── mod.rs          # Re-exports runtime types
    ├── status.rs       # TaskState (unified state enum)
    ├── artifact.rs     # Artifact, ArtifactStore
    ├── outcome.rs      # Outcome (iteration completion reason)
    └── markdown.rs     # markdown_to_html helper
```

## Type Categories

### Config Types (from YAML)
- **WorkflowConfig**: Map of named flows (each flow owns its stages and integration config)
- **StageConfig**: Stage definition (name, artifact, capabilities, prompt/script)
- **StageCapabilities**: Feature flags (subtasks)
- **FlowConfig**: Named pipeline with its own stages and integration config

### Domain Types (runtime entities)
- **Task**: Main entity — identity, state, artifacts, git info, hierarchy
- **TaskHeader**: Lightweight Task without artifacts (for orchestrator routing)
- **Iteration**: Single agent run within a stage (tracks rejections/retries)
- **IterationTrigger**: Why an iteration exists (Feedback, Rejection, Answers, etc.)

### Runtime Types (execution state)
- **TaskState**: Unified enum replacing old Status + Phase pair
- **Artifact**: Named output (content, stage, iteration, timestamp)
- **ArtifactStore**: HashMap-backed collection with query helpers
- **Outcome**: How an iteration ended (Approved, Rejected, etc.)

## Patterns

### Config Structs Must Reject Unknown Fields

All user-facing config structs (types deserialized from `workflow.yaml`) must include `#[serde(deny_unknown_fields)]`. This ensures that when a field is removed from the struct, stale YAML in production configs and test fixtures causes a hard parse error rather than silently being ignored.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct FlowConfig { ... }
```

When adding `deny_unknown_fields` to a struct, add a regression test following the pattern of `test_artifact_config_rejects_unknown_fields` in `stage.rs`. This guards against the attribute being accidentally removed.

**When removing a field:** update both production YAML files (`.orkestra/workflow.yaml` and `crates/orkestra-core/src/defaults/workflow.yaml`) and all test fixtures that use inline YAML strings (grep for the field name in both `src/config/` and `tests/`).

### Derive-Heavy Data Types
All types derive `Serialize`, `Deserialize`, `Clone`, and usually `Debug` + `PartialEq`. Use serde attributes for clean serialization:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskState { ... }
```

### Builder Pattern
Types with many optional fields use builder methods:

```rust
let task = Task::new(id, title, desc, stage, time)
    .with_parent(parent_id)
    .with_branch(branch)
    .with_base_branch(base);
```

### Query Methods
Domain types expose query methods for common checks:

```rust
task.is_terminal()
task.is_subtask()
task.current_stage()
state.needs_human_action()
state.has_active_agent()
```

## Key Type: TaskState

`TaskState` is the single source of truth for task execution state. It replaced the old `Status` + `Phase` pair to eliminate ambiguity.

**Variants carry context:**
- Most variants include `{ stage: String }` for the current stage
- Terminal variants (`Failed`, `Blocked`) carry optional error/reason
- `Integrating` has no stage (it's a cross-stage operation)

**State categories:**
- Setup: `AwaitingSetup`, `SettingUp`
- Queued: `Queued`
- Active: `AgentWorking`, `Finishing`, `Committing`, `Integrating`
- Awaiting Human: `AwaitingApproval`, `AwaitingQuestionAnswer`, `AwaitingRejectionConfirmation`, `Interrupted`
- Parent: `WaitingOnChildren`
- Terminal: `Done`, `Archived`, `Failed`, `Blocked`

## Gotchas

### WorkflowConfig::new() Always Pre-Inserts a "default" Flow
`WorkflowConfig::new(stages)` creates a flow named `"default"` and inserts it first in the `IndexMap`. If you later call `.with_flows(flows)`, those flows are appended after `"default"`. This means `config.flows.iter().next()` always returns `"default"`, not the first explicitly-added flow. In tests, look up flows by name: `config.flows.get("my-flow")` rather than `.iter().next()`.

### TaskState String Representation
Use `Display` trait for human-readable output. The `Display` impl includes the stage in parentheses:
```rust
format!("{}", TaskState::agent_working("work")) // "agent_working (work)"
```

### ArtifactStore is HashMap-Backed
`ArtifactStore` serializes as a flat map (via `#[serde(transparent)]`). Don't rely on insertion order.

### Validation is Optional
`WorkflowConfig::validate()` returns errors but doesn't prevent construction. Always call `is_valid()` or `validate()` after loading from YAML.

## Cross-Crate Constants

When multiple crates need to reference the same path format, directory name, or other constant value:

**DO**: Define it in orkestra-types with a public accessor function.

```rust
// In orkestra-types/src/runtime/artifact.rs
const ARTIFACTS_DIR: &str = ".orkestra/.artifacts";

pub fn artifacts_directory() -> &'static str {
    ARTIFACTS_DIR
}

pub fn artifact_file_path(name: &str) -> String {
    format!("{}/{}.md", ARTIFACTS_DIR, name)
}
```

**WHY**: orkestra-types is the shared dependency of both orkestra-core (which writes files) and orkestra-prompt (which references them). This ensures Single Source of Truth across crate boundaries.

**DON'T**: Define the same path/constant independently in multiple crates. If orkestra-core uses `.orkestra/.artifacts` and orkestra-prompt uses a different string, they'll diverge and break.

## Shared Serde Helpers

Custom serde functions used in multiple crates belong in `orkestra-types`, not duplicated across crates. Since almost every crate depends on `orkestra-types`, this is the lowest-friction sharing point.

Example: `deserialize_optional_non_empty_string` normalizes `Some("")` → `None` during deserialization. It lives in `runtime/resource.rs` and should be re-exported if needed by `orkestra-parser` or other crates. Do not copy it — reference it.

```rust
fn deserialize_optional_non_empty_string<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(d)?;
    Ok(s.filter(|s| !s.is_empty()))
}
```

## Anti-Patterns

- **Don't add I/O here**: Storage, network, file operations belong in other crates
- **Don't add business logic**: Orchestration rules belong in `orkestra-core`
- **Don't add CLI/UI concerns**: This crate is for data structures only
- **Don't break serialization compatibility**: Changes to serde attributes can break stored data
