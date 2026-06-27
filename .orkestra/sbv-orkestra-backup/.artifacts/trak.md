**Trak ID**: softly-bland-vulture
**Title**: Fix prewarm: run setup script and fix title-gen race

### Description
## Summary

Two bugs introduced with worktree prewarming:

### Bug 1: Setup script never runs for prewarm-adopted tasks

`spawn_prewarm()` calls `git_service.ensure_worktree()`, which explicitly does NOT run the setup script. For prewarm-adopted tasks (the happy path, now the most common case), the task jumps directly to Queued — `setup_worktree::execute()` is never called, so `worktree_setup.sh` never runs. Missing: `target/` symlink, `dist/` symlink, MISE trust config, rust-analyzer warm-up.

**Fix**: Call `git_service.run_setup_script()` inside `spawn_prewarm()`'s background thread after `ensure_worktree()` succeeds, before saving the record as Ready.

### Bug 2: Title generation race clobbers task state

In `create.rs` lines 91-99, a background title gen thread is spawned for prewarm-adopted tasks after `store.save_task()`. The thread does a full `save_task()` after an AI call. By the time it saves, the orchestrator has likely already advanced the task to `AgentWorking`. The title gen save overwrites the state back to `Queued`, which could cause `dispatch_completion` to mishandle the agent's output when it finishes.

**Fix**: Use a targeted title-only update in the store (e.g., `UPDATE tasks SET title = ? WHERE id = ? AND title = ''`) rather than a full `save_task()` overwrite, or save the title to a separate column update that doesn't touch state.

## Files to investigate/change
- `crates/orkestra-core/src/workflow/task/setup.rs` — `spawn_prewarm()` (Bug 1)
- `crates/orkestra-core/src/workflow/task/interactions/create.rs` — title gen thread (Bug 2)
- `crates/orkestra-core/src/workflow/task/interactions/generate_title.rs` — full save_task race
- `crates/orkestra-store/src/` — may need a targeted `update_task_title()` store method