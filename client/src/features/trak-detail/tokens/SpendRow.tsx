/**
 * The row under the chat bar's box: everything the step on screen has spent, as a figure
 * and as a row of squares, and how full its context window is at the far end.
 *
 * **The squares are a count, not a bar.** Each is a fixed 6px with a 2px gap and never
 * stretches, the row holds as many as fit, and a full row is 20m wherever it is drawn —
 * `squares.ts` has the arithmetic and why 20m. The unfilled rest of the row is not drawn:
 * an empty well would say a step is expected to fill it. Past a full row the row stays
 * full and an amber `×N` says how many rows' worth.
 *
 * **It measures its own track**, because the count is a function of the width and nothing
 * rerenders this when the drawer narrows. A `ResizeObserver` on the track's node, which is
 * the one subscription a presentational component may hold (`client-style`). The track is
 * `flex-1` from a zero basis, so its width is set by its siblings and never by the squares
 * in it — measuring it cannot feed back into itself.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { FULL_ROW, SQUARE_INK, fitting, fullness, percentOf, squares } from "./squares"
import { type StepUsage, tokens } from "./usage"

const SQUARE = "size-1.5 shrink-0 rounded-tile"

const SpendRow = ({ usage }: { readonly usage: StepUsage }): ReactNode => {
  const track = useRef<HTMLSpanElement>(null)
  // `undefined` until the layout effect has read the track, which is before the first
  // paint — so no frame draws a count taken at a width the row does not have.
  const [fit, setFit] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const node = track.current
    if (node === null) return undefined
    const measure = (): void => setFit(fitting(node.clientWidth))
    measure()
    const watching = new ResizeObserver(measure)
    watching.observe(node)
    return () => watching.disconnect()
  }, [])
  const row = fit === undefined ? undefined : squares(usage.spent, fit)
  const ctx = usage.context
  const pct = ctx === undefined ? undefined : percentOf(ctx.used, ctx.ceiling)
  const share = Math.round(Math.min(1, usage.spent / FULL_ROW) * 100)
  return (
    <div className="flex min-w-0 items-start gap-1.5 pt-2">
      <span className="flex shrink-0 items-baseline gap-1">
        <span className="font-mono text-2xs font-medium tabular-nums text-fg-muted">
          {tokens(usage.spent)}
        </span>
      </span>
      <span
        ref={track}
        role="img"
        aria-label={`${String(share)}% of a full row`}
        className="mt-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      >
        {row !== undefined &&
          Array.from({ length: row.whole }, (_, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- identical squares, positional
            <span key={i} className={`${SQUARE} ${SQUARE_INK}`} />
          ))}
        {row !== undefined && row.part > 0 && (
          <span
            className={`${SQUARE} relative overflow-hidden ring-1 ring-inset ring-fg-subtle/40`}
          >
            <span
              className={`absolute inset-y-0 left-0 ${SQUARE_INK}`}
              style={{ width: `${String(row.part * 100)}%` }}
            />
          </span>
        )}
      </span>
      {row?.times !== undefined && (
        <span className="shrink-0 rounded-pill bg-tone-waiting-bg px-1.5 font-mono text-2xs font-medium tabular-nums text-tone-waiting">
          ×{row.times.toFixed(1)}
        </span>
      )}
      {ctx !== undefined && (
        <span
          className={`flex shrink-0 items-baseline gap-1 font-mono text-2xs tabular-nums ${
            pct === undefined ? "text-fg-subtle" : fullness(pct).ink
          }`}
        >
          {/* No window known: the reading itself, since a percentage of nothing is a claim. */}
          <span>{pct === undefined ? tokens(ctx.used) : `${String(pct)}%`}</span>
          <span className="text-fg-subtle">ctx</span>
        </span>
      )}
    </div>
  )
}

export default SpendRow
