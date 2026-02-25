# orkestra-utility

AI agent guidance for working in this crate.

## Purpose

Single-turn AI utility tasks: title generation, commit message generation, and PR description generation. Not for multi-turn conversations or complex orchestration.

## Module Structure

```
src/
├── lib.rs              # Re-exports, UtilityError type
├── runner.rs           # UtilityRunner — shared execution infrastructure
├── title.rs            # TitleGenerator trait + Claude impl + mock
├── commit_message.rs   # CommitMessageGenerator trait + helpers + mock
└── pr_description.rs   # PrDescriptionGenerator trait + mock
```

## Pattern: Trait + Impl + Mock

Each generator follows the same pattern:

1. **Trait** — Injectable interface (`TitleGenerator`, `CommitMessageGenerator`, `PrDescriptionGenerator`)
2. **Claude impl** — Production implementation using `UtilityRunner`
3. **Mock** — Test double behind `testutil` feature, with `succeeding()` and `failing()` constructors

## UtilityRunner

The core execution engine in `runner.rs`:

```rust
let runner = UtilityRunner::new()  // defaults: 30s timeout, haiku model
    .with_timeout(60)
    .with_model("haiku");

let output = runner.run("generate_title", &context)?;
```

**How it works:**

1. Loads prompt template and JSON schema from embedded `tasks` module
2. Renders prompt with Handlebars (context variables)
3. Appends output format section from schema
4. Spawns `claude --model haiku --print --output-format json --json-schema <schema>`
5. Writes prompt to stdin, reads structured output from stdout
6. Validates output against schema using `jsonschema`
7. Returns parsed JSON or `UtilityError`

**Built-in tasks:**
- `generate_title` — Title from description
- `generate_commit_message` — Commit message from title/description/diff
- `generate_pr_description` — PR title and body from task context

## Key Functions

### commit_message.rs

| Function | Purpose |
|----------|---------|
| `friendly_model_name(spec)` | Map model ID to display name ("claudecode/sonnet" → "Claude Sonnet 4"). Implemented in `orkestra_types::config::models`, re-exported here. |
| `collect_model_names(workflow, flow)` | Gather unique model names from workflow config for co-author attribution |
| `format_commit_message(title, body, models)` | Format commit with trailers |
| `fallback_commit_message(title, task_id)` | Fallback when AI unavailable |

### title.rs

| Function | Purpose |
|----------|---------|
| `generate_title_sync(description, timeout)` | Blocking title generation via UtilityRunner |
| `generate_fallback_title(description)` | Truncate description at ~50 chars |

### pr_description.rs

| Function | Purpose |
|----------|---------|
| `format_pr_footer(models)` | Generate "Co-authored-by" + "Powered by Orkestra" footer |

## Gotchas

### Model Name Resolution

`friendly_model_name()` uses a lookup table in `orkestra_types::config::models` with exact matches. Unknown specs pass through unchanged:

```rust
friendly_model_name(Some("sonnet"))           // "Claude Sonnet 4"
friendly_model_name(Some("claudecode/sonnet")) // "Claude Sonnet 4"
friendly_model_name(Some("unknown-model"))    // "unknown-model"
```

### Flow-Aware Model Collection

`collect_model_names()` traverses workflow config respecting flow overrides. It uses `WorkflowConfig::agent_model_specs(task_flow)` which:
- Filters to flow stages if flow specified
- Returns effective model spec (flow override or global)
- Skips script stages (no AI model)

Always appends "Claude Haiku 4.5" (the utility model) if not already present.

### Process Spawning

`UtilityRunner` delegates to `orkestra-process` for proper cleanup:
- Uses `ProcessGuard` for RAII cleanup on timeout/error/panic
- Sets `process_group(0)` for clean tree kills
- Pipes stdin/stdout/stderr to avoid blocking

## Anti-Patterns

- **Don't use for multi-turn conversations** — This crate is for single-turn, schema-validated responses
- **Don't add complex orchestration** — Keep utilities atomic and fast
- **Don't bypass schema validation** — All outputs must validate against their schema
- **Don't hardcode model names** — Use `friendly_model_name()` for consistent display names

## Testing

Mocks are behind the `testutil` feature:

```rust
#[cfg(test)]
use orkestra_utility::MockTitleGenerator;

let generator = MockTitleGenerator::succeeding();  // Returns fallback title
let generator = MockTitleGenerator::failing();     // Returns error
```

Mock implementations call fallback functions to produce deterministic output.
