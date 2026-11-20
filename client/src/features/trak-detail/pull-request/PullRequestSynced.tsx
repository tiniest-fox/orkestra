/**
 * When the forge last answered, on one line under the title.
 *
 * **Indented to the title's column rather than the icon's**, so it reads as belonging to
 * the pull request rather than as a second thing beside its state plate.
 *
 * **A clock, and never a static pair of refresh arrows.** This is on a card a reader sees
 * constantly, and refresh arrows sitting still look pressable — a promise nothing here
 * keeps, since no press on this pane writes to or re-asks the forge. The arrows appear only
 * while they are turning, which is the one moment they are describing something.
 */

import type { ReactNode } from "react"
import { Clock, RefreshCw } from "lucide-react"
import type { Synced } from "./pullRequest"

const PullRequestSynced = ({ synced }: { readonly synced: Synced }): ReactNode => {
  const Glyph = synced.turning ? RefreshCw : Clock
  return (
    <p className="flex items-center gap-1.5 pb-3.5 pl-14 pr-4 text-2xs text-fg-subtle">
      <Glyph size={10} aria-hidden className={`shrink-0 ${synced.turning ? "animate-spin" : ""}`} />
      <span className="min-w-0">{synced.text}</span>
    </p>
  )
}

export default PullRequestSynced
