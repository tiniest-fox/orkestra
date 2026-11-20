/**
 * The mark under the live segment of a divided bar.
 *
 * **Short and centred, and the width is a decision rather than a measurement.** A segment
 * bar here is deliberately unequal — the drawer's position segment is several times the
 * width of a tab beside it — so a mark that scaled with its segment would read as a rule
 * across the bar on one and as a tab marker on the other. `w-7` weighs the same on a
 * 400px segment and a 45px one, which is the whole point of fixing it. That holds at bar
 * scale and again at card scale.
 *
 * It is a component rather than four classes because it is drawn by more than one bar and
 * a copied 28px is how two of them drift apart. The parent supplies the positioning
 * context: this is absolutely placed, so whatever holds it must be `relative`.
 */

import type { ReactNode } from "react"

const Marker = (): ReactNode => (
  <span
    aria-hidden
    className="pointer-events-none absolute bottom-0 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-pill bg-accent"
  />
)

export default Marker
