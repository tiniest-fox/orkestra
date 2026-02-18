# User Flows: Proposal A -- "Mission Control"

## Navigation Model

Mission Control uses a **single-level** navigation model. There is one view: the timeline feed. Task details are revealed by expanding rows in place (accordion). There is no separate detail page, no sidebar, no modal (except the command palette).

The command palette (Cmd+K) is the universal entry point for all actions: creating tasks, searching, filtering, approving, rejecting, and answering questions. It replaces the assistant panel, the new task modal, and most button clicks.

---

## Flow 1: Creating a Task

### Trigger
User presses Cmd+K to open the command palette, then types `new`.

### Steps
1. Command palette opens (centered modal, dark, monospace).
2. User types: `new Refactor the authentication middleware`
3. The palette shows a confirmation preview: task title, default flow, base branch.
4. Optional flags inline: `--flow quick`, `--branch feature/auth`, `--auto`.
5. Press Enter to create. Palette closes.
6. New task row appears in the "Active" section with a green pulsing status dot. The pipeline visualization shows the first stage as active.

### Design rationale
No separate modal or form. Task creation is a command, not a form submission. The command palette already has fuzzy search, auto-complete, and context awareness. Adding a form would be redundant UI for a text-driven operation.

---

## Flow 2: Scanning the Feed (Primary Daily Activity)

### Trigger
User opens the app or returns to the feed.

### What they see
The timeline feed is a single scrollable list divided into three sections:

**Needs Attention** (pinned to top, amber section marker)
- Rows sorted by urgency: failed (red dot) > questions (blue dot) > review (amber dot)
- Each row shows: status dot, task title + ID, pipeline bar with current stage, live feed text, action button
- Action buttons are contextual: "Approve" + "Review" for reviews, "Answer" for questions, "Retry" for failures
- Keyboard hint strip in the section header shows available shortcuts

**Active** (middle section, green section marker)
- Rows showing actively working tasks
- Live feed column has a pulsing green dot prefix and real-time agent action text
- Elapsed time counter in the action column
- Parent tasks show inline subtask progress bars instead of live feed text

**Completed Today** (bottom section, dimmed)
- Rows at 50% opacity
- Pipeline fully green, "Done" label
- Completion time and file change count in feed column

### Interaction
- J/K keys move a focus highlight between rows
- Enter expands the focused row (accordion)
- Escape collapses any expanded row
- Number keys (1/2/3) trigger quick actions on the focused row
- Mouse click on a row also expands it
- Hover shows subtle background highlight

---

## Flow 3: Reviewing Agent Work (Approve/Reject)

### Trigger
User sees a row in "Needs Attention" with an amber dot and "Review" action button, or navigates to it with J/K.

### Steps

**Quick path (keyboard):**
1. Navigate to the review row with J/K.
2. Press 1 to approve immediately (no feedback). Task advances to next stage. Row transitions to "Active" section.
3. Or press 2 to reject. An inline feedback input appears. Type feedback, press Enter.

**Full path (with artifact inspection):**
1. Navigate to the review row. Press Enter to expand.
2. The accordion reveals a two-column grid:
   - **Left: Plan Artifact** -- The stage output rendered as styled markdown. Header shows iteration number. Full width for content.
   - **Right: Agent Activity** -- Compact log of what the agent did during this stage. File reads, searches, edits, structured output events.
3. Below the grid: a **review bar** with amber tint. Contains:
   - Feedback text input (monospace, full width)
   - "Approve" button (green border)
   - "Reject" button (amber border)
4. To approve: Click "Approve" or press Cmd+Enter. Row collapses and transitions to "Active."
5. To reject: Type feedback in the input, click "Reject" or press Cmd+Shift+Enter. Task creates a new iteration. Row stays in "Needs Attention" while the agent reworks.

### Design rationale
The artifact and activity log are shown side-by-side in the accordion because they answer the two questions a reviewer has: "What did the agent propose?" (artifact) and "How did it get there?" (activity). No tab switching required.

---

## Flow 4: Answering Agent Questions

### Trigger
User sees a row with a blue dot and "Answer" action button.

### Steps
1. Navigate to the row. Press Enter to expand.
2. The accordion shows questions as inline blue-tinted panels:
   - Each question has the question text, optional context, and answer options as clickable button chips
   - Multiple-choice questions show option buttons in a row
   - Free-text questions show a text input
3. User selects/types answers for each question.
4. "Submit Answers" button at the bottom of the accordion.
5. Click submit. Agent resumes. Row transitions to "Active" with a working status.

### Design rationale
Questions are answered inline within the feed. No separate page or modal. The user doesn't lose context of other tasks while answering. After submitting, the feed naturally updates as the task transitions.

---

## Flow 5: Monitoring Active Work

### Trigger
User wants to see what an agent is doing in real time.

### Steps

**Passive monitoring (no interaction):**
- The "Active" section shows real-time one-line status for each task in the feed column
- A pulsing green dot indicates liveness
- Elapsed time counter ticks in the action column
- This is sufficient for most monitoring

**Active monitoring (expanded):**
1. Click or press Enter on an active task row.
2. Accordion expands to show:
   - **Activity log**: Compact timeline of agent actions. Each entry has an icon-letter (R=Read, E=Edit, G=Grep, B=Bash, T=Text) color-coded by type, followed by a one-line description.
   - **Task description** (collapsible): Original task description for context.
3. The activity log updates in real time. New entries appear at the bottom.
4. Press Escape to collapse and return to passive monitoring.

### Design rationale
The one-line live feed in the row is the primary monitoring interface. Most of the time, "Reading src/auth.ts" is all the user needs to know. The expanded view is for deep debugging, not routine monitoring.

---

## Flow 6: Managing Subtasks

### Trigger
A task enters "Waiting on Children" state after subtask breakdown.

### Steps
1. The parent task row shows a subtask progress bar in the feed column instead of live text. The bar has colored segments: green (done), pulsing green (working), gray (waiting), red (failed). A count label shows "2/4 subtasks."
2. Click or press Enter on the parent row.
3. The accordion expands to reveal **child task rows** -- identical in format to top-level rows but nested under the parent:
   - Completed subtasks are dimmed with strikethrough titles
   - Active subtasks show live feed text and elapsed time
   - Waiting subtasks show dependency labels (e.g., "Waiting on eagle")
   - Failed subtasks show error text in red
4. Each child row is independently expandable (nested accordion) for full detail.
5. Dependency arrows are shown as text labels after the subtask ID: `eagle <- robin` (eagle depends on robin).

### Design rationale
Subtasks render as rows within the parent's accordion, not as a separate view. The parent row is the container. This maintains the flat timeline metaphor -- everything is rows, even nested structures. Dependencies use text labels rather than visual arrows because text is searchable and unambiguous.

---

## Flow 7: Viewing Code Diff

### Trigger
User wants to see code changes an agent has made.

### Steps
1. This is intentionally not part of Mission Control's UI.
2. The user opens their terminal or IDE to view diffs using git tools.
3. The status bar shows the current branch and commit hash for reference.

### Design rationale
Mission Control is an operations dashboard, not a code review tool. Code diffs are better served by purpose-built tools (VS Code, GitHub, `git diff`). Embedding a diff viewer would bloat the interface and inevitably be worse than dedicated tools.

---

## Flow 8: Integration (Post-Completion)

### Trigger
Task completes all stages and enters "Done" state.

### Steps
1. Task row moves to "Completed Today" section at 50% opacity.
2. Feed column shows: "Merged to main" or "PR #47 merged" with file change count.
3. For tasks requiring manual integration: the row stays in "Needs Attention" with a green dot and "Integrate" action button.
4. Expanding an integration-pending row shows two options:
   - "Auto-merge to [branch]" button
   - "Open Pull Request" button
5. After selecting an option, the row shows PR/merge status and transitions to "Completed Today" when done.

### Design rationale
Integration is handled as another attention-needed action, not a separate workflow. The same "Needs Attention" > action button > resolve pattern applies.

---

## Flow 9: Handling Failed Tasks

### Trigger
A task fails (agent error, test failure, etc.).

### Steps
1. Task row appears in "Needs Attention" with a red status dot.
2. Feed column shows the error summary in red text: "cargo test: 3 failures in auth module."
3. Action column shows "Retry" button with red border.
4. Expanding the row shows:
   - **Error display**: Full error message in a red-tinted container
   - **Activity context**: What the agent was doing when it failed (last ~10 log entries)
   - **Retry bar**: Text input for additional instructions + "Retry" button
5. User optionally types guidance, clicks "Retry." Task re-enters the agent queue.

### Design rationale
The error is shown in the feed column of the row itself -- the user sees "cargo test: 3 failures" without expanding. For most failures, the one-line summary is enough to decide whether to retry immediately or investigate. The accordion provides depth when needed.

---

## Flow 10: Using the Command Palette

### Trigger
User presses Cmd+K at any time.

### Steps
1. Centered modal appears over the feed with a dark overlay.
2. Monospace text input with cursor. Shows recent commands and contextual suggestions.
3. User types a command:
   - `new Fix the login bug` -- creates a task
   - `approve` -- approves the currently focused task
   - `reject Need more error handling` -- rejects with feedback
   - `answer 1 Refinery` -- answers question 1
   - `filter failed` -- shows only failed tasks
   - `filter active` -- shows only active tasks
   - `/` -- clears filter
4. Tab completion for task names, stage names, flow names.
5. Enter executes. Escape closes.

### Design rationale
The command palette is the keyboard-first user's primary interface. It replaces the assistant panel (type questions about a task), the new task form, and most button clicks. Power users will rarely touch the mouse after learning the command vocabulary.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| J / K | Navigate between rows (move focus down/up) |
| Enter | Expand focused row (toggle accordion) |
| Escape | Collapse expanded row / close palette |
| 1 | Approve (when focused on review row) |
| 2 | Reject (when focused on review row) |
| 3 | Answer (when focused on question row) |
| Cmd+K | Open command palette |
| Cmd+N | New task (opens palette with `new` prefilled) |
| Cmd+Enter | Submit current action (approve, answer, create) |
| Cmd+Shift+Enter | Reject with feedback |
| / | Quick filter (focus filter input) |
| G then H | Go home (clear filters, scroll to top) |

---

## Transition Animations

There are no transition animations. Content appears and disappears instantly.

- **Row hover**: 100ms background-color change. No transform, no shadow.
- **Accordion expand**: Instant. No height animation. Content appears, feed reflows.
- **Row movement between sections**: Instant. Row disappears from old position, appears in new.
- **Status changes**: Instant color swap on the status dot. No fade.
- **Command palette**: Instant appear/disappear. No scale or opacity animation.

The lack of animation is a deliberate design choice. Mission Control prioritizes instant responsiveness. Every frame of animation is a frame the user waits. In a system where agents complete actions every few seconds, the interface must keep up without smoothing over changes.
