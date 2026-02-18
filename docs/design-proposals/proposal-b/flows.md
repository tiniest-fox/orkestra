# User Flows: Proposal B -- "The Workshop"

## Navigation Model

The Workshop uses a two-level navigation model:

1. **Home** -- The workbench. Shows all tasks grouped by intent (attention needed, agents working, recently completed). This is the default view.
2. **Focus** -- A full-screen workspace for a single task. Entered by clicking a card. Exited with a back button or Escape key.

There are no sidebars, no competing panels, no panel-within-panel nesting. One level of depth: workbench or focused task.

The assistant is a persistent, collapsible chat bubble in the bottom-right corner. It overlays the current view without displacing it.

---

## Flow 1: Creating a Task

### Trigger
User clicks "+ New Task" button or presses Cmd+N.

### Steps
1. A modal slides in from the bottom (not a side panel). It contains:
   - Large textarea: "What do you want to do?"
   - Flow picker: Visual cards showing available flows (Standard, Quick, Hotfix) with stage pipelines
   - Base branch selector (collapsed by default, expandable)
   - Auto mode toggle with brief explanation tooltip
2. User types description and optionally selects a flow.
3. Clicks "Create" or presses Cmd+Enter.
4. Modal closes. New task card appears in the "Agents at Work" section of the workbench with an entrance animation.

### Design rationale
The modal is chosen over a side panel because task creation is a focused, one-shot action. You create it and return to the workbench. No need to see the board during creation.

---

## Flow 2: Scanning the Workbench (Primary Daily Activity)

### Trigger
User opens the app or returns from a focus view.

### What they see
The workbench is divided into three intent-based sections:

**Your Attention** (pinned to top, always visible if non-empty)
- Cards with warm accent borders indicating the type of attention needed
- Each card shows: task title, what's needed (e.g., "Review plan", "2 questions", "Failed: cargo test"), and a primary action button directly on the card
- Sorted by urgency: failed > blocked > questions > review

**Agents at Work** (middle section)
- Cards with subtle animated gradient borders (breathing pulse)
- Each card shows: task title, current stage label, one-line live status ("Reading src/auth.ts...")
- No action buttons -- these tasks don't need the user

**Recently Completed** (bottom, collapsed to a single row by default)
- Compact horizontal strip: task titles with checkmarks
- "View all" link expands to full list
- "Archive all" batch action

### Interaction
- Clicking any card enters Focus view for that task
- Quick actions (approve, answer) are available directly on attention-needed cards via hover buttons
- The section heights are dynamic: if nothing needs attention, "Agents at Work" expands to fill the space

---

## Flow 3: Reviewing Agent Work (Approve/Reject)

### Trigger
User sees a card in "Your Attention" with "Review" label, or clicks into a task in review state.

### Steps

**Quick path (from workbench):**
1. Hover over the review card. "Approve" and "View" buttons appear.
2. Click "View" to read the artifact, then approve/reject from Focus view.
3. Or click "Approve" directly if the task is trusted (auto-mode tasks, simple changes).

**Full path (from Focus view):**
1. Click the card to enter Focus view.
2. The Focus view adapts to the task's state. For a review task:
   - **Hero section**: The artifact content (plan, summary, or review verdict) rendered as styled markdown, full width, generous typography
   - **Context sidebar** (right, collapsible): Task description, iteration history, stage pipeline visualization
   - **Action bar** (bottom, sticky): Feedback textarea + "Approve" (green) and "Request Changes" (amber) buttons
3. User reads the artifact.
4. To approve: Click "Approve" (or Cmd+Enter). Task advances. Focus view transitions to the next attention-needed task, or returns to workbench if none remain.
5. To reject: Type feedback in the textarea, click "Request Changes". Task re-enters the agent's work queue. Same transition behavior.

### Design rationale
The artifact is the hero because it's the thing the user needs to read and judge. Everything else is supporting context. The approve/reject bar is sticky at the bottom so it's always reachable regardless of artifact length.

---

## Flow 4: Answering Agent Questions

### Trigger
User sees a card in "Your Attention" with "Questions" label.

### Steps
1. Click the card to enter Focus view.
2. The Focus view adapts to question-answering mode:
   - **Questions displayed as a form**: Each question with its context, options (if multiple choice), or free-text input
   - **Task context** (collapsible section above): The task description and any relevant artifact from previous stages
   - **Submit bar** (bottom, sticky): "Submit Answers" button
3. User fills in answers.
4. Clicks "Submit Answers". Agent resumes with the answers. View transitions to next attention-needed task or workbench.

### Design rationale
Questions are a blocking state -- the agent literally cannot proceed without answers. The UI treats this with appropriate urgency by making the questions the entire focus view content, not hidden inside a tab.

---

## Flow 5: Monitoring Active Work

### Trigger
User wants to see what an agent is doing in real time.

### Steps
1. From workbench: Each "Agents at Work" card shows a one-line live status. This is sufficient for casual monitoring.
2. For deeper monitoring: Click the card to enter Focus view.
3. The Focus view adapts to monitoring mode:
   - **Activity feed** (main area): A real-time log of agent actions, styled as a clean timeline rather than raw terminal output. Tool uses are shown with descriptive labels ("Read file: src/auth.ts", "Search: authentication middleware"). Each entry has a subtle timestamp.
   - **Progress indicator** (top): A horizontal stage pipeline showing current position. Stages light up as they complete.
   - **Quick info sidebar** (right, collapsible): Task description, elapsed time, files touched count
4. The feed auto-scrolls. User can scroll up to review history; auto-scroll pauses and a "Jump to latest" pill appears at the bottom.

### Design rationale
The log replaces the three-level tab nesting (stage tabs > session tabs > content) from the current design with a single, unified activity feed. Stage boundaries are shown as section dividers within the feed, not as separate tab selections.

---

## Flow 6: Managing Subtasks

### Trigger
A task enters "Waiting on Children" state after subtask breakdown is approved.

### Steps
1. On the workbench, the parent task card shows a subtask progress indicator (mini bar with colored segments).
2. Click the parent card to enter Focus view.
3. The Focus view adapts to parent-with-subtasks mode:
   - **Progress summary** (top): Progress bar + counts (3/7 done, 1 failed, 3 working)
   - **Subtask list** (main area): All subtasks displayed as compact cards, sorted by priority (failed > needs attention > working > waiting > done). Each shows title, state, dependency information.
   - **Dependency visualization**: Subtle connecting lines between dependent subtasks (optional, can be toggled off)
4. Clicking a subtask card transitions the Focus view to that subtask's detail (same adaptive layout). A breadcrumb at the top shows: Workbench > Parent Task > Subtask.
5. Pressing Back or clicking the breadcrumb returns to the parent's subtask overview.

### Design rationale
Subtasks are viewed as a flat list within the parent's focus view, not as recursive nested sidebars. The parent task's focus view becomes a "project overview" for its subtasks. Navigation between parent and child is via breadcrumb traversal, not panel stacking.

---

## Flow 7: Viewing Code Diff

### Trigger
User wants to see what code changes the agent has made.

### Steps
1. From Focus view (any task with a worktree): Click the "Changes" tab or button.
2. The Focus view's main area transitions to the diff viewer:
   - **File list** (left column): Changed files with additions/deletions counts
   - **Diff content** (right area): Unified diff view with syntax highlighting
3. A toggle in the top bar switches between "Changes" and the previous view (Artifact, Activity, etc.).
4. Press Escape or click "Back" to return to the previous focus content.

### Design rationale
The diff viewer replaces the main content area of the Focus view rather than competing with other panels. It's a sub-view within the Focus context, not a separate mode of the entire app.

---

## Flow 8: Integration (Post-Completion)

### Trigger
Task completes all stages and enters "Done" state.

### Steps
1. Task card moves to "Recently Completed" section on workbench, but also appears in "Your Attention" with an "Integrate" label.
2. Click to enter Focus view. The view adapts to integration mode:
   - **Summary section**: What was done, files changed, key decisions
   - **Integration options** (primary): Two large buttons -- "Auto-merge to [branch]" and "Open Pull Request"
   - If a PR is created, the view transitions to PR monitoring mode showing: PR state badge, CI check statuses, review statuses
3. Once PR is merged, an "Archive" button appears. Clicking it archives the task and returns to workbench.

### Design rationale
Integration is treated as a first-class step in the workflow, not a footer panel that appears conditionally. The user clearly sees "this task is done, here's how to land it."

---

## Flow 9: Using the Assistant

### Trigger
User clicks the assistant bubble or presses Cmd+/ (slash).

### Steps
1. A chat panel expands from the bottom-right corner, overlaying the current view (workbench or focus). The underlying content is still visible and interactable.
2. User types a message. The assistant responds with context awareness -- it knows which task is currently focused (if any).
3. User can resize the chat panel by dragging the top edge.
4. Click the minimize button or press Escape to collapse back to the bubble.

### Design rationale
The assistant overlays rather than displaces. Users can ask the assistant about a task while still looking at it. The assistant is a utility layer, not a navigation destination.

---

## Flow 10: Handling Failed Tasks

### Trigger
A task fails (agent error, spawn failure, etc.) or is blocked.

### Steps
1. Card appears in "Your Attention" section with red accent border and "Failed" or "Blocked" label.
2. Click to enter Focus view. The view adapts to error recovery mode:
   - **Error display** (hero section): The error message prominently displayed with full context
   - **Retry options**: Textarea for additional instructions + "Retry" button
   - **Activity context** (collapsible): What the agent was doing when it failed, recent log entries
3. User optionally adds instructions, clicks "Retry". Task re-enters the agent's queue.

### Design rationale
Failed tasks get the same hero-section treatment as reviews -- the most important information (the error) is the first thing you see, not hidden inside a "Details" tab.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+N | New task |
| Cmd+K | Command palette / search |
| Cmd+/ | Toggle assistant |
| Escape | Go back (focus -> workbench, close modal/assistant) |
| Cmd+Enter | Submit (approve, create task, send message) |
| J/K | Navigate between cards (when workbench is focused) |
| Enter | Open focused card |

---

## Transition Animations

All transitions use spring-based easing (stiffness: 300, damping: 30) for organic, physical feel.

- **Card hover**: Subtle lift (translateY -2px) + warm shadow expansion. 200ms.
- **Focus enter**: Card expands and transitions into full-screen view. Other cards fade out. 350ms.
- **Focus exit**: Content contracts back to card position. Cards fade in. 300ms.
- **Section reorder**: When a task moves between sections (e.g., "Working" to "Attention"), it animates smoothly to its new position. 400ms.
- **Assistant expand**: Panel springs up from bottom-right with slight overshoot. 300ms.
