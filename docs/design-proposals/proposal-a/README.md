# Proposal A: "Mission Control"

## Design Philosophy

Mission Control treats Orkestra as a **real-time operations dashboard** -- like NASA mission control or a Bloomberg terminal adapted for AI orchestration. The user is a commander overseeing multiple autonomous agents. Every task is a mission with a live telemetry feed.

### Why Not a Kanban Board?

The current kanban board organizes tasks by workflow stage (Planning, Breakdown, Work, Checks, Review, Compound, Done, Failed, Blocked). This is a pipeline-centric view that assumes manual progression -- drag a card from one column to the next. But Orkestra's tasks progress autonomously through stages. The user doesn't move them; agents do.

Mission Control replaces columns with a **timeline feed** -- a dense, tabular layout where every task is a row and its entire lifecycle is visible at a glance. The pipeline visualization is the centerpiece: a horizontal bar showing all stages with the current position marked. No wasted space, no decorative chrome, no ambiguity about where things stand.

### Why a Timeline Feed Instead of Cards?

Cards waste space. A card shows one task per 120x200px block. A row shows one task per 44px of height across the full viewport width. For 10 tasks, cards need scrolling across a multi-column layout. Rows show all 10 in a single screen without scrolling.

The timeline feed also solves information density. Each row shows five dimensions simultaneously: status (color dot), identity (title + ID), progress (pipeline bar), activity (live feed text), and action (contextual button). Cards can show at most two or three of these without clutter.

### Why Accordion Expansion Instead of Sidebars?

The current 480px sidebar creates spatial competition -- the board shrinks while the detail panel grows. Users must mentally map between two disconnected areas.

Accordion expansion keeps the detail in context. The row expands downward, pushing other rows away. The detail is physically attached to the row it describes. There is no mapping problem. Pressing Escape collapses it and restores the full feed.

---

## Visual Language

### Color Palette

Dark-only. Mission Control has no light mode. The dark background is integral to the design -- signal colors are calibrated for contrast against navy, not white.

**Backgrounds:**
- Canvas: #0A0F1A (deep navy-black)
- Surface 1: #0F1729 (primary panels, status bar)
- Surface 2: #162033 (expanded sections, nested content)
- Surface 3: #1D2940 (hover states, keyboard badges)
- Hover: #1A2438 (row hover highlight)

**Signal Colors (vivid, for dark backgrounds):**
- Green: #34D399 (healthy, active, done)
- Green dim: #1A7A52 (completed pipeline stages)
- Amber: #FBBF24 (review needed, attention)
- Red: #F87171 (failed, errors)
- Blue: #60A5FA (questions, info)
- Purple: #A78BFA (secondary accent)
- Orange: #FB923C (edit operations in logs)

Each signal color has a background tint variant at 8% opacity for subtle inline containers (review bars, question panels, error displays).

**Text:**
- Primary: #F1F5F9 (high contrast white)
- Secondary: #CBD5E1 (body text, descriptions)
- Tertiary: #64748B (labels, timestamps)
- Quaternary: #475569 (disabled, decorative)

**Borders:**
- Default: rgba(148, 163, 184, 0.12) -- barely visible, structural only
- Focus: var(--blue) -- for keyboard focus indicators

### Typography

- **Data font:** IBM Plex Mono (weights 400, 500, 600). The primary font. Used for task IDs, timestamps, live feed text, log entries, code references, and all tabular data. Tabular numerals (`font-variant-numeric: tabular-nums`) are enabled globally so numbers align in columns.
- **Label font:** Inter (weights 400, 500, 600, 700). Secondary font for section headers, action buttons, task titles, and UI labels. Used sparingly -- IBM Plex Mono is the default; Inter is reserved for elements that need to read as UI chrome rather than data.

**Scale:**
- App title: 14px / Inter 700 / -0.02em tracking
- Task title: 13px / Inter 500
- Section header: 11px / Inter 600 / uppercase / 0.08em tracking
- Body data: 12px / IBM Plex Mono 400
- Micro data: 11px / IBM Plex Mono 400 (IDs, timestamps, labels)
- Tiny data: 10px / IBM Plex Mono 400 (keyboard hints, iteration labels)

### Spacing & Grid

Strict 8px base grid. All spacing values are multiples of 4px:

- Row height: 44px minimum
- Row padding: 12px vertical, 16px horizontal
- Section gap: 8px between feed sections
- Element gap: 12px between grid columns within a row
- Dense gap: 4px between tightly grouped items (pipeline stages, status metrics)

### Borders & Surfaces

- No shadows anywhere. Zero. Depth is communicated through background shade differences only.
- 1px borders using the low-opacity border color. Borders are structural separators, not decorative.
- Border radius: 4px maximum. Applied to buttons, input fields, keyboard hints, and inline containers. Never to rows, sections, or the main feed.
- Surfaces layer like tinted glass: bg-0 behind bg-1 behind bg-2 behind bg-3.

### Iconography

None. Status is communicated through colored dots (8px circles), text symbols, and inline indicators. No icon font, no SVGs, no emoji. This is a deliberate constraint: icons add visual noise and require the user to learn a symbol vocabulary. Colored dots + text labels are unambiguous.

### Animation

Minimal and immediate. No spring physics, no easing curves, no decorative motion.

- **Hover:** 100ms background color change. No transform.
- **Status transitions:** Immediate color swap (no transition).
- **Pulsing dots:** CSS `animation: pulse 2s infinite` on active status dots. `opacity` oscillates between 0.4 and 1.0.
- **Pipeline pulse:** Active pipeline stage pulses with same timing (1.5s cycle).
- **Accordion expand:** Not animated. Content appears/disappears instantly. The feed reflows.

---

## Component Mapping

How current components map to Mission Control:

| Current Component | Mission Control Equivalent |
|-------------------|---------------------------|
| KanbanBoard + KanbanColumn | Timeline Feed (single scrollable list, sectioned) |
| TaskCard | Task Row (44px-tall grid row with 5 columns) |
| TaskDetailSidebar (6 tabs + footer) | Accordion Detail (inline expansion below the row) |
| ReviewPanel (footer) | Review Bar (inline within accordion, amber-tinted) |
| QuestionFormPanel (footer) | Question Inline (option buttons within accordion) |
| IntegrationPanel (footer) | Integration Row (post-completion actions in row) |
| LogsTab (3-level tabs) | Log Compact (activity entries in accordion, single list) |
| ArtifactsTab | Artifact Section (left panel in accordion grid) |
| IterationsTab | Iteration label in artifact section header |
| SubtasksTab + nested sidebar | Subtask Expansion (child rows under parent, indented) |
| DiffPanel (replaces board) | Not shown in main feed (use terminal/IDE) |
| CommitHistoryPanel | Removed |
| AssistantPanel + SessionHistory | Removed from main UI (use command palette or terminal) |
| CommandPalette | Kept, enhanced as primary action interface |
| NewTaskPanel (sidebar) | Command palette action (`new Fix the login bug`) |
| ArchivedListView | Completed Today section (dimmed rows at bottom) |
| BranchIndicator + SyncStatus | Status bar right side (compact git state) |
| IterationIndicator (colored squares) | Iteration count in artifact section header |

---

## Information Architecture

```
Global Status Bar
  |-- App title (ORKESTRA)
  |-- Metric pills: Active (green), Review (amber), Questions (blue), Failed (red), Done Today
  |-- Git state: branch, commit hash, push/pull status
  |-- Notification badge (count of attention items)
  |-- Clock (auto-updating)

Timeline Feed (single scrollable area)
  |
  +-- NEEDS ATTENTION section (sorted: failed > questions > review)
  |     +-- [Task Row: review]     --> Accordion: Artifact + Activity + Review Bar
  |     +-- [Task Row: questions]  --> Accordion: Question forms inline
  |     +-- [Task Row: failed]    --> Accordion: Error display + Retry options
  |
  +-- ACTIVE section
  |     +-- [Task Row: working]    --> Accordion: Activity feed
  |     +-- [Task Row: working]    --> Accordion: Activity feed
  |     +-- [Task Row: subtasks]   --> Accordion: Child rows with progress
  |
  +-- COMPLETED TODAY section (dimmed, compact)
        +-- [Task Row: done]       --> Accordion: Integration options
        +-- [Task Row: done]       --> Accordion: Integration options

Command Palette (Cmd+K)
  +-- Task search and filter
  +-- Action execution (approve, reject, retry, answer)
  +-- Task creation (new + description)
```

---

## Key Decisions & Trade-offs

### Removed features
- **Light mode**: The design is calibrated for a dark canvas. Signal colors at the specified saturation levels would need complete re-calibration for light backgrounds. One mode, done well.
- **Commit history panel**: Developers have git tools. Orkestra shows git state in the status bar.
- **Push/pull actions**: Status indicator only. No UI-driven git operations.
- **Assistant panel**: Replaced by command palette. The assistant overlay adds complexity without solving a problem the command palette doesn't already solve.
- **Card-based layout**: Replaced entirely by rows. No cards, no card shadows, no card borders.
- **Icons**: Replaced by colored dots and text. No icon font dependency.
- **Animations beyond status pulses**: Decorative motion conflicts with the "instant, responsive" personality.

### Simplified features
- **Task creation**: Type `new` in the command palette followed by a description. No modal, no form fields, no flow picker. Flow selection happens via a flag in the command (`new --flow quick Fix the bug`).
- **Archive**: Completed tasks dim and stay at the bottom. No separate archive view. They age off after 24 hours.
- **Iteration history**: Shown as a small label in the artifact section header ("Iteration 2"), not as a separate tab or timeline.

### Preserved features
- **Pipeline visualization**: The horizontal progress bar is the signature element. Each stage is a segment, color-coded by state. Active stages pulse.
- **Live activity feed**: Real-time agent action streaming in both the row (one-line) and accordion (full log).
- **Subtask progress**: Inline colored bar in the feed column, expandable to child rows.
- **Keyboard shortcuts**: First-class navigation with J/K, Enter/Escape, number keys for quick actions.
- **Notification badge**: Count in the status bar draws attention without interrupting workflow.

### Added features
- **Global status bar**: Persistent metrics strip showing system-wide state at all times.
- **Inline review/question/error handling**: No separate panels. Actions happen within the expanded row.
- **Pipeline as primary progress indicator**: Replaces percentage bars and stage labels with a visual representation of the full workflow.
- **Keyboard hints**: Subtle badges showing available shortcuts in the section headers.

---

## Responsive Considerations

Mission Control is designed for wide screens (1200px+). The timeline feed needs horizontal space for all five columns.

- **Wide screens (>1400px)**: Full 5-column layout. Pipeline column expands. Live feed column shows more text.
- **Medium screens (1000-1400px)**: Pipeline column compresses. Live feed truncates earlier. Task IDs collapse.
- **Narrow screens (<1000px)**: Not recommended. The design intentionally prioritizes information density over mobile/tablet compatibility. If needed, the feed degrades to a 3-column layout (status + title + action) with accordion details providing the remaining information.

The design assumes the user is at a workstation with a wide monitor -- the same environment where they run their IDE and terminal.
