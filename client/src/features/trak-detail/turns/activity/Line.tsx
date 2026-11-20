/**
 * One line of the step pane, and everything in it is one: a tool call, a run of them, a
 * failing check, the engine's own notes.
 *
 * **It exists because three rows solved this by hand and three of them were wrong.** They
 * agreed about padding and disagreed about how the lead was centred, which reads as one
 * column that does not line up rather than as three components — so the bug report names
 * the rows and the cause is in none of them.
 *
 * The rule it fixes: **an icon has no text baseline.** A flex row aligned `items-baseline`
 * with an SVG in it falls back to the glyph's bottom margin edge and drops it below the
 * line it belongs to. So the row aligns `items-start`, and the lead is a fixed box that
 * centres its own content — `h-4` because every type step in `styles.css` shares a 16px
 * line-height, which makes the lead exactly one line tall. It therefore sits on the first
 * line whether the content is one line or three, and **no caller can change the column's
 * width** — only what is in it.
 *
 * **The lead is 12 wide with a 4 gutter, because 16 is where the agent's words start.**
 * The text column is not this file's own measurement to take: a turn is prose and rows in
 * one column, and the caret sitting where a bubble's first letter does is what makes the
 * two read as one column rather than two indents. So it is `AgentMessage`'s `px-4` that
 * fixes 16, and this adds up to the same — a caret hanging to the left of the text rather
 * than a step in front of it.
 */

import type { ReactNode } from "react"

const Line = ({
  lead,
  trailing,
  children,
}: {
  /** What goes in the fixed column: a disclosure, a glyph, or nothing. */
  readonly lead?: ReactNode
  /** The right-hand slot: a run's failure count, or a running call's clock. */
  readonly trailing?: ReactNode
  readonly children: ReactNode
}): ReactNode => (
  <span className="flex w-full min-w-0 items-start gap-1 py-0.5 text-left">
    <span
      aria-hidden={lead === undefined}
      className="flex h-4 w-3 shrink-0 items-center justify-center"
    >
      {lead}
    </span>
    <span className="flex min-w-0 flex-1 flex-col">{children}</span>
    {/* Its own gap: the content is `flex-1` and has already pushed this to the far end, so
        the row's own `gap-1` is measuring nothing here. */}
    {trailing === undefined ? undefined : (
      <span className="ml-2 flex h-4 shrink-0 items-center">{trailing}</span>
    )}
  </span>
)

export default Line
