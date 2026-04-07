# CLAUDE.md — orkestra-networking

Guidance for AI agents working in this crate.

## Purpose

`orkestra-networking` is the WebSocket server crate for remote control. It exposes the full `WorkflowApi` over an authenticated WebSocket connection (consumed by `daemon/`) and owns the **shared command handler layer** (`interactions/command/`) — handler functions shared between Tauri commands and WebSocket dispatch to prevent drift.

See the root CLAUDE.md Workspace Structure for a broader summary.

## Command Handler Conventions

### Thin-Delegate Rule

Command handlers in `crates/orkestra-networking/src/interactions/command/` are **thin delegates only**. Each handler must call exactly one `api.method()` and return — nothing else.

Business logic (field validation, git operations, error mapping) belongs in an interaction under `crates/orkestra-core/src/workflow/`, exposed through `WorkflowApi`.

**Patterns that cause HIGH rejections:**
- Guard clauses that validate task state inside the handler (e.g., checking `is_done`, `open_pr`, `branch_name` directly)
- Extracting task fields from a database query inside the handler before calling git
- Any logic beyond: deserialize params → call `api.one_method()` → serialize result

To add a new command: create an interaction in `orkestra-core`, add a `WorkflowApi` method that delegates to it, then write a one-liner handler in `interactions/command/`. Follow the existing siblings in `git.rs` as the template.

### Canonical Command Names

When calling backend commands from the frontend, always use `transport.call("canonical-name", ...)` where the name matches the key in `METHOD_MAP` (e.g. `"archive"`, `"approve"`). Never use the raw Tauri command string (e.g. `"workflow_archive"`) — it bypasses the transport abstraction and breaks WebSocket clients. The `METHOD_MAP` in `TauriTransport.ts` is the single source of truth for command names.

## WebSocket Transport Conventions

### Param Key Casing

Params passed to `transport.call()` are serialized over the WebSocket and deserialized into Rust structs by `serde`. Rust structs use snake_case field names. **Always use snake_case keys** in the TypeScript params object (e.g., `task_id`, not `taskId`). Using camelCase will silently fail to deserialize on the Rust side — the field arrives as `None` or triggers an error with no obvious signal. This is the most common cause of WebSocket handler breakage on the frontend side.

### Dispatch Table Parity

Every new WebSocket handler added to `dispatch.rs` needs a corresponding wiring test asserting `!= METHOD_NOT_FOUND`. Search `websocket.rs` tests for existing examples; they use a `build_test_handler()` helper. Missing wiring tests are flagged by reviewers.

`METHOD_MAP` in `TauriTransport.ts` and the Rust dispatch table are maintained in parallel. When adding a new command, update both and add a cross-reference comment to make the link explicit.

### Dead TCP + Timeout Handling

**Never call `ws.close()` in a timeout handler** — On a dead TCP connection, `ws.close()` itself hangs (the browser's close handshake waits for an acknowledgement that never arrives). When a `transport.call()` times out, the timeout handler must call `_handleDisconnect()` directly to force-close state and trigger reconnection — never `ws.close()`.

Additionally, store the `setTimeout` handle inside the `PendingRequest` entry and clear it inside `_handleDisconnect` (before resolving/rejecting any pending requests) to prevent double-rejection crashes when disconnect fires concurrently with a timeout.

**New timeout/transport error strings must go in `DISCONNECT_MESSAGES`** — Any error message that a timeout or dead-socket condition produces (e.g., `"Request timed out"`) must be registered in `DISCONNECT_MESSAGES` in `transportErrors.ts`. This ensures `isDisconnectError()` returns `true` for these errors, so action-handler `.catch()` guards correctly suppress spurious toast notifications during the exact reconnection scenario you're fixing.

## Notification Formatting

Notification format strings (title and body) are the **single source of truth** in `crates/orkestra-networking/src/types.rs` as three public functions: `format_review_notification`, `format_error_notification`, `format_conflict_notification`. Both Tauri's `TaskNotifier` and WebSocket `Event` constructors delegate to these functions.

Event payloads include pre-formatted `notification_title` and `notification_body` fields so all clients (Tauri desktop, PWA) receive ready-to-display strings. **Never duplicate this formatting logic in `src-tauri/src/notifications.rs` or frontend hooks** — put new notification format functions here and have all consumers call them.

When adding a new notification type: add a `format_*_notification` function in `types.rs`, call it from the relevant `Event::*()` constructor to embed it in the payload, and update the Tauri `TaskNotifier` to call the same function.

## Async Handler Conventions

When writing async HTTP handlers (axum, actix, etc.), **never call blocking operations directly** — process management, synchronous I/O, heavy computation, or anything that holds a lock while doing I/O. Blocking the async runtime starves all other requests on the thread.

Use `tokio::task::spawn_blocking` for any blocking call:

```rust
let supervisor = Arc::clone(&state.supervisor);
let id = project_id.clone();
spawn_blocking(move || supervisor.stop_daemon(&id))
    .await
    .map_err(|e| /* task panicked */)?
    .map_err(|e| /* stop failed */)?;
```

Both error cases need handling: `Ok(Err(e))` (operation failed) and `Err(e)` (task panicked). This is a HIGH-severity finding reviewers always catch when blocking code appears in async context.
