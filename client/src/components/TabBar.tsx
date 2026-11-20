/**
 * A band of flush segments with a rule above and below — the shape a navigator takes here.
 *
 * **The band owns the hairline between segments; a segment does not.** `[&>*+*]` rather
 * than a `border-l` on each child, because whether a segment is first is a fact about the
 * bar rather than about the segment — and a bar whose parts each carried their own divider
 * grows a wrong edge the first time one is reordered or hidden.
 *
 * **The segments are deliberately unequal.** One of them can be several times the width of
 * its neighbours, which is why `Marker` fixes its own width rather than filling the segment
 * it marks, and why nothing here distributes space: `flex-1` is the wide segment's to ask
 * for.
 *
 * It does not own which segment is lit. That is the caller's state and `Tab` draws it — a
 * bar that decided would have to know what its segments mean.
 */

import type { ReactNode } from "react"

const TabBar = ({
  label,
  children,
}: {
  /** Names the landmark, since nothing visible does. */
  readonly label: string
  readonly children: ReactNode
}): ReactNode => (
  <nav
    aria-label={label}
    /* The touch floor: below the phone breakpoint the segments are the band's height,
       so the band is what has to clear 44px — *inside* its own two hairlines. `h-11`
       alone leaves each segment 42px: border-box height counts the `border-y`, and the
       borders are the band's, not the segments'. Measured by `e2e/phone.spec.ts`. */
    className="flex h-9 shrink-0 items-stretch border-y border-border bg-surface max-sm:h-[calc(--spacing(11)+2px)] [&>*+*]:border-l [&>*+*]:border-border"
  >
    {children}
  </nav>
)

export default TabBar
