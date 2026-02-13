---
date: 2026-02-13
category: frontend-backend
tags: [error-handling, string-contracts, integration, coupling]
severity: low
---

# Frontend-Backend String Contracts Need Explicit Documentation

## Symptoms
- Frontend feature works initially but breaks silently when backend error messages change
- No compiler errors or type-safety warnings when contract breaks
- Frontend logic depends on string prefix matching of backend error messages

## Root Cause
The frontend checks error message prefixes to detect specific failure states, but there's no type-level contract enforcing this. If the backend changes the error message format, the frontend silently fails to detect the condition.

**Example**: `IntegrationPanel` detects PR creation failures by checking:
```typescript
const isPrCreationFailure =
  task.status.type === "failed" &&
  task.status.error?.startsWith("PR creation failed:");
```

Backend sets this at `integration.rs:208`:
```rust
task.status = Status::failed(format!("PR creation failed: {error}"));
```

If backend changes "PR creation failed:" to anything else, the frontend's retry panel won't show.

## Solution
**Document string contracts explicitly** when the frontend relies on backend error message formats:

1. **Add a constant with a backend reference**:
```typescript
/**
 * Prefix used by backend to indicate PR creation failures.
 * @see crates/orkestra-core/src/workflow/services/integration.rs (pr_creation_failed)
 */
const PR_CREATION_FAILURE_PREFIX = "PR creation failed:";
```

2. **Use the constant for matching**:
```typescript
const isPrCreationFailure =
  task.status.type === "failed" &&
  task.status.error?.startsWith(PR_CREATION_FAILURE_PREFIX);
```

3. **Consider adding backend tests** that verify the error message format if it's part of a frontend contract.

## Prevention
- When frontend code checks `error?.startsWith()` or similar string patterns, extract the string to a documented constant
- Link the constant to the backend source location via `@see` JSDoc
- For critical contracts, add backend tests that fail if the string format changes
- Consider whether error discrimination should use structured error types instead of string matching

## Alternative Approaches

**Better long-term solution**: Add an error code field to `Status::failed()`:
```rust
pub enum ErrorCode {
    PrCreationFailed,
    MergeFailed,
    // ...
}

task.status = Status::failed_with_code(
    ErrorCode::PrCreationFailed,
    format!("PR creation failed: {error}")
);
```

This gives frontend type-safe error discrimination while keeping human-readable messages flexible.

## Related Code
- `src/components/TaskDetail/TaskDetailSidebar.tsx:39` - Constant definition
- `src/components/TaskDetail/TaskDetailSidebar.tsx:128-135` - Usage in visibility logic
- `crates/orkestra-core/src/workflow/services/integration.rs:208` - Backend error creation
