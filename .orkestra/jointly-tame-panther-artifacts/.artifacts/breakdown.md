# Technical Design: Token Counts in PR Footer

Wire `TaskTokenUsage` (already computed by `query::token_usage::execute`) into `format_pr_footer` so every Orkestra-created PR shows token consumption.

## Approach

- Fetch token usage in `prepare_pr_creation` (has `api.store` + `api.home_dir`) and thread it through `PrPreparation` → `create_pull_request::execute` → `PrDescriptionContext` → `format_pr_footer`
- Show input and output tokens in compact notation (e.g., "120.4k input · 45.2k output") — PR footers need conciseness, unlike CLI's exact numbers
- Omit the token line entirely when both counts are zero (unavailable data)
- Cache tokens omitted from display — they're an implementation detail, not useful to PR readers

## File Changes

| File | Change |
|------|--------|
| `crates/orkestra-utility/src/pr_description.rs` | Add `token_usage: Option<&TokenUsage>` to `PrDescriptionContext` and `format_pr_footer`; add compact number formatter |
| `crates/orkestra-core/src/workflow/integration/interactions/create_pull_request.rs` | Accept + pass `token_usage` through |
| `crates/orkestra-core/src/workflow/integration/pr_creation.rs` | Fetch token usage in `prepare_pr_creation`, thread through `PrPreparation` and `run_pr_creation` |

## Testing

Existing unit tests for `format_pr_footer` and `create_pull_request` cover the current behavior. The implementation subtask adds tests for the new token formatting (with tokens, without tokens, compact notation thresholds).

---

## Implementation Instructions

## Trak Summary

Add total token usage (input + output) to the hardcoded PR footer so every Orkestra-created PR shows how many tokens the task consumed. The token tracking infrastructure and PR footer already exist — this connects them.

## What This Accomplishes

Thread `TokenUsage` from the PR creation preparation step through to `format_pr_footer`, which renders a new "Tokens: Xk input · Yk output" line in the footer.

## Files to Modify

### 1. `crates/orkestra-utility/src/pr_description.rs`

**Add compact number formatter** (private helper):
- Numbers < 1,000 → exact (e.g., "842")
- Numbers ≥ 1,000 → one decimal with "k" suffix (e.g., "120.4k")
- Numbers ≥ 1,000,000 → one decimal with "M" suffix (e.g., "1.2M")

**Add `token_usage` field to `PrDescriptionContext`:**
```rust
pub token_usage: Option<&'a orkestra_types::domain::TokenUsage>,
```

**Modify `format_pr_footer` signature:**
```rust
pub fn format_pr_footer(model_names: &[String], token_usage: Option<&TokenUsage>) -> String
```

In the function body, if `token_usage` is `Some` and has non-zero `input_tokens` or `output_tokens`, insert a line before the "Powered by Orkestra" line:
```
Tokens: 120.4k input · 45.2k output
```

Use only `input_tokens` and `output_tokens` fields — omit cache tokens from display.

**Update all callers of `format_pr_footer` within this file:**
- `ClaudePrDescriptionGenerator::generate_pr_description` (line 125): pass `ctx.token_usage`
- `MockPrDescriptionGenerator::generate_pr_description` (line 177): pass `ctx.token_usage`

**Update existing tests** to pass the new `token_usage` field (use `None` for existing tests to preserve behavior). Add new tests:
- `test_format_pr_footer_with_tokens` — verify the token line appears with correct compact formatting
- `test_format_pr_footer_zero_tokens` — verify no token line when both are zero
- `test_compact_number_formatting` — verify the formatter at boundaries (999 → "999", 1000 → "1.0k", 1500 → "1.5k", 120432 → "120.4k", 1200000 → "1.2M")

Note: `orkestra-utility` already depends on `orkestra-types` — check `Cargo.toml` to confirm, and add the dep if not.

### 2. `crates/orkestra-core/src/workflow/integration/interactions/create_pull_request.rs`

**Add `token_usage` parameter to `execute`:**
```rust
pub(crate) fn execute(
    git: &dyn GitService,
    pr_service: &dyn PrService,
    pr_desc_gen: &dyn PrDescriptionGenerator,
    task: &Task,
    model_names: &[String],
    artifacts: &[PrArtifact],
    token_usage: Option<&TokenUsage>,
) -> Result<String, PrPipelineError>
```

- Pass `token_usage` into `PrDescriptionContext`
- Pass `token_usage` to the fallback `format_pr_footer` call (line 85)
- Update existing tests to pass `None` for the new parameter

### 3. `crates/orkestra-core/src/workflow/integration/pr_creation.rs`

**Fetch token usage in `prepare_pr_creation`:**
After collecting artifacts (line 157), fetch token usage:
```rust
let token_usage = crate::workflow::query::token_usage::execute(
    api.store.as_ref(),
    task_id,
    &api.home_dir,
).ok().map(|u| u.total);
```
Use `.ok()` to silently handle errors — token usage is decorative, never block PR creation.

**Add `token_usage` to `PrPreparation::NeedsPrWork`:**
```rust
token_usage: Option<TokenUsage>,
```

**Thread through `spawn_pr_creation`, `create_pr_sync`, and `run_pr_creation`:**
- Extract from `PrPreparation` alongside other fields
- Pass `token_usage.as_ref()` to `create_pull_request::execute`
- `run_pr_creation` gains a `token_usage: Option<TokenUsage>` parameter

## Patterns to Follow

- `format_pr_footer` pattern: simple string builder with conditional sections
- `prepare_pr_creation` pattern: gather all inputs while holding the lock, pass through `PrPreparation` enum
- Error handling: `.ok()` for non-critical data (token usage should never block PR creation)

## Acceptance Criteria

- `format_pr_footer` with token data produces a footer containing a "Tokens: ..." line with compact notation
- `format_pr_footer` with `None` or zero tokens produces the same footer as before (no token line)
- All existing tests pass with the new parameter (passing `None`)
- New tests cover compact formatting at boundaries and token line presence/absence
- `cargo test -p orkestra-utility -p orkestra-core` passes

## Import Paths

- `orkestra_types::domain::TokenUsage` — the token struct
- `crate::workflow::query::token_usage::execute` — fetches `TaskTokenUsage` from session files (in orkestra-core)