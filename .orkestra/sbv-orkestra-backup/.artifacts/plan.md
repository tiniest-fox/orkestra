# Fix prewarm: unified setup, title-gen race, cleanup race, and validation guards

## Summary

Three bugs in the worktree prewarming system, plus missing runtime validation:

1. **Setup script skipped** — Prewarm-adopted tasks skip `worktree_setup.sh`. Fix: unify into a single setup flow where all tasks go through `SettingUp` with idempotent steps (`ensure_worktree` already handles this).

2. **Title-gen state clobber** — Background title generation does a full `save_task()` that can overwrite task state. Fix: targeted `update_task_title()` store method.

3. **Cleanup deletes prewarm worktrees** — `cleanup_orphaned_worktrees` runs every 60s and only checks `Task` records, not `WorktreeRecord`s. Prewarm worktrees (which only have a `WorktreeRecord` before adoption) get deleted along with their branches. This is the root cause of `swiftly-noble-lion`'s failure. Fix: also check `WorktreeRecord`s before deleting.

4. **No worktree validity guards** — The setup path trusts that a worktree directory is a valid git worktree without checking. Add guards that verify a valid `.git` file/dir exists in the worktree before proceeding.

## Scope

| In scope | Out of scope |
|----------|-------------|
| Unify create.rs: all tasks go through `AwaitingSetup` → `SettingUp` → `Queued` | Refactoring prewarm lifecycle beyond these fixes |
| Make `setup_worktree::execute()` idempotent (leverage existing `ensure_worktree`) | Changing `ensure_worktree()` API in orkestra-git |
| Add `update_task_title()` targeted store method | |
| Fix `cleanup_orphaned_worktrees` to check `WorktreeRecord`s | |
| Add worktree validity guards during setup | |
| E2e tests covering all three bugs and the guards | |

## Success Criteria

| Criterion | Verification |
|-----------|-------------|
| All tasks go through `SettingUp` before `Queued` | Code + e2e test |
| `worktree_setup.sh` runs for prewarm-adopted tasks | Code + e2e test |
| Title generation uses targeted update, cannot clobber state | Code + unit test |
| Periodic cleanup preserves worktrees with matching `WorktreeRecord` | Code + e2e test |
| Setup detects and recovers from invalid worktree state (missing `.git`) | Code + e2e test |
| All existing tests pass | `cargo test --workspace` zero warnings |

## E2e Tests

These tests validate the bugs and their fixes. They use `TestEnv` with `MockAgentRunner` and real SQLite — see existing patterns in `crates/orkestra-core/tests/e2e/`.

### Test 1: Prewarm-adopted task runs setup script
- Prewarm a worktree (sync mode), verify record is `Ready`
- Create a task that adopts the prewarm
- Advance orchestrator — task should go through `SettingUp`
- Verify `setup_worktree::execute()` was called (setup script ran)
- Verify task reaches `Queued` with valid worktree

### Test 2: Cleanup preserves prewarm worktrees
- Prewarm a worktree, verify directory + branch exist
- Run `cleanup_orphaned_worktrees` — no `Task` exists, only `WorktreeRecord`
- Verify worktree directory and branch still exist
- Verify `WorktreeRecord` still exists

### Test 3: Cleanup still removes truly orphaned worktrees
- Create a worktree directory manually (no task, no record)
- Run `cleanup_orphaned_worktrees`
- Verify it was removed (regression guard — don't break existing cleanup)

### Test 4: Title generation doesn't clobber task state
- Create a task, advance it past `Queued` to `AgentWorking`
- Call `generate_title::execute()` 
- Verify task state is still `AgentWorking` (not reverted to `Queued`)
- Verify title was updated

### Test 5: Setup detects invalid worktree and recovers
- Create a prewarm record marked `Ready` with a worktree path
- Create the directory but WITHOUT a valid `.git` file (simulates cleanup having deleted the worktree)
- Create a task that adopts the prewarm, advance through setup
- Verify setup detects the invalid state and re-creates the worktree via `ensure_worktree`
- Verify task reaches `Queued` with a valid worktree

### Test 6: Unified setup path is idempotent
- Create a task with a valid prewarm worktree (fully set up)
- Run `setup_worktree::execute()` again
- Verify no error, worktree unchanged, setup script ran again

## Worktree Validity Guards

Add checks during task setup that verify the worktree is actually a valid git worktree before proceeding:

- **In `setup_worktree::execute()`**: After `ensure_worktree()` returns (whether it created or found existing), verify the worktree path contains a valid `.git` file. If the directory exists but `.git` is missing (zombie from cleanup), remove the directory and retry `ensure_worktree()`.
- **In `adopt_worktree::apply_to_task()`** or the caller in `create.rs`: When adopting a `Ready` worktree record, verify the worktree path actually exists and has a valid `.git` file. If not, skip adoption (fall through to normal `AwaitingSetup` path which will recreate it).

## Open Technical Questions

- Should `update_task_title()` live on the `WorkflowStore` trait or concrete store? Breakdown agent should follow existing patterns for targeted updates.
- For the cleanup fix: should `cleanup_orphaned_worktrees` query `WorktreeRecord`s via a new store method, or should `list_worktree_names` be filtered? The former is simpler — pass the store's worktree records as a second exclusion set alongside task headers.
- For the validity guard retry: if `ensure_worktree()` itself created the worktree but it's still invalid after, should setup fail fast or retry once? Fail fast is probably correct — a retry masks a deeper git issue.
