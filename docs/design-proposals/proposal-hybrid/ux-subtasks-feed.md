# UX Analysis: Subtasks in Main Feed

---

## Recommendation

Show subtasks in the feed only when they need user attention. Never show subtasks that are merely working or blocked on dependencies. The parent row remains visible and carries a subtask progress indicator for everything else.

---

## Rationale

**1. The feed is organized by what requires user action, not what is happening.**

"Needs Attention / Active / Completed" is an intent-based grouping. The signal that matters is: does the user need to do something right now? A subtask waiting on a dependency is not actionable. A subtask running its work stage is not actionable. Showing either of those in the feed pollutes the intent-grouping model without adding any decision surface. It generates visual presence for things the user cannot act on.

**2. The parent row already carries the subtask signal.**

The feed.html already includes a `.subtask-inline` component in the parent row: a small progress bar showing done/active fills, and the text "2 / 4 subtasks complete." This tells the user everything they need to know about a parent in motion without requiring a separate row per child. Duplicating that information with individual child rows creates redundancy, not clarity.

**3. Subtasks that need attention are genuinely user-facing, and failing to surface them buries required actions.**

If a subtask hits a `?` (questions) or `!` (failed) or `>` (review) state, the user cannot discover it without clicking into the parent. That is a flow failure. A required user action is hidden behind a parent row that looks fine from the outside. The parent's progress bar might read "2 / 4 active" while one of those actives is actually blocked waiting for an answer. The parent row has no way to signal that. Surfacing the subtask directly in NEEDS ATTENTION fixes this.

---

## Concerns Addressed

**Feed density and cognitive load (8 subtasks from one parent):**

Under this recommendation, a parent with 8 actively-working subtasks shows zero subtask rows in the feed. The parent row shows "0 / 8 subtasks complete" in its progress indicator. No density problem. Density only becomes a concern if multiple subtasks simultaneously hit NEEDS ATTENTION states, and at that point the density is warranted — those are all real actions waiting for the user.

**Parent-child hierarchy lost in a flat list:**

Subtasks in NEEDS ATTENTION get a visual treatment that identifies their parent. They are not orphaned rows. The row format includes a parent reference that makes the relationship legible without nesting. The hierarchy is communicated through information on the row, not through spatial indentation in the feed. Indentation in the feed creates complications with keyboard navigation and the fixed grid layout that the existing row design depends on.

**Keyboard navigation with mixed rows:**

The `j` / `k` model navigates by row. Adding subtask rows to the feed does not break this — every row is navigable, every row has a defined action. The concern would be if subtask rows appeared in ACTIVE (where there is no primary action), because the user pressing `a` or `enter` on a working subtask row would have ambiguous behavior. This recommendation prevents that: subtask rows appear only where they are actionable.

**Intent-grouping: should subtasks appear in NEEDS ATTENTION when the parent is ACTIVE?**

Yes. The parent's section placement reflects the parent's state. The subtask's section placement reflects the subtask's state. These are independent. A parent sitting in ACTIVE (because most of its children are running fine) can have one child in NEEDS ATTENTION. Showing that child only in NEEDS ATTENTION is correct — that is where the user will look for things to act on. If the parent were also pulled into NEEDS ATTENTION because of its child, you would have two rows for what is effectively one problem, and the parent row still would not show an actionable button.

**Subtasks that finish while in the feed:**

A subtask row in NEEDS ATTENTION that gets resolved (user answers its questions, agent resumes) transitions to `*` working state. At that point it leaves the NEEDS ATTENTION section. It does not appear in ACTIVE. It disappears from the feed. The parent row's progress indicator absorbs it. This is the correct behavior — the user has no reason to watch a recovering subtask unless they open the parent detail.

**Should "blocked" subtasks appear in the feed?**

No. "Blocked" in this system means waiting on a dependency — another subtask hasn't finished yet. This is not a state that requires user input. It is the orchestrator managing sequencing. Showing blocked subtasks in the feed would teach users to read "blocked" as "something is wrong" when it usually means "working as intended." The distinction is important. Blocked subtasks are invisible in the feed; they appear in the parent's detail panel for users who want to understand the dependency graph.

---

## Proposed Interaction Model

### Which subtask states appear in the feed

| Subtask state | Appears in feed | Section |
|---|---|---|
| idle / queued | No | — |
| working (agent running) | No | — |
| blocked (waiting on dependency) | No | — |
| questions (`?`) | Yes | NEEDS ATTENTION |
| review (`>`) | Yes | NEEDS ATTENTION |
| failed (`!`) | Yes | NEEDS ATTENTION |
| done | No | — |

### Row format for subtask rows in NEEDS ATTENTION

The subtask row uses the same grid structure as a parent task row, with two differences:

1. The title column shows both a parent reference and the subtask title, visually nested in the same column.
2. The row background is slightly inset to signal child relationship without breaking the grid.

```
[!]  api-rate-limiting               [plan][break][work][checks][rev][comp]  3 test failures — token_expiry    [Retry]
      └ validate-token-middleware     ^^^^^ at Checks
```

In the actual row, the parent reference renders as a dimmed prefix above the subtask title in the title column, using the existing two-line title layout (title on top, id/meta below):

```
Title column:
  validate-token-middleware            <- primary, 13px 500 weight
  api-rate-limiting · it.1            <- secondary, 10px mono, text-3
```

The parent name replaces the task ID in the secondary line of the title column. This preserves the grid layout completely and makes the parent readable without adding columns or nesting.

The pipeline bar shows the subtask's own pipeline progress, not the parent's. The status symbol and action button operate on the subtask directly.

### Parent row behavior when subtasks are in NEEDS ATTENTION

The parent row does not move to NEEDS ATTENTION. It stays in ACTIVE. Its progress indicator updates to reflect the accurate count. The progress bar's active fill uses `--accent-2` (purple, the system-autonomous color) for running children and the amber active fill for children in states requiring attention — but this is a subtle secondary signal. The primary signal is the subtask row itself in NEEDS ATTENTION.

If the user wants to act on the subtask from the parent's detail panel, that is still possible. But the feed should not require the user to navigate through the parent.

### Acting directly on a subtask from the feed

When the user selects a subtask row and presses `enter`, the right detail panel opens to the subtask's detail. The left list shows the subtask row selected. The parent row is visible in the left list in ACTIVE, unselected. The user acts on the subtask (answers questions, retries, approves) and the subtask resolves. The subtask row disappears from NEEDS ATTENTION. The parent row in ACTIVE updates its progress count.

This flow has no friction. The user sees the problem in NEEDS ATTENTION, acts on it, and it disappears. They never had to locate the parent, expand a child list, or navigate a hierarchy.

---

## What This Means for the Feed Design

### Changes to feed.html

**1. Add a parent reference to the task-title-col for subtask rows.**

The existing two-line title column structure (`.task-title` + `.task-id`) can carry this without layout changes. For subtask rows, `.task-id` shows the parent task name instead of the task's own ID and iteration. This requires no new columns or CSS.

```html
<!-- Subtask row example in NEEDS ATTENTION -->
<div class="task-row">
  <span class="task-sym red">!</span>
  <div class="task-title-col">
    <span class="task-title">validate-token-middleware</span>
    <span class="task-id">api-rate-limiting &middot; subtask</span>
  </div>
  <div class="pipeline-col">
    <!-- subtask's own pipeline progress -->
  </div>
  <div class="task-activity error">3 test failures — auth::middleware::token_expiry</div>
  <div class="task-actions">
    <button class="btn-action retry">Retry</button>
  </div>
</div>
```

**2. No change to the parent row structure.**

The existing `.subtask-inline` progress bar and "2 / 4 subtasks complete" text in the activity column already handles the parent-level signal. That component requires no changes.

**3. Update section counts to reflect subtask rows.**

The NEEDS ATTENTION section count currently reflects parent tasks only. If subtask rows appear there, the count should include them. "Needs Attention (5)" where 2 are parent tasks and 3 are subtasks requiring action is accurate and useful. No structural change needed — just a count calculation update.

**4. The status bar counts in the top bar.**

The metrics in the top bar ("3 active · 2 review · 1 questions") should count by actionable items, not by tasks at the parent level. A subtask with questions counts toward the questions metric. This makes the top bar a reliable at-a-glance view of total work waiting for the user.

**5. No change to keyboard shortcuts or the status line.**

The `j` / `k` navigation, `a` for approve, `r` for reject — all of these work on whatever row is selected. Subtask rows are first-class rows. No special handling needed.

### What does not need to change

- The grid layout (`grid-template-columns: 18px minmax(0, 200px) 148px minmax(0, 1fr) auto`) is sufficient.
- The pipeline bar component works identically for subtasks and parents.
- The action buttons (Approve, Retry, Answer, Reject) are the same regardless of whether the row is a parent or child.
- The ACTIVE section needs no structural changes — subtasks never appear there.
