---
title: Backward-Compatible Rust Enum Variant Renames with #[serde(alias)]
date: 2026-02-27
tags: [rust, serde, database, backward-compat]
category: patterns
module: orkestra-core
symptoms:
  - Renaming a serialized enum variant would break existing database rows
  - Old variant name is stored as a string in SQLite; new code can't deserialize it
---

# Backward-Compatible Enum Variant Renames with `#[serde(alias)]`

## Problem

Orkestra serializes enum variants (e.g., `IterationTrigger`) as strings into SQLite. When you rename a variant — say `PrComments` → `PrFeedback` — existing rows contain the old string value and deserialization breaks. A full DB migration is unnecessary for this class of change.

## Solution

Use `#[serde(alias = "old_name")]` on the new variant. Serde will accept both the new canonical name and the old alias:

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IterationTrigger {
    /// PR comments, failing checks, or guidance for a Done task.
    #[serde(alias = "pr_comments")]
    PrFeedback {
        comments: Vec<PrCommentData>,
        checks: Vec<PrCheckData>,
        guidance: Option<String>,
    },
    // ...
}
```

- **Serialization** writes `pr_feedback` (the new canonical name).
- **Deserialization** accepts both `pr_feedback` and `pr_comments` (from old rows).
- No migration needed.

## When to Use

- Internal enum variants stored in SQLite that have no external API contract
- Renames where old rows are valid and don't need data migration

## When NOT to Use

- When the variant's payload shape also changed (field added/removed without `#[serde(default)]`)
- When you need to migrate existing data to a new structure

## Related

If you also add a new field to an existing variant, combine `#[serde(alias)]` with `#[serde(default)]` on the new field so old rows without that field still deserialize:

```rust
#[serde(alias = "pr_comments")]
PrFeedback {
    comments: Vec<PrCommentData>,
    #[serde(default)]
    checks: Vec<PrCheckData>,  // Old rows had no `checks` field
    guidance: Option<String>,
},
```
