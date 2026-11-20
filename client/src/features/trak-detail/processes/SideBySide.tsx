/**
 * The drawer split in two: the trak in a column of its own, and the side panel taking the
 * rest. **In full view the trak column is gone and the panel takes the whole drawer** —
 * no strip holds the trak's plate, so the process header's Collapse is the one way back.
 *
 * **The trak is kept, not unmounted, while it is hidden** — `hidden` and `inert` take it
 * off the screen and out of the focus order — so a draft in the chat bar, the scroll of
 * its turns and the surface it was on are all where they were when the split comes back.
 */

import type { ReactNode } from "react"

const SideBySide = ({
  trak,
  panel,
  full,
}: {
  readonly trak: ReactNode
  readonly panel: ReactNode
  readonly full: boolean
}): ReactNode => (
  <div className="flex min-h-0 flex-1">
    <div
      hidden={full}
      inert={full}
      className="flex w-agent shrink-0 flex-col border-r border-border bg-surface"
    >
      {trak}
    </div>
    <div className="flex min-w-0 flex-1 flex-col bg-surface">{panel}</div>
  </div>
)

export default SideBySide
