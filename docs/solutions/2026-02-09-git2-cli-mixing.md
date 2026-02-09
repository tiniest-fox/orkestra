---
date: 2026-02-09
category: git
tags: [git2, git-cli, worktree, metadata-inconsistency]
severity: medium
---

# Mixing git2 and git CLI Causes Metadata Inconsistency

## Symptoms
- Branch deletion failures that only appear when running commands manually via git CLI
- Commands succeed in code but fail when inspected externally
- Error messages like "branch checked out" despite worktree cleanup completing successfully

## Root Cause
Mixing git2 (in-process Rust bindings) with git CLI operations causes metadata state divergence:

1. git2 modifies repository state in-process
2. git CLI reads on-disk metadata that hasn't been updated
3. CLI sees stale state (e.g., worktree still checked out after git2 pruned it)

In this case: `git2::Repository::prune_worktrees()` cleaned up worktree metadata in-process, but `git branch -D` via CLI saw the worktree as still checked out in the on-disk metadata.

## Solution
**Use git2 consistently for all related operations.** Don't switch to CLI mid-flow.

Changed `delete_branch()` from:
```rust
Command::new("git")
    .args(["branch", "-D", branch_name])
    .output()?
```

To:
```rust
let mut branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
branch.delete()?;
```

Both operations now use the same in-process repository handle, eliminating metadata inconsistency.

## Prevention
- When using git2 for repository operations, continue using git2 for all related operations in the same flow
- Only use git CLI for operations git2 doesn't support or for read-only inspection
- If you must mix git2 and CLI: flush/sync the repository state before CLI calls (though this is error-prone)

## Related Code
- `crates/orkestra-core/src/workflow/adapters/git_service.rs:621-638` - Fixed implementation
- `crates/orkestra-core/src/workflow/adapters/git_service.rs:1083-1135` - Integration test
