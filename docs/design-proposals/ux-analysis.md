# UX Analysis: Orkestra App

## Executive Summary

Orkestra is a task orchestration app that spawns AI agents to plan and implement software tasks with human oversight. The core value proposition is **a visual control plane for AI-assisted development** -- you describe what you want, agents plan and execute it, and you review and guide the work.

The current UI is functional but suffers from **information architecture sprawl**: too many views, tabs, panels, and states competing for attention. The app tries to surface everything at once rather than guiding users through their primary workflows. This analysis maps every user flow end-to-end, identifies structural issues, and proposes restructuring opportunities.

---

## 1. User Workflow Map

### 1.1 Task Creation Flow

**Steps:** Click "+ New Task" -> Fill description -> (optional) select flow, base branch, auto mode -> Create

**Current UI:** Opens a right-side panel (NewTaskPanel) with:
- Textarea for description
- Branch selector dropdown
- Auto mode toggle
- Flow picker (grid of flow options with stage pipeline visualization)

**Assessment:** This flow is clean and well-designed. The flow picker with visual stage pipelines is a particularly strong interaction -- it gives users clear understanding of what each flow does before committing. Minor issue: "Auto" toggle is unexplained -- new users won't know what this means without documentation.

### 1.2 Monitoring Active Tasks

**Steps:** View kanban board -> Watch task cards update -> Notice state icons

**Current UI:** Kanban board with columns per workflow stage plus Done/Failed/Blocked terminal columns. Cards show:
- Title (or truncated description)
- Description snippet
- Task ID (monospace, e.g. "gentle-fuzzy-otter")
- State icons (spinner, questions, review, failed, blocked, interrupted, auto mode)
- Subtask progress bar
- Iteration indicator (dots showing stage progression)
- PR status icon

**Assessment:** The kanban board is the strongest part of the UI. The visual language of state icons is rich and communicative. However, the card is trying to show too much information:
- Task IDs are displayed on every card but are only useful for debugging
- The iteration indicator is cryptic -- a series of colored dots that require learned interpretation
- Subtask progress bar, PR icon, and iteration dots all compete for the bottom of the card
- Empty columns collapse to narrow vertical labels, which is elegant

**Key insight:** The kanban board serves two different users -- someone quickly scanning for "what needs my attention" and someone deeply monitoring progress. These are different information densities.

### 1.3 Reviewing Agent Work (Primary User Action)

**Steps:** Click task card -> Read artifact -> Approve or Reject with feedback

**Current UI:** Opens TaskDetailSidebar (right panel, 480px) containing:
- Header: title, status badge, action icons (interrupt, diff, terminal, editor, delete, close), auto toggle
- Tab bar: Details | Subtasks | Activity | Logs | Artifacts | PR
- Tab content area
- Footer panel: contextual action area (Review, Questions, Resume, Integration, Archive, PR Issues)

**Assessment:** This is the most complex and problematic part of the UI.

**Problems:**
1. **Tab overload.** Up to 6 tabs (Details, Subtasks, Activity, Logs, Artifacts, PR), but the user's primary action is almost always "review the artifact and approve/reject." The most important content is buried as one tab among many.
2. **Footer panel logic is deeply nested.** The footer shows different panels based on a priority cascade: Delete > Questions > Resume > Review > Integration > Archive > PR Issues. This creates unpredictable behavior -- the footer changes contextually and users can't predict what they'll see.
3. **Smart tab selection is clever but disorienting.** When you click a task, the system auto-selects the "best" tab based on state (logs if working, artifacts if in review, PR if done, etc.). This means clicking the same task at different times shows different content. Users lose their mental model of "where things are."
4. **The header is packed.** Title + status badge + 5-6 icon buttons + auto toggle + ID + question/review/interrupted badges -- all in approximately 60px of vertical space. Some icons are custom SVGs, some are from lucide-react, creating inconsistency.
5. **480px sidebar width is constraining.** Artifacts (which are often markdown plans or code summaries) and logs (which are terminal-style output) both need more horizontal space than 480px provides.

### 1.4 Answering Agent Questions

**Steps:** Notice question icon on card -> Click task -> See question form footer

**Current UI:** Questions appear as a tall footer panel (480px) within the task detail sidebar. Shows each question with context, options (if multiple choice), or free-text input.

**Assessment:** The question flow is well-designed. The tall footer makes questions prominent and hard to miss. The main issue is discoverability -- questions are signaled only by a small icon on the card and a badge in the header. A task with pending questions should feel fundamentally different from a normal task.

### 1.5 Viewing Logs (Observing Agent Work)

**Steps:** Click task -> Navigate to Logs tab -> (optional) switch stage -> (optional) switch session run

**Current UI:** Nested tabbed panels:
- Outer tabs: one per stage that has logs
- Inner tabs (conditional): one per session run within a stage (only when multiple runs exist)
- Content: terminal-style log viewer with auto-scroll

**Assessment:** The log viewer itself is good -- monospace, auto-scrolling, properly structured log entries. But the navigation is confusing:
- Three levels of tabs (task detail tabs -> stage tabs -> session tabs) create cognitive overload
- The stage tabs use the "small" tab variant which is visually different from the main task tabs, adding visual noise
- Users have to understand the concept of "sessions within stages" to navigate, which is an implementation detail that shouldn't be exposed

### 1.6 Managing Subtasks

**Steps:** Task enters WaitingOnChildren -> Click task -> Subtasks tab -> Monitor/interact with subtasks -> Click subtask to open secondary panel

**Current UI:** Subtasks tab shows a progress bar and sorted list of subtask cards. Clicking a subtask opens a secondary panel (another 480px sidebar stacked to the right), creating a deeply nested view: Kanban | Parent Detail | Subtask Detail.

**Assessment:** The three-panel deep nesting is the most extreme information architecture issue. At 480px + 480px + remaining kanban, the kanban becomes nearly invisible. The subtask detail panel is a full TaskDetailSidebar with its own tabs, creating a recursive nesting: kanban > parent sidebar > subtasks tab > subtask sidebar > subtask's own tabs.

This is technically correct but experientially overwhelming. The user's mental model shouldn't be "I'm looking at a tab inside a sidebar about a subtask of a task on a board" -- it should be "I'm looking at this piece of work."

### 1.7 Code Review & Diff Viewing

**Steps:** Click diff icon in task header -> View file list + unified diff

**Current UI:** The diff panel replaces the kanban board content area. File list on left, unified diff on right. Both task and subtask diffs are supported.

**Assessment:** The diff viewer is clean and functional. The main UX issue is **navigation cost**: opening a diff replaces the board, so the user loses their overview. Closing the diff returns to the board, but if they want to check something in the task detail and come back to the diff, they need to re-open it. There's no "toggle" feeling -- it's a mode switch.

### 1.8 Integration Flow (Post-Completion)

**Steps:** Task reaches Done -> See integration footer -> Choose "Auto-merge" or "Open PR" -> (if PR) Monitor PR tab -> (if merged) Archive

**Current UI:** Sequential footer panels:
1. IntegrationPanel: Auto-merge vs Open PR buttons
2. (If PR created) PrTab appears in tabs, PrIssuesPanel in footer for conflicts/comments
3. ArchivePanel: Archive button when PR is merged

**Assessment:** This is actually a well-designed progressive flow. Each state reveals the next action. The main issue is that it's entirely passive -- the user has to keep checking back to see if the PR was reviewed, if checks passed, etc. OS notifications help but the in-app experience is just polling the PR tab.

### 1.9 Git History & Sync

**Steps:** Click branch indicator -> View commit log -> (optional) Click commit to see diff -> Push/Pull buttons

**Current UI:** CommitHistoryPanel opens in the left panel slot. Shows commit list with file counts, sync status indicators (ahead/behind), push/pull buttons.

**Assessment:** This feature feels disconnected from the task workflow. It's about the project's git state, not about any specific task. Its placement in the same panel system as everything else makes it feel like another mode rather than a utility. Users who want to push/pull probably don't want to lose their current task focus to do so.

### 1.10 Assistant Chat

**Steps:** Click "Assistant" button -> Type message -> View response -> (optional) View history

**Current UI:** AssistantPanel opens in the left panel slot with chat interface. Session history is a secondary panel that slides in from the left.

**Assessment:** The assistant is well-contained as a panel. Its main issue is that it displaces other content when opened -- you can't have both the assistant and a task detail open simultaneously (they compete for panel slots). For an AI orchestration tool, having the AI assistant unable to coexist with the task view is a significant limitation.

---

## 2. Information Architecture Issues

### 2.1 Everything is a Panel

The current architecture has one paradigm: everything is a panel in a grid layout. Kanban board, task details, subtask details, diff viewer, commit history, assistant, session history -- they're all competing for the same three layout slots (content, panel, secondaryPanel).

This creates a **zero-sum layout problem**: opening one thing necessarily closes or displaces another. You can't look at a task's details while chatting with the assistant. You can't view a diff while looking at the commit history. Every navigation is a trade-off.

### 2.2 Too Many States in One Component

The TaskDetailSidebar component handles:
- Normal task viewing (6 tabs)
- Active work monitoring (auto-switching to logs)
- Review/approval flow (footer panel)
- Question answering (tall footer panel)
- Resume from interruption (footer panel)
- Integration/merge flow (footer panel)
- Archive flow (footer panel)
- PR conflict resolution (footer panel)
- Delete confirmation (footer panel)
- Subtask parent view (progress + subtask list)
- Subtask child view (same component, different props)

This is a single component with 11+ distinct behavioral modes. The conditional logic for which footer to show is a 15-line priority cascade. Users cannot predict what the panel will look like when they open a task.

### 2.3 Tabs Within Tabs Within Tabs

The deepest nesting is: Task Detail Tabs > Logs Tab > Stage Tabs > Session Tabs. That's three levels of tabbed navigation within a 480px sidebar. Each level uses a different tab component variant (standard vs small), adding visual confusion.

Similarly: Task Detail Tabs > Subtasks Tab > Click Subtask > Subtask's own Detail Tabs -- this creates a recursive structure where the child has the same complexity as the parent.

### 2.4 Active vs Archived is a Global Mode Switch

The Active/Archived toggle at the top of the app switches the entire board between active kanban view and archived list view. This is a binary mode that affects the entire app state. Archived tasks are a "done" pile that most users rarely need to access, but they're given equal prominence to the active board.

### 2.5 Branch/Git/Sync Features are Orphaned

BranchIndicator, CommitHistoryPanel, SyncStatusIndicator, and push/pull operations are project-level concerns that don't relate to the task workflow. They're accessed from the top bar (branch) and a left panel (history), mixing project-level operations with task-level operations in the same navigation structure.

---

## 3. Feature Essentiality Assessment

### Essential (Core Value)

- **Kanban board** -- The primary overview. Users need to see all tasks at a glance.
- **Task creation** -- Must exist, must be fast.
- **Artifact review + approve/reject** -- The primary user action. This is why the app exists.
- **Question answering** -- Agents need human input to proceed; blocking without this.
- **Log viewing** -- Users need to see what the agent is doing, especially when something goes wrong.
- **Auto mode toggle** -- Core differentiator: "just do it all" vs "let me review each step."
- **Subtask progress** -- Parent tasks need to show child status.
- **Error/failed/blocked display** -- Users need to know when things go wrong and what to do.

### Important (High Value, Could Be Simplified)

- **Diff viewer** -- Valuable for code review, but could be simplified or externalized (open in editor).
- **PR integration** -- Valuable for the merge flow, but the full PR tab (checks, reviews, comments) is complex. Could be reduced to status + actions.
- **Iteration history** -- Useful for understanding what happened, but rarely the primary concern. Could be collapsed or on-demand.
- **Flow picker** -- Important for power users but could be progressive disclosure.
- **Resume from interruption** -- Necessary but rare; could be less prominent.
- **Retry failed/blocked** -- Necessary recovery mechanism.

### Nice-to-Have (Could Be Deferred or Removed)

- **Artifact tabs per stage** -- Most users care about the latest artifact, not the per-stage breakdown. The stage-by-stage artifact view is a power user feature.
- **Session history in logs** -- Showing multiple runs per stage is an implementation detail. Most users just want "the current log."
- **Commit history panel** -- Project-level git operations could live in the terminal or IDE. This is duplicating functionality that developers already have.
- **Push/Pull from UI** -- Same as above; developers already have git tools.
- **Branch selector for task creation** -- Edge case; most tasks are created from the default branch.
- **Command palette** -- Nice shortcut but only searches tasks. Limited utility currently.
- **Auto-task templates dropdown** -- Power user convenience that could be part of command palette.

### Potentially Expendable

- **Archive view** -- Could be a filter on the board rather than a separate mode.
- **IterationIndicator on task cards** -- The colored dots showing stage progression are cryptic and add visual noise to every card.
- **Task ID display on cards** -- Implementation detail; IDs like "gentle-fuzzy-otter" are charming but take up card real estate.
- **External tool detection/buttons** -- The header buttons for terminal/editor are nice but the detection is complex. Users can just navigate to the worktree themselves.

---

## 4. Restructuring Opportunities

### 4.1 Opportunity: Focus View vs Overview

**Problem:** The app has one mode that tries to be both an overview (kanban) and a focus view (task detail). Opening a task detail shrinks the overview.

**Opportunity:** Separate these into distinct experiences:
- **Overview mode**: Full-width kanban with compact task cards. Optimized for scanning. Task cards show only: title, state icon, stage. Click to enter focus mode.
- **Focus mode**: Full-screen task experience. All the detail panels, logs, diff, etc. have room to breathe. A breadcrumb or back button returns to overview.

This eliminates the panel competition problem entirely. The kanban doesn't need to coexist with a sidebar -- they're separate screens.

### 4.2 Opportunity: Action-First Task Detail

**Problem:** The task detail is organized by data type (Details, Subtasks, Activity, Logs, Artifacts, PR). But users don't think in data types -- they think in actions ("what do I need to do?").

**Opportunity:** Organize the task detail around the user's current action:
- **Needs Review**: Show the artifact prominently with approve/reject as primary actions. Logs and details are secondary.
- **Has Questions**: Show the questions prominently as the only thing you can do.
- **Working**: Show the live log as the primary content. Everything else is secondary.
- **Failed/Blocked**: Show the error prominently with retry as the primary action.
- **Done**: Show integration options prominently.

Instead of tabs, use a single scrollable view that adapts its layout and content priority to the task state. The most important thing is always at the top.

### 4.3 Opportunity: Flatten the Subtask Hierarchy

**Problem:** Subtask management creates a recursive sidebar-within-sidebar pattern that's confusing and space-consuming.

**Opportunity:** Treat subtasks as peers in the kanban. When a task has subtasks, expand it inline or show subtasks as their own cards grouped under the parent. The parent becomes a grouping header, not a separate entity that you open and then drill into.

Alternatively, a "task family" view that shows parent + all subtasks in a flat list with dependency lines, rather than nesting them inside the parent's detail view.

### 4.4 Opportunity: Notification-Driven Workflow

**Problem:** Users have to actively scan the board and click into tasks to discover what needs attention. The kanban is organized by workflow stage, not by urgency.

**Opportunity:** Add a primary "Needs Attention" section that aggregates all tasks requiring human action:
- Questions to answer
- Artifacts to review
- Failed tasks to retry
- PRs to merge

This could be a persistent sidebar, a dashboard view, or even just a sorted/filtered kanban column. The key insight is that the user's job is to respond to agent requests, so the UI should organize around those requests rather than around pipeline stages.

### 4.5 Opportunity: Progressive Log Disclosure

**Problem:** The log viewer exposes full implementation details (stages, sessions, sub-agents, tool use).

**Opportunity:** Three levels of log detail:
1. **Activity summary** -- One-sentence description of what the agent is doing (already exists as `activity_log` on iterations). This should be the default.
2. **Tool use timeline** -- What tools were called, in what order. Like a build log: file reads, edits, searches. No raw output.
3. **Full session** -- Everything. Raw tool inputs/outputs, sub-agent details. For debugging.

Most users only need level 1. Power users occasionally need level 2. Level 3 is for debugging broken runs.

### 4.6 Opportunity: Remove the Panel Layout Entirely

**Problem:** The PanelLayout + Slot system is technically sophisticated but creates a rigid grid that forces all UI states into the same spatial framework.

**Opportunity:** Use routes or views instead of panels:
- `/board` -- Kanban overview
- `/task/:id` -- Full task focus view
- `/task/:id/diff` -- Diff viewer for this task
- `/assistant` -- Assistant chat (or keep as an overlay)

This is conceptually simpler, gives each view full width, and aligns with how desktop apps typically work (window-per-concern or tab-per-concern rather than panel-per-concern). The animation system becomes page transitions rather than panel slides.

### 4.7 Opportunity: Simplify Git to a Status Indicator

**Problem:** Commit history, sync status, push/pull, and branch selection are features that duplicate the developer's existing tools.

**Opportunity:** Reduce git presence to a minimal status indicator:
- Show current branch name
- Show ahead/behind count
- One-click push/pull (keep this, it's convenient)
- Remove the full commit history panel

Developers who need to look at commit history will use their terminal or IDE. The app's value is in orchestrating agents, not in being a git GUI.

---

## 5. Alternative Organizational Paradigms

### 5.1 Inbox + Feed (Linear-style)

Replace the kanban with a chronological feed of events that need attention. Tasks that need human action float to the top. Tasks that are working quietly sink down. This reframes the UI from "status dashboard" to "workflow queue."

**Pros:** Directly maps to the user's job (respond to things). Eliminates the need to scan columns.
**Cons:** Loses the pipeline visualization that makes the kanban satisfying. Harder to see overall progress.

### 5.2 Dashboard-First

A single-screen dashboard showing:
- Attention needed (count + list)
- Active agents (count + compact status)
- Recently completed
- Quick-create task input

Each section expands to full detail on click. No persistent sidebars. The dashboard is always the home base.

**Pros:** Immediate clarity on "what's happening." Low cognitive load.
**Cons:** Requires more clicks to get to detail. May feel too simple for power users.

### 5.3 Conversation-Centric

Reframe each task as a conversation between human and agents. The task detail isn't tabs and panels -- it's a chat thread where agent outputs, questions, approvals, and rejections are messages in a timeline. The artifact is inline in the conversation. The review action is a reply.

**Pros:** Familiar mental model (chat). Natural progressive disclosure. Context is always visible.
**Cons:** Long conversations become hard to scan. Artifacts need to be viewable outside the conversation context.

### 5.4 Split-Screen Workstation

Two persistent panes: left is always the task list/board (compact), right is always the task detail (full). No panels sliding in and out. The left pane shows a compact list (not full kanban) when a task is selected. The right pane is a rich, full-height task experience.

**Pros:** Predictable layout that never changes shape. Both overview and detail are always visible.
**Cons:** Sacrifices the full-width kanban. The compact task list may not convey enough information.

---

## 6. Pain Points Summary (Ranked by Impact)

1. **Panel competition** -- Opening anything closes something else. The zero-sum layout limits multitasking.
2. **Sidebar overload** -- 6 tabs, 9+ footer states, recursive subtask nesting in 480px.
3. **Unpredictable footer** -- The footer panel changes based on a hidden priority cascade. Users can't predict what they'll see.
4. **Smart tab selection** -- Auto-switching the active tab based on state is disorienting. The same task shows different content at different times.
5. **Log nesting** -- Three levels of tabs in a narrow sidebar is cognitively expensive.
6. **Subtask recursion** -- Opening a subtask creates a sidebar-within-sidebar that consumes most of the screen.
7. **Git features feel separate** -- Commit history and sync are project-level but live in the task-level panel system.
8. **Archive as mode switch** -- Separating active and archived into global modes is heavy-handed for what's essentially a filter.
9. **Card information density** -- Task cards show ID, description, multiple icons, progress bar, iteration dots, and PR status. Too much for a card.
10. **No "attention needed" aggregation** -- The user must scan the entire board to find tasks needing action.

---

## 7. Design Principles for Proposals

Based on this analysis, any redesign should prioritize:

1. **Action-oriented navigation** -- Organize around what the user needs to do, not around data types.
2. **Predictable layout** -- The screen shouldn't rearrange itself based on hidden state. Users should know what to expect when they click something.
3. **One thing at a time** -- Give each view enough space to be useful. Don't pack everything into competing panels.
4. **Progressive disclosure** -- Show the essential information first. Let users drill down for details.
5. **State-driven UI** -- The task's state should drive the entire visual presentation, not just which tab is selected.
6. **Subtasks as peers** -- Flatten the hierarchy rather than nesting it.
7. **Reduce features, increase clarity** -- Remove or consolidate features that duplicate the developer's existing tools (git GUI, full PR viewer) and focus on what only Orkestra provides (agent orchestration, artifact review, approval workflow).
