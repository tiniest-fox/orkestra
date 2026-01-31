# Tauri Backend

The Tauri layer is a thin bridge between the React frontend and the `orkestra-core` library. It should contain no business logic — commands acquire the `WorkflowApi` lock, call a method, and return the result.

## Command Organization

Commands live in `src/commands/`, organized by concern:

| File | Concern | Pattern |
|------|---------|---------|
| `task_crud.rs` | Create, read, delete tasks | `app_state.api()?.method()` |
| `human_actions.rs` | Approve, reject, answer questions, retry, auto-mode | `app_state.api()?.method()` |
| `queries.rs` | Read-only data fetching (iterations, artifacts, config, logs) | `app_state.api()?.method()` |
| `external_tools.rs` | Open worktrees in terminal/editor | Shell commands via `tauri-plugin-shell` |

All commands are re-exported from `commands/mod.rs` and registered in `lib.rs`'s `invoke_handler!`.

## Adding a New Command

1. Add the function in the appropriate module (or create a new one if it's a new concern)
2. Annotate with `#[tauri::command]` — Tauri requires owned types for parameters
3. Get the API via `app_state.api()?` which returns a `MutexGuard<WorkflowApi>`
4. Return `Result<T, TauriError>` — use `?` with `WorkflowError` (auto-converts via `From` impl in `error.rs`)
5. Re-export from `commands/mod.rs` if new module
6. Register in the `invoke_handler!` macro in `lib.rs`
7. Frontend TypeScript bindings regenerate on build

## State Management

- `AppState` (`state.rs`) holds `Arc<Mutex<WorkflowApi>>`, the workflow config, project root, and database connection
- Commands receive `State<AppState>` from Tauri's dependency injection
- The API lock is shared between commands and the orchestrator — hold it briefly
- `StartupState` is separate and always available (even before initialization completes)

## Error Handling

- `TauriError` (`error.rs`) wraps `WorkflowError` with structured `{ code, message }` JSON
- Error codes: `TASK_NOT_FOUND`, `INVALID_TRANSITION`, `STORAGE_ERROR`, `LOCK_ERROR`, etc.
- Frontend parses these via `JSON.parse(error)` in catch blocks

## Key Files

| File | Role |
|------|------|
| `lib.rs` | App entry point: initialization, orchestrator startup, signal handlers, notification handling |
| `state.rs` | `AppState`: database connection, API construction, git service setup |
| `error.rs` | `TauriError` with `From<WorkflowError>` conversion and error code table |
| `startup.rs` | Project root detection, database setup, startup status reporting |
| `commands/mod.rs` | Command re-exports and `get_startup_status` |
