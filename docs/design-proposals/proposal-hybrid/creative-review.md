# Creative Director Review

## Verdict: Strong bones, three structural fractures that will compound into a broken system if not fixed before a single line of implementation code is written.

The palette is correct. The typography decision (IBM Plex) is correct. The split-pane layout direction is correct. The text-symbol status vocabulary is correct. None of that needs revisiting.

What needs fixing is structural inconsistency that has already fragmented across the file set. There are two parallel systems for the left sidebar, two parallel systems for the pipeline display, and a status symbol color error that contradicts the spec the designers themselves wrote. These are not polish issues. They are architecture issues that will produce a product that looks assembled, not designed.

---

## 1. Feed Layout — Canonical Spec

### Position

There are two completely different left-pane implementations in this file set and they must be collapsed into one.

**Type A — Full feed row** (`feed.html`): A horizontal grid layout with five columns: symbol, title+ID, pipeline bar, activity text, actions. Full-width application. No sidebar grouping. This is the Feed Mode described in the brief.

**Type B — Compact sidebar list** (`task-detail-working.html`, `task-detail-review.html`, `task-detail-questions.html`, `task-detail-pr.html`, `new-task.html`): A 240px fixed sidebar with flex rows containing: symbol, task name+subtitle, optional badge. No pipeline bar. This is the Split Mode left pane.

These are legitimately different views for different modes, and that is correct per the brief. The problem is that **Type B is not consistent across the files that use it**, and the task row structure inside Type B has diverged.

### Type B Violations — Left Sidebar

**`task-detail-working.html` and `task-detail-review.html`** use an older version of Type B:
- Task row is `flex-direction: column` with padding `9px 14px`
- Title is 12px IBM Plex Sans
- Sub-line shows `stage · iter N` as plain text with a colored `4px×4px` dot
- No section grouping — flat list under a single "Tasks" header
- No badges

**`task-detail-questions.html`, `task-detail-pr.html`, and `new-task.html`** use a newer, better version of Type B:
- Task row is `flex` horizontal with `padding: 7px 14px`
- Title is 12px IBM Plex Sans (same)
- Sub-line shows stage metadata in monospace
- Section grouping with section headers (Needs Attention / Working / Done groupings)
- Badges for question count, review state, PR state

The newer version is correct. `task-detail-working.html` and `task-detail-review.html` are running old code.

### Canonical Left Sidebar Spec

```css
/* Left pane shell */
.split-left {
  width: 240px;
  flex-shrink: 0;
  background: var(--surface-1);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.split-left-scroll {
  overflow-y: auto;
  flex: 1;
  padding: 12px 0;
}

/* Section grouping */
.left-section { margin-bottom: 8px; }

.left-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px;
  margin-bottom: 2px;
}

.left-section-title {
  font-family: var(--font-mono);  /* IBM Plex Mono */
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-2);
}

.left-section-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-3);
}

/* Task row */
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background 80ms;
  position: relative;
}
.task-row:hover { background: var(--surface-hover); }

/* Selected/active state */
.task-row.active { background: var(--accent-bg); }
.task-row.active::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: var(--accent);
}

/* Symbol */
.task-sym {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  width: 16px;
  flex-shrink: 0;
  text-align: center;
}

/* Task info */
.task-info { min-width: 0; flex: 1; }

.task-name {
  font-family: var(--font-ui);  /* IBM Plex Sans */
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-0);
}

.task-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-3);
  margin-top: 1px;
}

/* Badge */
.task-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}
```

**Key measurements:**
- Sidebar width: `240px` fixed (all files agree — this is correct)
- Row padding: `7px 14px` (horizontal)
- Row min-height: implied ~34px by padding + 12px title + 10px sub
- Symbol column: `16px` wide
- Section header padding: `4px 14px`
- Section title: 10px IBM Plex Mono, 600 weight, uppercase, 0.08em tracking

### Type A Feed Row Canonical Spec (feed.html)

`feed.html` is largely correct. The grid is:

```css
.task-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 200px) 148px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 8px 24px;
  min-height: 40px;
}
```

This is the canonical definition. The columns are: symbol | title+ID | pipeline+label | activity | actions. `148px` for the pipeline column is specific and must not be altered — it gives the pipeline bar room to read at a glance without consuming the title column.

---

## 2. Stage Pipeline — Canonical Approach

### Position

Use text shorthands in the detail pane breadcrumb. Use the horizontal segment bar in feed rows. Never use circles/bubbles. The design system's `pipe-seg` bars are correct. The design system's `pipe-stage-label` text labels beneath bars are correct.

Here is the full breakdown:

**In feed rows (feed.html and the left pane is excluded from this):** Horizontal colored segment bars with a text label to the right showing the current stage name in full ("Work", "Review", "Planning"). This is working correctly in `feed.html`. Do not touch it.

**In detail pane headers (all task-detail-*.html):** A text breadcrumb in monospace showing all stages as shorthands with `→` separators, current stage highlighted. This is a navigation/orientation element, not a progress visualization. It works because it is compact and the detail pane already communicates state through the content beneath it.

The shorthands are: `pln tsk wrk chk rvw cmp`. Lowercase for completed/pending, uppercase for current. This is the convention already in use in `task-detail-working.html` and `task-detail-review.html` and it is correct.

**No bubbles.** The design system shows filled/empty circle variants in section 4 but they do not appear in any screen file. Do not use them. They add visual weight to a component that needs to be lightweight, and they introduce a visual language that competes with the status symbols (`* ? ! > . ~`) rather than complementing them.

### Violations

**`task-detail-questions.html` — pipeline breadcrumb, lines 553–563:**
The current stage `PLN` is uppercased correctly, but the remaining stages `tsk wrk chk rvw` are styled as `.done` with `color: var(--text-3)` — the muted color. This is wrong. `.done` implies completed. These stages have not been completed; the task is in planning. Completed stages should use `var(--text-3)` (muted), pending stages should use `var(--text-3)` as well (same visual weight, task is not there yet), and the current stage gets the signal color for the current state (blue for questions, amber for working/review, etc.).

The fix: completed = `var(--green-dim)`, current = signal color, pending = `var(--text-3)`.

In `task-detail-questions.html` this task is at the planning stage with questions, so `PLN` should be `var(--blue)` (question state), all other stages `var(--text-3)` pending. The current code makes everything look done except the current stage, which is semantically backwards.

**`task-detail-pr.html` — pipeline breadcrumb, lines 536–547:**
Uses `done-all` class styling all stages including current as `var(--green)`, with `cmp` as `.dim`. The PR view represents a completed pipeline, so green for all completed stages is semantically correct. But `var(--green)` is used here — the full bright green — rather than `var(--green-dim)` which is specified for completed stages. This is a signal intensity error. Full bright green is for active/healthy status. Dim green is for "done, recedes." Fix: change completed stages to `var(--green-dim)`.

**`task-detail-working.html` — pipeline breadcrumb, line 484:**
`WRK` is uppercase and amber. This is correct. But notice `pln` and `tsk` before it have no `.done` class — they are plain `.pipeline-stage` styled as `var(--text-2)`. They should show as completed (green-dim). Currently they are the same weight as pending stages after `WRK`. Fix: add a `.done` class with `color: var(--green-dim)` to `pln` and `tsk`.

**`task-detail-review.html` — pipeline breadcrumb, lines 456–467:**
Same problem as working. `pln tsk wrk chk` before `RVW` have no `.done` class. They appear as pending. Fix: same as above.

**`new-task.html` — flow selector pipeline text, lines 505–521:**
Uses `pln → tsk → wrk → chk → rvw → cmp` as plain text in `.flow-pipeline`. This is informational text within a UI element, not a status breadcrumb, so full stage shorthands in plain monospace are correct here. No fix needed.

---

## 3. Consistency Audit

### Typography

**`task-detail-working.html` — app name, line 70:**
```css
.app-name {
  font-size: 11px; font-weight: 700; letter-spacing: 0.10em;
  text-transform: uppercase; color: var(--text-0);
  font-family: var(--font-mono);  /* IBM Plex Mono */
}
```
The brief specifies "App brand: 13px Inter 700, tracking -0.02em" — now IBM Plex Sans 13px 700 tracking -0.02em. This file uses 11px, monospaced, 0.10em tracking. Wrong font family, wrong size, wrong tracking. The brief is explicit: the brand name is a UI font, not a data font.

`task-detail-review.html` has the identical error (lines 70–74 are copied from working).

**`task-detail-questions.html` and `task-detail-pr.html` — brand name:**
```css
.brand { font-weight: 700; font-size: 13px; letter-spacing: -0.02em; color: var(--text-0); }
```
Correct size and tracking but missing `font-family: var(--font-ui)`. The font will inherit from body, which happens to be correct — but it should be explicit. Minor.

**`task-detail-questions.html` — detail title, line 196:**
`font-size: 18px; font-weight: 600; letter-spacing: -0.02em`

**`task-detail-pr.html` — detail title, line 160:**
`font-size: 18px; font-weight: 600; letter-spacing: -0.02em`

**`task-detail-working.html` and `task-detail-review.html` — detail title:**
`font-size: 18px; font-weight: 700` — weight is 700 here vs. 600 in questions and PR.

Pick one. 700 is correct for a primary heading element. Fix questions and PR to `font-weight: 700`.

**`task-detail-review.html` — artifact body text, lines 228–244:**
Artifact paragraph text is `font-size: 14px`. The brief specifies body text at 13px. 14px is not in the defined scale. Fix to 13px.

Artifact list items are also 14px. Same fix.

**`design-system.html` — primary button color, line 603:**
```css
.btn--primary {
  background: var(--green);
  border-color: var(--green);
  color: #141118;
}
```
The primary action button in the design system uses green as the fill color. But in every screen file, the primary action button (`btn-primary`) uses `var(--accent)` (pink-red). These are in direct conflict. The design system says green is for completion/done states. Using green as a primary button fill is semantically wrong given the established color vocabulary. Fix the design system: `.btn--primary` should use `var(--accent)` fill. Reserve the green button variant as `.btn--success` for completion-state actions only (e.g., "Merge").

**`design-system.html` — section number labels:**
Uses `color: var(--accent)` for section numbers, which is correct per the brief (accent on navigational emphasis). No issue.

### Color

**`task-detail-questions.html` — `sym-working` color, line 153:**
```css
.sym-working { color: var(--green); }
```
The brief (Round 2 correction, explicitly documented in design-brief.md and TEAM-BRIEF.md) states that `*` working must be **amber**. Green = done. Amber = in motion.

`task-detail-pr.html` — same error, line 131: `sym-working { color: var(--green); }`

`new-task.html` — same error, line 115: `sym-working { color: var(--green); }`

This is three files with the same explicit spec violation. `feed.html` gets it right (`.task-sym.amber` with `pulsing` animation). The split-pane files have not been updated to the Round 2 correction. This matters: a developer looking at the working symbol in green reads "done." That is the exact wrong message.

**`task-detail-review.html` — review status dot in the left pane, line 403:**
```html
<div class="task-row-status-dot" style="background: var(--accent);"></div>
<span class="task-row-stage">review · iter 2</span>
```
Using accent (pink-red) for the review status dot. Review should be amber. The brief states `>` review = amber. The accent color is for user-initiated actions, not system states. Fix to `var(--amber)`.

**`task-detail-pr.html` — `sym-done` uses bright green, lines 133, 512, 519:**
```css
.sym-done { color: var(--green); opacity: 0.45; }
```
This approximates dim green through opacity stacking, which is a poor approach — it varies based on background color. Use `var(--green-dim)` directly: `color: var(--green-dim); opacity: 1;`. Same issue in `task-detail-questions.html` and `new-task.html`.

**`design-system.html` — `--btn--warning` uses dark palette amber value, line 656:**
```css
border-color: rgba(251, 191, 36, 0.25);
```
`#FBBF24` is the dark-mode amber. The light-mode amber is `#D97706`. This is a dark palette color leaking into a light-only system.

### Spacing

**Action bar heights are inconsistent across task-detail files:**
- `task-detail-working.html`: `height: 48px`, `padding: 0 20px`
- `task-detail-review.html`: `height: 52px`, `padding: 0 20px`
- `task-detail-questions.html`: `position: fixed; padding: 12px 32px` (no explicit height)
- `task-detail-pr.html`: `position: fixed; bottom: 26px; padding: 12px 32px` (no explicit height, offset from bottom by 26px to account for status line height)
- `new-task.html`: `position: fixed; bottom: 26px; padding: 12px 40px`

Three different padding values (0 20px, 12px 32px, 12px 40px). Two use `position: fixed` with bottom offsets to account for the status line; two use `flex-shrink: 0` in the flex column. The fixed positioning approach in questions, PR, and new-task is brittle — if the status line height changes, the offset breaks. Use `flex-shrink: 0` in the flex column consistently.

**Canonical action bar:**
```css
.action-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  height: 52px;
  background: var(--surface-1);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
```

**Status line heights diverge:**
- `feed.html`: `height: 28px`
- `task-detail-working.html`: `height: 28px`
- `task-detail-review.html`: `height: 28px`
- `task-detail-questions.html`: `height: 26px`
- `task-detail-pr.html`: `height: 26px`
- `new-task.html`: `height: 26px`

Two files at 26px, three at 28px. Pick 28px and standardize.

**Detail header padding inconsistency:**
- `task-detail-working.html` and `task-detail-review.html`: `padding: 16px 24px 12px`
- `task-detail-questions.html` and `task-detail-pr.html`: `padding: 24px 32px 20px`

This is a 50% increase in top padding and a 33% increase in horizontal padding between the two groups. Pick one. The `24px 32px 20px` version gives the title room to breathe. Use that.

### Components

**Button shape — border-radius drift:**
- `task-detail-working.html`: `btn-ghost` uses `border-radius: 5px`
- `task-detail-review.html`: `btn-primary` and `btn-outline` use `border-radius: 5px`
- `task-detail-questions.html`: `btn-primary` uses `var(--radius-md)` = 6px
- `task-detail-pr.html`: `btn-primary`, `btn-outline-accent`, `btn-text-link` use `var(--radius-md)` = 6px
- `new-task.html`: `btn-primary` uses `var(--radius-md)` = 6px

Some files use hardcoded `5px`, others use the token `6px`. The token exists. Use it everywhere.

**`task-detail-questions.html` and `task-detail-pr.html` — the `sym-review` symbol is `~`:**
```html
<span class="task-sym sym-review">~</span>
```
The review state symbol should be `>`, not `~`. The brief is explicit: `>` = review/awaiting approval, `~` = idle/queued. The symbol `~` is used for review tasks in these two files' left pane lists, which is simply wrong. The idle tasks that display as `~` in `feed.html` are correctly using `~`. These review items should use `>`.

**`design-system.html` — task row grid, line 742:**
```css
.task-row {
  grid-template-columns: 20px 1fr auto auto;
}
```
The design system's task row component uses only 4 columns, omitting the pipeline column. The `feed.html` canonical row has 5 columns including the pipeline as the third column. The design system is documenting an incomplete row that does not match the primary screen. Fix the design system's task row demo to match the 5-column feed.html spec:
```css
grid-template-columns: 18px minmax(0, 200px) 148px minmax(0, 1fr) auto;
```

### Priority Classification

**Must fix before implementation:**
1. `sym-working` color: green → amber in `task-detail-questions.html`, `task-detail-pr.html`, `new-task.html`
2. Left sidebar structure in `task-detail-working.html` and `task-detail-review.html` — rebuild to match the newer format in questions/PR/new-task
3. App name in `task-detail-working.html` and `task-detail-review.html` — wrong font, wrong size, wrong tracking
4. `sym-review` symbol `~` → `>` in `task-detail-questions.html` and `task-detail-pr.html`
5. Action bar `position: fixed` → `flex-shrink: 0` in `task-detail-questions.html`, `task-detail-pr.html`, `new-task.html`

**Must fix before design sign-off:**
6. Pipeline breadcrumb `.done` class missing from completed stages in `task-detail-working.html` and `task-detail-review.html`
7. Pipeline breadcrumb stage color in `task-detail-questions.html` — current stage should be blue (questions), preceding stages have no completion state
8. Completed pipeline stages in `task-detail-pr.html` using bright green instead of `var(--green-dim)`
9. Status line height standardize to 28px (questions, PR, new-task are at 26px)
10. Detail header padding standardize to `24px 32px 20px` (working and review use smaller values)
11. Review status dot in `task-detail-review.html` left pane — accent → amber
12. `sym-done` — replace `color: var(--green); opacity: 0.45` with `color: var(--green-dim)` in questions, PR, new-task
13. Button border-radius hardcoded `5px` → `var(--radius-md)` in working and review

**Nice to have:**
14. `.btn--primary` in `design-system.html` — change fill from green to accent for semantic correctness
15. Dark palette amber `#FBBF24` → light palette amber `#D97706` in design-system.html warning button border
16. Detail title font-weight standardize to 700 in questions and PR (currently 600)
17. Artifact body text in `task-detail-review.html` 14px → 13px
18. Explicit `font-family: var(--font-ui)` on `.brand` in questions and PR

---

## Fix List

**1.** In `task-detail-questions.html`, `task-detail-pr.html`, and `new-task.html`: change `.sym-working { color: var(--green); }` to `.sym-working { color: var(--amber); }`. Add pulsing animation to match feed.html: `animation: symbol-pulse 2.5s ease-in-out infinite;`

**2.** In `task-detail-questions.html` and `task-detail-pr.html`: change the review task symbol in the left pane HTML from `~` to `>`. Check all task rows marked `sym-review` and confirm they display `>`.

**3.** In `task-detail-working.html` and `task-detail-review.html`: replace the left pane structure entirely. Delete `.task-list-pane`, `.task-list-header`, `.task-list-scroll`, `.task-row` (the flex-column variant), `.task-row-title`, `.task-row-meta`, `.task-row-stage`, `.task-row-status-dot` CSS and HTML. Rebuild using the structure from `task-detail-questions.html`: `split-left` + `left-section` + `left-section-header` + `task-row` (horizontal flex). Include section groupings (Needs Attention, Working, Done). Add proper badges.

**4.** In `task-detail-working.html` and `task-detail-review.html`: change `.app-name` CSS to `font-family: var(--font-ui); font-size: 13px; font-weight: 700; letter-spacing: -0.02em; text-transform: none; color: var(--text-0);`. Remove the monospace font, remove the uppercase transform, correct the size and tracking.

**5.** In `task-detail-questions.html`, `task-detail-pr.html`, `new-task.html`: change `.action-bar` from `position: fixed; bottom: 26px` to `flex-shrink: 0` within the flex column. Set `height: 52px; padding: 0 24px`.

**6.** In `task-detail-working.html`: add class `done` to the `pln` and `tsk` stages in the pipeline breadcrumb HTML. Add `.pipeline-stage.done { color: var(--green-dim); }` to the CSS.

**7.** In `task-detail-review.html`: add class `done` to `pln`, `tsk`, `wrk`, `chk` in the breadcrumb. Same CSS addition.

**8.** In `task-detail-questions.html`: the pipeline breadcrumb has `PLN` as current (blue is correct for questions state) and all other stages as `.done` — but those stages have not been completed. Remove the `.done` class from `tsk wrk chk rvw`. They should remain as pending (text-3). Add `.pipeline-stage.current { color: var(--blue); }` — this already exists. Verify the HTML matches: only `PLN` gets `.current`.

**9.** In `task-detail-pr.html`: change `done-all` class color from `var(--green)` to `var(--green-dim)` in the CSS. PR shows all stages complete — they should recede, not blaze.

**10.** In `task-detail-review.html` left pane: change the selected task's status dot from `background: var(--accent)` to `background: var(--amber)`. Review = amber, not accent.

**11.** In `task-detail-questions.html`, `task-detail-pr.html`, `new-task.html`: change `.sym-done { color: var(--green); opacity: 0.45; }` to `.sym-done { color: var(--green-dim); }`.

**12.** All task-detail files: standardize `.status-line { height: 28px; }`. Files at 26px (questions, PR, new-task) need updating.

**13.** All task-detail files: standardize `.detail-header { padding: 24px 32px 20px; }`. Files working and review need updating from `16px 24px 12px`.

**14.** In `task-detail-working.html` and `task-detail-review.html`: change all hardcoded `border-radius: 5px` in button styles to `var(--radius-md)`.

**15.** In `design-system.html`: change `.btn--primary` background and border-color from `var(--green)` to `var(--accent)`. Rename the current variant `.btn--success` if a green completion button is needed.

**16.** In `task-detail-questions.html` and `task-detail-pr.html`: change `.detail-title { font-weight: 600; }` to `font-weight: 700`.

**17.** In `task-detail-review.html`: change artifact prose `font-size: 14px` to `font-size: 13px` in `.artifact-doc p` and `.artifact-doc ol li`.

**18.** In `design-system.html`: update `.task-row` grid to `grid-template-columns: 18px minmax(0, 200px) 148px minmax(0, 1fr) auto` to match the five-column feed layout, and add a pipeline column demo showing `.pipe-seg` bars in the task row showcase.
