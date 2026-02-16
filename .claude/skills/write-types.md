---
name: write-types
description: Write a types.rs with error enums and domain structs for a module
---

# Write Types

Types are pure data — no logic beyond Display/From impls. This file is a leaf dependency: nothing else in the crate imports from types.rs, and types.rs imports nothing from the crate.

## File Template

```rust
//! Shared types for {domain} operations.
//!
//! Pure data types with no dependencies on other crate internals.

use serde::Serialize;  // Only if types are exposed to callers
use std::fmt;

// ============================================================================
// Errors
// ============================================================================

/// Errors that can occur during {domain} operations.
#[derive(Debug, Clone)]
pub enum MyError {
    /// {Specific domain failure.}
    SpecificError(String),
    /// {Another domain failure.}
    AnotherError(String),
    /// {Structured variant for rich error data.}
    Conflict {
        source: String,
        details: Vec<String>,
    },
    /// I/O error (filesystem operations).
    IoError(String),
    /// Other {domain} error.
    Other(String),
}

impl fmt::Display for MyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SpecificError(msg) => write!(f, "Specific error: {msg}"),
            Self::AnotherError(msg) => write!(f, "Another error: {msg}"),
            Self::Conflict { source, details } => {
                write!(f, "Conflict in {source}: {} item(s)", details.len())
            }
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::Other(msg) => write!(f, "{domain} error: {msg}"),
        }
    }
}

impl std::error::Error for MyError {}

impl From<std::io::Error> for MyError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

// ============================================================================
// Domain Types
// ============================================================================

/// {What this represents.}
#[derive(Debug, Clone)]
pub struct OperationResult {
    /// {Field description.}
    pub name: String,
    /// {Field description.}
    pub path: std::path::PathBuf,
}

/// {What this represents.}
#[derive(Debug, Clone, Serialize)]
pub struct ExposedData {
    /// {Field description.}
    pub id: String,
    /// {Field description.}
    pub count: usize,
}
```

## Rules

1. **Pure data, no logic.** Only `Display`, `From`, `Error` impls. No methods that do real work.
2. **`#[derive(Debug, Clone)]` minimum.** Add `Serialize` only when the type is exposed to callers (API responses, stored data).
3. **Doc comment on every type and field.** Brief but present.
4. **No imports from other crate modules.** Types is a leaf — it depends only on std and external crates.
5. **Error enum always includes `Other(String)`.** Catch-all for unexpected failures.
6. **`impl From<std::io::Error>`** — always include for filesystem operations.
7. **Use sections** (`// ====`) to separate errors from domain types when the file has both.

## Error Enum Design

- Name variants by **domain cause**, not by the operation that failed
- `String` payload for human-readable context
- Structured variants (with named fields) for errors the caller needs to inspect programmatically
- Keep variants minimal — add new ones only when callers need to match on them

```rust
// Good: domain-specific, inspectable
MergeConflict { branch: String, conflict_files: Vec<String> }

// Good: context string for everything else
MergeError(String)

// Bad: too generic
Error(String)

// Bad: operation-named instead of cause-named
CreateFailed(String)
```

## Exemplar

`crates/orkestra-git/src/types.rs` — reference types file with `GitError` enum and domain structs.
