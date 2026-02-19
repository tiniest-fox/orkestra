# Creative Direction: Iteration History

## Decision

Modified approval: the UX recommendation is directionally correct but the detail panel treatment needs revision before implementation — the Unicode dots are wrong for this design system, and the feed label escalation threshold needs a sharper rule.

---

## What to Build

### Feed row treatment

Append a count suffix to the `.pipeline-stage-label` span when iteration count is 2 or greater. The suffix is a middle dot separator followed by the count, rendered as a subordinate annotation to the stage name.

**Exact text format:** `Review ·3` (stage name, then a space, then U+00B7 MIDDLE DOT, then the count digit)

**CSS rules:**

The count suffix is a child `<span>` inside `.pipeline-stage-label`. It inherits the parent's font family and size baseline, then overrides:

```css
.pipeline-stage-label .iter-count {
  font-size: 8px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--text-2);   /* neutral: iterations 2–3 */
}

.pipeline-stage-label .iter-count.escalated {
  color: var(--amber);    /* escalated: iterations 4+ */
  font-weight: 500;
}
```

**Token:** `--text-2` (#9890A4) at iterations 2–3. `--amber` (#D97706) at 4+.

**Escalation rule:** 2 is worth noting. 3 confirms a pattern. 4 is a signal that something is actually stuck — escalate to amber. Do not use amber at ×2 or ×3; that would cry wolf on normal review cycles. ×1 shows nothing; ×2 and ×3 show in `--text-2`; ×4 and above show in `--amber`.

**Width:** Expand `.pipeline-stage-label` `min-width` from `42px` to `56px` to accommodate the suffix without truncation. The activity column will compress fractionally; that is acceptable.

**HTML:**
```html
<span class="pipeline-stage-label amber">
  Review<span class="iter-count"> ·3</span>
</span>

<!-- Escalated example (4+): -->
<span class="pipeline-stage-label amber">
  Review<span class="iter-count escalated"> ·5</span>
</span>
```

**Cap:** At ×9+, show `·9+`. Do not render a two-digit number in an 8px span.

### Detail panel treatment

Do not use the Unicode circle dot sequence (Concept B as proposed). The `○` `●` `◐` approach is being rejected. Here is why: those characters carry optical weight that varies by platform and rendering context. `●` at 11px on macOS renders fine; on Windows it can sit off-baseline and look like a layout accident. More importantly, a row of colored dots in the detail header competes directly with the iteration feedback banner below it — the banner already announces "Iteration 2" with explicit feedback text. Two mechanisms saying the same thing, one in symbolic shorthand and one in plain language, is redundant at best and confusing at worst.

**What to build instead:** Augment the existing pipeline breadcrumb in the detail header. Each stage label in the breadcrumb already distinguishes `done`, `current`, and `queued` states. Extend it to show a count annotation inline on any stage with 2+ iterations, using the same `·N` notation from the feed. This keeps a single source of truth for the iteration signal and places it exactly where the user is already looking when they open the detail panel.

**Exact breadcrumb format:**

```
pln → wrk ·2 → RVW ·3 → cmp
```

The count annotation on past stages uses `--text-3` (#C4BCCC) — lighter than the stage label itself, reading as auxiliary data rather than equal-weight content. The count on the current stage (`RVW ·3`) uses `--text-2` (#9890A4), one step darker, because the current stage's loop count is the most actionable piece of information in this header.

**CSS additions to `.pipeline-breadcrumb`:**

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

**HTML:**
```html
<div class="pipeline-breadcrumb">
  <span class="pipeline-stage done">pln</span>
  <span class="pipeline-sep"> → </span>
  <span class="pipeline-stage done">wrk<span class="iter-suffix"> ·2</span></span>
  <span class="pipeline-sep"> → </span>
  <span class="pipeline-stage current">RVW<span class="iter-suffix"> ·3</span></span>
  <span class="pipeline-sep"> → </span>
  <span class="pipeline-stage">cmp</span>
</div>
```

The existing `detail-meta` line (`> needs review · review stage · iteration 2 · 2nd attempt`) stays exactly as is. The breadcrumb annotation and the meta line are not redundant: the breadcrumb shows distribution across stages, the meta line shows the current stage's number in plain language. They serve different reading speeds.

### Rules

**When counts appear:**
- Iteration 1 on any stage: no annotation anywhere. The label is clean.
- Iteration 2 on any stage: show `·2` in feed label and breadcrumb. Neutral color.
- Iteration 3: show `·3`. Still neutral.
- Iteration 4+: show count in `--amber` in the feed label. Breadcrumb stays at `--text-2` for current, `--text-3` for past — the breadcrumb is not the urgency signal, the feed label is.

**What counts as an iteration:**
An iteration is one complete agent run within a stage. Rejection and re-run creates a new iteration. The count shown is the total number of iterations on that stage, not a global task iteration count. If the task is on its third work iteration and first review iteration, the feed label shows `Review` with no suffix, and the breadcrumb shows `wrk ·3 → RVW`.

**The `it.N` sub-label in the feed row** (`swift-copper-heron · it.2`) is a global iteration count and stays as is. It is not the same as the per-stage count. Do not remove it. It tells a different story: "this task has been touched N times total."

**Left pane (split view):** The `.task-sub` line already reads `review · iter 2`. No change needed. The narrow left pane cannot accommodate the count suffix in the label column reliably, and the `iter N` text already covers it.

---

## What Not to Do

**Do not animate the count suffix.** The active pipeline segment already pulses. The stage label already inherits that visual weight on review/work states. Adding motion to the count suffix — or pulsing it at high iteration counts — creates visual noise on the most important column in the row. Motion is reserved for segment state, not annotation.

**Do not use the Unicode dot sequence in the detail header.** The proposal to add `○ ○ ◐` below the breadcrumb introduces a new visual vocabulary without a sufficiently distinct purpose. The breadcrumb already encodes the same information more efficiently. Adding the dot row would require explaining what the dots mean; the `·N` notation on stage labels requires no explanation.

**Do not show the count on completed tasks.** The completed section renders at `opacity: 0.42`. Iteration counts on completed tasks are archaeological data. A user looking at a completed task does not need to know it took four review cycles — they need to know it's done. Strip the count annotation from the completed section entirely.

**Do not escalate to amber at ×2.** A task on its second iteration is completely normal — many workflows expect one feedback cycle. Amber at ×2 would make half the tasks in the feed look like they are struggling. Reserve amber for when the count genuinely signals something unusual: ×4 is the right threshold for a six-stage pipeline.

**Do not add a tooltip to the feed row pipeline strip showing a per-stage breakdown.** The design brief is explicit: do not put pipeline information in a tooltip. The breadcrumb in the detail panel is where the full per-stage breakdown lives. The feed's job is orientation, not diagnosis.
