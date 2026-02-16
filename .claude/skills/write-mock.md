---
name: write-mock
description: Write a mock.rs test double implementing a module's trait
---

# Write Mock

The mock implements the trait for testing. It records calls and returns configurable results. Feature-gated behind `testutil`.

## File Template

```rust
//! Mock {domain} service for testing.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::interface::MyTrait;
use crate::types::{MyError, ...};

/// Mock {domain} service for testing.
///
/// Tracks calls in memory and allows setting expected results.
pub struct MockMyService {
    // Call recording
    operation_one_calls: Mutex<Vec<(String, Option<String>)>>,
    // Configurable returns
    next_operation_one_result: Mutex<Option<Result<Output, MyError>>>,
    // State tracking
    items: Mutex<HashMap<String, PathBuf>>,
}

impl MockMyService {
    /// Create a new mock service.
    pub fn new() -> Self {
        Self {
            operation_one_calls: Mutex::new(Vec::new()),
            next_operation_one_result: Mutex::new(None),
            items: Mutex::new(HashMap::new()),
        }
    }

    // -- Configure Returns --

    /// Set the result for the next `operation_one` call.
    pub fn set_next_operation_one_result(&self, result: Result<Output, MyError>) {
        *self.next_operation_one_result.lock().unwrap() = Some(result);
    }

    // -- Inspect Calls --

    /// Get the list of `operation_one` calls for verification.
    pub fn get_operation_one_calls(&self) -> Vec<(String, Option<String>)> {
        self.operation_one_calls.lock().unwrap().clone()
    }
}

impl Default for MockMyService {
    fn default() -> Self {
        Self::new()
    }
}

impl MyTrait for MockMyService {
    // -- Domain A --

    fn operation_one(&self, id: &str, opt: Option<&str>) -> Result<Output, MyError> {
        // Record the call
        self.operation_one_calls
            .lock()
            .unwrap()
            .push((id.to_string(), opt.map(String::from)));

        // Return configured result or default
        if let Some(result) = self.next_operation_one_result.lock().unwrap().take() {
            return result;
        }

        // Default: sensible no-op response
        Ok(Output { ... })
    }

    // -- Domain B --

    fn simple_check(&self, id: &str) -> bool {
        self.items.lock().unwrap().contains_key(id)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_records_calls() {
        let mock = MockMyService::new();
        mock.operation_one("ID-1", Some("main")).unwrap();

        let calls = mock.get_operation_one_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "ID-1");
    }

    #[test]
    fn test_mock_configurable_results() {
        let mock = MockMyService::new();
        mock.set_next_operation_one_result(Err(MyError::Other("fail".into())));
        assert!(mock.operation_one("ID-1", None).is_err());
    }
}
```

## Rules

1. **Feature-gated module.** In `lib.rs`: `#[cfg(feature = "testutil")] pub mod mock;`
2. **`Mutex<...>` for all fields.** The trait requires `Send + Sync`, so interior mutability via Mutex.
3. **`impl Default` delegates to `new()`.** Always provide both.
4. **`// -- Domain --` subsections** match the interface and service ordering exactly.
5. **Test the mock itself.** Verify call recording and configurable returns work correctly.

## Helper Method Patterns

### Configure returns (set before the call)

```rust
// Single-shot: `.take()` in the trait impl, returns default after
pub fn set_next_merge_result(&self, result: Result<MergeResult, MyError>) {
    *self.next_merge_result.lock().unwrap() = Some(result);
}

// Queue-based: for testing sequences of calls
pub fn set_next_push_result(&self, result: Result<(), MyError>) {
    self.push_results.lock().unwrap().push_back(result);
}
```

### Inspect calls (assert after the call)

```rust
pub fn get_create_calls(&self) -> Vec<(String, Option<String>)> {
    self.create_calls.lock().unwrap().clone()
}
```

## Trait Impl Patterns

```rust
// Record + configurable return
fn operation(&self, id: &str) -> Result<T, MyError> {
    self.operation_calls.lock().unwrap().push(id.to_string());
    if let Some(result) = self.next_operation_result.lock().unwrap().take() {
        return result;
    }
    Ok(default_value)
}

// Queue-based return (for multiple sequential calls)
fn push(&self, branch: &str) -> Result<(), MyError> {
    self.push_calls.lock().unwrap().push(branch.to_string());
    self.push_results.lock().unwrap().pop_front().unwrap_or(Ok(()))
}

// State-tracking (for existence checks)
fn exists(&self, id: &str) -> bool {
    self.items.lock().unwrap().contains_key(id)
}
```

## Exemplar

`crates/orkestra-git/src/mock.rs` — reference mock with call recording, configurable returns, state tracking, and self-tests.
