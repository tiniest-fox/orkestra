/**
 * One segmented bar with its legend under it — the shape every surface that draws spend
 * uses. The trak view lays it in its spend section;
 * the chat bar's context line lays it in the popover the line opens.
 *
 * `ceiling` absent means there is nothing to be a percentage of, so the segments fill the
 * bar and no well is drawn: a visible remainder under an unknown maximum would be
 * inventing headroom, which is worse than showing none. With a ceiling the empty part
 * sits in a white well with an inset edge, and the legend gains a *free* row.
 */

import type { ReactNode } from "react"
import TokenLegend, { WELL } from "./TokenLegend"
import { type Segment, tokens } from "./usage"

const Strip = ({
  segments,
  ceiling,
}: {
  readonly segments: readonly Segment[]
  readonly ceiling: number | undefined
}): ReactNode => {
  const used = segments.reduce((n, s) => n + s.n, 0)
  const span = ceiling ?? used
  return (
    <div
      className={`flex h-2.5 w-full min-w-0 overflow-hidden rounded-pill ${
        ceiling === undefined ? "" : WELL
      }`}
    >
      {segments.map((s) => (
        <span
          key={s.name}
          className={s.fill}
          style={{ width: `${String(span === 0 ? 0 : Math.max(0, (s.n / span) * 100))}%` }}
          title={`${s.name} ${tokens(s.n)} tokens`}
        />
      ))}
    </div>
  )
}

const TokenBar = ({
  segments,
  ceiling,
}: {
  readonly segments: readonly Segment[]
  readonly ceiling: number | undefined
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Strip segments={segments} ceiling={ceiling} />
    <TokenLegend segments={segments} ceiling={ceiling} />
  </div>
)

export default TokenBar
