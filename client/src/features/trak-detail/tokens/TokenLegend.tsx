/**
 * The rows under a bar, one per segment: the swatch, the name and the bare figure — the
 * unit is the head's, and `Tokens` says why it is drawn there alone. With a ceiling the
 * list gains a *free* row, the well's swatch beside it.
 */

import type { ReactNode } from "react"
import { type Segment, tokens } from "./usage"

/** The well the empty part of a bar sits in, and the swatch the legend gives it. */
export const WELL = "bg-surface ring-1 ring-inset ring-border"

const Figure = ({ n }: { readonly n: number }): ReactNode => (
  <span className="font-mono text-2xs tabular-nums text-fg">{tokens(n)}</span>
)

const TokenLegend = ({
  segments,
  ceiling,
}: {
  readonly segments: readonly Segment[]
  readonly ceiling: number | undefined
}): ReactNode => {
  const used = segments.reduce((n, s) => n + s.n, 0)
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {segments.map((s) => (
        <li key={s.name} className="flex min-w-0 items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-control ${s.fill}`} aria-hidden />
          <span className="text-2xs text-fg-muted">{s.name}</span>
          <Figure n={s.n} />
        </li>
      ))}
      {ceiling !== undefined && (
        <li className="flex min-w-0 items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-control ${WELL}`} aria-hidden />
          <span className="text-2xs text-fg-muted">free</span>
          <Figure n={Math.max(0, ceiling - used)} />
        </li>
      )}
    </ul>
  )
}

export default TokenLegend
