# Current App Analysis

Comprehensive analysis of the Orkestra desktop app UI for the design team.

## Application Overview

Orkestra is a **Tauri desktop application** (Rust backend + React/TypeScript frontend) that orchestrates AI coding agents to plan and implement software development tasks. It provides a kanban-style project management interface with deep integration into git workflows, agent monitoring, and human-in-the-loop approval processes.

**Tech stack:** Tauri 2, React 18, TypeScript, Tailwind CSS, Framer Motion, Lucide icons, Geist font family.

---

## Architecture & Navigation Model

### Provider Hierarchy

The app wraps everything in a deep provider tree (see `App.tsx`):

```
WorkflowConfigProvider
  AutoTaskTemplatesProvider
    TasksProvider (polls every 2s, listens for "task-updated" events)
      PrStatusProvider
        AssistantProvider
          GitHistoryProvider
            DisplayContextProvider
              Orkestra (main layout)
```

### Preset-Based Navigation

All navigation is managed by `DisplayContextProvider` using a **preset system**. Each user action maps to a named preset that defines which components fill three layout slots:

| Slot | Purpose | Position |
|------|---------|----------|
| `content` | Main area (board, diff viewer) | Center |
| `panel` | Primary sidebar (task detail, assistant, git history) | Right or left |
| `secondaryPanel` | Nested sidebar (subtask detail, session history) | Adjacent to panel |

**All 10 presets:**

| Preset | Content | Panel | Secondary Panel |
|--------|---------|-------|-----------------|
| Board | KanbanBoard | - | - |
| Task | KanbanBoard | TaskDetail | - |
| Subtask | KanbanBoard | TaskDetail | SubtaskDetail |
| NewTask | KanbanBoard | NewTaskPanel | - |
| TaskDiff | DiffPanel | TaskDetail | - |
| SubtaskDiff | DiffPanel | - | SubtaskDetail |
| GitHistory | KanbanBoard | GitHistoryPanel | - |
| GitCommit | CommitDiffPanel | GitHistoryPanel | - |
| Assistant | KanbanBoard | AssistantPanel | - |
| AssistantHistory | KanbanBoard | AssistantPanel | SessionHistory |

### Panel Layout System

All panels use `PanelLayout` + `Slot` for CSS grid-based animated transitions. Slots are either `type="grow"` (flex to fill) or `type="fixed"` with pixel sizes. Visibility is controlled by boolean props derived from the active preset.

---

## Top-Level Layout (Orkestra.tsx)

The root layout is:
```
[Full viewport, p-4, bg-stone-100 / dark:bg-stone-950]
  [Top bar: title, assistant btn, active/archived toggle, branch indicator, + New Task, auto tasks]
  [Error banner if any]
  [PanelLayout (flex-1): all Slots for all panels]
  [CommandPalette (modal overlay)]
```

### Top Bar Elements

1. **"Orkestra" title** - Static text using `Panel.Title`
2. **Assistant button** - Toggles assistant panel; has animated ping indicator when agent is working and panel is closed, static dot for unread responses
3. **Active/Archived toggle** - Pill-style segmented control switching between active kanban view and archived list view
4. **Branch indicator** - Shows current git branch + latest commit message; clickable to open git history panel; shows sync status (ahead/behind) and push/pull buttons
5. **"+ New Task" button** - Opens NewTaskPanel sidebar
6. **Auto Task dropdown** - Dropdown for predefined task templates from `.orkestra/tasks/*.md`

---

## Main Content Views

### 1. Kanban Board (`KanbanBoard.tsx`)

The primary view. Displays tasks organized by workflow stage columns.

**Columns are built dynamically from `workflow.yaml`:**
- One column per workflow stage (plan, task, work, check, review, compound)
- Plus three terminal columns: Done, Failed, Blocked
- Each column gets a colored dot from the stage palette (orange-to-purple gradient)

**Column behavior:**
- Empty columns collapse to 48px width with a vertical rotated label
- Populated columns expand to 288px (w-72) with horizontal label + count
- Tasks are sorted by priority tier: failed > blocked > interrupted > questions > review > working > waiting
- Framer Motion LayoutGroup for smooth task movement between columns

**Only top-level tasks shown** (subtasks are filtered out).

### 2. Archived List View (`ArchivedListView.tsx`)

Simple vertical list of archived tasks using `TaskCard` in "subtask" variant. No columns, no kanban layout. Empty state with Archive icon.

### 3. Diff Panel (`DiffPanel.tsx`)

Full-screen code diff viewer with:
- Left: file list (`DiffFileList`)
- Right: unified diff view with syntax highlighting (`DiffContent`)
- 2-second polling for live updates
- Syntax CSS injected via `<style>` tag from Tauri backend highlight service

### 4. Commit Diff Panel (`CommitDiffPanel.tsx`)

Same diff layout but for a single commit's changes. Used when viewing git history.

---

## Task Card (`TaskCard.tsx`)

The task card is a core UI element used throughout the app with two variants:

### Board Variant (default)
- Title (or truncated description if no title)
- Description preview (2-line clamp)
- Subtask progress bar (colored segments per state)
- Task ID (monospace)
- Artifact count (when done)
- Iteration indicator strip (colored squares showing history)
- Status icons cluster (top-right corner):
  - Auto mode: purple zap icon with bounce animation
  - Git phase: merge icon with bounce
  - Queued: orange spinner
  - Questions: blue message circle
  - Review needed: amber eye
  - Working: orange spinner
  - Failed: red X circle
  - Blocked: amber alert circle
  - Interrupted: amber pause
  - PR status: git pull request icon (colored by state)
  - Waiting on children: aggregate child state icon

### Subtask Variant
- Short ID prefix (monospace, dimmed)
- Title
- Description (collapses when done)
- Failed/Blocked badge
- Dependency names
- Collapses to minimal state when done/archived (just title + checkmark)

### Visual States
- **Border highlighting** based on state: error (failed), warning (blocked/review), amber (interrupted), info (questions), orange (selected)
- Backgrounds also shift with state

---

## Task Detail Sidebar (`TaskDetailSidebar.tsx`)

A 480px-wide panel that slides in from the right when a task is selected. Uses a nested `PanelLayout` with vertical direction for main content + footer actions.

### Header (`TaskDetailHeader.tsx`)
- Task title (or description if no title)
- Action buttons: Interrupt (pause), Diff toggle, Terminal, Editor, Delete, Close
- Status row: Task ID, status badge, Questions badge, Review badge, Interrupted badge
- Auto mode toggle (purple switch)

### Tabs (dynamically built based on task state)

| Tab | Shows When | Content |
|-----|-----------|---------|
| **Details** | Always | Description text; error/blocked banners; retry textarea + button |
| **Subtasks** | Has subtasks | Progress bar (colored segments), sorted subtask cards |
| **Activity** | Always | Chronological iteration cards showing stage, outcome, activity log |
| **Logs** | Always | Agent session logs with stage tabs + sub-tabs for multiple runs per stage; auto-scroll; full tool use/result/text/error entries |
| **Artifacts** | Has artifacts | Tabbed artifact view (plan, breakdown, summary, etc.); rendered markdown in expandable panels |
| **PR** | Has PR URL | PR state badge, CI checks, conflicts, reviews with nested comments, comment selection + guidance textarea |

### Smart Default Tab Logic
- Done/Archived -> PR tab (if has PR) or Artifacts
- Failed/Blocked -> Details
- Interrupted -> Details
- Waiting on children -> Subtasks
- Working/System active -> Logs
- Needs review -> Artifacts
- Default -> Details

### Footer Panels (conditional, 200px or 480px slots)

| Panel | Condition | Content |
|-------|-----------|---------|
| **QuestionFormPanel** | Has pending questions | Multi-step wizard with radio options + custom text; Previous/Next/Submit |
| **DeleteConfirmPanel** | User clicked delete | Confirmation dialog |
| **ResumePanel** | Task is interrupted | Optional message textarea + Resume button |
| **ReviewPanel** | Needs review | Approve/Reject with feedback textarea; or Confirm/Override for pending rejections |
| **IntegrationPanel** | Done without PR | Auto-merge and Open PR buttons; or Retry for PR creation failures |
| **ArchivePanel** | Done with merged PR | Archive button |
| **PrIssuesPanel** | Done with PR conflicts/comments | Address conflicts and/or selected comments buttons |

---

## Iteration Indicator (`IterationIndicator.tsx`)

A compact strip of 20x20px colored squares on each task card. Each square represents one iteration:
- Icon from stage config (or first letter fallback)
- Color based on outcome semantic (success=green, warning=amber, error=red, info=blue, rejection=purple, neutral=gray)
- Tooltip on hover: "Stage -- Outcome"
- Last square animates if task is actively working
- Shows max 9 (or 10), with "+N" overflow counter

---

## Assistant Panel (`AssistantPanel.tsx`)

A 480px-wide chat panel that slides in from the left side.

- **Header:** Session title, History button, New Session button, Close button
- **Message area:** Reuses `LogList` component (same as task logs), auto-scroll
- **Footer:** Either `ChatInputPanel` (message input + send/stop) or `QuestionFormPanel` (if assistant has questions)

### Session History (`SessionHistory.tsx`)
Secondary panel (320px) showing past assistant sessions as a list.

---

## Git History Panel (`CommitHistoryPanel.tsx`)

A 360px panel showing commit history of the current branch.

- Commit entries with hash, message, author, timestamp, file count
- Sync status indicators (ahead/behind)
- Push/Pull buttons
- Click a commit to open CommitDiffPanel in main content area

---

## New Task Panel (`NewTaskPanel.tsx`)

A 480px sidebar for creating tasks:
- Description textarea (6 rows)
- Branch selector dropdown
- Auto mode toggle
- Flow picker (when flows are defined): grid of flow options showing pipeline visualization (stage names connected by arrows)

---

## Command Palette (`CommandPalette.tsx`)

Spotlight-style modal triggered by Cmd+K:
- Search input with escape hint
- Two item types: actions (commands) and search results (tasks/subtasks)
- Keyboard navigation (arrows + enter)
- Shows "Recent" label when no query

---

## Log Viewer (`Logs/`)

The log system renders agent session logs with specialized entry types:

| Entry Type | Rendering |
|-----------|-----------|
| `text` | Markdown-rendered text blocks |
| `user_message` | Blue-highlighted prompt blocks with resume type badges |
| `tool_use` | Collapsible tool call display with icon + summary |
| `tool_result` | Collapsible result display |
| `subagent_tool_use` | Nested tool calls from sub-agents |
| `error` | Red error blocks |
| `script_start` | Script command display |
| `script_output` | Terminal-style output |
| `script_exit` | Exit code with success/failure/timeout indicator |

Log entries are grouped by sub-agents using `useGroupedLogs`, which detects chains of subagent tool uses and groups them into collapsible sections.

---

## Design System & Tokens

### Color Palette

**Primary neutral: Stone** (warm gray)
- Light backgrounds: stone-50 to stone-100
- Dark backgrounds: stone-800 to stone-950
- Text: stone-700 (light) / stone-300 (dark)

**Accent: Custom Orange** (shifted toward red, anchored at #F04A00)
- Used for primary buttons, active states, focus rings, selected items

**Semantic colors:**
- `success`: Tailwind emerald
- `warning`: Tailwind amber
- `error`: Tailwind red
- `info`: Tailwind blue
- `purple`: Used for auto mode, rejections, PR open state

### Stage Colors (Kanban columns)
Orange-to-purple gradient palette cycling through stages:
1. bg-orange-500
2. bg-orange-400
3. bg-purple-400
4. bg-purple-500
5. bg-purple-600
6. bg-purple-700
7. bg-purple-800
8. bg-stone-500

### Task State Colors
Comprehensive state-specific color sets (bg, badge, icon variants):
- **done:** emerald/success green
- **working:** orange
- **questions:** blue/info
- **review:** amber/warning
- **blocked:** amber/warning (slightly different shade)
- **failed:** red/error
- **waiting:** stone/gray
- **interrupted:** amber
- **auto:** purple
- **PR states:** purple (open), green (merged), red (closed), gray (unknown)

### Typography
- **Font family:** Geist (sans), Geist Mono (monospace)
- **Headings:** `font-heading font-semibold` or `font-heading font-medium`
- **Body:** text-sm (14px default)
- **Monospace:** Task IDs, branch names, code, log output

### Spacing & Sizing
- **Root padding:** 16px (p-4)
- **Panel border radius:** 12px (`rounded-panel`)
- **Small border radius:** 8px (`rounded-panel-sm`)
- **Panel shadows:** Multi-layer diffuse shadows (`shadow-panel`), with hover (`shadow-panel-hover`) and press (`shadow-panel-press`) variants
- **Fixed panel widths:** 480px (task detail, assistant, new task), 360px (git history), 320px (session history)
- **Collapsed column:** 48px
- **Expanded column:** 288px

### Dark Mode
System preference via `darkMode: 'media'`. Every color class uses dual-mode pattern: `light-value dark:dark-value`.

### Animations
- **Framer Motion** for all panel transitions, column resizing, tab content sliding, layout groups
- CSS animations: `animate-spin` (loading), `animate-pulse` (status dots), `animate-ping` (notification), custom `animate-spin-bounce` (agent working indicators)
- Spring-based tab content transitions (directional slide)
- Grid-based slot transitions (opacity + size)

---

## Data Flow & Polling

### Task State Updates
- **Polling:** `TasksProvider` polls `workflow_get_tasks` every 2 seconds
- **Events:** Listens for `task-updated` Tauri events (emitted by orchestrator on state changes)
- **Optimistic updates:** Deletes are immediately reflected in UI; polling skips deleted IDs until confirmed

### PR Status
- Separate provider with configurable polling frequency
- Active polling (faster) when PR tab is focused
- Background polling (slower) for task cards showing PR icons

### Logs
- `useLogs` hook fetches logs per stage/session
- 2-second polling when logs tab is active
- Stage and session selection via `StageLogInfo` data

### Git History
- `GitHistoryProvider` fetches commit log + sync status
- Lazy-loads file counts per commit
- Push/pull operations with loading states

---

## Complete Task State Machine

All 18 task states (from `TaskState` type):

| State | Stage? | Description | UI Indicator |
|-------|--------|-------------|-------------|
| `awaiting_setup` | Yes | Task created, waiting for setup | - |
| `setting_up` | Yes | Worktree being created | - |
| `queued` | Yes | Ready to run, waiting for slot | Orange spinner |
| `agent_working` | Yes | Agent actively running | Orange spinner / bounce |
| `finishing` | Yes | Agent done, processing output | - |
| `committing` | Yes | Committing changes | Git icon |
| `committed` | Yes | Committed, ready for next stage | - |
| `integrating` | No | Merging into base branch | Git merge icon |
| `awaiting_approval` | Yes | Human review needed | Eye icon + amber border |
| `awaiting_question_answer` | Yes | Agent asked questions | Message icon + blue border |
| `awaiting_rejection_confirmation` | Yes | Reviewer rejected, human confirms | Eye icon + amber border |
| `interrupted` | Yes | Manually paused | Pause icon + amber border |
| `waiting_on_children` | Yes | Parent waiting for subtasks | Layers icon + child state |
| `done` | No | Completed successfully | Green check |
| `archived` | No | Archived after PR merge | Green check (dimmed) |
| `failed` | No | Failed with error | Red X + error banner |
| `blocked` | No | Blocked on external dependency | Amber alert + reason |

### Derived State (pre-computed in backend)
The backend sends `DerivedTaskState` with boolean flags and aggregated data:
- `is_working`, `is_system_active`, `is_interrupted`, `is_failed`, `is_blocked`, `is_done`, `is_archived`, `is_terminal`
- `needs_review`, `has_questions`, `is_waiting_on_children`
- `current_stage`, `phase_icon`, `rejection_feedback`
- `pending_questions`, `pending_rejection`
- `stages_with_logs` (which stages have log data, how many sessions each)
- `subtask_progress` (aggregate counts by state)

---

## Workflow Configuration

From `.orkestra/workflow.yaml`, the standard pipeline:

```
plan (Plan) -> task (Task) -> work (Work) -> check (Check) -> review (Review) -> compound (Compound)
```

**Named flows (alternate pipelines):**
- **quick:** plan -> work -> check -> review -> compound (skips breakdown)
- **hotfix:** work -> check -> review (skips planning, breakdown, compound)
- **micro:** work -> check (no review, uses lightweight model)

Each stage has capabilities (ask_questions, subtasks, approval) that determine what UI elements appear.

---

## Tauri Commands (Complete Feature Surface)

### Task CRUD
- `workflow_get_tasks` - List all active tasks (rich views with iterations)
- `workflow_get_archived_tasks` - List archived tasks
- `workflow_create_task` - Create new task (title, description, auto_mode, base_branch, flow)
- `workflow_create_subtask` - Create subtask under parent
- `workflow_delete_task` - Delete task

### Human Actions
- `workflow_approve` - Approve current stage
- `workflow_reject` - Reject with feedback
- `workflow_answer_questions` - Answer agent questions
- `workflow_retry` - Retry failed/blocked task with optional instructions
- `workflow_set_auto_mode` - Toggle auto mode
- `workflow_interrupt` - Kill agent process
- `workflow_resume` - Resume interrupted task with optional message
- `workflow_merge_task` - Auto-merge completed task
- `workflow_open_pr` - Create GitHub PR
- `workflow_retry_pr` - Retry failed PR creation
- `workflow_archive` - Archive completed task
- `workflow_address_pr_comments` - Send task back to work with PR comment context
- `workflow_address_pr_conflicts` - Send task back to work with conflict context

### Queries
- `workflow_get_config` - Get workflow configuration
- `workflow_get_auto_task_templates` - Get predefined task templates
- `workflow_get_iterations` - Get iteration history
- `workflow_get_artifact` - Get specific artifact
- `workflow_get_pending_questions` - Get pending questions
- `workflow_get_current_stage` - Get current stage
- `workflow_get_rejection_feedback` - Get rejection feedback
- `workflow_list_branches` - List git branches
- `workflow_get_logs` - Get agent session logs
- `workflow_get_pr_status` - Get PR status from GitHub

### Git/Diff
- `workflow_get_diff` - Get task diff (highlighted)
- `workflow_get_commit_diff` - Get single commit diff
- `workflow_get_commit_log` - Get commit history
- `workflow_git_sync_status` - Get ahead/behind counts
- `workflow_push_to_origin` - Push to remote
- `workflow_pull_from_origin` - Pull from remote
- `workflow_get_commit_file_counts` - Get file counts per commit

### External Tools
- `detect_external_tools` - Detect terminal and editor apps
- `open_in_terminal` - Open worktree in terminal
- `open_in_editor` - Open worktree in code editor

### Assistant
- `assistant_get_sessions` - List assistant sessions
- `assistant_new_session` - Create new session
- `assistant_send_message` - Send message to assistant
- `assistant_stop_agent` - Stop assistant agent
- `assistant_get_logs` - Get assistant session logs
- `assistant_get_pending_questions` - Get assistant questions
- `assistant_answer_questions` - Answer assistant questions

### Project
- `open_project` - Open a project folder
- `get_recent_projects` - Get recent project list
- `pick_folder` - OS folder picker dialog
- `start_orchestrator` - Start the orchestrator loop
- `stop_orchestrator` - Stop the orchestrator loop
- `get_project_info` - Get project metadata (has_gh_cli, etc.)

---

## Information Architecture Summary

### Primary Hierarchy
1. **Board level** - All tasks in kanban columns (or archived list)
2. **Task level** - Single task detail with tabs (details, subtasks, activity, logs, artifacts, PR)
3. **Subtask level** - Subtask detail (same structure as task, minus some features)

### Secondary Views (slide-in panels)
- **Assistant** - Independent chat, left side
- **Git History** - Commit timeline, left side
- **New Task** - Creation form, right side
- **Diff Viewer** - Code changes, replaces board

### Overlays
- **Command Palette** - Cmd+K, centered modal
- **Auto Task Dropdown** - Positioned dropdown from top bar

---

## Key User Workflows

### 1. Create and Monitor a Task
1. Click "+ New Task" -> NewTaskPanel slides in
2. Write description, select branch, choose flow, toggle auto mode
3. Click "Create Task" -> card appears in first stage column
4. Card shows spinner when agent is working
5. Click card -> TaskDetailSidebar opens, auto-selects Logs tab while working

### 2. Answer Agent Questions
1. Task card highlights with blue border + message icon
2. Click card -> QuestionFormPanel appears at bottom (480px)
3. Navigate multi-step wizard (radio options or custom text)
4. Submit answers -> agent resumes

### 3. Review Agent Work
1. Task card highlights with amber border + eye icon
2. Click card -> ReviewPanel appears at bottom (200px)
3. Either approve (green button) or type feedback and request changes (amber button)
4. For auto-reviewer rejections: Confirm Rejection or Override with feedback

### 4. Handle Failures
1. Task card shows red border + X icon in Failed column
2. Click card -> Details tab shows error banner
3. Optionally type retry instructions
4. Click "Retry Task" -> agent restarts

### 5. Integrate Completed Task
1. Done task -> IntegrationPanel at bottom
2. Choose "Auto-merge" (direct merge) or "Open PR" (GitHub PR)
3. If PR: PR tab appears, shows checks/reviews/comments
4. After PR merge: ArchivePanel appears -> click Archive

### 6. Use Assistant
1. Click "Assistant" button -> panel slides in from left
2. Type message -> agent responds in log format
3. Create new sessions, browse history

### 7. View Code Changes
1. Click diff icon in task header -> DiffPanel opens, replacing board
2. File list on left, unified diff on right
3. Click file to navigate

---

## Component Inventory (complete)

### Top-level
- `App.tsx` - Provider tree
- `Orkestra.tsx` - Main layout + slot orchestration
- `StartupErrorScreen.tsx` - Error display during initialization
- `ProjectPicker.tsx` - Initial project selection screen

### Kanban
- `KanbanBoard.tsx` - Board container
- `KanbanColumn.tsx` - Single column (collapsible)
- `TaskCard.tsx` - Task card (board + subtask variants)
- `IterationIndicator.tsx` - Iteration history strip

### Task Detail
- `TaskDetailSidebar.tsx` - Main orchestrator (tabs + footer panels)
- `TaskDetailHeader.tsx` - Title, badges, action buttons
- `DetailsTab.tsx` - Description + error/retry
- `SubtasksTab.tsx` - Subtask list + progress
- `IterationsTab.tsx` - Activity history
- `IterationCard.tsx` - Single iteration display
- `LogsTab.tsx` - Agent logs with stage/session tabs
- `ArtifactsTab.tsx` - Artifact viewer with tabs
- `ArtifactView.tsx` - Single artifact (markdown render)
- `PrTab.tsx` - PR status, checks, reviews, comments
- `ReviewPanel.tsx` - Approve/reject interface
- `QuestionFormPanel.tsx` - Multi-step Q&A
- `IntegrationPanel.tsx` - Merge/PR options
- `ResumePanel.tsx` - Resume interrupted task
- `ArchivePanel.tsx` - Archive completed task
- `DeleteConfirmPanel.tsx` - Delete confirmation
- `PrIssuesPanel.tsx` - Address PR conflicts/comments

### Archive
- `ArchivedListView.tsx` - Archived task list
- `ArchiveTaskDetailView.tsx` - Read-only archived task detail
- `ArchiveTaskDetailHeader.tsx` - Simplified header for archived tasks

### Assistant
- `AssistantPanel.tsx` - Chat interface
- `ChatInputPanel.tsx` - Message input + send/stop
- `SessionHistory.tsx` - Session list

### Git / Diff
- `CommitHistoryPanel.tsx` - Commit timeline
- `CommitEntry.tsx` - Single commit row
- `CommitDiffPanel.tsx` - Commit diff viewer
- `DiffPanel.tsx` - Task diff viewer
- `DiffPanelBody.tsx` - Shared diff body layout
- `DiffFileList.tsx` - File sidebar
- `DiffFileEntry.tsx` - Single file entry
- `DiffContent.tsx` - Diff rendering
- `DiffLine.tsx` - Single diff line
- `CollapsedSection.tsx` - Collapsible file sections

### Navigation
- `CommandPalette.tsx` - Cmd+K search
- `BranchIndicator.tsx` - Branch + sync status
- `BranchSelector.tsx` - Branch dropdown for task creation
- `SyncStatusIndicator.tsx` - Ahead/behind badges
- `SyncActionButton.tsx` - Push/pull buttons
- `AutoTaskDropdown.tsx` - Predefined task templates dropdown
- `NewTaskPanel.tsx` - Task creation form

### Logs
- `LogList.tsx` - Log entry list
- `LogEntryView.tsx` - Entry type router
- `SubagentGroup.tsx` - Grouped sub-agent entries
- Entry renderers: Text, UserMessage, ToolUse, ToolResult, SubagentToolUse, Error, ScriptStart, ScriptOutput, ScriptExit
- Shared: ExpandableContent, ToolDisplay, ToolInputSummary

### UI Design System
- `Panel.tsx` - Base container (+ Header, Body, Footer, Title, CloseButton)
- `Button.tsx` - Variants: primary, secondary, ghost, destructive, warning, info
- `Badge.tsx` - Status badges
- `IconButton.tsx` - Icon-only button
- `TabbedPanel.tsx` - Tabs with animated highlight + slide transitions
- `CollapsibleSection.tsx` - Expandable/collapsible section
- `ExpandablePanel.tsx` - Height-expandable content
- `ExpandButton.tsx` - Expand/collapse toggle
- `Dropdown.tsx` - Dropdown menu
- `EmptyState.tsx` - Empty state placeholder
- `ErrorState.tsx` - Error display
- `LoadingState.tsx` - Loading spinner
- `Link.tsx` - Styled anchor tag
- `ModalPanel.tsx` - Viewport overlay (portal-based)
- `OverlayContainer.tsx` - Overlay positioning helper
- `PanelLayout.tsx` - CSS grid layout manager
- `Slot.tsx` - Animated grid slot
- `FlexContainer.tsx` - Flex layout helper

### Hooks
- `useAutoScroll.ts` - Auto-scroll to bottom on new content
- `useChunkedHtml.ts` - Progressive HTML rendering
- `useCommitDiff.ts` - Commit diff fetching
- `useDiff.ts` - Task diff fetching with polling
- `useFocusTaskListener.ts` - Tauri event listener for focus-task
- `useLogs.ts` - Log fetching per stage/session
- `useNotificationPermission.ts` - OS notification setup
- `useProjectRoot.ts` - Project root path
- `useQuestionForm.ts` - Multi-step question form state
- `useSmartDefault.ts` - Smart default selection for tabs
- `useSyntaxCss.ts` - Syntax highlight CSS injection
- `useTaskDetail.ts` - Task action handlers

### Utils
- `kanban.ts` - Column building, task-to-column mapping
- `taskOrdering.ts` - Priority-based task sorting
- `iterationOutcomes.ts` - Outcome-to-color/label mapping
- `formatters.ts` - Title casing, date formatting
- `iconMap.ts` - Lucide icon name resolution
- `prose.ts` - Markdown prose styling classes
- `toolStyling.tsx` - Tool-specific icons and colors
- `assistantQuestions.ts` - Assistant question helpers
- `errors.ts` - Error parsing utilities

---

## Observed Design Patterns

### Strengths
1. **Consistent panel system** - Every slide-in panel uses the same Slot/PanelLayout mechanism
2. **Rich state visualization** - Tasks communicate their state through color, icon, border, and animation
3. **Smart defaults** - Tab selection, stage selection adapt to current task state
4. **Auto-mode autonomy** - Tasks can run fully autonomously or with human checkpoints
5. **Deep git integration** - Diff viewer, commit history, sync status are first-class features
6. **PR lifecycle** - Full loop from creation through review to merge/archive

### Potential Pain Points
1. **Information density** - Task cards pack many signals (icons, badges, progress bars, iteration strips) into a small space
2. **Panel depth** - Up to 3 panels can be open simultaneously (secondary + panel + content), eating horizontal space
3. **Linear navigation** - No breadcrumbs or multi-level navigation; going from subtask to parent requires closing subtask
4. **No dashboard/overview** - No aggregate view of overall project health, agent utilization, or throughput
5. **Footer panel switching** - Multiple exclusive footer panels (questions, review, resume, integration, archive) selected by complex conditional logic
6. **Polling-based updates** - 2-second polling could be replaced with more event-driven updates for better responsiveness
7. **Flat archived view** - Archived tasks are just a plain list with no grouping, filtering, or search
8. **Log viewer complexity** - Nested stage tabs + session sub-tabs + auto-scroll in a narrow sidebar panel
