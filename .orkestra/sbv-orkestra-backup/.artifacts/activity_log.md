[plan]
- Confirmed `ensure_worktree` is already idempotent — no new detection logic needed for the unified setup path
- Root cause of consistent failures: `cleanup_orphaned_worktrees` checks only Tasks, not WorktreeRecords, so prewarm worktrees are treated as orphaned and deleted (with their branches) every 60s
- User wants: (1) e2e tests validating all three bugs and the fixes, (2) runtime guards verifying valid git worktree state during setup
- Plan updated with test-first emphasis and worktree validity guards

