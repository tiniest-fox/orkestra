/**
 * How long ago this engine last fetched — `2 min ago`, or `not fetched yet`. Never
 * *fetching*: that is said once, in the action cell.
 *
 * **The one piece of the bar that ticks, and the clock is read here rather than in the
 * hook** — `useSecond` redraws whoever reads it every second, and read in `useGitBar` it
 * would redraw the whole traks list with it.
 */

import type { ReactNode } from "react"
import { useSecond } from "../../../hooks/useSecond"
import { ageSaid } from "./gitView"
import type { GitView } from "./gitView"

const GitFetched = ({
  view,
  lead = "",
}: {
  readonly view: GitView
  /** What stands before an age — the card's `fetched`, the Fetch cell's `·`. */
  readonly lead?: string
}): ReactNode => {
  const now = useSecond(view.origin) * 1000
  const said = ageSaid(view, now)
  if (said === undefined) return undefined
  return (
    <span className="shrink-0 font-mono text-2xs font-normal text-fg-subtle">
      {view.fetchedAt === undefined ? said : `${lead}${said}`}
    </span>
  )
}

export default GitFetched
