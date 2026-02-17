# orkestra-prompt

Pure prompt assembly for Orkestra agent stages.

## Overview

This crate assembles prompts from workflow configuration and task state. It builds the system prompts, user messages, and resume prompts that agents receive. No filesystem I/O — template loading and agent definition reading stay in orkestra-core.

## Key Types

### PromptBuilder

Constructs `StagePromptContext` from workflow configuration and task data:

```rust
use orkestra_prompt::PromptBuilder;

let builder = PromptBuilder::new(&workflow_config);
let ctx = builder.build_context(
    "planning",              // stage name
    &task,                   // task with artifacts
    feedback,                // rejection feedback if any
    integration_error,       // merge conflict context if any
    show_structured_hint,    // Claude Code specific hint
    activity_logs,           // prior iteration logs
    sibling_tasks,           // sibling subtask context
);
```

### PromptService

Stateless service that owns pre-compiled Handlebars templates and dispatches to interactions:

```rust
use orkestra_prompt::PromptService;

let service = PromptService::new();
let config = service.build_agent_config(
    &workflow, &task, "work", &agent_definition, &json_schema,
    feedback, integration_error, &flow_overrides,
    show_hint, activity_logs, sibling_tasks,
)?;
```

### StagePromptContext

All data needed to build a stage prompt:

- Stage configuration (name, artifact, capabilities)
- Task info (id, title, description, worktree, base branch)
- Input artifacts from prior stages
- Question history, feedback, integration errors
- Activity logs from prior iterations
- Sibling subtask context (for subtasks)
- Workflow overview (stage list with current marker)

### ResolvedAgentConfig

The assembled agent configuration ready for spawning:

- `system_prompt` — agent definition + output format instructions
- `prompt` — user message with task context
- `json_schema` — structured output schema
- `session_type` — stage identifier for logging

### ResumeType

Determines the resume prompt variant when continuing a session:

- `Continue` — simple interrupt recovery
- `Feedback` — rejection with feedback to address
- `Integration` — merge conflict to resolve
- `Answers` — human answered agent questions
- `Recheck` — re-run after full cycle completed
- `RetryFailed` — retry after failure
- `RetryBlocked` — retry after blocked
- `ManualResume` — user-initiated resume with optional message
- `PrComments` — PR review comments to address

## Helper Functions

- `deduplicate_activity_logs_by_stage()` — collapse consecutive same-stage logs
- `sibling_status_display()` — convert `TaskState` to user-friendly string

## Dependencies

- `orkestra-types` — domain and config types
- `orkestra-schema` — JSON schema generation
- `handlebars` — template rendering
- `serde` / `serde_json` — serialization
