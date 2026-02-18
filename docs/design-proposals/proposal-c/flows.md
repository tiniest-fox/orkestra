# Proposal C: User Flows

## Flow 1: Creating a Task

### Default Creation

1. Command bar is focused (or press Cmd+K to focus it)
2. Type: `new Implement user authentication with JWT`
3. Press Enter
4. Task is created with default settings (auto mode off, default branch, default flow)
5. New task row appears in "ACTIVE" section with `~` (queued) status
6. Within seconds, agent starts and status changes to `*` (working)

### Creation with Options

1. Focus command bar
2. Type: `new --flow quick --auto -b feature/auth Fix the login bug on the auth page`
3. Press Enter
4. Task is created with: quick flow, auto mode on, base branch `feature/auth`
5. Task appears in "ACTIVE" and progresses automatically through all stages

### Alternative: Interactive Creation

1. Focus command bar, type `new` and press Enter (without description)
2. A minimal inline form appears below the command bar:
   ```
   Description: _
   Flow: [default] quick hotfix micro
   Branch: main
   Auto: off

   Enter to create  |  Esc to cancel
   ```
3. Tab between fields, type to fill, Enter to create

---

## Flow 2: Monitoring Active Tasks

### Passive Monitoring

1. The default buffer view shows all tasks grouped by urgency
2. "ACTIVE" section shows tasks with `*` prefix and a live status in the rightmost column
3. The live status updates in real-time as the agent works:
   ```
   * auth-refactor     Work   coding    Reading src/middleware/auth.ts
   ```
   updates to:
   ```
   * auth-refactor     Work   coding    Running cargo test...
   ```
4. No interaction needed -- the buffer is a live feed

### Quick Scan

1. Glance at the command bar status summary: `[3 active] [1 review] [1 failed]`
2. These counts tell you immediately if anything needs attention
3. The "NEEDS ATTENTION" section is always at the top -- if it's empty, nothing needs you

### Filtering

1. Focus command bar
2. Type `is:active` to show only active tasks
3. Or `stage:work` to show only tasks in the work stage
4. Or `auth` to filter by text match on task title/description
5. The buffer filters instantly as you type
6. Press Escape to clear the filter and show all tasks

---

## Flow 3: Reviewing Agent Work (Primary User Action)

### From the Buffer

1. The task appears in "NEEDS ATTENTION" with a `>` symbol:
   ```
   > database-schema-update     Review   planning   View plan, approve or reject
   ```
2. Navigate to it with j/k keys (or click)
3. Press Enter to enter focus view

### In Focus View

4. The focus view shows:
   ```
   database-schema-update
   Review planning artifact
   Created 2h ago  |  Stage: planning  |  Iteration 2

   ----------------------------------------------------------------

   ARTIFACT: plan

   ## Database Schema Update Plan

   ### Changes
   1. Add `workflow_stage_sessions` table for agent session tracking
   2. Add `log_entries` table for structured agent logs
   ...

   ----------------------------------------------------------------

   [a]pprove  [r]eject with feedback  [d]iff  [l]ogs  [h]istory
   ```
5. Read the artifact (it's rendered as styled markdown, full-width)
6. To approve: press `a`
7. Confirmation appears: `Approved. Task advancing to next stage.`
8. Auto-navigates to the next task needing attention (or returns to buffer if none)

### Rejecting with Feedback

6. To reject: press `r`
7. A text input appears below the artifact:
   ```
   Feedback: _

   Enter to submit  |  Esc to cancel
   ```
8. Type feedback: `The migration should also add a foreign key constraint from log_entries to workflow_tasks`
9. Press Enter
10. Confirmation: `Rejected with feedback. Agent will re-attempt.`
11. Task moves back to "ACTIVE" section

---

## Flow 4: Answering Agent Questions

### Discovery

1. Task appears in "NEEDS ATTENTION" with `?` symbol:
   ```
   ? api-endpoint-design     Waiting   planning   2 questions awaiting answers
   ```
2. Navigate and press Enter to focus

### Answering

3. Focus view shows questions as numbered prompts:
   ```
   api-endpoint-design
   2 questions from planning agent

   ----------------------------------------------------------------

   1. Should the API use REST or GraphQL?

      The current codebase uses REST endpoints with Express.
      The team has some GraphQL experience.

      Options:
        [1] REST (consistent with existing codebase)
        [2] GraphQL (better for complex queries)
        [3] Custom answer

      Your choice: _

   ----------------------------------------------------------------
   ```
4. Type `1` and press Enter (or type a custom answer for option 3)
5. Next question appears:
   ```
   2. Should pagination use cursor-based or offset-based pagination?

      Your answer: _
   ```
6. Type answer and press Enter
7. Confirmation: `Answers submitted. Agent resuming.`
8. Task returns to "ACTIVE" section

---

## Flow 5: Handling Failed Tasks

### Discovery

1. Task appears in "NEEDS ATTENTION" with `!` symbol:
   ```
   ! ci-pipeline-fix     Failed   work   "cargo test failed: 3 assertion errors"
   ```
2. The error message is visible directly in the task row

### Investigation

3. Press Enter to focus
4. Focus view shows:
   ```
   ci-pipeline-fix
   Failed during work stage
   Error: cargo test failed: 3 assertion errors in tests/auth_test.rs

   ----------------------------------------------------------------

   LAST ACTIVITY

   12:34:22  Read tests/auth_test.rs
   12:34:25  Edit tests/auth_test.rs (lines 45-52)
   12:34:28  Run cargo test
   12:34:31  FAILED: 3 assertion errors

   ----------------------------------------------------------------

   [r]etry  [R]etry with instructions  [l]ogs (full)  [d]iff  esc back
   ```
5. Press `l` to view full logs if needed
6. Press `r` to retry, or `R` to retry with additional instructions:
   ```
   Instructions: _

   Enter to submit  |  Esc to cancel
   ```
7. Type: `The auth middleware now returns a 401 instead of 403. Update the test assertions.`
8. Press Enter. Task resumes and returns to "ACTIVE"

---

## Flow 6: Managing Subtasks

### Viewing Subtask Status

1. Parent task in the buffer shows subtask count:
   ```
   * api-redesign     Waiting   children   3/5 subtasks complete
   ```
2. Press Enter to focus. Subtasks are shown as an indented list:
   ```
   api-redesign
   Waiting on children (3/5 complete)

   ----------------------------------------------------------------

   SUBTASKS

     . endpoint-auth         Done     12:30    Merged
     . endpoint-users        Done     12:45    Merged
     . endpoint-billing      Done     13:00    Merged
     * endpoint-notifications Work     coding   Writing handler...
     ~ endpoint-analytics    Queued   -        Blocked by: notifications

   ----------------------------------------------------------------

   Enter on a subtask to focus it  |  esc back
   ```
3. Navigate to a subtask with j/k, press Enter to focus into it
4. The subtask focus view works identically to a regular task focus view
5. Press Escape to return to the parent's subtask view
6. Press Escape again to return to the main buffer

### Subtask in Buffer View

Subtasks can also appear in the main buffer when they need attention:
```
NEEDS ATTENTION (1)

? endpoint-notifications     Questions   planning   1 question
  (subtask of api-redesign)
```

The parentage is shown as a secondary line with reduced opacity.

---

## Flow 7: Viewing Diffs

### From Focus View

1. While viewing a task in focus view, press `d`
2. The focus view content switches to a unified diff:
   ```
   database-schema-update -- Changes
   3 files changed, +87 -12

   ----------------------------------------------------------------

   src/adapters/sqlite/migrations/V15__add_sessions.sql  (+42)

     + CREATE TABLE workflow_stage_sessions (
     +     id TEXT PRIMARY KEY,
     +     task_id TEXT NOT NULL,
     +     stage TEXT NOT NULL,
     +     ...
     + );

   src/workflow/domain/session.rs  (+33 -4)

     @@ -1,4 +1,8 @@
       use serde::{Deserialize, Serialize};
     + use chrono::{DateTime, Utc};

     - pub struct StageSession {
     + #[derive(Debug, Clone, Serialize, Deserialize)]
     + pub struct StageSession {
     +     pub id: String,
     +     pub task_id: String,
     ...

   ----------------------------------------------------------------

   esc back to task  |  n next file  |  p prev file
   ```
3. Navigate between files with `n`/`p`
4. Press Escape to return to the task focus view

### From Split View

1. In split view (Ctrl+\), select a task in the left pane
2. Press `d` -- the right pane shows the diff
3. Navigate files in the diff with `n`/`p`
4. Press `d` again to toggle back to the task detail view

---

## Flow 8: Integration (Post-Completion)

### Auto-Merge

1. Task reaches "COMPLETED TODAY" with a `Done` status:
   ```
   . database-migration     Done     12:34     3 files changed
   ```
2. Press Enter to focus
3. Focus view shows integration options:
   ```
   database-migration
   Completed -- ready to integrate

   ----------------------------------------------------------------

   SUMMARY

   Added workflow_stage_sessions and log_entries tables with
   appropriate indexes. Migration runs cleanly on fresh and
   existing databases.

   3 files changed, +87 -12

   ----------------------------------------------------------------

   [m]erge to main  [p]r -- open pull request  [d]iff  [a]rchive
   ```
4. Press `m` to auto-merge
5. Confirmation: `Merged to main. Task archived.`

### Open PR

4. Press `p` to open a pull request
5. Status updates: `PR opened: #42`
6. Focus view shows PR status:
   ```
   PR #42 -- Open
   CI: passing (3/3)  |  Reviews: 0  |  Conflicts: none

   [a]rchive when merged  |  esc back
   ```

---

## Flow 9: Using the Command Bar

The command bar is always at the top of the screen. Press `/` or Cmd+K to focus it from anywhere.

### Commands

| Input | Action |
|-------|--------|
| `new <description>` | Create a task |
| `new --flow quick <desc>` | Create task with flow |
| `new --auto -b branch <desc>` | Create with auto mode and branch |
| `is:review` | Filter to tasks needing review |
| `is:failed` | Filter to failed tasks |
| `is:active` | Filter to active tasks |
| `stage:work` | Filter by stage |
| `flow:quick` | Filter by flow |
| `<text>` | Fuzzy search task titles and descriptions |
| `approve` | Approve focused task (same as `a` in focus) |
| `reject <feedback>` | Reject focused task with feedback |
| `retry` | Retry focused task |
| `archive` | View/manage archived tasks |
| `auto on/off` | Toggle auto mode for focused task |
| `interrupt` | Interrupt focused task's agent |
| `resume` | Resume interrupted task |
| `split` | Toggle split view |
| `help` | Show all commands |

### Tab Completion

- Task names complete on Tab
- Stage names complete after `stage:`
- Flow names complete after `flow:` or `--flow`
- Command names complete from first few characters

---

## Flow 10: Assistant Interaction

### Quick Question

1. Focus command bar
2. Type: `ask What's the best approach for handling database migrations?`
3. Response appears inline below the command bar as a temporary overlay
4. Press Escape to dismiss

### Extended Conversation

1. Type `assistant` in command bar and press Enter
2. The buffer switches to an assistant chat view:
   ```
   ASSISTANT

   > What's the best approach for handling database migrations?

   Based on the current codebase, I'd recommend using Refinery for
   migrations. The project already uses it for...

   > Can you explain the worktree setup process?

   Each task gets an isolated git worktree at .orkestra/.worktrees/...

   > _
   ```
3. Type messages and press Enter to send
4. Press Escape to return to the main buffer

### Context-Aware Assistant

When in focus view on a specific task:
1. Type `ask` in the status line prompt
2. The assistant automatically has context about the focused task
3. Questions like `ask Why did this fail?` get task-relevant answers

---

## Flow 11: Keyboard Navigation Summary

### Global

| Key | Action |
|-----|--------|
| `/` or `Cmd+K` | Focus command bar |
| `Escape` | Unfocus command bar / close focus view / close split |
| `Cmd+N` | Create new task (focuses command bar with `new ` prefilled) |
| `Ctrl+\` | Toggle split view |
| `j` / `k` | Move focus down / up in task list |
| `Enter` | Open focused task in focus view |
| `?` | Show keyboard shortcut help |

### In Focus View

| Key | Action |
|-----|--------|
| `Escape` | Return to buffer |
| `a` | Approve (when in review) |
| `r` | Reject with feedback (when in review) |
| `d` | Toggle diff view |
| `l` | Show full logs |
| `h` | Show iteration history |
| `s` | Show subtasks (if parent) |
| `m` | Merge to main (when done) |
| `p` | Open PR (when done) |
| `i` | Interrupt agent |
| `R` | Retry with instructions |
| `1-9` | Select option (for questions with numbered choices) |

### In Diff View

| Key | Action |
|-----|--------|
| `n` | Next file |
| `p` | Previous file |
| `Escape` | Return to task focus |
| `j` / `k` | Scroll down / up |

---

## Navigation Model

```
Buffer (default)
  |
  +-- [Enter] --> Focus View
  |                 |
  |                 +-- [d] --> Diff View
  |                 |            |
  |                 |            +-- [Esc] --> Focus View
  |                 |
  |                 +-- [l] --> Full Log View
  |                 |            |
  |                 |            +-- [Esc] --> Focus View
  |                 |
  |                 +-- [h] --> History View
  |                 |            |
  |                 |            +-- [Esc] --> Focus View
  |                 |
  |                 +-- [s] --> Subtask List
  |                 |            |
  |                 |            +-- [Enter] --> Subtask Focus
  |                 |            |                |
  |                 |            |                +-- [Esc] --> Subtask List
  |                 |            |
  |                 |            +-- [Esc] --> Focus View
  |                 |
  |                 +-- [Esc] --> Buffer
  |
  +-- [Ctrl+\] --> Split View
                     |
                     +-- Left pane: Buffer (navigable)
                     +-- Right pane: Focus View of selected task
                     |
                     +-- [Ctrl+\] --> Buffer (close split)
```

Every state is reachable from every other state in at most 3 keystrokes. Escape always goes "up" one level.
