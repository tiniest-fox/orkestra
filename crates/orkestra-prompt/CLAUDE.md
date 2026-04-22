# CLAUDE.md — orkestra-prompt

AI agent guidance for working in the orkestra-prompt crate.

## Purpose

Assembles prompts from workflow configuration and task state. Pure logic — no filesystem I/O. Template loading and agent definition reading happen in orkestra-core; this crate receives them as parameters.

## Module Structure

```
src/
├── lib.rs              # Re-exports public API
├── service.rs          # PromptService (owns Handlebars registry)
├── types.rs            # Context types, ResumeType, errors
├── templates/          # Handlebars templates (embedded via include_str!)
│   ├── output_format.md
│   ├── initial_prompt.md
│   ├── system_prompt.md
│   └── resume/         # Resume prompt variants
│       ├── continue.md
│       ├── integration.md
│       ├── answers.md
│       ├── pr_comments.md
│       ├── malformed_output.md
│       └── gate_failure.md
└── interactions/
    ├── build/          # Initial prompt construction
    │   ├── context.rs      # PromptBuilder
    │   ├── agent_config.rs # build_agent_config
    │   ├── system_prompt.rs
    │   ├── user_message.rs
    │   └── workflow_overview.rs
    └── resume/         # Resume prompt construction
        ├── determine_type.rs
        └── build_prompt.rs
```

## Key Types

### StagePromptContext

The primary data structure for prompt rendering. Contains:
- `stage: &StageConfig` — stage configuration
- `task_id: &str` — task identifier
- `task_file_path: String` — path to the materialized task definition file
- `has_input_artifacts: bool` — whether any prior stage has a materialized artifact available
- `activity_log_path: Option<String>` — path to the activity log file, if materialized
- `question_history: Vec<QuestionAnswerContext>` — Q&A pairs
- `feedback: Option<&str>` — rejection feedback
- `integration_error: Option<IntegrationErrorContext>` — merge conflict info
- `worktree_path: Option<&str>` — git worktree path for isolation
- `base_branch: &str` — base branch this task was created from
- `base_commit: &str` — git commit SHA of the base branch at worktree creation time
- `show_direct_structured_output_hint: bool` — whether to show direct StructuredOutput instructions
- `workflow_stages: Vec<WorkflowStageEntry>` — stage overview
- `sibling_tasks: Vec<SiblingTaskContext>` — sibling subtask context
- `resources: Vec<ResourceContext>` — inline resource list (merged task + parent resources; includes parent-inherited resources for subtasks)

### ResumeType

Enum determining which resume prompt template to use. Priority order when auto-determining: `Integration > Feedback > Answers > Continue`.

Variants:
- `Continue` — interrupted, continue from last point
- `Integration { message, conflict_files }` — merge conflict
- `Answers { answers }` — human provided answers
- `PrComments { comments, checks, guidance }` — PR review comments and failed CI checks
- `MalformedOutput { error, attempt, max_attempts }` — corrective prompt after malformed agent output
- `GateFailure { error }` — gate script failed; resume prompt rendered from `gate_failure.md` and filtered out of the UI chat feed (shown inline via gate log entries instead)
- `UserMessage { message }` — user sent a message directly; raw message passed through with no template wrapping

## Patterns

### PromptBuilder is the entry point

`PromptBuilder::new(workflow)` → `build_context(...)` → `StagePromptContext`

The service uses the builder internally when constructing agent configs.

### Templates are embedded at compile time

Templates in `src/templates/` are included via `include_str!` in `service.rs` and registered with Handlebars at construction. No runtime file I/O.

### Resume prompts are SHORT

When resuming a session, the agent already has full context from the original session. Resume prompts only provide what changed (feedback, answers, conflicts). Don't include full task description.

## Gotchas

1. **`deduplicate_activity_logs_by_stage()`** — Collapses consecutive same-stage logs, not all same-stage logs. If `[work, review, work]` appears, all three are kept. Only `[work, work, review]` collapses to `[work, review]`. Logs must be passed in chronological order.

2. **`sibling_status_display()`** — Maps `TaskState` to simple display strings like "pending", "working", "done". Used in prompt context for sibling subtask summaries.

3. **Question history is NOT included in initial prompts** — Initial prompts start with empty question history. Questions and answers flow through resume prompts after the agent asks and human answers.

4. **Template guards use `resources`** — In Handlebars templates, guard the resources block on `{{#if resources}}`. The `resources` array is always fully populated (merged task + parent), so this is the correct signal. The `{{#each resources}}` loop renders each inline resource entry.

5. **Populate all context struct fields when templates change** — When adding a new template variable, ensure every context struct that feeds that template includes the new field. Handlebars silently treats missing fields as falsy — a missing `resources` field in `UserMessageContext` will cause the entire `{{#if resources}}` block (including other variables nested inside) to be skipped without any error.


## Anti-patterns

- **Don't add file I/O here** — Template and definition loading belongs in orkestra-core
- **Don't embed agent definitions** — Definitions come from `.orkestra/agents/` files, loaded by orkestra-core
- **Don't hardcode stage names** — Use `stage.name`, `stage.artifact` from config
- **Don't skip the service for template rendering** — `PromptService` manages template registration; direct Handlebars use risks missing templates

## Testing

Most logic has unit tests in the interaction files. Test coverage for:
- Resume type priority (`determine_type.rs`)
- Resume prompt rendering with all variants (`build_prompt.rs`)

Note: `deduplicate_activity_logs_by_stage()` is tested in orkestra-core where it's used.

Run tests:
```bash
cargo test -p orkestra-prompt
```
