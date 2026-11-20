/**
 * The scannable figure over a bar: what it holds, against its ceiling where one is known.
 *
 * **There are two reasons a ceiling is absent and they do not read alike.** On a step the
 * window is *unknown* — there is one and nothing here knows it — so `bare` says what the
 * figure measures. On the trak bar there is no ceiling at all, and the same words would
 * make the whole spend read as *6.8m in context*, which is false: it is six windows' worth
 * over a day. So the words are the caller's, and the trak passes none.
 */

import type { ReactNode } from "react"
import { tokens } from "./usage"

const TokenHead = ({
  used,
  ceiling,
  bare,
}: {
  /** What the window holds, or what the trak spent. */
  readonly used: number
  readonly ceiling: number | undefined
  /** The words after the figure where there is no ceiling. `undefined` draws none. */
  readonly bare: string | undefined
}): ReactNode => {
  const pct = ceiling === undefined ? undefined : Math.round((used / ceiling) * 100)
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-lg font-medium tabular-nums text-fg">{tokens(used)}</span>
      {ceiling === undefined ? (
        <>{bare !== undefined && <span className="text-2xs text-fg-subtle">{bare}</span>}</>
      ) : (
        <span className="flex shrink-0 items-baseline gap-1">
          <span className="font-mono text-sm tabular-nums text-fg-muted">/ {tokens(ceiling)}</span>
        </span>
      )}
      {pct !== undefined && (
        <span
          className={`font-mono text-sm tabular-nums ${
            pct >= 90 ? "text-tone-bad" : pct >= 70 ? "text-tone-waiting" : "text-fg-muted"
          }`}
        >
          {String(pct)}%
        </span>
      )}
    </span>
  )
}

export default TokenHead
