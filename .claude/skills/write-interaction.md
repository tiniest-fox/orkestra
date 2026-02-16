---
name: write-interaction
description: Write a new interaction file following the standard module structure
---

# Write Interaction

An interaction is a single git/domain operation. One file, one `execute()`, one concern.

## File Template

```rust
//! {One-sentence description of what this interaction does.}

use std::path::Path;
// ... only what's needed

use crate::types::{ModuleError, ...};

/// {Doc comment explaining the operation and any important behavior.}
pub fn execute(
    // Parameters — see "Parameter Patterns" below
) -> Result<T, ModuleError> {
    // Implementation
}

// Private helpers below — never `pub`
fn helper(...) { ... }
```

## Rules

1. **One `pub fn execute()` per file.** This is the only public function. No exceptions — if you need a second public entry point, create a second interaction file.
2. **Private helpers are fine.** Functions below `execute()` that break up complex logic. Never `pub`, never exported.
3. **Small files are correct.** A 12-line wrapper around a single git command is right. Don't pad files for length.
4. **If it grows beyond ~120 lines**, consider splitting into composed interactions.

## Parameter Patterns

Use the pattern that matches your domain:

| Pattern | When |
|---------|------|
| `repo: &Mutex<Repository>` | git2 operations (branch lookup, worktree checks) |
| `worktree_path: &Path` | CLI git commands in a worktree context |
| `repo_path: &Path` | CLI git commands in the main repo |
| Domain-specific params | IDs, branch names, messages, etc. |

## Composing Other Interactions

Same domain — use `super::`:
```rust
super::exists::execute(repo, task_id)
```

Cross-domain — use full path:
```rust
crate::interactions::branch::get_commit_oid::execute(repo, base_branch)
```

Never import interactions from outside the crate.

## Error Handling

- Return `Result<T, ModuleError>` (e.g., `GitError`)
- Use `?` with `.map_err()` for context:
  ```rust
  Command::new("git")
      .args(["merge", "--ff-only", source])
      .current_dir(working_dir)
      .output()
      .map_err(|e| GitError::MergeError(format!("Failed to merge: {e}")))?;
  ```
- Never swallow errors silently. `Ok(None)` for file-not-found is fine if the caller expects it.

## File Naming & Organization

```
interactions/
  {domain}/          # e.g., worktree/, branch/, merge/
    mod.rs           # pub mod {action};
    {action}.rs      # verb or noun: create.rs, exists.rs, fast_forward.rs
```

- Directory = "What kind of thing?" (worktree, branch, merge, diff)
- File = "What action?" (create, delete, exists, fast_forward)

When adding a new interaction, also add `pub mod {name};` to the domain's `mod.rs`.

## Exemplars

- **Simple (12 lines):** `crates/orkestra-git/src/interactions/worktree/exists.rs`
- **Complex with composition:** `crates/orkestra-git/src/interactions/merge/fast_forward.rs`
- **Organization:** `crates/orkestra-git/src/interactions/mod.rs`
