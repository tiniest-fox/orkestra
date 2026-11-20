/**
 * One of the four tabs either side of the dock's pill: a glyph alone, the band's whole
 * height, and an equal share of its half, so four of them and the pill fit at 375px
 * whatever the branch is called. The label is spoken and never drawn.
 *
 * **The corner badge is drawn here rather than in `components/`**, because the round
 * chose it for this bar alone: a count, or `!`, in the tone's own ink as a fill. A second
 * caller is what would move it.
 */

import type { ReactNode } from "react"
import { toneSolid } from "../../format/tone"
import type { TabBadge } from "./git/actionBadge"

const DockTab = ({
  label,
  glyph,
  badge,
  muted,
  onClick,
}: {
  readonly label: string
  readonly glyph: ReactNode
  readonly badge: TabBadge | undefined
  /** Nothing here to act on — no remote, nothing declared — so the glyph steps back. */
  readonly muted: boolean
  readonly onClick: () => void
}): ReactNode => (
  <button
    type="button"
    aria-label={label}
    aria-haspopup="dialog"
    onClick={onClick}
    className={`flex h-full min-w-0 flex-1 items-center justify-center ${muted ? "text-fg-subtle" : "text-fg"}`}
  >
    <span className="relative flex items-center justify-center">
      {glyph}
      {badge !== undefined && (
        <span
          aria-hidden
          className={`absolute -top-1.5 left-3 flex h-4 min-w-4 items-center justify-center rounded-pill px-1 font-mono text-xs leading-none font-medium text-accent-ink ${toneSolid[badge.tone]}`}
        >
          {badge.text}
        </span>
      )}
    </span>
  </button>
)

export default DockTab
