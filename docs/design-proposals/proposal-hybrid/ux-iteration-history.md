# Iteration History: UX Proposals

## The Problem

A task that went through review four times tells you something different from a task that sailed through in one. The current app makes this visible by listing all iterations, but the list format is verbose and lives in a place the user has to go looking for it. Forge needs to encode this quality signal into the existing visual language without adding a new column, new panel, or new concept — just a natural extension of what's already there. The challenge is that iteration count is not a status signal (it doesn't tell you what to do right now) but it does become urgent when a task is actively looping, and it should fade into the background when it isn't.

---

## Concept A: Stage Loop Marks

**The idea:** The pipeline strip in every feed row is already doing heavy lifting — it encodes stage position and state. Stage loop marks annotate individual segments with a small superscript count when iterations on that stage exceed one. A segment that has been visited only once stays visually clean. A segment visited three times gets a tiny `×3` mark above it. The mark uses IBM Plex Mono, renders at 8px, and appears in `--text-3` for completed stages (recedes), amber for the currently-looping stage (draws attention).

**Where it lives:**
- Feed row: on the pipeline segment, as a superscript rendered above the segment bar. Visible always, but readable only on hover if the segment is narrow.
- Detail header: in the pipeline breadcrumb, the current stage label shows the iteration count inline: `RVW ×3` instead of just `RVW`. First iterations show no count — `×1` is never rendered.
- The feed row's task-id line (below the title) already shows `it.2` — this stays as-is and is the fallback for the split view's narrow left pane, where the pipeline strip is not shown.

**Interaction:** Always-on annotation. No hover required to see the count on the active stage — it's visible at rest. Completed-stage counts fade to `--text-3` (near invisible at a glance, readable if you look). On hover of the pipeline strip, a tooltip shows the full breakdown: `plan ×1 · work ×2 · review ×3`.

**HTML/CSS snippet:**

```html
<!-- Feed row pipeline column with loop marks -->
<div class="pipeline-col" style="
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
">
  <div class="pipeline-segs" style="
    display: flex;
    gap: 2px;
    flex: 1;
    align-items: flex-end;
  ">
    <!-- Plan: done, 1 iteration — no mark -->
    <div style="display: flex; flex-direction: column; align-items: center; flex: 1; gap: 2px;">
      <div style="height: 8px;"></div><!-- placeholder for mark height -->
      <div style="flex: 1; height: 4px; border-radius: 2px; background: #A0C8B0; width: 100%;"></div>
    </div>

    <!-- Work: done, 2 iterations — mark shown in text-3 -->
    <div style="display: flex; flex-direction: column; align-items: center; flex: 1; gap: 2px;">
      <span style="
        font-family: 'IBM Plex Mono', monospace;
        font-size: 8px;
        font-weight: 500;
        color: #C4BCCC;
        line-height: 1;
        white-space: nowrap;
      ">×2</span>
      <div style="flex: 1; height: 4px; border-radius: 2px; background: #A0C8B0; width: 100%;"></div>
    </div>

    <!-- Review: active, 3 iterations — mark shown in amber -->
    <div style="display: flex; flex-direction: column; align-items: center; flex: 1; gap: 2px;">
      <span style="
        font-family: 'IBM Plex Mono', monospace;
        font-size: 8px;
        font-weight: 600;
        color: #D97706;
        line-height: 1;
        white-space: nowrap;
      ">×3</span>
      <div style="flex: 1; height: 4px; border-radius: 2px; background: #D97706;
        animation: seg-pulse 1.8s ease-in-out infinite; width: 100%;"></div>
    </div>

    <!-- Compound: queued — no mark -->
    <div style="display: flex; flex-direction: column; align-items: center; flex: 1; gap: 2px;">
      <div style="height: 8px;"></div>
      <div style="flex: 1; height: 4px; border-radius: 2px; background: #EBE6F0; width: 100%;"></div>
    </div>
  </div>

  <!-- Stage label: current stage with iteration count -->
  <span style="
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    color: #D97706;
    min-width: 54px;
    text-align: right;
  ">Review ×3</span>
</div>
```

And in the detail header breadcrumb:

```html
<div class="pipeline-breadcrumb" style="
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: #9890A4;
  letter-spacing: 0.03em;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
">
  <span style="color: #9890A4;">pln</span>
  <span style="color: #C4BCCC;"> → </span>
  <span style="color: #9890A4;">wrk <span style="color: #C4BCCC; font-size: 9px;">×2</span></span>
  <span style="color: #C4BCCC;"> → </span>
  <span style="color: #D97706; font-weight: 700;">RVW <span style="font-size: 9px; font-weight: 500;">×3</span></span>
  <span style="color: #C4BCCC;"> → </span>
  <span style="color: #9890A4;">cmp</span>
</div>
```

**Honest assessment:**

Good: Zero new visual real estate required. The pipeline strip already has height — adding a superscript above segments uses the vertical space that's currently empty. The count is co-located with the stage it describes, so the spatial relationship is clear without explanation. The color rule is already established (amber = active/attention, text-3 = receded).

Trade-off: The pipeline strip is 148px wide with 4–6 segments, meaning each segment is ~20–28px. At that width, `×3` at 8px is readable but tight. With more than 6 stages or very narrow layouts, this degrades. Also: the superscript pushes the pipeline strip down slightly (the column needs ~10px more height to accommodate the mark row), which adds to the feed row height. This needs to be assessed against the overall row density goal. The fix is to only show marks when count exceeds 1, and to cap marks at `×9` (anything beyond that gets `×9+`).

---

## Concept B: Iteration Pulse Dots

**The idea:** Rather than annotating the pipeline strip, this concept adds a compact dot sequence to the detail panel header only — not the feed. The feed stays exactly as it is (the `it.N` in the task-id line is sufficient at-a-glance signal). In the detail panel, just below the breadcrumb, a row of small 5px dots shows the history of each review stage: filled dot for approved, ring dot for rejected. A task that went `rejected → rejected → approved` shows `○ ○ ●` using Unicode circles. The dot sequence is the only place this appears; it's always on in the detail header.

**Where it lives:**
- Feed row: no change. The existing `it.N` label already communicates "this is on its Nth iteration" to anyone looking at the left list or the task-id line.
- Detail header: a single line of dots below the breadcrumb, grouped by stage. Only stages with more than zero iterations show their dot sequence; stages not yet reached show nothing.

**Interaction:** Always-on in the detail header. No hover required, no expand required. On hover of the dot row, a tooltip expands to show the full timeline: `Plan: approved · Work: rejected, approved · Review: rejected ×2, approved`. This tooltip is the only place timestamps would live (optional).

**HTML/CSS snippet:**

```html
<!-- Detail header iteration dot row -->
<div style="
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: #9890A4;
  margin-top: 4px;
">

  <!-- Plan: 1 iteration, approved -->
  <div style="display: flex; align-items: center; gap: 4px;">
    <span style="color: #C4BCCC; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;">pln</span>
    <span style="
      font-size: 11px;
      color: #A0C8B0;
      line-height: 1;
    ">●</span>
  </div>

  <span style="color: #E4DFE9;">·</span>

  <!-- Work: 2 iterations — rejected then approved -->
  <div style="display: flex; align-items: center; gap: 4px;">
    <span style="color: #C4BCCC; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;">wrk</span>
    <!-- rejected -->
    <span style="
      font-size: 11px;
      color: #DC2626;
      line-height: 1;
      opacity: 0.5;
    ">○</span>
    <!-- approved -->
    <span style="
      font-size: 11px;
      color: #A0C8B0;
      line-height: 1;
    ">●</span>
  </div>

  <span style="color: #E4DFE9;">·</span>

  <!-- Review: 3 iterations — rejected, rejected, current (in progress) -->
  <div style="display: flex; align-items: center; gap: 4px;">
    <span style="color: #D97706; font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.06em; font-weight: 600;">rvw</span>
    <!-- rejected -->
    <span style="
      font-size: 11px;
      color: #DC2626;
      line-height: 1;
      opacity: 0.5;
    ">○</span>
    <!-- rejected -->
    <span style="
      font-size: 11px;
      color: #DC2626;
      line-height: 1;
      opacity: 0.5;
    ">○</span>
    <!-- current iteration — amber, pulsing -->
    <span style="
      font-size: 11px;
      color: #D97706;
      line-height: 1;
      animation: pulse-opacity 2.5s ease-in-out infinite;
    ">◐</span>
  </div>

</div>
```

**Honest assessment:**

Good: Dot sequences communicate the outcome pattern, not just a raw count. `○ ○ ●` reads as "struggled then got there." `○ ○ ◐` reads as "struggling, currently on third attempt." This is richer than a bare number and stays compact. The half-filled circle `◐` for the in-progress iteration is a natural extension of the filled/empty logic. Using Unicode shapes means no icon dependency, consistent with Forge's no-icons rule.

Trade-off: This lives only in the detail panel, so the feed row gives no indication of a looping task beyond the existing `it.N` label — which is already there but easy to miss. A user scanning the feed won't immediately notice that a task is on its fifth review cycle; they'd need to open the detail panel. Whether that's acceptable depends on whether the user's workflow is "scan feed, act on what needs attention" (in which case the feed symbol and section placement are sufficient) or "diagnose tasks while scanning" (in which case the feed needs more). For Forge's intent-grouped model, the former is true: if a task needs attention, it's in the Needs Attention section. The user doesn't need to see the loop count to know they need to act.

The second trade-off: with many iterations, the dot sequence gets wide. Eight iterations across two stages would render eight dots plus labels. A cap at 5 dots (with a `+N` overflow indicator) prevents this from growing unbounded.

---

## Concept C: Loop Heat on the Stage Label

**The idea:** The stage label in the feed row (the rightmost part of the pipeline column, currently showing e.g. "Review" in amber) encodes iteration count through typographic weight and an optional count suffix. A first-pass review shows `Review` in normal weight amber. A second pass shows `Review ·2` (middle dot separator, then the count). A third pass: `Review ·3`. The count color and weight escalate with iteration count: counts 2–3 show at `--text-2` weight (neutral, noting information), counts 4+ show at `--amber` weight (calling attention). This uses the stage label's existing real estate, requires no additional layout changes, and matches Forge's existing pattern of putting data in the mono font.

The detail panel header's meta line ("iteration 2 · 2nd attempt") already exists and can carry the stage-specific detail. The feed's label heat is just a glanceable version of the same signal.

**Where it lives:**
- Feed row: the stage label, which already exists at the right end of the pipeline column. No new column, no layout change.
- Detail panel header: the existing meta line already says "iteration 2" — this stays. The stage label in the breadcrumb gets the same count notation: `RVW ·3`.
- Left pane (split view): the `task-row-stage` subtext already reads "review · iter 2" — this is already correct and needs no change.

**Interaction:** Always-on. No hover, no expand. The count is part of the label text and renders wherever the label renders. A stage on its first iteration never shows a count — the label is clean. The count only appears when there's something worth noting.

**HTML/CSS snippet:**

```html
<!-- Pipeline column with loop heat on stage label -->
<div class="pipeline-col" style="
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
">
  <div style="display: flex; gap: 2px; flex: 1;">
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #A0C8B0;"></div>
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #A0C8B0;"></div>
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #D97706;
      animation: seg-pulse 1.8s ease-in-out infinite;"></div>
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #EBE6F0;"></div>
  </div>

  <!--
    Stage label with loop count.
    ·2 shown in text-2 (neutral signal)
    ·4+ would show in amber (elevated attention signal)

    This example: Review on 3rd iteration.
    The middle dot · visually separates the stage name from the count.
    Count is one notch smaller (8px vs 9px) to read as annotation, not equal weight.
  -->
  <span style="
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    color: #D97706;
    min-width: 54px;
    text-align: right;
    line-height: 1;
  ">
    Review<span style="
      color: #9890A4;
      font-size: 8px;
      font-weight: 400;
      letter-spacing: 0;
    "> ·3</span>
  </span>
</div>

<!-- For comparison: a task on iteration 5 (escalated color) -->
<div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
  <div style="display: flex; gap: 2px; flex: 1;">
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #A0C8B0;"></div>
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #A0C8B0;"></div>
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #D97706;
      animation: seg-pulse 1.8s ease-in-out infinite;"></div>
    <div style="flex: 1; height: 4px; border-radius: 2px; background: #EBE6F0;"></div>
  </div>

  <!-- ·5 shows in amber — same color as the stage name, elevated visual weight -->
  <span style="
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    color: #D97706;
    min-width: 54px;
    text-align: right;
    line-height: 1;
  ">
    Review<span style="
      color: #D97706;
      font-size: 8px;
      font-weight: 600;
      letter-spacing: 0;
    "> ·5</span>
  </span>
</div>
```

**Honest assessment:**

Good: This is the lightest touch of the three concepts. It requires no layout changes, no new elements, no additional height in the feed row. The stage label already exists and has room for a two-character suffix. The `·N` notation reads naturally: a middle dot is already used in this design system as a separator (it appears in `task-id` lines), so `·3` extends a pattern that already exists rather than introducing a new symbol. The escalating color for high counts (neutral text-2 at low counts, amber at high counts) means clean tasks stay visually clean while struggling tasks surface their distress.

Trade-off: The count is per-stage for the current stage only — it tells you how many iterations the active stage has gone through, but gives no history of what happened at previous stages. If a task struggled at work and then also struggled at review, the label only shows the current stage's count. The full history requires opening the detail panel. This is the right trade-off for the feed: the feed is for orientation, not diagnosis. The detail panel covers the full history via the existing iteration banner and the `it.N` meta line.

A secondary trade-off: the stage label column is fixed-width (`min-width: 42px` in the current spec). With a count suffix added, this needs to expand to about 54px, which slightly compresses the activity text column. Small but worth flagging.

---

## My Recommendation

**Ship Concept C (Loop Heat) as the feed treatment, and add Concept B's dot sequence to the detail panel header.**

Here is the reasoning.

Concept C solves the feed problem with minimum disruption. It extends the stage label, a component that already exists, by appending a `·N` count that costs one character of width. The visual logic is already established in the design system — the middle dot separator, mono font numbers, escalating amber for attention. A user scanning the feed will see `Review ·4` and immediately understand the task is on its fourth review cycle without needing to look anywhere else. Clean tasks show no count at all, so the feed doesn't accumulate visual noise for normal cases.

Concept B solves the detail panel problem that Concept C leaves unaddressed. When a user opens a task to act on it, the dot sequence in the detail header gives them the full outcome pattern at a glance: which stages were clean, which looped, and what the loop pattern looked like (all rejections, or rejection then approval?). This is richer than a bare number and lives in the right place — the detail panel is where the user is preparing to make a judgment, so the fuller history is relevant there. The dot sequence adds one line to the detail header, which already contains the breadcrumb and the meta line. It fits without restructuring anything.

Concept A (Stage Loop Marks) is the most expressive design — it shows per-stage counts in the feed without compromising the stage label — but it requires adding height to the pipeline segment column to accommodate the superscript row. That layout change is a bigger lift than a label suffix, and the benefit over Concept C is marginal for the feed use case.

The hybrid recommendation in terms of implementation order: Concept C for the feed (small, self-contained, no layout changes), Concept B for the detail panel (adds one line to the header). Both can be built independently and in either order.

One more thing to specify for both: the rule about when counts appear. A stage on its first iteration shows no count. A stage on its second iteration starts showing the count. This keeps clean tasks clean — the majority of tasks sail through without looping, and they should stay visually quiet. The count is opt-in by behavior, not opt-in by user interaction.
