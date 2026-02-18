# Proposal C: "The Terminal"

## Design Philosophy

The Terminal reimagines Orkestra as a **text-first, keyboard-driven power tool**. The central conviction: **chrome is waste.** Every border, shadow, rounded corner, and decorative element that isn't content is stealing pixels from what matters. The interface should feel like a beautifully typeset document -- or better, like a terminal emulator designed by a typographer.

### The Argument Against GUI Conventions

Most task management tools inherit their visual language from consumer SaaS: rounded cards, colorful badges, icon-heavy toolbars, animated transitions. These conventions exist to make software feel approachable. Orkestra's users don't need approachability -- they're developers who spend their day in terminals, editors, and REPLs. They want **density, speed, and predictability**.

The Terminal strips away every GUI convention that doesn't earn its place:
- **No cards.** Content is separated by whitespace and indentation, like a well-structured text file.
- **No shadows.** Depth is communicated through typographic hierarchy (weight, size, opacity).
- **No icons.** Status is communicated through text symbols and color: a green dot for success, a red X for failure, an amber ? for questions.
- **No transitions.** Content appears and disappears instantly. The interface responds at the speed of thought.
- **No decorative color.** The palette is black, white, and a single accent color (the existing Orkestra orange #F04A00) used only for interactive elements and focus states.

### Why This Works for Orkestra

Orkestra is a tool for developers orchestrating AI agents. Its users:
1. Live in terminals and code editors 8+ hours per day
2. Value information density over visual comfort
3. Navigate primarily by keyboard
4. Think in text, not in spatial arrangements
5. Want to see what's happening and act on it, not admire the UI

The kanban board, card-based layouts, and panel systems of conventional project tools are optimizations for **visual scanning** -- they help non-technical users quickly assess status through spatial arrangement and color. Orkestra's users don't need this. They can read a sorted text list faster than they can scan a spatial board.

### The Core Interaction Model

The entire interface is a **single scrollable buffer** with a **persistent command bar**. Think: Vim buffer meets Raycast meets a beautifully formatted terminal output.

- **Command bar** is the universal entry point. Type to filter, search, create, act. Every action in the app is accessible from here.
- **Task list** is a dense, sortable, filterable text list grouped by urgency. No cards, no columns -- just rows of aligned data.
- **Focus mode** replaces the list with a single task's full detail. Press Enter to focus, Escape to return.
- **Split view** divides the screen vertically: list on the left, focused task on the right. One keystroke to toggle.

---

## Visual Language

### Color Palette

**Light mode (primary):**

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#FFFFFF` | Background -- pure white, no gray tint |
| `fg` | `#000000` | Primary text -- true black |
| `fg-secondary` | `#6B7280` | Secondary text, metadata |
| `fg-muted` | `#9CA3AF` | Disabled, timestamps, hints |
| `border` | `#E5E7EB` | Horizontal rules, section dividers only |
| `accent` | `#F04A00` | Interactive elements, focus rings, links |
| `accent-bg` | `rgba(240, 74, 0, 0.06)` | Subtle tint for focused/selected rows |
| `status-success` | `#059669` | Done, approved, passing |
| `status-active` | `#D97706` | Agent working, in-progress |
| `status-attention` | `#2563EB` | Needs review, has questions |
| `status-danger` | `#DC2626` | Failed, error, blocked |

**Dark mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#000000` | True black background |
| `fg` | `#FFFFFF` | White text |
| `fg-secondary` | `#9CA3AF` | Secondary text |
| `fg-muted` | `#6B7280` | Muted text |
| `border` | `#374151` | Dividers |
| `accent` | `#F04A00` | Same orange accent |
| `accent-bg` | `rgba(240, 74, 0, 0.10)` | Selected row tint |

**Rule:** No grays for backgrounds. No surface elevation. No card backgrounds. Just black or white, with color reserved for status and interaction.

### Typography

**Font:** Berkeley Mono (primary), falling back to Iosevka, Cascadia Code, JetBrains Mono, SF Mono, Consolas, monospace.

Everything is monospace. This creates natural column alignment without CSS grid systems. The fixed-width grid becomes the design system.

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Page title | 16px | 700 | 24px | "Orkestra" branding |
| Section header | 11px | 600 | 16px | "NEEDS ATTENTION (3)" -- always uppercase |
| Task title | 14px | 500 | 20px | Task names in list and focus view |
| Body | 13px | 400 | 20px | Descriptions, artifact text, log content |
| Data | 13px | 400 | 20px | Stage names, timestamps, IDs -- tabular-nums |
| Small | 11px | 400 | 16px | Metadata, hints, keyboard shortcuts |
| Command | 14px | 400 | 20px | Command bar input |

All text uses `font-variant-numeric: tabular-nums; font-feature-settings: 'liga' 0;` -- tabular numbers for alignment, no ligatures for readability.

### Spacing

- **Base unit:** 8px (intentionally larger than 4px to create generous whitespace between dense text)
- **Line gap within sections:** 0px (text lines are separated by line-height only, like a terminal)
- **Section gap:** 24px (3 units) -- clear visual breathing room between groups
- **Page margin:** 32px horizontal, 24px vertical
- **Indentation:** 24px (3 characters at 8px/char) for nested content

### Visual Separators

- **Between sections:** A single `<hr>` -- 1px solid border color, full width
- **Between items:** No separator. Line-height and grouping provide structure.
- **Hierarchy:** Communicated through indentation, font weight, and opacity -- not through borders or backgrounds.

### Status Symbols

Text-based, not icon-based:

| Symbol | Color | Meaning |
|--------|-------|---------|
| `*` | status-active | Agent working |
| `?` | status-attention | Questions waiting |
| `!` | status-danger | Failed or blocked |
| `>` | status-attention | Needs review |
| `.` | status-success | Completed |
| `~` | fg-muted | Idle / queued |
| `-` | fg-muted | Archived |

### Animation

**None.** Zero transitions, zero hover effects (beyond cursor: pointer), zero entrance animations. Content appears and disappears instantly. This is a deliberate, opinionated choice:

1. Animations add latency between intent and result
2. They make the interface feel slower than it is
3. Terminal users expect instant response
4. The absence of motion is itself a design statement

The only "animation" is the cursor blink in the command bar.

---

## Component Mapping

| Current Component | Terminal Equivalent | Notes |
|-------------------|-------------------|-------|
| KanbanBoard | Buffer (scrollable list) | Grouped by urgency, not pipeline stage |
| KanbanColumn | Section header | Uppercase text + count, no visual container |
| TaskCard | Task row | Single line: symbol + title + stage + status + action hint |
| TaskDetailSidebar | Focus view | Replaces the buffer with full task content |
| ReviewPanel | Inline review block | Artifact text + approve/reject prompt at bottom |
| QuestionFormPanel | Inline Q&A | Questions rendered as numbered prompts |
| LogsTab | Log stream | Monospace, no tabs -- just the latest session's output |
| ArtifactsTab | Inline artifact | Rendered markdown, no tab navigation |
| IterationsTab | History section | Compact chronological list in focus view |
| SubtasksTab | Subtask list | Indented under parent, same row format |
| DiffPanel | Split diff view | Unified diff in focus, or right pane in split mode |
| AssistantPanel | Command bar + overlay | Type assistant queries in the command bar |
| CommandPalette | Command bar | Always visible at top, not a modal overlay |
| NewTaskPanel | Command bar | `new Fix the login bug` creates a task inline |
| Badge | Text symbol + color | No pill shapes, no backgrounds |
| Button | Text link + keyboard hint | `[a]pprove  [r]eject  [d]iff  [l]ogs` |

### New Components

| Component | Purpose |
|-----------|---------|
| Command Bar | Persistent top-of-screen input. Filter, search, create, act. |
| Status Line | Bottom bar: branch, sync status, active agent count, keyboard hints |
| Task Row | Dense single-line task representation with aligned columns |
| Focus View | Full-buffer task detail with state-adaptive content |
| Split Pane | Vertical divider creating list + detail side-by-side |

---

## Layout Architecture

### Default View (Buffer)

```
+------------------------------------------------------------------+
| > _                                       [3 active] [1 review]  |  <- Command bar + status summary
+------------------------------------------------------------------+
|                                                                    |
|  NEEDS ATTENTION (3)                                               |  <- Section header
|                                                                    |
|  > database-schema-update     Review   planning   View plan       |  <- Task row
|  ! ci-pipeline-fix            Failed   work       cargo test: 3   |
|  ? api-endpoint-design        Waiting  planning   2 questions     |
|                                                                    |
|  ----------------------------------------------------------------  |  <- Section divider
|                                                                    |
|  ACTIVE (3)                                                        |
|                                                                    |
|  * auth-refactor              Work     coding     Reading auth.ts |
|  * user-settings-page         Plan     planning   Analyzing...    |
|  * test-infrastructure        Break    breakdown  4 subtasks      |
|                                                                    |
|  ----------------------------------------------------------------  |
|                                                                    |
|  COMPLETED TODAY (2)                                               |
|                                                                    |
|  . database-migration         Done     12:34      3 files changed |
|  . api-rate-limiting          Done     11:20      7 files changed |
|                                                                    |
+------------------------------------------------------------------+
| main  +2 -0  |  3 agents  |  j/k nav  enter focus  cmd+k command |  <- Status line
+------------------------------------------------------------------+
```

### Focus View (Single Task)

```
+------------------------------------------------------------------+
| > database-schema-update                    esc back  d diff      |
+------------------------------------------------------------------+
|                                                                    |
|  database-schema-update                                            |  <- Task title
|  Review planning artifact                                          |  <- State description
|  Created 2h ago  |  Stage: planning  |  Iteration 2               |
|                                                                    |
|  ----------------------------------------------------------------  |
|                                                                    |
|  ARTIFACT: plan                                                    |
|                                                                    |
|  ## Database Schema Update Plan                                    |
|                                                                    |
|  ### Changes                                                       |
|  1. Add `workflow_stage_sessions` table for agent session tracking  |
|  2. Add `log_entries` table for structured agent logs              |
|  3. Add indexes on task_id for both tables                         |
|                                                                    |
|  ### Migration Strategy                                            |
|  - Create V15__add_sessions_and_logs.sql                           |
|  - Run migration on startup (Refinery handles this)                |
|  - No data migration needed (new tables only)                      |
|                                                                    |
|  ### Estimated Changes                                             |
|  - 3 new files (migration, types, queries)                         |
|  - 2 modified files (schema.rs, mod.rs)                            |
|                                                                    |
|  ----------------------------------------------------------------  |
|                                                                    |
|  [a]pprove  [r]eject with feedback  [d]iff  [l]ogs  [h]istory     |
|                                                                    |
+------------------------------------------------------------------+
| main  +2 -0  |  Review mode  |  a approve  r reject  esc back    |
+------------------------------------------------------------------+
```

### Split View

```
+-------------------------------+----------------------------------+
| > _                           | database-schema-update           |
+-------------------------------+                                  |
|                               | Review planning artifact         |
| NEEDS ATTENTION (3)           | Created 2h ago  |  planning      |
|                               |                                  |
| > database-schema-update  >   | -------------------------------- |
| ! ci-pipeline-fix             |                                  |
| ? api-endpoint-design         | ARTIFACT: plan                   |
|                               |                                  |
| --------------------------    | ## Database Schema Update Plan   |
|                               |                                  |
| ACTIVE (3)                    | ### Changes                      |
|                               | 1. Add `workflow_stage_sessions` |
| * auth-refactor               | 2. Add `log_entries` table       |
| * user-settings-page          | 3. Add indexes on task_id        |
| * test-infrastructure         |                                  |
|                               | ...                              |
| --------------------------    |                                  |
|                               | [a]pprove  [r]eject  [d]iff     |
| COMPLETED TODAY (2)           |                                  |
|                               |                                  |
| . database-migration          |                                  |
| . api-rate-limiting           |                                  |
+-------------------------------+----------------------------------+
| main  +2 -0  |  3 agents  |  ctrl+\ split  j/k nav  esc close  |
+-------------------------------+----------------------------------+
```

---

## Key Design Decisions

### Removed Features

- **Kanban board:** Replaced entirely by the grouped text list. The kanban metaphor doesn't serve keyboard-first users.
- **Panel/sidebar system:** Eliminated. No PanelLayout, no Slots. Just a buffer that changes content.
- **Icons (Lucide):** Replaced by text symbols. Unicode characters are sufficient for status communication.
- **Rounded corners, shadows, borders:** Removed. Visual hierarchy comes from typography alone.
- **Animations/transitions:** Removed entirely. Content is instantaneous.
- **Commit history panel:** Developers have terminals. The status line shows branch + ahead/behind.
- **Session sub-tabs in logs:** Implementation detail. Show the latest session; older sessions accessible via history command.
- **Iteration indicator (colored dots):** Replaced by iteration count in task metadata.
- **Auto-task templates dropdown:** Accessible via command bar (`new --flow quick Fix the bug`).

### Simplified Features

- **Archive:** Not a mode switch. Completed tasks age off the bottom of the list. Type `archive` in command bar to view/manage archived tasks.
- **PR integration:** Reduced to status text + action prompts. No separate PR tab with full checks/reviews/comments viewer.
- **Subtasks:** Shown as indented rows under the parent in the main list. No separate subtask panel.
- **Diff viewer:** Rendered inline in focus view (unified diff) or in the right pane of split view.
- **Branch selection:** Part of the command bar. `new -b feature/auth Fix the login` or default to current branch.

### Preserved Features

- **Command palette (Cmd+K):** This becomes the primary interaction pattern, not a secondary shortcut. Enhanced with full action support.
- **Auto mode toggle:** Available per-task via command bar or keyboard shortcut in focus view.
- **Flow picker:** Available in task creation flow, rendered as a text-based selection.
- **Live agent status:** The rightmost column of each task row updates in real-time with the agent's current action.
- **Artifact review + approve/reject:** The core workflow. Rendered as inline text with keyboard-driven actions.
- **Question answering:** Rendered as numbered prompts with keyboard selection.

### Added Features

- **Persistent command bar:** Always visible, always ready. Not a modal overlay.
- **Status line:** Bottom bar showing git branch, sync status, agent count, and contextual keyboard hints.
- **Vim-style navigation:** j/k, Enter/Escape, number keys for quick actions.
- **Inline task creation:** Type directly in the command bar, no modal needed.
- **Filter expressions:** `is:review`, `is:failed`, `stage:work`, `flow:quick` in the command bar.
- **Keyboard shortcut hints:** Contextual hints in the status line and after action prompts.

---

## Responsive Behavior

| Width | Adaptation |
|-------|------------|
| > 1200px | Full 4-column task rows (symbol + title + stage + status). Split view available. |
| 900-1200px | 3-column rows (symbol + title + status). Split view collapses to focus-only. |
| < 900px | 2-column (symbol + title). Status on second line. No split view. |

The monospace text wraps naturally. No grid reflow, no card restructuring. Content simply truncates or wraps within the fixed-width character grid.

---

## Personality

Precise. Fast. Uncompromising. The UI communicates: **this is a power tool for people who know what they're doing.** No onboarding, no hand-holding, no decorative elements. If you can use Vim, you can use this. The learning curve is intentional -- it filters for users who will benefit most from the design's speed and density.

This is the Orkestra for developers who think task management UIs have too much UI.
