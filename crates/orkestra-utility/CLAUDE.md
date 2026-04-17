# orkestra-utility

AI agent guidance for working in this crate.

## Purpose

Lightweight AI utility tasks: title generation, commit message generation, and PR description generation. Most tasks run single-turn (`--print` mode); PR description runs interactively with tool access so the agent can read files and git history directly.

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
// Single-turn (default): haiku, 30s timeout, no tool access
let runner = UtilityRunner::new()
    .with_timeout(60)
    .with_model("haiku");

// Interactive: sonnet, longer timeout, tool access in a worktree
let runner = UtilityRunner::new()
    .with_model("sonnet")
    .with_timeout(300)
    .with_mode(ExecutionMode::Interactive)
    .with_cwd("/path/to/worktree");

let output = runner.run("generate_pr_description", &context)?;
```

**How it works:**

1. Loads prompt template and JSON schema from embedded `tasks` module
2. Renders prompt with Handlebars (context variables)
3. Appends output format section from schema
4. In `SingleTurn` mode: spawns `claude --model <model> --print --output-format json --json-schema <schema>`; in `Interactive` mode: omits `--print` so the agent can use tools
5. Writes prompt to stdin, reads structured output from stdout
6. Validates output against schema using `jsonschema`
7. Returns parsed JSON or `UtilityError`

**Built-in tasks:**
- `generate_title` — Title from description (Interactive, haiku, 120s timeout for task titles; SingleTurn, 30s for assistant session titles)
- `generate_commit_message` — Commit message from title/description/diff (SingleTurn, haiku)
- `generate_pr_description` — PR title and body from task context (Interactive, sonnet, 5-min timeout — runs in task worktree so agent can read git history directly)

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
- Skips stages without AI models

Always appends "Claude Haiku 4.5" (the utility model) if not already present.

### Process Spawning

`UtilityRunner` delegates to `orkestra-process` for proper cleanup:
- Uses `ProcessGuard` for RAII cleanup on timeout/error/panic
- Sets `process_group(0)` for clean tree kills
- Pipes stdin/stdout/stderr to avoid blocking

## Anti-Patterns

- **Don't add complex orchestration** — Keep utilities atomic and fast; interactive mode is for context gathering, not multi-step workflows
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
