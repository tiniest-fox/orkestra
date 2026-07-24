# Phase 1 — Mechanical Resolution Logic

**Status:** Next up
**Blocked by:** nothing
**Parallel with:** [Phase 2](./02-technique-library-content.md) — no shared dependency

## Goal

Four pure resolution functions, no orchestrator wiring: a Technique frontmatter loader, a check-script metadata parser, model max-resolution across a Technique set, and check/tool union-dedup.

## Approach

The frontmatter shape already has a working precedent in this codebase, so this isn't a new pattern — it's a second instance of one. `crates/orkestra-core/src/workflow/config/auto_task.rs` parses `.orkestra/tasks/*.md` the exact same way a Technique file needs to be parsed: split on the second `---`, deserialize a private frontmatter struct via `serde_yaml`, then derive a distinct public type after validation rather than exposing the raw struct. Reuse that split → parse → derive shape directly.

## Concrete schemas

### Technique frontmatter

```yaml
---
title: Red/Green Investigation
description: >
  Investigate a bug by writing a failing test that reproduces it...
check: expect-test-failure
disallowed_tools: [Edit, Write]
model: opus
---
# markdown body — the instructional prompt content
```

| Field | Type | Notes |
|---|---|---|
| `title` | `String` | required — selection index display name |
| `description` | `String` | required — the composer's selection signal (see `design.md`) |
| `check` | `Option<String>` | singular, not a list — matches the one check per Technique shown in every worked example |
| `disallowed_tools` | `Vec<ToolRestriction>` | **reuse** the existing type from `orkestra_types::config::stage` — don't invent a second one |
| `model` | `Option<String>` | key into `models.yaml`'s ranked list |

> `pinned_when` was considered and dropped — see `design.md`'s "Composition model" and "What we chose not to mechanize" sections. Every Technique is discretionary; there is no field that bypasses composer judgment.

```rust
struct TechniqueFrontmatter { // private, deserialized directly
    title: String,
    description: String,
    check: Option<String>,
    #[serde(default)]
    disallowed_tools: Vec<ToolRestriction>,
    model: Option<String>,
}

pub struct Technique { // public, derived — adds filename + body
    pub name: String,       // derived from filename: "red-green.md" -> "red-green"
    pub title: String,
    pub description: String,
    pub check: Option<String>,
    pub disallowed_tools: Vec<ToolRestriction>,
    pub model: Option<String>,
    pub body: String,        // prompt content after frontmatter
}
```

### Check-script metadata

```bash
#!/usr/bin/env bash
# ---
# title: Expect Test Failure
# description: Passes only when the target test fails
# timeout_seconds: 1200
# ---
set -euo pipefail
...
```

```rust
struct CheckMetadata {
    title: String,
    description: String,
    timeout_seconds: u64,
}
```

Parser is deliberately separate from the frontmatter one above — this is a shell comment block, not a markdown file, and the shebang has to stay line one. Strip the leading `# ` from each line between the two `# ---` delimiters, then hand the remainder to the same `serde_yaml` the frontmatter parser already uses.

### `.orkestra/models.yaml`

```yaml
default: sonnet
ranked:
  - opus
  - sonnet
  - claude-pty/opus
  - opencode-go/gpt-5
```

```rust
struct ModelRegistry {
    default: String,
    ranked: Vec<String>,  // earliest = highest-ranked
}
```

## Resolution functions

- [ ] `fn parse_technique(path: &Path) -> Result<Technique, TechniqueLoadError>` — split/parse/derive, mirrors `auto_task.rs`
- [ ] `fn resolve_model(techniques: &[&Technique], registry: &ModelRegistry) -> String` — take the technique-specified model with the lowest index in `ranked` (earliest = highest-ranked); fall back to `registry.default` if none specify one
- [ ] `fn resolve_checks(techniques: &[&Technique]) -> Vec<String>` — collect, sort, dedup every non-empty `check` across the set
- [ ] `fn resolve_disallowed_tools(techniques: &[&Technique]) -> Vec<ToolRestriction>` — same shape, union not rank. **Verify `ToolRestriction` already derives `Ord`/`Hash` before relying on sort+dedup — not confirmed yet.**

## Error type

Mirror `loader.rs`'s `LoadError` — the existing convention for this exact layer (config loading), distinct from the hand-rolled enums stage execution uses.

```rust
#[derive(thiserror::Error, Debug)]
enum TechniqueLoadError {
    #[error("technique file not found: {0}")]
    NotFound(PathBuf),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("failed to parse technique frontmatter: {0}")]
    Parse(#[from] serde_yaml::Error),
    #[error("invalid technique: {0}")]
    Validation(String),
}
```

## Test fixtures to write

- [ ] Two Techniques with different `model` values → confirm `resolve_model` picks the higher-ranked one, not the first-listed or last-listed
- [ ] No Technique in the set specifies a model → confirm fallback to `registry.default`
- [ ] Two Techniques with an overlapping `check` value → confirm `resolve_checks` dedups rather than running the same check twice
- [ ] A Technique with malformed frontmatter (missing required `title`) → confirm `parse_technique` returns `TechniqueLoadError::Parse`, not a panic

## Open questions

- [ ] **Crate placement.** A new module inside `orkestra-core` next to `auto_task.rs` (where this exact kind of parsing already lives), or a separate crate mirroring `orkestra-schema`'s pure-function isolation (which has no YAML dependency today and would need one added)? The existing precedent — this is config-loading, not schema-generation — leans toward the former. Confirm before starting.

## Exit criteria

- [ ] All four resolution functions exist, unit-tested against the fixtures above
- [ ] Zero I/O beyond reading a file — no orchestrator/runtime wiring yet (that's Phase 3)
- [ ] Crate placement question above is resolved, not deferred mid-implementation
