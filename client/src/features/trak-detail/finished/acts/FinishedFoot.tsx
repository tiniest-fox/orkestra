/**
 * The band at the finished pane's bottom edge that holds the press row, and the box above
 * it while one is open.
 *
 * **On the pane's bottom edge always, even under a short card.** The pane's column is at
 * least the scroller's height and `mt-auto` pushes the band to its foot; `sticky` holds it
 * there on a pane that runs past the drawer, so Archive is reachable under any length of
 * card. Where the presses are never depends on how long the card is: a band that sat under
 * the card on a short pane and pinned only on a long one would move them.
 *
 * **A hairline rule, always**: the band is always on the edge, so the rule is always true.
 *
 * **Rung 20**: a band the content passes under, over the card's own rung-10 pinned header.
 * That rank adds a stacking context, so a `fixed` descendant draws at rung 20, not its own:
 * the desk's confirmations float `absolute` above the row and stay inside, and a phone's
 * `ConfirmSheet` covers the screen only because nothing after this band in the drawer
 * outranks it.
 *
 * The negative margin spans the pane's padding so the band's fill reaches both edges; the
 * padding inside restores the content line. It pays the column's bottom padding, which is
 * why the pane has `pt-4` rather than `py-4`.
 */

import type { ReactNode } from "react"

const FinishedFoot = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="sticky bottom-0 z-20 -mx-4 mt-auto border-t border-border bg-canvas px-4 pb-4 pt-3">
    {children}
  </div>
)

export default FinishedFoot
