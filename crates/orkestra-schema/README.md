# orkestra-schema

JSON schema generation for agent stage outputs.

## Overview

This crate generates dynamic JSON schemas based on stage configuration. Schemas define the valid output structure for AI agents, enabling structured output validation. The crate is pure logic with no I/O — schemas are assembled from embedded JSON component files at compile time.

## Usage

```rust
use orkestra_schema::{generate_stage_schema, SchemaConfig};

let config = SchemaConfig {
    artifact_name: "plan",
    ask_questions: true,
    produces_subtasks: false,
    has_approval: false,
};

let schema = generate_stage_schema(&config);
// Returns a JSON string defining valid output types
```

## SchemaConfig

| Field | Type | Effect |
|-------|------|--------|
| `artifact_name` | `&str` | Name used for the main output type (e.g., `"plan"`, `"summary"`) |
| `ask_questions` | `bool` | Adds `"questions"` type with question/options structure |
| `produces_subtasks` | `bool` | Adds `"subtasks"` type; artifact embedded in subtasks output |
| `has_approval` | `bool` | Adds `"approval"` type with decision field; replaces artifact type |

All schemas include terminal states (`"failed"`, `"blocked"`) regardless of configuration.

## Schema Composition

Schemas are composed from JSON component files embedded at compile time:

- `artifact.json` — Base artifact with `content` and `activity_log`
- `questions.json` — Question array with options
- `subtasks.json` — Subtask array with dependencies
- `approval.json` — Approval decision with content
- `terminal.json` — Failed/blocked states with error/reason

The `generate_stage_schema` function assembles these components based on the `SchemaConfig` flags, producing a flat discriminated union schema (no `oneOf` at top level).

## Example Generators

The `examples` module provides schema-validated example generators for prompt guidance:

```rust
use orkestra_schema::examples::{subtask_example, question_example};

// Generate a validated subtask example
let subtask = subtask_example(
    "Implement auth",
    "Add JWT authentication",
    "Detailed implementation instructions...",
    &[0, 1], // depends on subtasks 0 and 1
);

// Generate a validated question example
let question = question_example(
    "Which database?",
    &["PostgreSQL", "SQLite"],
);
```

These functions validate against the actual schema components — if the schema changes and examples become invalid, tests fail.

## Dependencies

- `serde_json` — JSON serialization
- `jsonschema` — Example validation against schemas
