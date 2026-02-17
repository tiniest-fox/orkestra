# CLAUDE.md — orkestra-store

Guidance for AI agents working in this crate.

## Purpose

orkestra-store provides the `WorkflowStore` trait for workflow persistence. It abstracts storage backends so the workflow system can use SQLite in production and in-memory stores for testing.

## Module Structure

```
src/
├── lib.rs              # Re-exports public API
├── interface.rs        # WorkflowStore trait + WorkflowError
├── service.rs          # SqliteWorkflowStore (thin dispatcher)
├── connection.rs       # DatabaseConnection (Arc<Mutex<Connection>>)
├── mock.rs             # InMemoryWorkflowStore (testutil feature)
├── types.rs            # Internal helper types
├── migrations/
│   └── mod.rs          # Refinery migration runner
│   └── V*.sql          # Migration files
└── interactions/       # One directory per entity
    ├── task/
    ├── iteration/
    ├── session/
    ├── log_entry/
    └── assistant/
```

## Key Files

### interface.rs

The `WorkflowStore` trait with subsections:

- **Task** — CRUD operations plus `next_task_id()`, `next_subtask_id()`
- **Iteration** — Active/latest queries, per-stage filtering
- **Stage Session** — Session management, `get_sessions_with_pids()` for crash recovery
- **Log Entry** — Append-only logs, auto-incremented sequence numbers
- **Assistant Session** — Separate assistant chat sessions
- **Bulk Read** — `list_iterations_for_tasks()`, `list_stage_sessions_for_tasks()`, `list_archived_subtasks_by_parents()`
- **Bulk Write** — `delete_task_tree()` for atomic cleanup

Many methods have **default implementations** that query per-item. The SQLite store overrides these with optimized single-query versions.

### service.rs

`SqliteWorkflowStore` is a thin dispatcher:

1. Lock the connection
2. Delegate to an interaction's `execute()`
3. Return the result

No business logic lives here.

### connection.rs

`DatabaseConnection` handles:

- WAL mode for concurrent access
- 5s busy timeout to avoid lock contention
- Automatic migration on open
- `quick_check()` for corruption detection
- `open_validated()` — moves corrupted databases aside and creates fresh ones

### mock.rs

`InMemoryWorkflowStore` uses `HashMap` and `Vec` with `Mutex` for thread safety. Behind the `testutil` feature flag.

## Interaction Organization

Each entity has its own directory under `interactions/`:

### task/

| File | Purpose |
|------|---------|
| `get.rs` | Get task by ID |
| `save.rs` | Insert or update task |
| `list.rs` | List all tasks |
| `list_headers.rs` | List tasks without artifact deserialization |
| `list_subtasks.rs` | List children of a parent |
| `list_archived_by_parents.rs` | Bulk query archived subtasks |
| `delete.rs` | Delete single task |
| `delete_tree.rs` | Transactional multi-task delete |
| `next_id.rs` | Generate petname ID |
| `next_subtask_id.rs` | Generate ID with unique last word among siblings |
| `from_row.rs` | Row deserialization helper |

### iteration/

| File | Purpose |
|------|---------|
| `get_all.rs` | All iterations for a task |
| `get_for_stage.rs` | Iterations filtered by stage |
| `get_active.rs` | Active (not ended) iteration |
| `get_latest.rs` | Most recent iteration regardless of status |
| `list_all.rs` | All iterations across all tasks |
| `list_for_tasks.rs` | Bulk query by task IDs (single IN clause) |
| `save.rs` | Insert or update |
| `delete.rs` | Delete all iterations for a task |
| `from_row.rs` | Row deserialization |

### session/

Stage session interactions follow the same pattern. `get_with_pids.rs` finds sessions with running agents (for crash recovery).

### log_entry/

| File | Purpose |
|------|---------|
| `append.rs` | Add log entry with auto-incremented sequence |
| `get.rs` | Get entries for a session |
| `delete_for_task.rs` | Delete entries via session lookup |

### assistant/

Assistant chat sessions have their own CRUD separate from stage sessions.

## Key Patterns

### Default Implementations with Optimizations

The trait provides default implementations that work but may be slow:

```rust
fn list_task_headers(&self) -> WorkflowResult<Vec<TaskHeader>> {
    let tasks = self.list_tasks()?;  // Default: deserialize all artifacts
    Ok(tasks.iter().map(TaskHeader::from).collect())
}
```

`SqliteWorkflowStore` overrides with an optimized query that skips the `artifacts` column entirely.

### Subtask ID Generation

`next_subtask_id()` ensures the last word of the petname is unique among siblings:

```rust
// If siblings are: "slowly-red-cat", "quickly-blue-dog"
// New ID must not end in "cat" or "dog"
```

This allows using the last word as a readable short display ID in the UI.

### Bulk Operations

`list_iterations_for_tasks()` and `list_stage_sessions_for_tasks()` accept a slice of task IDs and return all matching records in a single query. The SQLite implementation uses `WHERE task_id IN (?)` with dynamically generated placeholders.

`delete_task_tree()` wraps all deletes in a single transaction for atomicity.

## Gotchas

1. **`list_task_headers()` is not `list_tasks()`** — Headers skip artifact deserialization for performance. Use headers for listing, full tasks for detail views.

2. **Migrations use Refinery naming** — Files must be `VN__description.sql` (double underscore). They're embedded at compile time.

3. **Lock scope matters** — Each trait method locks the connection for its duration. Don't hold references across method calls.

4. **Session state filtering** — `get_stage_session()` excludes `Superseded` sessions by design.

## Anti-Patterns

- **Don't add business logic here** — This crate is pure persistence. Validation, state transitions, and orchestration belong in orkestra-core.
- **Don't skip transactions for multi-step operations** — Use `delete_task_tree()` for cascade deletes, not multiple `delete_task()` calls.
- **Don't access `interactions/` from outside this crate** — They're implementation details. Use the trait.
