# orkestra-git

Git operations for Orkestra task orchestration.

## Overview

This crate provides worktree management, branch operations, merge/rebase, and diff capabilities for isolating tasks in parallel git worktrees. It is the **reference implementation** of the trait+service+mock+interactions module pattern used throughout Orkestra.

## Key Types

### Trait

- **`GitService`** — Port for git operations. Requires `Send + Sync` for thread-safe sharing across the orchestrator and Tauri command handlers.

### Implementations

- **`Git2GitService`** — Production implementation using git2 crate + CLI
- **`MockGitService`** — Testing implementation with canned responses (behind `testutil` feature)

### Domain Types

- **`WorktreeCreated`** — Result of worktree creation (branch name, path, base commit)
- **`TaskDiff`** — Complete diff for a task branch against its base
- **`FileDiff`** — Diff information for a single file
- **`MergeResult`** — Result of a merge operation (commit SHA, target branch, timestamp)
- **`SyncStatus`** — Commits ahead/behind remote tracking branch
- **`CommitInfo`** — Metadata for a single git commit
- **`GitError`** — Error variants for git operations

## Usage

```rust
use orkestra_git::{GitService, Git2GitService, WorktreeCreated};
use std::path::Path;

// Create service for a repository
let git = Git2GitService::new(Path::new("/path/to/repo"))?;

// Create a worktree for a task
let worktree: WorktreeCreated = git.create_worktree("TASK-001", Some("main"))?;
println!("Branch: {}", worktree.branch_name);      // task/TASK-001
println!("Path: {:?}", worktree.worktree_path);    // .orkestra/.worktrees/TASK-001
println!("Base: {}", worktree.base_commit);        // abc123...

// Check for uncommitted changes
if git.has_pending_changes(&worktree.worktree_path)? {
    git.commit_pending_changes(&worktree.worktree_path, "WIP")?;
}

// Get diff against base branch
let diff = git.diff_against_base(
    &worktree.worktree_path,
    "task/TASK-001",
    "main"
)?;
for file in diff.files {
    println!("{}: +{} -{}", file.path, file.additions, file.deletions);
}

// Merge to target branch
let result = git.merge_to_branch("task/TASK-001", "main")?;
println!("Merged at {}", result.commit_sha);

// Clean up worktree (keep branch since it's merged)
git.remove_worktree("TASK-001", false)?;
```

## Feature Flags

| Flag | Description |
|------|-------------|
| `testutil` | Enables `MockGitService` for integration tests |

## Dependencies

- **git2** — Rust bindings for libgit2 (reads, some writes)
- **chrono** — Timestamp formatting
- **serde** — Serialization for types
