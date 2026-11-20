/**
 * The slot beside the branch: ↑ahead ↓behind with zeros dropped, *up to date*, or the
 * reason a branch can have no counts — `no origin`, `detached`, `not published`.
 */

import type { ReactNode } from "react"
import { ArrowDown, ArrowUp, Check } from "lucide-react"
import type { GitCounts as Counts } from "./gitView"

const GitCounts = ({ counts }: { readonly counts: Counts }): ReactNode => {
  switch (counts._tag) {
    case "None":
      return <span className="shrink-0 font-mono text-2xs text-fg-subtle">{counts.said}</span>
    case "Even":
      return (
        <span className="flex shrink-0 items-center gap-1 font-mono text-2xs text-tone-good">
          <Check size={11} aria-hidden /> up to date
        </span>
      )
    case "Apart":
      return (
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs tabular-nums">
          {counts.ahead > 0 && (
            <span className="flex items-center text-fg" title={`${String(counts.ahead)} to push`}>
              <ArrowUp size={11} aria-hidden />
              {counts.ahead}
            </span>
          )}
          {counts.behind > 0 && (
            <span
              className="flex items-center text-tone-working"
              title={`${String(counts.behind)} to pull`}
            >
              <ArrowDown size={11} aria-hidden />
              {counts.behind}
            </span>
          )}
        </span>
      )
  }
}

export default GitCounts
