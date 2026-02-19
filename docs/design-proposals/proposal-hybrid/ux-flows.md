# Forge UX Flows

UX flow documentation for the Orkestra Forge design system. This document maps every user journey through the app, defines the information hierarchy for each view, specifies what each task state shows in the detail panel, and documents interaction patterns, edge cases, and gaps in the current proposal.

---

## 1. Complete User Journey Map

### 1.1 First Launch

**Entry point:** User opens the app for the first time, or has no project loaded.

**Flow:**
1. App launches to the onboarding/project picker screen
2. User sees: recent projects list (empty on first use), "Open folder" affordance, brief description of what Orkestra does
3. User clicks "Open folder" or drags a folder onto the window
4. OS file picker opens, user selects a project root
5. App validates the project (looks for `.orkestra/` directory or `Cargo.toml` with `[workspace]`)
6. If `.orkestra/` does not exist: app prompts to initialize with a sensible default workflow
7. If valid project: app opens the feed view with the split pane available

**What can go wrong:**
- User selects a directory with no recognizable project structure. Show an inline error message on the project picker: "This folder doesn't look like a project. Make sure it contains a `.git` directory." Do not open a broken session.
- User selects a project they've opened before. Navigate directly without a second confirmation.
- App was previously open with a project: bypass the picker entirely and open the last project.

---

### 1.2 Task Creation

**Entry point:** User is in the feed or split view and wants to start a new task.

**Flow:**
1. User types in the command bar or presses `n` from the feed
2. Command bar enters "new task" mode: prompt changes to `new >`, feed dims slightly, a creation panel expands below the command bar or the right panel becomes a creation form
3. User types a task description in natural language
4. (Optional) User sets: flow (via `--flow quick`), base branch (via `--branch feat/xyz`), auto mode (toggle)
5. Pressing Enter creates the task and returns to the feed
6. New task appears at the top of the "Active" section with the `~` idle symbol, then transitions to `*` within seconds as setup begins

**Information hierarchy at task creation:**
- Primary: the description textarea — large, focused, no competing elements
- Secondary: flow picker (collapsed by default, expands on interaction)
- Tertiary: branch selector, auto mode toggle — visible but not demanding attention
- Hidden until needed: advanced options

**What can go wrong:**
- User submits an empty description. Inline validation, not a toast. The textarea border turns to amber, a small message appears below: "Describe what you want the agent to do."
- User types a very long description that exceeds reasonable limits. The textarea scrolls; no hard block, but show a soft character count.
- Flow picker shows flows the user doesn't recognize. Each flow row shows its stage pipeline as a horizontal strip of labeled segments. No wall of text, no modal.

---

### 1.3 Monitoring Active Tasks

**Entry point:** User returns to the feed while tasks are running.

**Flow:**
1. User opens feed (default view). Sections: "Needs attention" at top, "Active" below, "Completed today" at bottom.
2. Tasks requiring human action are at the top, with their attention type clearly labeled (Review, Questions, Failed).
3. Active tasks show a live activity line in the row — the agent's current action in real time.
4. User reads the feed to understand system state without clicking into anything.
5. When a task changes state, it re-sorts into the appropriate section without a jarring transition.

**What the feed row communicates:**
- Status symbol (leftmost column): `*` working, `>` review, `?` questions, `!` failed, `.` done
- Task title (center, primary weight)
- Pipeline progress: horizontal strip of stage segments, active stage pulsing
- Live activity text (right side, tertiary weight): "Reading 14 files..." or "Writing auth.rs..."
- Section badge (rightmost): categorical label matching the section intent

**What is NOT in the feed row:**
- Task IDs (visible in detail panel, not in list)
- Iteration history
- Timestamps (only in "Completed today" section)
- PR status icons

---

### 1.4 Reviewing Agent Work

**Entry point:** User sees a `>` task in the "Needs attention" section and clicks it.

**Flow:**
1. User clicks the task row. Split view opens (or right panel populates if already in split view).
2. Right panel loads: task title, stage badge, iteration count.
3. Lead content is the artifact — rendered markdown, full width, scrollable.
4. Below the artifact: action bar with Approve `[a]` and Reject `[r]` as primary actions. Diff `[d]` and Logs `[l]` as secondary.
5. If user clicks Reject: a feedback textarea appears below the action bar, inline. Reject button becomes "Send rejection" and requires at least one character in the textarea.
6. If user clicks Approve: the task transitions immediately in the list (symbol changes from `>` to `*`), the detail panel updates to show the next stage starting.

**Information hierarchy in review panel:**
- Primary: the artifact content — everything else steps back visually
- Secondary: the action bar — always visible, docked to the bottom of the panel
- Tertiary: iteration count, stage label, creation time — visible in the header but not competing with artifact
- Hidden until requested: diff view, logs, iteration history

**Rejection flow detail:**
A user who rejects an artifact needs to explain what's wrong. The feedback textarea should appear immediately below the action bar without pushing the artifact off screen. Two actions: "Send rejection" (amber, requires text) and "Cancel" (ghost). After sending, the textarea closes, the task returns to `*` as the agent begins another iteration.

---

### 1.5 Answering Agent Questions

**Entry point:** User sees a `?` task in "Needs attention." The question count badge shows "2 Qs."

**Flow:**
1. User clicks the task row.
2. Right panel leads with the questions — not with an artifact. Questions come first because they are a blocking condition.
3. Each question is numbered, titled, and has either radio options or a free-text input.
4. If multiple questions: they are all visible at once in a scrollable list, not paginated. The user answers all of them and submits together.
5. Submit button is disabled until all required questions have an answer.
6. After submit: task transitions from `?` to `*` in the feed, the detail panel shows the agent resuming.

**Information hierarchy in questions panel:**
- Primary: the questions, presented in full with their context
- Secondary: submit action (disabled until complete)
- Tertiary: task context (description, current stage) — available but collapsible
- Hidden: diff, logs, artifacts — these are irrelevant during question-answering

**Why all questions at once (not paginated):**
The current implementation paginates questions step-by-step. This is wrong for a power tool. Users reading question 3 might want to reconsider their answer to question 1 after seeing the later context. All questions visible simultaneously respects the user's intelligence and prevents the re-submit pattern where users go back to change answers.

---

### 1.6 Handling Failures

**Entry point:** User sees a `!` task in "Needs attention."

**Flow:**
1. User clicks the task row.
2. Right panel leads with the failure — the error message is the largest element on screen.
3. The error is shown verbatim (agent output) with context: what stage failed, what the agent was trying to do.
4. Below the error: a retry textarea and "Retry with instructions" button. Instructions are optional — a plain "Retry" is available without text.
5. For script failures (automated checks): the script output is shown directly, not an agent summary.
6. After retry: task moves to `*` in the feed, detail panel shows the agent restarting.

**Information hierarchy in failure panel:**
- Primary: the error itself — red tint, prominent, full text
- Secondary: retry action — immediately available without hunting
- Tertiary: what stage failed, when it failed, iteration count
- Hidden until requested: full log of the failed run

**What NOT to do:**
Do not make the user navigate to a "Logs" tab to see why something failed. The failure reason belongs on the surface level.

---

### 1.7 Monitoring a Working Task

**Entry point:** User clicks an `*` task in the "Active" section.

**Flow:**
1. Right panel shows the live agent activity.
2. Lead content is a live log stream — not a historical artifact (there isn't one yet, or the current one is being produced).
3. Activity summary at the top: "Planning · Work stage · Iteration 2 · 4m 32s elapsed"
4. Below: the log stream, newest entries at the bottom, auto-scrolling. Tool use entries are collapsed by default (just the tool name and summary).
5. No actions available other than "Interrupt `[i]`" — which pauses the agent.

**Information hierarchy in working panel:**
- Primary: the live activity / log stream — this is what the user came to see
- Secondary: interrupt action — always available
- Tertiary: elapsed time, stage, iteration count
- Hidden: no approval or rejection actions (nothing to approve yet)

---

### 1.8 Subtask Management

**Entry point:** A parent task with `~` symbol and "2/4 subtasks" badge in the feed.

**Flow:**
1. User clicks the parent task row.
2. Right panel shows: task title, "Waiting on children" state explanation, and the subtask list.
3. Subtask list shows each child as a compact row with its own symbol, title, and current state.
4. Clicking a subtask row navigates to that subtask (it becomes the focused row in the left list, right panel shows the subtask detail).
5. The left list shows subtasks indented under their parent when the parent is expanded.
6. Parent re-focuses and advances automatically when all children complete — the user does not need to do anything.

**Information hierarchy for waiting-on-children panel:**
- Primary: the subtask list — users need to know what's blocking the parent
- Secondary: links to each child (navigable from the list)
- Tertiary: parent task context, which stage the parent will advance to when children complete
- Hidden: no approval/rejection on the parent while waiting

---

### 1.9 Integration and Merge

**Entry point:** A `>` task in "Needs attention" with badge "Merge ready" — or a task that recently reached Done state.

**Flow — auto-merge path:**
1. User clicks the done task.
2. Right panel shows: "Work complete" confirmation with a brief summary of changes (file count, branch name).
3. Two primary actions: "Auto-merge `[m]`" and "Open PR `[p]`".
4. User presses `m`. Task transitions to integrating state (`~` with "Merging" label).
5. After integration: task appears in "Completed today" with `.` symbol. Detail panel shows: merged branch, commit hash, file count.

**Flow — PR path:**
1. User presses `p` on the done task.
2. Panel updates to show: PR creation in progress.
3. PR is created. Panel shows: PR URL, title, CI check status (as they run).
4. If CI passes and PR is reviewed: panel shows "Merge PR" action.
5. After merge: archive action available. User presses `a` to archive. Task moves off the feed.

**Information hierarchy in integration panel:**
- Primary: the two choices — auto-merge or PR. Make the choice clear and consequential.
- Secondary: what's being merged (branch, file count, commit summary)
- Tertiary: PR status, CI checks, review status (visible after PR is created)

---

### 1.10 Interrupted Task Recovery

**Entry point:** An interrupted task shows `~` symbol with "Interrupted" badge.

**Flow:**
1. User clicks the interrupted task.
2. Panel shows: what the agent was doing when interrupted, current stage, iteration.
3. Optional message textarea: "Add context for resumption (optional)"
4. Primary action: "Resume `[r]`". Secondary: "Delete task"
5. After resume: task returns to `*` in the feed.

---

## 2. Information Hierarchy Decisions

### 2.1 Feed View

**Primary:** "Needs attention" section — this is why the user opens the app. It must be immediately visible and visually heavier than other sections.

**Secondary:** "Active" section — tasks the user cares about but cannot act on right now.

**Tertiary:** "Completed today" — dimmed, below the fold on busy days. Evidence of progress, not a work queue.

**What is secondary throughout:**
- Pipeline progress visualization — present in every row but visually lightweight (thin colored strip)
- Live activity text — tertiary weight text, right-aligned
- Keyboard hints — always shown but in tertiary color

**What is hidden until needed:**
- Iteration history
- Subtask detail
- Artifact content (requires opening the detail panel)
- Logs

### 2.2 Split View (Left Panel)

**Primary:** Task titles and status symbols — these are what users scan.

**Secondary:** Section groupings (Needs attention / Active / Completed) — these set context.

**Tertiary:** Stage labels below task titles, using mono font — present but scannable not readable.

**Hidden:** Everything else. No pipeline visualization in the narrow left pane (this would be too compressed to communicate anything useful at ~160-240px width).

### 2.3 Detail Panel (Right Side)

The detail panel adapts its hierarchy entirely to the task state. See Section 3 for the complete state-to-view mapping.

**In all states, the following hierarchy holds:**
- Topmost: what the user must act on right now (question, error, approval)
- Middle: context for that action (artifact, error message, question context)
- Bottom: the action bar with keybindings visible
- Scrollable overflow: secondary content (iteration history, full logs, PR status)

**What is always visible without scrolling:**
- The task title and state
- The primary action(s) for the current state
- Keyboard shortcuts for those actions

**What requires scrolling or a secondary interaction:**
- Full artifact content (if long)
- Iteration history
- Full log stream
- PR CI checks and review comments

---

## 3. State-to-View Mapping

For each task state, the following specifies the lead content, secondary content, and available actions in the detail panel.

### 3.1 Agent Working (`*`)

**Lead content:** Live log stream, auto-scrolling. Tool use entries collapsed to one-liners.

**Secondary:** Activity summary line ("Reading codebase · 47 files · 3m 12s")

**Actions:** Interrupt `[i]`, Open in editor `[e]`, View diff `[d]`

**What is hidden:** Approve/reject (nothing to approve), full artifact view

---

### 3.2 Needs Review (`>`)

**Lead content:** The artifact, rendered markdown, full panel width.

**Secondary:** Iteration badge ("Iteration 2"), stage label, elapsed time since artifact was produced

**Actions (pinned to bottom):**
- Approve `[a]` — primary, green
- Reject `[r]` — secondary, expands feedback textarea inline
- View diff `[d]` — tertiary
- View logs `[l]` — tertiary

**After clicking Reject:**
- Feedback textarea appears above the action bar (not a modal, not a replacement of the artifact)
- "Send rejection" replaces "Reject" (now amber, requires text)
- "Cancel" dismisses the textarea and returns to the standard action bar

---

### 3.3 Has Questions (`?`)

**Lead content:** Question list, numbered, full panel width. Each question shows:
- Question title (bold)
- Question context (body text, collapsible if long)
- Input: radio options or free-text textarea

**Secondary:** Task description summary, current stage

**Actions:** Submit answers `[Enter]` (disabled until all required questions answered)

**What is hidden:** Artifact (there isn't a completed one yet), diff, full logs

---

### 3.4 Failed (`!`)

**Lead content:** Error block — red tint background, error message in full, stage that failed.

**Secondary:** What the agent was trying to do (activity summary from last iteration)

**Actions:**
- Retry `[r]` — runs the same stage again
- Retry with instructions (feedback textarea appears inline, same pattern as rejection feedback)
- Delete task `[del]`

**What is hidden:** Approve, diff (may not exist if failure was early), PR

---

### 3.5 Blocked (`!`)

**Lead content:** Blocked reason block — amber tint, reason text in full.

**Secondary:** Which external dependency is blocking, how long blocked.

**Actions:**
- Retry `[r]` — attempt to unblock
- Retry with instructions (same inline textarea pattern)

---

### 3.6 Waiting on Children (`~` with subtask badge)

**Lead content:** Subtask list — each child as a navigable row with its own state symbol.

**Secondary:** Aggregate progress ("2 of 4 subtasks complete"), which stage the parent advances to after completion.

**Actions:** None direct on the parent. Click a subtask row to navigate to it.

**Progress communication:**
- Completed subtasks: `.` symbol, dimmed row
- Active subtasks: `*` symbol with live activity
- Review/questions: `>` or `?` symbols, with action badge

---

### 3.7 Interrupted (`~` with "Interrupted" badge)

**Lead content:** Interruption context — what the agent was doing, which stage, iteration count.

**Secondary:** Optional resume message textarea (default empty, not required)

**Actions:**
- Resume `[r]` — primary, restarts the agent
- Delete task — secondary/destructive

---

### 3.8 Done — Awaiting Integration (`.` with "Merge" badge)

**Lead content:** Completion summary — "Work complete" statement, branch name, file change count.

**Secondary:** Final artifact (collapsed, expandable), iteration summary

**Actions:**
- Auto-merge `[m]` — primary
- Open PR `[p]` — secondary
- View diff `[d]` — tertiary

---

### 3.9 Done — PR Open (`.` with "PR open" badge)

**Lead content:** PR status block — PR title, number, CI check list, review status.

**Secondary:** PR description, link to GitHub

**Actions:**
- If CI failing: "Address comments" or "Address conflicts" — sends agent back to work stage
- If PR merged: Archive `[a]`
- View diff `[d]`

---

### 3.10 Archived

**Lead content:** Summary card — what was built, when, how many files changed.

**Secondary:** Artifact (read-only, collapsed), commit hash, PR link if applicable

**Actions:** None. Read-only. Completed work has no pending user action.

---

## 4. Interaction Patterns

### 4.1 Keyboard Navigation

**In the feed / left pane:**
- `j` / `k` — move selection down / up through task rows
- `Enter` — open selected task in detail panel (activates split view)
- `Esc` — close detail panel, return to feed-only view
- `n` — start new task (focuses command bar in "new task" mode)
- `a` — if focused task is in review: approve
- `r` — if focused task is in review: begin rejection flow
- `i` — interrupt the focused working task
- `Ctrl+\` — toggle split view open/closed
- `Cmd+K` — activate command palette overlay

**In the detail panel:**
- `a` — approve (if review state)
- `r` — reject or resume (context-dependent: reject if review, resume if interrupted)
- `d` — view diff
- `l` — view logs
- `e` — open worktree in editor
- `Esc` — close detail panel, return focus to list
- `Tab` — cycle through secondary actions in the action bar

**Keybinding display:**
Every action button shows its keybinding inline: `Approve [a]`, `Reject [r]`. These are not tooltips — they are always visible in the button text or as a trailing kbd element.

### 4.2 Command Bar

The command bar is always visible at the top of the app. It is not a modal. It serves three modes:

**Navigation mode (default):**
- Prompt: `>`
- User can type to search tasks by title — results update live in the feed (highlighting matches)
- Pressing Enter on a search result focuses that task

**Command mode:**
- Triggered by typing `/` as the first character
- Autocomplete shows available commands: `/new`, `/approve`, `/reject`, `/interrupt`, `/logs`, `/diff`
- Commands operate on the currently focused task

**New task mode:**
- Triggered by `n` key or `/new` command
- Prompt changes to `new >`
- Everything the user types becomes the task description
- `--flow quick` inline flags available
- Pressing Enter creates the task

**Cmd+K enhanced mode:**
- An overlay expands from the command bar (not a separate modal)
- Fuzzy search across all tasks, all commands, and recent actions
- Arrow keys navigate, Enter executes, Esc dismisses

### 4.3 Split View Open/Close

- `Ctrl+\` toggles the split view
- Clicking any task row opens the split view if it is not already open
- The split view persists across task selections — clicking a new task updates the right panel without closing the split
- `Esc` from the right panel closes the right panel and returns keyboard focus to the left list (but does not close the split view layout)
- A second `Esc` from the left list with no task focused closes the split view entirely (returns to feed)
- The split layout is sticky: if the user opened it once, it stays open for their session unless explicitly closed

### 4.4 Inline Feedback (Rejection / Retry)

This pattern is used in three places: review rejection, failure retry with instructions, and blocked retry with instructions.

**Behavior:**
1. User clicks "Reject" or "Retry with instructions"
2. A textarea appears immediately below the action bar — no modal, no navigation
3. The artifact or error above remains visible (user may need to reference it while writing)
4. The confirm button is adjacent to the textarea, disabled until the textarea has content
5. A "Cancel" ghost button dismisses the textarea and returns to the standard action bar
6. After submission: the textarea closes, the task state updates in the feed

This pattern keeps the user in context. They do not lose their view of what they're responding to.

### 4.5 Section Expand/Collapse

The "Completed today" section in the feed is collapsible — users on busy projects may want to hide it to reduce visual noise.

- Section headers are clickable. A collapse chevron appears on hover.
- Collapsed state is remembered for the session.
- "Needs attention" is never collapsible — this would be a safety issue.

---

## 5. Edge Cases and Empty States

### 5.1 No Tasks — Empty Feed

**State:** User has opened a project for the first time, or all tasks are complete and archived.

**What to show:**
- The section headers disappear (don't show empty section headers with count "0")
- Center of the feed shows a calm, non-alarming empty state
- Copy: "No active tasks. Press `n` to create one."
- Below: a command bar hint showing the new task shortcut
- Do NOT show a large illustration or animation — this is a tool, not an onboarding screen

**What NOT to show:**
- "Needs attention (0)" section headers
- Tutorial links
- Feature walkthroughs

### 5.2 All Tasks in Needs Attention

**State:** The user has been away for a while and everything piled up. 5+ tasks all need review or questions.

**What to show:**
- "Needs attention (7)" section takes up the full visible feed
- "Active" and "Completed" sections are below the fold
- The feed is honest about the queue size
- No artificial prioritization within the attention section — tasks appear in order of creation

**What helps the user:**
- The status bar at the top shows the count: "7 Review · 2 Questions" so the user knows the scope before scrolling

### 5.3 Everything Active, Nothing Needs Attention

**State:** Six agents all working simultaneously. Feed is quiet.

**What to show:**
- "Needs attention" section is absent (no header, no space)
- "Active" section fills the feed
- Live activity lines keep the feed feeling alive without requiring user action
- Status bar: "6 agents active"

### 5.4 All Tasks Completed Today

**State:** End of a productive session. All tasks done.

**What to show:**
- "Needs attention" and "Active" sections absent
- "Completed today (8)" section visible
- Rows are dimmed (50% opacity) — done work steps back
- Status bar: "0 active — 8 done today"

### 5.5 Project Initialization

**State:** User opened a project that has no `.orkestra/` directory.

**What to show:**
- A non-blocking prompt in the feed center: "This project doesn't have an Orkestra config yet. Initialize with defaults?"
- Two actions: "Initialize `[Enter]`" and "Open docs"
- After initialization: the feed appears, the command bar activates

### 5.6 Detached State — Orchestrator Not Running

**State:** The Tauri backend orchestrator has stopped or not started.

**What to show:**
- Status bar shows: "Orchestrator stopped" in red
- An amber banner below the command bar: "Agents are not running. Tasks are paused."
- A "Restart orchestrator" button in the banner
- The task list is still visible and browsable — just frozen

### 5.7 Subtask — All Children Failed

**State:** Parent is waiting on children, but all children have failed.

**What to show:**
- Parent moves to "Needs attention" with `!` symbol and "Children failed" badge
- Detail panel shows the subtask list with all children showing `!` symbols
- Each failed child row is clickable to navigate to the child's failure detail
- There is no single-click recovery for this state — the user must address each child individually

---

## 6. Gaps in the Existing Proposal

### 6.1 No Onboarding / Project Picker

The existing screens all assume a project is loaded and tasks exist. There is no screen showing what the user sees before any of this is true. This is the largest gap — the first impression of the app.

**What's needed:** `onboarding.html` — the project picker with recent projects, open folder, and a brief orientation to what the app does.

### 6.2 Integration Flow Unaddressed

The existing screens have no representation of what happens after a task completes. The integration flow (auto-merge vs PR, PR status tracking, conflict resolution, archive) is a significant part of the user's job and has no mockup.

**What's needed:** `integration.html` — the post-completion flow from both the list view and the detail panel.

### 6.3 Interrupted State Underspecified

The `monitoring.html` and `failed.html` screens exist, but there is no interrupted-state mockup. Interrupted tasks are different from failed tasks — the agent was manually paused, not crashed. The recovery action (resume with optional message) is distinct.

### 6.4 Rejection Flow Not Shown End-to-End

The `review.html` screen shows the pre-rejection state. There is no mockup showing the inline feedback textarea after clicking "Reject," nor the state after rejection is sent (agent working again on iteration 2).

### 6.5 Subtask List in Split View

The `subtasks.html` screen exists as a standalone, but how subtasks appear within the split view (as indented rows in the left list, navigable to child detail in the right panel) is not mocked.

### 6.6 Empty States Across All Screens

None of the existing screens show empty states. The feed with no tasks, the right panel with no task selected, the log viewer with no logs — all of these are visually undefined.

### 6.7 Command Bar Modes Not Visualized

The command bar appears in every screen in its default state. None of the screens show the command bar in "new task mode," "search mode," or the Cmd+K expanded overlay. These are the primary interaction affordances and need representation.

### 6.8 Settings / Project Configuration

There is no settings screen. Users need to configure their workflow (`workflow.yaml`), their agent prompts, their flow definitions, and their git integration. The team brief lists this as a gap (`settings.html`).

### 6.9 Awaiting-Rejection-Confirmation State

The system has a state where a reviewer (automated or human) has rejected a stage and the human must confirm or override the rejection before the agent retries. This state exists in the backend but has no visual representation in the Forge screens.

### 6.10 Auto Mode Visibility

Auto mode (where the app approves stages without human review) is mentioned as a core feature but none of the Forge screens show what it looks like when auto mode is on for a task — does the task still appear in "Needs attention"? How does the user know it is running autonomously? The visual treatment of auto mode tasks is undefined.

---

## 7. Navigation Mental Model

The Forge layout has exactly two modes:

**Feed mode:** Full-width task list, sections grouped by intent. No detail panel. Use this for overview, scanning, and quick orientation.

**Split mode:** Left list (narrowed to ~240-360px) + right detail panel. Use this for focused task interaction — reviewing, answering, monitoring.

The user transitions between these modes with a single action (`Enter` or `Ctrl+\`). The mental model is: **feed is for reading, split is for acting.**

There are no nested levels within split mode. A subtask is just another task — clicking a subtask in the left list updates the right panel to show that subtask. The parent is visible in the left list above it (as a different row, perhaps slightly dimmed if not focused). There is no modal, no third panel, no recursion.

This is the single most important structural decision: the layout never changes shape. Feed or split. The content of the right panel changes, but the spatial relationship between left list and right detail is constant once in split mode.
