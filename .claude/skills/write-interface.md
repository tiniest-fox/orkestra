---
name: write-interface
description: Write an interface.rs trait defining a module's contract
---

# Write Interface

The interface defines what the module can do. It's the contract that callers depend on — no implementation details leak through.

## File Template

```rust
//! {Module} trait definition.
//!
//! {Optional paragraph explaining the contract and its role in the system.}

use std::path::Path;
// Only import from crate::types — never from interactions or service

use crate::types::{MyError, ...};

/// {What this trait abstracts over.}
///
/// This trait abstracts over {domain} operations, allowing:
/// - `MyService`: Production implementation
/// - `MockMyService`: Testing implementation with canned responses
///
/// The trait requires `Send + Sync` for thread-safe sharing.
pub trait MyTrait: Send + Sync {
    // -- Domain A --

    /// {One-liner describing what this does.}
    ///
    /// {Multi-line for complex operations: behavior, edge cases, return values.}
    fn operation_one(&self, param: &str) -> Result<Output, MyError>;

    /// {Doc comment.}
    fn operation_two(&self, path: &Path) -> Result<(), MyError>;

    // -- Domain B --

    /// {Doc comment.}
    fn other_op(&self, id: &str) -> Result<bool, MyError>;
}
```

## Rules

1. **`Send + Sync` by default.** The trait must be thread-safe for sharing across async boundaries (orchestrator, Tauri command handlers).
2. **`// -- Domain --` subsections** group methods by concern. Match these in the service and mock.
3. **Every method has a `///` doc comment.** One-liner minimum. Multi-line for operations with edge cases, fallback behavior, or non-obvious return values.
4. **`&self` receiver** on every method. The service holds shared state; methods borrow it.
5. **Return `Result<T, ModuleError>`** for fallible operations. Use `bool` directly only for simple checks.
6. **Import only from `crate::types`.** The interface is a leaf — it depends on nothing else in the crate except types. No interaction imports, no service imports.
7. **No default implementations.** Every method is required. If two impls share logic, that's a sign it should be an interaction.

## Method Signature Patterns

```rust
// Simple query
fn exists(&self, id: &str) -> bool;

// Fallible operation returning data
fn create(&self, id: &str, config: Option<&str>) -> Result<Created, MyError>;

// Fallible operation returning nothing
fn delete(&self, id: &str) -> Result<(), MyError>;

// Path-based operation
fn diff(&self, path: &Path, branch: &str) -> Result<Diff, MyError>;

// Batch operation
fn batch_counts(&self, ids: &[String]) -> Result<HashMap<String, usize>, MyError>;
```

## Exemplar

`crates/orkestra-git/src/interface.rs` — reference trait with worktree, branch, commit, diff, merge, and remote domains.
