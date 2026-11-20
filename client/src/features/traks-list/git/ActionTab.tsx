/**
 * The dock's git-action tab: the one action's glyph with its badge, which opens the sheet
 * — `actionBadge` says what it shows and why it does not press. A spinner while anything
 * runs, and a muted glyph where there is no action to offer: a cloud struck through with
 * no remote, a broken link on a detached head.
 */

import type { ReactNode } from "react"
import { CloudOff, Loader2, Unlink } from "lucide-react"
import DockTab from "../DockTab"
import { GIT_GLYPH } from "./GitAction"
import { actionBadge, actionLabel } from "./actionBadge"
import type { GitView } from "./gitView"

const SIZE = 20

const ActionTab = ({
  view,
  onClick,
}: {
  readonly view: GitView
  readonly onClick: () => void
}): ReactNode => {
  const { cell } = view
  const Glyph =
    cell._tag === "None"
      ? cell.said === "no origin"
        ? CloudOff
        : Unlink
      : cell.busy
        ? Loader2
        : GIT_GLYPH[cell.action]
  // Level and fetched-or-not, the action is a Fetch nobody is owed: drawn back, as nothing.
  const quiet = cell._tag === "None" || (!cell.busy && cell.ahead === 0 && cell.behind === 0)
  return (
    <DockTab
      label={actionLabel(view)}
      glyph={
        <Glyph
          size={SIZE}
          aria-hidden
          className={cell._tag === "Press" && cell.busy ? "animate-spin text-fg-muted" : ""}
        />
      }
      badge={actionBadge(view)}
      muted={quiet && actionBadge(view) === undefined}
      onClick={onClick}
    />
  )
}

export default ActionTab
