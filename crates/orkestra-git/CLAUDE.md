# CLAUDE.md — orkestra-git

This crate is the **reference implementation** of the trait+service+mock+interactions module pattern. Study this crate when learning how to structure Orkestra modules.

## Module Structure

```
src/
├── lib.rs           # Public API exports
├── interface.rs     # GitService trait with subsections
├── service.rs       # Git2GitService — thin dispatcher to interactions
├── mock.rs          # MockGitService — testutil feature flag
├── types.rs         # GitError, WorktreeCreated, TaskDiff, etc.
└── interactions/    # Domain-organized operations
    ├── mod.rs
    ├── worktree/    # create, create_for_branch, exists, list, remove, setup_script
    ├── branch/      # create_from_oid, current, delete, get_commit_oid, is_merged, list, resolve_working_dir
    ├── commit/      # batch_file_counts, create, has_pending_changes, log, read_file_at_head
    ├── diff/        # against_base, collect, commit, parse_output, uncommitted, untracked_file
    ├── file/        # list (git-tracked files in repo)
    ├── merge/       # fast_forward, rebase, squash
    ├── remote/      # pull, push, sync_base, sync_status
    └── stash/       # pop, push
```

## Key Patterns

### One `execute()` Per Interaction

Every file in `interactions/` exposes a single `pub fn execute(...)` as its entry point. Private helpers stay below. Example from `worktree/create.rs`:

```rust
pub fn execute(
    repo: &Mutex<Repository>,
    worktrees_dir: &Path,
    task_id: &str,
    base_branch: Option<&str>,
) -> Result<WorktreeCreated, GitError> {
    // ... implementation
}
```

### Composing Interactions

Within the same domain, use `super::action::execute()`:
```rust
if super::exists::execute(repo, task_id) { ... }
```

Across domains, use the full path:
```rust
let oid = crate::interactions::branch::get_commit_oid::execute(repo, base_branch)?;
```

### Service as Thin Dispatcher

`Git2GitService` holds shared state (repo, paths) and delegates each trait method to exactly one interaction. No business logic in the service:

```rust
fn create_worktree(&self, task_id: &str, base_branch: Option<&str>) -> Result<WorktreeCreated, GitError> {
    let result = self.ensure_worktree(task_id, base_branch)?;
    interactions::worktree::setup_script::execute(&self.repo_path, &result.worktree_path)?;
    Ok(result)
}
```

### Trait Subsections

`GitService` uses subsection comments to group related methods:

```rust
pub trait GitService: Send + Sync {
    // -- Worktree --
    fn create_worktree(...) -> Result<WorktreeCreated, GitError>;
    fn ensure_worktree(...) -> Result<WorktreeCreated, GitError>;
    // ...

    // -- Branch --
    fn list_branches(...) -> Result<Vec<String>, GitError>;
    // ...
}
```

The service and mock implementations use matching subsections.

## Important Behaviors

### Worktree Creation

- `create_worktree()` — Creates worktree AND runs setup script
- `ensure_worktree()` — Creates worktree WITHOUT running setup script

The split exists because callers need to save worktree info to the database before the setup script runs, enabling retry if the setup script fails.

### Branch Merge Checks

`is_branch_merged()` returns `true` if:
1. All commits on the branch are reachable from the target, OR
2. The branch doesn't exist (already cleaned up after merge)

This lets cleanup code safely call `is_branch_merged()` without worrying about deleted branches.

### Fetching from Remote

Always fetch without a refspec: `git fetch origin` (via `interactions/remote/fetch.rs`). The refspec form `git fetch origin main:main` fails with an error when `main` is the currently checked-out branch, because git refuses to update a checked-out branch via a refspec. After fetching, resolve the base commit from the remote-tracking ref (`origin/main`) rather than the local branch ref — this ensures worktrees branch from `origin/main`'s tip regardless of whether the user has run `git pull`.

### git2 vs CLI

The crate uses both git2 (Rust bindings) and git CLI:
- **git2**: Repository reads, branch operations, some worktree operations
- **CLI**: Diff output formatting, merge/rebase (for cleaner conflict handling), push/pull

The `Repository` is wrapped in `Mutex<Repository>` because git2's `Repository` is `Send` but not `Sync`.

## Anti-Patterns to Avoid

- **Business logic in service.rs** — Keep service methods as single-line dispatchers
- **Skipping the interaction pattern** — Every operation gets its own `execute()` file, even if it's 10 lines
- **Reaching into interactions from outside** — Callers use `GitService` trait, never `interactions::` directly
- **Shared helpers in a utilities file** — If multiple interactions need the same logic, one calls the other or it becomes its own interaction

## Testing

Unit tests live inline in `service.rs` and `mock.rs`. Tests create real git repositories in temp directories.

When testing worktree creation, call `git.fetch_origin()` before `ensure_worktree()` to mirror production usage (see `setup_worktree.rs`). Without the preceding fetch, the remote-tracking ref won't be populated and tests that rely on resolving `origin/main` will fail.

For integration tests in other crates, use `MockGitService` (requires `testutil` feature). Two patterns exist for injecting errors:

**One-shot result override** (`set_next_*`) — for methods that may be called multiple times but only need a single error on one call:
```rust
let mock = MockGitService::new();
mock.set_next_merge_result(Err(GitError::MergeConflict { ... }));
```

**Persistent error injection** (mutex+take, the `force_push_error` pattern) — for methods that need to return an error on the next call, used when adding new error paths to the mock:
```rust
// In mock.rs: add a field and setter following force_push_error
mock.set_has_pending_changes_error(GitError::Other("...".into()));
// next call to has_pending_changes() takes the error and returns Err(...)
```

Use the mutex+take pattern when extending the mock with a new error-injectable method.
