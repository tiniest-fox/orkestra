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
│   ├── stage.rs        # StageConfig, StageCapabilities, ScriptStageConfig
│   └── workflow.rs     # WorkflowConfig, FlowConfig, IntegrationConfig
├── domain/
│   ├── mod.rs          # Re-exports domain types
│   ├── task.rs         # Task, TaskHeader, TickSnapshot
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
- **WorkflowConfig**: Ordered stages, integration config, named flows
- **StageConfig**: Stage definition (name, artifact, inputs, capabilities, prompt/script)
- **StageCapabilities**: Feature flags (ask_questions, subtasks, approval)
- **FlowConfig**: Alternate pipeline with stage subset and overrides

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

### TaskState String Representation
Use `Display` trait for human-readable output. The `Display` impl includes the stage in parentheses:
```rust
format!("{}", TaskState::agent_working("work")) // "agent_working (work)"
```

### ArtifactStore is HashMap-Backed
`ArtifactStore` serializes as a flat map (via `#[serde(transparent)]`). Don't rely on insertion order.

### FlowStageEntry Custom Serde
`FlowStageEntry` has custom serialize/deserialize to support YAML shorthand:
- Simple: `"work"` → `FlowStageEntry { stage_name: "work", overrides: None }`
- With overrides: `{ work: { prompt: "worker_quick.md" } }` → entry with overrides

### Validation is Optional
`WorkflowConfig::validate()` returns errors but doesn't prevent construction. Always call `is_valid()` or `validate()` after loading from YAML.

## Anti-Patterns

- **Don't add I/O here**: Storage, network, file operations belong in other crates
- **Don't add business logic**: Orchestration rules belong in `orkestra-core`
- **Don't add CLI/UI concerns**: This crate is for data structures only
- **Don't break serialization compatibility**: Changes to serde attributes can break stored data
