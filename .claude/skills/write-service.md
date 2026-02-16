---
name: write-service
description: Write a service.rs implementing a trait via interaction delegation
---

# Write Service

The service is a thin dispatcher. It holds shared state and delegates each trait method to exactly one interaction's `execute()`. No business logic lives here.

## File Template

```rust
//! {Module}-based implementation of the `{Trait}` trait.
//!
//! Delegates each trait method to an interaction in `interactions/`.

use std::path::{Path, PathBuf};
// ... imports

use crate::interactions;
use crate::interface::MyTrait;
use crate::types::{MyError, ...};

/// {Brief description of what this service provides.}
pub struct MyService {
    // Shared state: connections, paths, config
    repo_path: PathBuf,
}

impl MyService {
    /// Create a new `MyService`.
    pub fn new(repo_path: &Path) -> Result<Self, MyError> {
        // Validate inputs, open connections
        Ok(Self {
            repo_path: repo_path.to_path_buf(),
        })
    }
}

impl MyTrait for MyService {
    // -- Domain A --

    fn operation_one(&self, ...) -> Result<T, MyError> {
        interactions::domain_a::operation_one::execute(...)
    }

    fn operation_two(&self, ...) -> Result<T, MyError> {
        interactions::domain_a::operation_two::execute(...)
    }

    // -- Domain B --

    fn other_op(&self, ...) -> Result<T, MyError> {
        interactions::domain_b::other_op::execute(...)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    // Integration tests against real infrastructure (e.g., temp git repos)
}
```

## Rules

1. **Each trait method delegates to exactly one interaction.** The mapping is 1:1. If a trait method needs to call two interactions sequentially, that's orchestration — it belongs in the caller (e.g., `integration.rs` in orkestra-core), not here.
2. **No business logic in the service.** No conditionals, no loops over results, no error transformation beyond what the interaction returns.
3. **`// -- Domain --` subsections** match the interface's groupings exactly.
4. **Constructor validates and initializes.** Open connections, verify paths, build shared state. This is the only place the service does real work.
5. **Tests section at bottom.** Integration tests that exercise the real implementation.

## What the Service Holds

The struct holds resources that interactions need but shouldn't create themselves:

```rust
pub struct Git2GitService {
    repo: Mutex<Repository>,  // Shared connection
    repo_path: PathBuf,       // Base path for CLI commands
    worktrees_dir: PathBuf,   // Derived config
}
```

Pass these to interactions as parameters — interactions never reach back into the service.

## Exemplar

`crates/orkestra-git/src/service.rs` — reference implementation with worktree, branch, commit, diff, merge, and remote domains.
