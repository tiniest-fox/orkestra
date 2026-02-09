# Git Polling Optimization - Behavioral Verification Checklist

## Compilation & Test Status

✅ **All compilation and tests pass:**
- `cargo test -p orkestra-core`: 615 unit tests + 66 e2e tests passed
- `cargo build` (Tauri backend): Compiled successfully
- `pnpm build` (Frontend): Built successfully with no TypeScript errors

## Manual Behavioral Verification

The following scenarios should be verified manually when running the application to ensure the optimized git polling behavior works correctly:

### 1. Commit List Loads Immediately
**What to test:**
- Open the git history panel for any task
- Observe the commit list population

**Expected behavior:**
- Commit list populates quickly with:
  - Commit hash (abbreviated)
  - Commit message
  - Author name
  - Timestamp
- File counts should NOT be visible yet
- Skeleton placeholders (loading indicators) should appear where file counts will be

**Why this matters:** The optimization separates lightweight commit info from expensive file count calculations. Users should see commit history immediately without waiting for file count stats.

---

### 2. File Counts Appear After Short Delay
**What to test:**
- Continue observing the git history panel after it loads
- Watch the skeleton placeholders

**Expected behavior:**
- Within 1-2 seconds, skeleton placeholders should be replaced with actual file counts
- File counts should display as "N files" (e.g., "3 files", "1 file")
- All visible commits should get their file counts populated in a single batch

**Why this matters:** The batch file count API should fetch counts for all visible commits efficiently, avoiding N+1 queries.

---

### 3. File Counts Persist Across Panel Toggle
**What to test:**
- Close the git history panel
- Reopen the git history panel
- Observe the commit list on reopen

**Expected behavior:**
- File counts should be visible immediately (no skeleton flash)
- Counts are served from provider state cache
- No additional backend calls for file counts on reopen

**Why this matters:** Provider state persistence prevents unnecessary re-fetching of data that doesn't change frequently.

---

### 4. New Commits Get File Counts
**What to test:**
- Leave the git history panel open
- Make a new commit in the task's worktree (or wait for polling to detect an existing new commit)
- Observe how the new commit appears in the list

**Expected behavior:**
- New commit appears in the list with commit info (hash, message, author, timestamp)
- File count initially shows skeleton placeholder
- File count loads and replaces skeleton within 1-2 seconds

**Why this matters:** The polling system should handle incremental updates correctly, fetching file counts for new commits without re-fetching existing ones.

---

### 5. Commit Diff Still Works (On-Demand Loading)
**What to test:**
- Click on any commit in the history list
- Observe the diff panel

**Expected behavior:**
- Diff panel opens and displays the full diff with syntax highlighting
- Loading should be fast (on-demand, no polling)
- Diff content should match the selected commit
- No regression in diff functionality

**Why this matters:** The `useCommitDiff` hook provides on-demand diff loading, separate from the commit list polling. This should continue working exactly as before.

---

### 6. Task Diff Polling Works
**What to test:**
- Open a task diff panel (for a task that has uncommitted changes)
- Observe the diff panel behavior
- Make a change to a file in the task's worktree
- Close the diff panel

**Expected behavior:**
- Diff loads initially when panel opens
- Diff updates every 2 seconds while panel is open
- New changes appear in the diff after polling interval
- Closing the panel stops polling (verify in browser DevTools network tab or Tauri logs)

**Why this matters:** Task diffs use `useDiff` with polling enabled. This should work independently of commit history polling.

---

### 7. No Regression in Commit Selection
**What to test:**
- Click on different commits in the history list
- Observe the diff panel switching between commits

**Expected behavior:**
- Clicking a commit immediately switches the diff panel to that commit
- No delay or lag when switching between commits
- Diff content correctly reflects the selected commit
- Previously loaded diffs can be re-selected without re-fetching

**Why this matters:** Commit selection and diff viewing should remain responsive and correct throughout the optimizations.

---

## Success Criteria

All 7 behavioral scenarios above should work as described. If any scenario fails or behaves differently than expected, investigate the specific component:

- **Scenarios 1-4**: Backend commit list polling + frontend provider state
- **Scenario 5**: `useCommitDiff` hook (on-demand loading)
- **Scenario 6**: `useDiff` hook with polling
- **Scenario 7**: Frontend commit selection state management

## Performance Notes

Expected performance characteristics:
- Initial commit list load: <100ms (lightweight commit info only)
- File count batch fetch: 1-2 seconds for typical commit lists (10-20 commits)
- Commit diff load: <500ms per commit (on-demand, cached by Git)
- Task diff polling: 2-second intervals when panel is open

## Testing Tips

1. **Use browser DevTools**: Network tab should show reduced API calls for commit lists
2. **Check Tauri logs**: Should show batch file count queries, not individual queries per commit
3. **Test with large repos**: Optimization benefits are most visible with repositories that have many commits
4. **Test panel toggling**: Verify caching works by rapidly closing/opening git history panel
