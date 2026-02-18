# Proposal Hybrid: "Forge"

## Design Philosophy

Forge is the synthesis. It takes Proposal C's conviction that chrome is waste, Proposal A's belief that data density matters, and Proposal B's insistence that tools can have soul. The result: **a keyboard-driven, information-dense power tool with enough visual warmth and typographic care that it doesn't feel punishing to use.**

The name says it: this is where work gets shaped. Not a dashboard to admire, not a terminal to endure -- a forge where you and your agents hammer out software together.

### The Hybrid Thesis

Each proposal had a clear strength and a clear weakness:

- **Proposal C (The Terminal)** had the best interaction model -- keyboard-first, command bar, split view, zero chrome -- but its all-monospace austerity and pure black/white palette made it feel cold and monotonous. Extended use would fatigue.
- **Proposal A (Mission Control)** had the best information density -- pipeline visualizations, metrics, live feeds, timing data -- but its dark-only navy palette and no-shadows rule made it feel like a Bloomberg terminal. All data, no breathing room.
- **Proposal B (The Workshop)** had the best visual design -- considered typography, warm palette, thoughtful shadows and spacing -- but its card-based layout and full-screen focus transitions felt too far from the power-user mental model.

Forge takes:

| Element | Source | Why |
|---------|--------|-----|
| Keyboard-first interaction | C | Every action has a keybinding. Command bar is primary. Vim-style navigation. |
| Split view | C | Left list + right detail, toggled with one key |
| Persistent command bar + status line | C | Always visible, never modal |
| Text-symbol status indicators | C | `*` `?` `!` `>` `.` -- unambiguous, no icon font |
| Pipeline visualization | A | Horizontal stage bars per task row -- the signature element |
| Live feed column | A | Real-time agent activity visible in the main list |
| Metrics and timing | A | Duration, stage progress, agent counts in status bar |
| Data-rich expanded rows | A | Accordion expansion with full artifacts, not a sidebar |
| Section-based feed grouping | A + B | "Needs Attention" / "Active" / "Completed" -- intent-driven like B, dense like A |
| Mixed typography | B | Inter for UI, JetBrains Mono for data/code -- not all-monospace |
| Warm dark palette | B | Not pure black, not navy -- a warm dark with character |
| Shadows and depth | B | Subtle, warm-toned shadows on elevated surfaces |
| Considered spacing | B | 4px grid, generous section gaps, tight element gaps |
| Border radius on interactive elements | B | 6px buttons, 8px cards -- not zero, not 16px |
| Hover states and focus rings | B | Every interactive element has a visible response |
| Accent color with warmth | B | Terracotta-shifted orange, not raw #F04A00 |

### The Target Aesthetic

**Linear meets Warp terminal.** Functional density with design taste.

The interface should feel like a well-designed terminal emulator that hired a typographer. Dense data, keyboard shortcuts visible everywhere, but with enough warmth in the palette and enough care in the spacing that you don't feel like you're staring at a spreadsheet.

---

## Visual Language

### Color Palette

Dark mode primary, light mode available via toggle.

**Dark mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `canvas` | `#141118` | App background -- warm near-black with slight purple undertone |
| `surface-1` | `#1C1820` | Elevated panels, status bar, command bar |
| `surface-2` | `#242029` | Expanded sections, nested content, code blocks |
| `surface-3` | `#2E2936` | Hover states, keyboard badges, active items |
| `surface-hover` | `#282330` | Row hover highlight |
| `border` | `rgba(168, 162, 178, 0.12)` | Structural borders -- barely visible |
| `border-focus` | `var(--accent)` | Focus rings, active elements |

**Accent:**

| Token | Value | Usage |
|-------|-------|-------|
| `accent` | `#E8613A` | Interactive elements, focus rings, command prompt, links |
| `accent-hover` | `#F07350` | Hover state for accent elements |
| `accent-bg` | `rgba(232, 97, 58, 0.08)` | Subtle tint for selected/focused rows |
| `accent-bg-hover` | `rgba(232, 97, 58, 0.14)` | Stronger tint for active states |

**Signal colors (calibrated for dark backgrounds):**

| Token | Value | Semantic |
|-------|-------|----------|
| `green` | `#4ADE80` | Active, healthy, done, approved |
| `green-dim` | `#22804A` | Completed pipeline stages, dimmed success |
| `amber` | `#FBBF24` | Review needed, attention, warning |
| `red` | `#F87171` | Failed, error, blocked, danger |
| `blue` | `#60A5FA` | Questions, info, PR status |
| `purple` | `#A78BFA` | Auto mode, secondary accent |

Each signal has a background variant at 8% opacity for inline containers.

**Text hierarchy:**

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `#F0ECF4` | High contrast, headings, titles |
| `text-secondary` | `#B8B0C4` | Body text, descriptions |
| `text-tertiary` | `#706880` | Labels, timestamps, metadata |
| `text-muted` | `#524A5C` | Disabled states, decorative |

**Light mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `canvas` | `#FAF8FC` | Warm off-white with slight purple |
| `surface-1` | `#FFFFFF` | Elevated surfaces |
| `surface-2` | `#F4F0F8` | Nested content |
| `surface-3` | `#EBE6F0` | Hover, badges |
| `text-primary` | `#1C1820` | Primary text |
| `text-secondary` | `#6B6078` | Secondary text |
| `text-tertiary` | `#9890A4` | Metadata |
| `border` | `#E4DFE9` | Borders |

### Typography

Two fonts, clear roles:

- **UI font:** Inter (400, 500, 600, 700) -- all labels, headings, buttons, navigation, section headers. Clean, professional, excellent at small sizes.
- **Data font:** JetBrains Mono (400, 500, 600) -- task IDs, timestamps, code, log content, pipeline labels, keyboard hints, status line. Tabular numerals enabled globally.

The rule: if it's *content the user reads to understand*, it's Inter. If it's *data the user scans to act on*, it's JetBrains Mono.

**Scale:**

| Level | Font | Size | Weight | Tracking | Usage |
|-------|------|------|--------|----------|-------|
| App title | Inter | 14px | 700 | -0.02em | "ORKESTRA" branding |
| Section header | Inter | 11px | 600 | 0.06em uppercase | "NEEDS ATTENTION (3)" |
| Task title | Inter | 13px | 500 | -0.01em | Task names in feed |
| Body | Inter | 13px | 400 | 0 | Descriptions, artifact text |
| Label | Inter | 11px | 500 | 0 | Button labels, tab names |
| Data | JetBrains Mono | 12px | 400 | 0 | IDs, timestamps, stage names |
| Code | JetBrains Mono | 12px | 400 | 0 | Code blocks, log entries |
| Micro | JetBrains Mono | 11px | 400 | 0 | Keyboard hints, counts |
| Status line | JetBrains Mono | 11px | 400 | 0 | Bottom bar content |

### Spacing

4px base unit. All values are multiples of 4.

| Element | Value | Rationale |
|---------|-------|-----------|
| Page margin | 24px horizontal, 16px vertical | Generous without wasting space |
| Section gap | 8px between sections | Tight but distinguishable |
| Row height | 40px minimum | Slightly smaller than A's 44px for density |
| Row padding | 10px vertical, 16px horizontal | Enough for hover targets |
| Element gap | 12px between grid columns | Standard column spacing |
| Dense gap | 4px between tightly grouped items | Pipeline stages, status metrics |
| Section header padding | 6px vertical | Compact headers |

### Borders and Surfaces

- **Shadows:** Subtle, warm-toned. Used on command bar, expanded accordions, and action buttons. Not on rows or section headers.
  - Resting: `0 1px 2px rgba(20, 17, 24, 0.15), 0 1px 3px rgba(20, 17, 24, 0.10)`
  - Hover: `0 2px 8px rgba(20, 17, 24, 0.20), 0 1px 3px rgba(20, 17, 24, 0.12)`
- **Borders:** 1px, low opacity. Structural only -- separating command bar, status line, section boundaries.
- **Border radius:** 6px for buttons and inputs. 8px for expanded content areas and code blocks. 4px for keyboard badges. Never on rows or the main feed.
- **Depth:** Surfaces layer through background shade differences. Command bar and status line are `surface-1`. Expanded content is `surface-2`. Hover targets are `surface-3`.

### Status Symbols

Same text-based approach as C, with signal colors:

| Symbol | Color | Meaning |
|--------|-------|---------|
| `*` | green | Agent actively working |
| `?` | blue | Questions waiting for answers |
| `!` | red | Failed or blocked |
| `>` | amber | Needs review / approval |
| `.` | green (dim) | Completed |
| `~` | text-muted | Idle / queued / waiting |
| `-` | text-muted | Archived |

### Animation

Minimal and purposeful. No decorative motion.

- **Hover:** 120ms background color transition. Subtle, immediate.
- **Focus:** Instant outline appearance (no transition on focus rings).
- **Status dots:** CSS `animation: pulse 2.5s ease-in-out infinite` on active agent indicators. Opacity oscillates 0.4 to 1.0.
- **Pipeline pulse:** Active stage segment pulses with 1.5s cycle.
- **Accordion expand:** 200ms height transition with ease-out. Content fades in over 150ms.
- **No spring physics, no bounce, no entrance animations.** Every other transition is instant.

### Iconography

None. Status is communicated through colored text symbols and signal color backgrounds. No icon font, no SVGs, no emoji.

Exception: the pipeline visualization uses colored segments (CSS only), not icons.

---

## Layout Architecture

### Default View (Feed)

```
+------------------------------------------------------------------+
| ORKESTRA   3 Active  1 Review  1 Questions  1 Failed   Cmd+K     |  <- Status bar (surface-1)
+------------------------------------------------------------------+
| > _                                    [branch] [+2 -0] [theme]  |  <- Command bar (surface-1)
+------------------------------------------------------------------+
|                                                                    |
|  NEEDS ATTENTION (3)                                               |
|                                                                    |
|  > auth-middleware-refactor  [==*==---] Planning   Review plan     |
|  ! ci-pipeline-fix           [====!--] Checks     3 failures      |
|  ? database-schema-update    [*------] Planning   2 questions      |
|                                                                    |
|  ----------------------------------------------------------------  |
|                                                                    |
|  ACTIVE (3)                                                        |
|                                                                    |
|  * user-settings-page        [====*--] Work       Reading files..  |
|  * api-rate-limiting         [*------] Planning   Analyzing...     |
|  * test-infrastructure       [==~----] Children   2/4 subtasks     |
|                                                                    |
|  ----------------------------------------------------------------  |
|                                                                    |
|  COMPLETED TODAY (2)                                               |
|                                                                    |
|  . database-migration        [======] Done  12:34  3 files changed |
|  . api-rate-limiting         [======] Done  11:20  PR #47 merged   |
|                                                                    |
+------------------------------------------------------------------+
| main +2 -0  |  3 agents  |  j/k nav  enter focus  ctrl+\ split   |
+------------------------------------------------------------------+
```

### Split View

```
+------------------------------------------------------------------+
| ORKESTRA   3 Active  1 Review  1 Questions                Cmd+K  |
+------------------------------------------------------------------+
| > _                                    [branch] [+2 -0] [theme]  |
+-------------------------------+----------------------------------+
|                               |                                  |
| NEEDS ATTENTION (3)           | auth-middleware-refactor          |
|                               | Review planning artifact         |
| > auth-middleware-refactor  > | Created 2h ago | Planning | It.2 |
| ! ci-pipeline-fix             |                                  |
| ? database-schema-update      | -------------------------------- |
|                               |                                  |
| --------------------------    | ARTIFACT: plan                   |
|                               |                                  |
| ACTIVE (3)                    | ## Auth Middleware Refactor Plan  |
|                               |                                  |
| * user-settings-page          | ### Changes                      |
| * api-rate-limiting           | 1. Extract JWT validation...     |
| * test-infrastructure         | 2. Add refresh token support...  |
|                               |                                  |
| --------------------------    | [a]pprove  [r]eject  [d]iff     |
|                               |                                  |
| COMPLETED TODAY (2)           |                                  |
|                               |                                  |
| . database-migration          |                                  |
| . api-rate-limiting           |                                  |
+-------------------------------+----------------------------------+
| main +2 -0  |  3 agents  |  ctrl+\ close split  j/k  esc back  |
+------------------------------------------------------------------+
```

---

## Component Mapping

| Current Component | Forge Equivalent |
|-------------------|-----------------|
| KanbanBoard + KanbanColumn | Feed (scrollable, intent-grouped sections) |
| TaskCard | Task Row (40px grid row with symbol + title + pipeline + feed + action) |
| TaskDetailSidebar (6 tabs) | Focus View (full-width) or Split Pane (right side) |
| ReviewPanel | Inline review block in focus/split (artifact + action bar) |
| QuestionFormPanel | Inline Q&A in focus/split (numbered questions + inputs) |
| IntegrationPanel | Integration section in focus view |
| LogsTab (3-level tabs) | Log stream view (single scrollable, filterable) |
| ArtifactsTab | Inline artifact in focus view (rendered markdown) |
| IterationsTab | History section in focus view (compact list) |
| SubtasksTab | Indented subtask rows under parent in feed |
| DiffPanel | Split diff view (file list + unified diff) |
| CommitHistoryPanel | Removed (use terminal/IDE) |
| AssistantPanel | Command bar query or overlay |
| CommandPalette | Command bar (always visible) + Cmd+K enhanced mode |
| NewTaskPanel | Command bar creation (`new Fix the login bug`) |
| ArchivedListView | Completed section at bottom, archiving automatic |
| BranchIndicator | Command bar right side (compact) |
| IterationIndicator | Iteration count in focus view header |
| Badge | Text symbol + color (no pills) |
| Button | Styled button with keyboard hint |

---

## Key Decisions

### Removed
- **Light mode as primary**: Dark-first. Light is available but secondary.
- **Kanban board**: Replaced by intent-grouped feed. Stage columns don't serve autonomous pipelines.
- **Icons**: All status via text symbols + color. No icon font dependency.
- **Panel/sidebar system**: No competing panels. Feed or split view.
- **Commit history panel**: Developers have terminals.
- **Push/pull from UI**: Status indicator only.
- **Cards**: No card metaphor. Content is rows and inline expansions.
- **Serif heading font**: Fraunces from B is too editorial for a power tool. Inter is clean and professional.

### Simplified
- **Task creation**: Command bar input. No modal, no separate panel.
- **Archive**: Completed tasks dim and age off. No separate archive mode.
- **Iteration history**: Count in header, timeline in focus view. Not a top-level tab.
- **PR integration**: Status + actions in focus view. Not a full PR browser.
- **Log navigation**: No stage tabs + session tabs. Single stream with stage dividers and filters.

### Preserved
- **Pipeline visualization**: The visual signature. Each row shows full stage progress.
- **Live activity**: Real-time agent action text, visible in the feed without opening details.
- **Artifact review + approve/reject**: The core workflow, inline in focus view.
- **Question answering**: Numbered prompts with keyboard-driven responses.
- **Subtask progress**: Inline bar in feed, expandable to child rows.
- **Auto mode**: Toggle per task, visible in task metadata.
- **Flow picker**: Available during task creation in the command bar.
- **Command palette (Cmd+K)**: Enhanced as the primary action interface.

### Added
- **Persistent command bar**: Always visible at top. Not a modal overlay.
- **Status line**: Bottom bar with git state, agent count, keyboard hints.
- **Split view toggle**: One keystroke to get list + detail side by side.
- **Log filtering + search**: Filter by type (tool/output/error), search by text.
- **Pipeline in every row**: Stage progress visible without expanding.
- **Warm dark palette**: Not cold, not sterile. Has personality.
- **Mixed typography**: UI text and data text are visually distinct.

---

## Responsive Behavior

| Width | Adaptation |
|-------|------------|
| > 1400px | Full 5-column task rows. Split view available. Pipeline column expands. |
| 1000-1400px | Pipeline column compresses. Feed text truncates. Split view still available. |
| 800-1000px | 3-column rows (symbol + title + status). No split view. Pipeline moves to tooltip. |
| < 800px | Not recommended. This is a workstation tool. |

---

## Personality

Precise but not punishing. Fast but not cold. Dense but not cluttered.

The UI communicates: "This is a sharp tool with a good grip." It respects your time (keyboard-first, zero unnecessary clicks), respects your intelligence (dense data, no hand-holding), and respects your eyes (warm palette, careful typography, enough whitespace to breathe).

Forge is for developers who want their AI orchestration tool to feel as considered as their code editor, as fast as their terminal, and as informative as a good dashboard -- without compromising on any of those three.
