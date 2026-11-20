/**
 * A segment travelling a card's top edge while what it draws is being re-asked.
 *
 * **Out of the flow, on the card's own edge.** A mark in normal flow shifts everything
 * below it by two pixels every poll, which on a fifteen-second interval is a card that
 * twitches. The card supplies `relative` and `overflow-hidden`; this supplies the line.
 *
 * **It keeps its colour while the card around it is toned**, because it is a claim about
 * the fetch rather than about what the card says — on the pull request card the one thing
 * an unconfirmed answer does not withhold, and on the deploy block the one thing that says
 * the script is running again.
 */

import type { ReactNode } from "react"

const Rechecking = (): ReactNode => (
  <div
    aria-hidden
    className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-tone-working-track"
  >
    <div className="h-full w-1/3 animate-travel bg-tone-working" />
  </div>
)

export default Rechecking
