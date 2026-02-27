# Forge — Design Decisions

> Read this file and `design-brief.md` before editing any screen. Every decision here is settled.
> If you believe a decision is wrong, write a note in `creative-review.md` — do not silently override.

---

## Tokens (canonical values)

These are the only values in use. No drift. No approximations. No dark-palette values.

```css
--canvas:           #FAF8FC   /* warm off-white body, slight purple undertone */
--surface-1:        #FFFFFF   /* elevated panels, command bar, sidebars, action bars */
--surface-2:        #F4F0F8   /* nested content, code blocks, expanded sections */
--surface-3:        #EBE6F0   /* hover states, keyboard badges, active item backgrounds */
--surface-hover:    #F0ECF4   /* row hover — lighter than surface-3 */
--border:           #E4DFE9   /* structural borders, all dividers */
--border-strong:    rgba(28, 24, 32, 0.18)  /* used only on button hover */

--accent:           #E83558   /* pink-red — all user-initiated actions, focus rings, command prompt */
--accent-hover:     #D42B4C   /* accent darkened ~8% for button hover states */
--accent-bg:        rgba(232, 53, 88, 0.08)   /* focused row background, accent tints */
--accent-bg-strong: rgba(232, 53, 88, 0.14)   /* stronger accent tint, rarely needed */

--accent-2:         #A63CB5   /* pinky-purple — system-autonomous states, subtask badges, auto-mode */
--accent-2-hover:   #91339E
--accent-2-bg:      rgba(166, 60, 181, 0.08)

--green:            #16A34A   /* active healthy success — use sparingly, not for completion */
--green-dim:        #A0C8B0   /* completed stages, done state (recedes) */
--green-bg:         rgba(22, 163, 74, 0.06)
--amber:            #D97706   /* in-motion: working agent, review segment, escalated iteration count */
--amber-bg:         rgba(217, 119, 6, 0.06)
--red:              #DC2626   /* failed, error */
--red-bg:           rgba(220, 38, 38, 0.06)
--blue:             #2563EB   /* questions, informational, blocked waiting on user */
--blue-bg:          rgba(37, 99, 235, 0.06)

--text-0:           #1C1820   /* primary: task titles, headings, active content */
--text-1:           #6B6078   /* body text, descriptions, artifact prose */
--text-2:           #9890A4   /* labels, timestamps, metadata, neutral annotation */
--text-3:           #C4BCCC   /* disabled, decorative, secondary annotation, pending stage labels */

--font-ui:          'IBM Plex Sans', system-ui, -apple-system, sans-serif
--font-mono:        'IBM Plex Mono', 'SF Mono', 'Cascadia Code', monospace

--radius-md:        6px       /* all buttons, badges, interactive elements */
--shadow-bar:       0 1px 3px rgba(28, 24, 32, 0.08), 0 1px 2px rgba(28, 24, 32, 0.05)
```

**Accent usage rule (authoritative):**

| Context | Token |
|---|---|
| Command bar `>` prompt character and caret | `--accent` |
| Button fill (`.btn--accent`) | `--accent` |
| Focus rings and keyboard focus outlines | `--accent` |
| Active / focused task row left-border (2px) | `--accent` |
| Branch name in status line | `--accent` |
| Inline code color in artifacts | `--accent` |
| Section title text in feed headers | `--accent` |
| Subtask / waiting-on-children badge | `--accent-2` |
| Auto-mode indicator | `--accent-2` |
| Orchestration-level status indicators | `--accent-2` |
| Integration pipeline segment (`ps--integration`) | `--accent-2` |

Use `--accent` for anything the user initiates or acts on. Use `--accent-2` for anything the system is doing autonomously.

---

## Typography

**Google Fonts import (required in every HTML file):**
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**Role split:**
- `--font-ui` (IBM Plex Sans): task titles, artifact prose, section headers, button labels, descriptions, error messages, app brand name
- `--font-mono` (IBM Plex Mono): task IDs, timestamps, stage names in pipeline, keyboard shortcut badges, command bar input, git metadata, status line content, section count labels

**Scale — no other sizes permitted:**

| Use case | Size | Family | Weight | Tracking |
|---|---|---|---|---|
| App brand name (ORKESTRA) | 13px | UI | 700 | -0.02em |
| Section header text | 10px | Mono | 600 | 0.10em uppercase |
| Task title | 13px | UI | 500 | -0.01em |
| Body / artifact prose | 13px | UI | 400 | default |
| Button label | 12px | UI | 500 | default |
| Task ID / metadata sub-line | 10px | Mono | 400 | default |
| Keyboard badges | 10px | Mono | 500 | default |
| Stage label in pipeline col | 9px | Mono | 500–600 | 0.05em uppercase |
| Iteration count suffix | 8px | Mono | 400–500 | 0 |
| Status line | 11px | Mono | 400 | default |
| Metrics in top bar | 11px | Mono | 400/600 | default |

**Detail panel specifics:**
- Detail title: 18px UI 700, tracking -0.02em
- Task sub/stage in left pane: 10px Mono, color `--text-3`
- Section header in left pane: 10px Mono 600, uppercase, 0.08em tracking, color `--text-2`

---

## Status Symbols

Text-based. No icons. No SVGs.

| Symbol | State | Color | Token | Animation |
|---|---|---|---|---|
| `*` | Working / agent running | Amber | `--amber` | Pulses: `pulse-opacity` 2.5s ease-in-out, opacity 0.35–1.0 |
| `?` | Questions / blocked on user input | Blue | `--blue` | None |
| `!` | Failed | Red | `--red` | None |
| `>` | Review / awaiting approval | Amber | `--amber` | None (steady amber) |
| `.` | Done / complete | Dim green | `--green-dim` | None |
| `~` | Idle / queued | Muted | `--text-3` | None |
| `-` | Archived | Muted | `--text-3` | None |

Review symbol is `>` (not `~`). The `*` working symbol color is amber (not green — green means done). Only `*` animates. The diamond `◇` (`&#9671;`) in `--accent-2` is used for the integration/awaiting-merge state.

---

## Pipeline

**In feed rows and subtask rows:** Horizontal segment bars (`.ps` elements inside `.pipe-row`). No text labels in the row. One bar per stage, equal width, 4px height, 2px gap, `border-radius: 2px`. The pipeline column is `148px` fixed width.

**Feed row grid:**
```css
grid-template-columns: 18px minmax(0, 220px) 148px auto;
gap: 16px;
padding: 8px 24px;
min-height: 40px;
```

**Segment states:**
```css
.ps--pending     { background: var(--surface-3); }
.ps--done        { background: var(--green-dim); }
.ps--active      { background: var(--amber); animation: pipe-active-pulse 1.5s ease-in-out infinite; }
.ps--review      { background: var(--amber); }           /* steady, not pulsing */
.ps--failed      { background: var(--red); }
.ps--dim         { background: var(--surface-3); opacity: 0.45; }  /* unreachable after failure */
.ps--complete    { background: var(--green-dim); }
.ps--integration { background: var(--accent-2); }
```

**In the detail panel header:** Text breadcrumb in Mono showing stage shorthands with `→` separators. Current stage uppercase, colored by current state. Completed stages show `var(--green-dim)`. Pending stages show `var(--text-3)`.

Stage shorthands: `pln  tsk  wrk  chk  rvw  cmp`

Breadcrumb example: `pln → wrk ·2 → RVW ·3 → cmp`

**No circles/bubbles in any context.** No hover tooltips on the pipeline strip.

---

## Iteration History

Approved design: Concept C (loop heat on stage label) in the feed + inline `·N` in the detail breadcrumb.

### Feed row treatment

The `.pipe-iter` element sits to the right of the `.pipe-row` bar inside `.pipeline-col`. It is a sibling of `.pipe-row`, not inside it.

```css
.pipe-iter {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  margin-left: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}
.pipe-iter.neutral { color: var(--text-2); }  /* iterations 2–3 */
.pipe-iter.amber   { color: var(--amber); }   /* iterations 4+ */
```

```html
<span class="pipe-iter neutral">&middot;3</span>
<span class="pipe-iter amber">&middot;5</span>
```

**Rules:**
- Iteration 1: no element rendered
- Iterations 2–3: `.pipe-iter.neutral` (`--text-2`)
- Iteration 4+: `.pipe-iter.amber` (`--amber`)
- Cap at `·9+` — never render a two-digit number at 10px
- Do not animate the count suffix
- Do not show on completed rows (those rows render at `opacity: 0.38`)
- The count is per-stage for the current stage, not a global task iteration count

### Detail panel breadcrumb treatment

Count annotation appended inline on stages with 2+ iterations using the `.iter-suffix` child span.

```css
.pipeline-stage .iter-suffix {
  font-size: 9px;
  font-weight: 400;
  color: var(--text-3);
  letter-spacing: 0;
  margin-left: 1px;
}
.pipeline-stage.current .iter-suffix {
  color: var(--text-2);
}
```

Past-stage count: `--text-3`. Current-stage count: `--text-2`. The breadcrumb is not the urgency signal — amber escalation is feed-only.

The existing `detail-meta` line (iteration N in plain language) is not replaced by this. Both coexist — breadcrumb shows distribution, meta line shows current stage count in plain language. They serve different reading speeds.

---

## Feed Layout

**Three sections in order:**
1. **NEEDS REVIEW** (or "NEEDS ATTENTION") — tasks requiring user action. Always first. Never collapsible.
2. **IN PROGRESS** (or "ACTIVE") — agents running autonomously.
3. **COMPLETED** — done tasks, `opacity: 0.38`, aged off naturally.

No fourth section for idle/queued — those appear in IN PROGRESS at low visual weight.

**Section header:**
```css
.section-header {
  padding: 20px 24px 5px;
  position: sticky; top: 0;
  background: var(--canvas);
  z-index: 10;
}
.section-title {
  font-family: var(--font-mono);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.10em; text-transform: uppercase;
  color: var(--accent);
}
.section-count { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); margin-left: 6px; }
```

Section count includes subtask rows that appear in NEEDS ATTENTION. Subtasks in review/question/failed states surface directly into NEEDS ATTENTION as first-class rows. Subtasks that are idle, working, or blocked on dependencies do not appear in the feed.

**Subtask rows in NEEDS ATTENTION:**
- Same 4-column grid as parent rows
- `padding-left: 44px` (24px base + 20px indent)
- `.task-id` line shows parent task name instead of own ID: `parent-task-name · subtask`
- Pipeline bar shows the subtask's own pipeline progress
- Status symbol and action buttons operate directly on the subtask

**Selected row:**
```css
.task-row.selected {
  background: var(--accent-bg);
  border-left-color: var(--accent);  /* 2px left border */
}
```

**Section dividers:** `1px solid var(--border)` at `margin: 12px 24px 0`.

---

## Buttons

**Row-level action buttons (`.btn-row`):**
```css
.btn-row {
  font-family: var(--font-ui);
  font-size: 12px; font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;               /* var(--radius-md) — never exceed 6px */
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-0);
}
.btn-row:hover { background: var(--surface-3); border-color: var(--border-strong); }
```

**Variants:**
- `.btn-row.review` — `border-color: rgba(232,53,88,0.40); color: var(--accent)`. Hover: `accent-bg` + full accent border.
- `.btn-row.answer` — `border-color: rgba(37,99,235,0.35); color: var(--blue)`. Hover: `blue-bg` + full blue border.
- `.btn-row.retry` — `border-color: rgba(220,38,38,0.35); color: var(--red)`. Hover: `red-bg` + full red border.
- `.btn-row.secondary` — `border: var(--border); color: var(--text-1)`.

**Keyboard hints (`.btn-kbd`):**
```css
.btn-kbd {
  font-family: var(--font-mono); font-size: 10px; font-weight: 500;
  opacity: 0.55;
  background: rgba(28, 24, 32, 0.06);
  border-radius: 3px; padding: 0 3px;
}
```

Keyboard hints are shown **only on the selected/focused row**. Non-focused rows show the same buttons without the kbd element inside them. Every interactive action that has a keybinding shows the keybinding — it is never hidden or tooltip-only.

**Detail panel action bar:**
```css
.action-bar {
  height: 52px; padding: 0 24px;
  background: var(--surface-1);
  border-top: 1px solid var(--border);
  flex-shrink: 0;   /* NOT position: fixed */
}
```

No modals for actions. No "are you sure?" dialogs. No modal for task creation. No panels that stack.

---

## Subtasks in Feed

| Subtask state | Appears in feed | Section |
|---|---|---|
| idle / queued | No | — |
| working (agent running) | No | — |
| blocked (waiting on dependency) | No | — |
| questions (`?`) | Yes | NEEDS ATTENTION |
| review (`>`) | Yes | NEEDS ATTENTION |
| failed (`!`) | Yes | NEEDS ATTENTION |
| done | No | — |

Parent rows do not move to NEEDS ATTENTION because of a child. The parent stays in IN PROGRESS. Its subtask progress indicator (`N / M subtasks complete`) updates. The child surfaces directly in NEEDS ATTENTION as its own first-class row.

Parent row subtask progress indicator sits in the activity column. It uses the existing two-line title layout — no new columns needed.

After a subtask in NEEDS ATTENTION resolves (user acts, agent resumes), the subtask row disappears from the feed. The parent's progress count absorbs it. The subtask does not appear in IN PROGRESS afterward.

The `j` / `k` navigation, `a` for approve, `r` for reject — operate identically on subtask rows and parent rows.

---

## Left Pane (Split View) — Canonical Spec

Width: `240px` fixed. `background: var(--surface-1)`. `border-right: 1px solid var(--border)`.

**Task row:**
```css
.task-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
}
.task-row.active { background: var(--accent-bg); }
.task-row.active::before {  /* 2px left accent border */
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 2px; background: var(--accent);
}
```

**Task name:** 12px IBM Plex Sans 500, `color: --text-0`
**Task sub-line:** 10px IBM Plex Mono, `color: --text-3`, shows `stage · iter N`
**Symbol column:** 16px wide

**Section headers in left pane:**
- 10px IBM Plex Mono, 600 weight, uppercase, 0.08em tracking
- `color: --text-2`
- `padding: 4px 14px`

No pipeline bar in the narrow left pane. The `task-sub` line covering `review · iter 2` is sufficient.

---

## Pipeline Breadcrumb (Detail Panel)

Format: `pln → tsk → WRK ·2 → chk → rvw → cmp`

- Completed stages: `var(--green-dim)` with `.done` class
- Current stage: uppercase, signal color for current state (amber for working/review, blue for questions, red for failed), `.current` class
- Pending stages: `var(--text-3)`, no class modifier
- Iteration count on any stage with 2+ iterations: `·N` via `.iter-suffix` child span
  - Past stage count: `--text-3`
  - Current stage count: `--text-2`

```html
<span class="pipeline-stage done">pln</span>
<span class="pipeline-sep"> → </span>
<span class="pipeline-stage done">wrk<span class="iter-suffix"> ·2</span></span>
<span class="pipeline-sep"> → </span>
<span class="pipeline-stage current">RVW<span class="iter-suffix"> ·3</span></span>
<span class="pipeline-sep"> → </span>
<span class="pipeline-stage">cmp</span>
```

---

## Command Bar

Always visible at top. Not a modal. Not invoked. Always ready.

**Structure:** `height: 38px`, `background: var(--surface-1)`, `border-bottom: 1px solid var(--border)`

**Prompt character:** `>` in `--accent`, 13px IBM Plex Mono 600
**Input:** 12px IBM Plex Mono, `caret-color: var(--accent)`, transparent background
**Right side:** Branch name in `--accent` (font-weight 500), git status in `--text-3`

Three modes: navigation (default), command (triggered by `/`), new task (triggered by `n` or `/new`). The `Cmd+K` overlay expands from the command bar — not a separate modal.

---

## Layout Chrome

**Top bar:** `height: 44px`, `background: var(--surface-1)`, `border-bottom: 1px solid var(--border)`, `box-shadow: var(--shadow-bar)`

**Status line:** `height: 28px`, `background: var(--surface-1)`, `border-top: 1px solid var(--border)`, 11px IBM Plex Mono

**Two modes only:**
- Feed mode: full-width scrollable list
- Split mode: left pane `240px` fixed + right detail panel. `Ctrl+\` toggles. Clicking a task row opens split view. `Esc` closes right panel but keeps split layout. Second `Esc` closes split entirely.

No third mode. No nested panels. No modals. No sidebars stacking.

---

## Detail Header

```css
.detail-header { padding: 24px 32px 20px; }
```

Contains (top to bottom):
1. Pipeline breadcrumb (10–11px Mono)
2. Task title (18px UI 700, tracking -0.02em)
3. Meta line: `> state description · stage · iteration N · elapsed time` (12px Mono, `--text-2`)

The meta line and breadcrumb coexist — not redundant. Breadcrumb shows distribution across stages; meta line shows current stage count in plain language.

---

## Hard Constraints

Things that are never acceptable regardless of context:

- No colors outside the defined token set
- No gradients on UI chrome (gradients only inside pipeline segment bars if ever used)
- No `border-radius` greater than 8px anywhere; buttons and badges use exactly 6px
- No font sizes outside the defined scale
- No drop shadows on task rows (only top bar and elevated surfaces get shadows)
- No decorative illustrations, empty-state artwork, or onboarding mascots
- No `position: fixed` on action bars — use `flex-shrink: 0` in the flex column
- No tabs inside the right pane
- No tooltips for pipeline information — it belongs in the row and breadcrumb
- No kanban columns

---

## Screen Inventory

| File | Purpose |
|---|---|
| `index.html` | Concept overview / landing page for the proposal |
| `design-system.html` | Canonical token and component reference — the source of truth for all visual implementation |
| `feed.html` | Main task feed: intent-grouped sections, pipeline bars, action buttons, iteration suffixes |
| `feed-refined.html` | Refined version of the feed with improved visual polish and realistic content |
| `split-refined.html` | Split-pane view: left task list + right detail panel, refined |
| `questions-refined.html` | Q&A flow: user answering agent questions, refined |
| `review.html` | Review flow: artifact rendered, approve/reject actions |
| `questions.html` | Questions flow (earlier version) |
| `integration.html` | Post-completion merge flow: auto-merge, PR creation, CI status — 6 states |
| `onboarding.html` | First-run project picker and recent projects |
| `ux-flows.md` | UX flow documentation — user journeys, state-to-view mappings, edge cases |
| `design-brief.md` | Creative direction, rationale, personality, visual signature — read before touching any screen |
| `design-research.md` | AI orchestration UI patterns research, 2025 |
| `TEAM-BRIEF.md` | Team coordination, status tracking, gap analysis |
| `index.md` | This file — canonical decision registry |
| `assistant.html` | Assistant panel: session log, compose, inline Q&A, session history |
