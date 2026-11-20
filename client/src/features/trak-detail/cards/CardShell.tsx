/**
 * The box the pane's cards take: an edge on the surface, a header row, a band and a body.
 *
 * **Four cards drew this four times.** A proposal, a filed artifact, a stuck account and a
 * set of questions differ in what they *say* and agreed on every measurement — the radius,
 * the hairline, the mono header at `2xs`, the `p-3` body. Four copies of an appearance is
 * how a system grows a surface it cannot name, and the header is where that cost lands: a
 * gate's presses sit at the right of that row, and a slot three of four cards happen to
 * have is a slot nothing can rely on.
 *
 * **`actions` is that slot, and what goes in it is the gate's business**, for a
 * correctness reason: there is no fixed pair. The approval gate accepts
 * `Approve` and refuses `Skip`; the two that accept `Skip` refuse `Approve`. A card
 * drawing its own buttons would offer a press `decide` settles as `Failed{engine}` — a
 * wrong verdict rather than a refusal. So this component knows nothing about what it is
 * holding, and a card with no gate passes nothing.
 *
 * **In the feature, not `components/`.** `client-style` moves a thing to the design
 * system on its *second feature*, and this has one. `components/README.md` names
 * `Region · Recess · Raised` for the panels here; whichever of those this turns out to be
 * is a decision for whoever draws them, not a name to claim in advance.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

/** How the header reads. Not `Tone` — this is a header treatment, not a status. */
export type CardTone = "neutral" | "bad" | "waiting"

/* Whole literal class names. An assembled one emits no CSS at all — see `Button`. */
const GLYPH: Record<CardTone, string> = {
  neutral: "text-fg-subtle",
  bad: "text-tone-bad",
  waiting: "text-tone-waiting",
}

/**
 * The label follows the glyph only when the card *is* the bad news. A question is drawn
 * `waiting` and still reads in the ordinary ink, because the tone is about the glyph
 * rather than about the words — the same split `EmptyState` makes.
 */
const LABEL: Record<CardTone, string> = {
  neutral: "text-fg-subtle",
  bad: "text-tone-bad",
  waiting: "text-fg-subtle",
}

const CardShell = ({
  head,
  icon: Icon,
  tone = "neutral",
  open,
  onToggle,
  summary,
  actions,
  band,
  children,
}: {
  /** The header's label, in mono caps. What this card is, in three or four words. */
  readonly head: string
  /** The leading glyph. A `lucide-react` component, not a name. */
  readonly icon?: LucideIcon
  readonly tone?: CardTone
  /**
   * Whether the card is open, when it folds at all. Passing `onToggle` is what makes the
   * header pressable; passing neither leaves it as text, which is what three of the four
   * cards want — nothing folds a gate you are standing at.
   */
  readonly open?: boolean
  readonly onToggle?: () => void
  /** What the header says in place of the body while folded. */
  readonly summary?: ReactNode
  /**
   * The gate's presses, at the right of the header row. `undefined` draws no slot at all
   * rather than an empty one, so a card with nothing to press keeps its header's measure.
   */
  readonly actions?: ReactNode
  /**
   * A full-bleed strip between the header row and the body, drawn whether or not the card
   * is folded — the standing fact about how this document was taken, where `actions` is
   * what is being asked about it now.
   *
   * Outside the body's padding on purpose: it is a band across the card rather than a
   * first section of it, which is what stops it reading as something the agent wrote.
   * Like `actions`, this component does not know what it is holding.
   */
  readonly band?: ReactNode
  /** The body. `undefined` draws no body — which is how a folded card collapses. */
  readonly children?: ReactNode
}): ReactNode => {
  const label = (
    <>
      {Icon === undefined ? undefined : <Icon size={12} className={`shrink-0 ${GLYPH[tone]}`} />}
      {/* The head gives way to the presses and to nothing else. A proposal's head counts
          what approving buys — steps, pieces, runs, waits — and on a phone that count is
          longer than the room beside Approve and Recompose; a head that kept its
          measure put the presses on top of it. Cut at its end, so what is lost is the
          last number and never the press. A folded card's summary is the other thing on
          this row, and it takes only what the head leaves: `flex-1` starts it at zero
          width, so a long summary is cut and the head beside it — `Never answered`, the
          one fact a folded question card gives — stays whole. */}
      <span
        className={`min-w-0 truncate font-mono text-2xs uppercase tracking-wider ${LABEL[tone]}`}
      >
        {head}
      </span>
      {summary === undefined ? undefined : (
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{summary}</span>
      )}
    </>
  )

  return (
    <section className="flex min-w-0 flex-col rounded-surface border border-border bg-surface">
      {/* **The header sticks to the top of the pane it scrolls in**, because the gate's press
          is in this row and the pane lands at its bottom. A document that draws every
          section open is taller than the pane, so landing at the end put Approve above
          the viewport — 61px at a desk, 520px on a phone. Sticky keeps one press in one
          place while the document scrolls under it, and it is pinned inside the card's
          own box, so the header of a finished card leaves with the card. `bg-surface`
          and the rounded top are what stop the body showing through as it passes. */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-surface border-b border-border bg-surface px-3 py-2">
        {/* `flex-1` on the label's side: it takes what the presses leave rather than a
            share of the row, so when the two cannot both fit it is the head that is cut,
            and the presses only give way once they alone are wider than the card. */}
        {onToggle === undefined ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">{label}</span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-control text-left"
          >
            {open === true ? (
              <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-fg-subtle" />
            )}
            {label}
          </button>
        )}

        {/* `min-w-0` rather than `shrink-0`: what a gate puts here is a button and
            sometimes a sentence saying why the last press did not land, and the sentence
            is the one that has to give way. */}
        {actions === undefined ? undefined : (
          <span className="flex min-w-0 items-center justify-end gap-2">{actions}</span>
        )}
      </div>

      {band}

      {children === undefined ? undefined : (
        <div className="flex min-w-0 flex-col gap-3 p-3">{children}</div>
      )}
    </section>
  )
}

export default CardShell
