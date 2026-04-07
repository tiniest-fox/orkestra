# orkestra-utility

Lightweight AI utility tasks for Orkestra.

Provides title generation, commit message generation, and PR description generation using Claude haiku. Each utility runs as a single-turn AI call with structured JSON output and schema validation.

## Overview

This crate handles small, focused AI tasks that don't warrant a full agent session:

- **Title generation** — Generate concise task titles from descriptions
- **Commit message generation** — Generate conventional commit messages from diffs
- **PR description generation** — Generate structured PR titles and bodies

All utilities use Claude haiku for fast, low-cost responses with schema-enforced output.

## Key Types

### Traits

| Trait | Method | Purpose |
|-------|--------|---------|
| `TitleGenerator` | `generate_title(task_id, description)` | Generate task title from description |
| `CommitMessageGenerator` | `generate_commit_message(title, description, diff, models)` | Generate commit message from task context |
| `PrDescriptionGenerator` | `generate_pr_description(task_title, task_description, artifacts, commits_summary, diff_summary, base_branch, model_names)` | Generate PR title and body from task context, artifact references, and commit history |

### Implementations

| Struct | Trait | Description |
|--------|-------|-------------|
| `ClaudeTitleGenerator` | `TitleGenerator` | Spawns Claude haiku for title generation |
| `ClaudeCommitMessageGenerator` | `CommitMessageGenerator` | Spawns Claude haiku for commit messages |
| `ClaudePrDescriptionGenerator` | `PrDescriptionGenerator` | Spawns Claude haiku for PR descriptions |

### Mocks (behind `testutil` feature)

| Mock | Trait |
|------|-------|
| `MockTitleGenerator` | `TitleGenerator` |
| `MockCommitMessageGenerator` | `CommitMessageGenerator` |
| `MockPrDescriptionGenerator` | `PrDescriptionGenerator` |

## Helper Functions

### Title Generation

```rust
use orkestra_utility::{generate_title_sync, generate_fallback_title};

// AI-powered title generation (blocking)
let title = generate_title_sync("Fix the authentication bug where...", 30)?;

// Fallback when AI unavailable (truncates at ~50 chars)
let title = generate_fallback_title("Fix the authentication bug where...");
```

### Commit Message Generation

```rust
use orkestra_utility::{
    format_commit_message, fallback_commit_message,
    collect_model_names, friendly_model_name,
};

// Format with co-author attribution
let msg = format_commit_message(
    "Add feature",
    "This adds a new feature.",
    &["Claude Sonnet 4.5".to_string()],
);

// Fallback when AI unavailable
let msg = fallback_commit_message("Add feature", "task-123");

// Collect model names from workflow for attribution
let models = collect_model_names(&workflow_config, task_flow);

// Map model spec to display name
let name = friendly_model_name(Some("claudecode/sonnet")); // "Claude Sonnet 4.5"
```

### PR Description Generation

```rust
use orkestra_utility::format_pr_footer;

// Generate model attribution footer
let footer = format_pr_footer(&["Claude Sonnet 4.5".to_string()]);
// ---
// Co-authored-by: Claude Sonnet 4.5
// ⚡ Powered by Orkestra
```

## UtilityRunner

The `UtilityRunner` is the shared execution infrastructure for all utility tasks:

```rust
use orkestra_utility::UtilityRunner;
use serde_json::json;

let runner = UtilityRunner::new()
    .with_timeout(30)
    .with_model("haiku");

let output = runner.run("generate_title", &json!({
    "description": "Fix the login bug"
}))?;
```

Features:
- Spawns Claude with `--model haiku --output-format json --json-schema`
- Handles timeout with configurable duration
- Validates output against JSON schema
- Returns structured `UtilityError` on failure

## Error Handling

All operations return `UtilityError` variants:

| Variant | Meaning |
|---------|---------|
| `SpawnFailed` | Failed to spawn Claude process |
| `IoError` | I/O error during communication |
| `Timeout` | Task exceeded timeout |
| `ParseError` | Failed to parse output |
| `SchemaError` | Invalid JSON schema |
| `ValidationFailed` | Output failed schema validation |
| `TaskNotFound` | Unknown task name |

## Dependencies

- `orkestra-process` — Process spawning and cleanup (`ProcessGuard`, stderr reader)
- `orkestra-types` — Workflow configuration types (for `collect_model_names`)
