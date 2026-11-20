/**
 * A press anywhere outside `root`, while `active` — the dismissal a panel pinned by a
 * tap needs and cannot raise for itself.
 *
 * On a blur, which is where dismissal usually lives, iOS Safari is the case: a tapped
 * `<button>` never takes focus there, so a tap elsewhere raises no blur and a legend
 * pinned by one tap stays open over the turns. `pointerdown` on the document is what
 * every tap raises, whichever element it lands on. A document listener is a hook's
 * business rather than a component's (`client-style`), and it is registered only while
 * there is something to dismiss, so an idle bar costs the document nothing.
 */

import type { RefObject } from "react"
import { useEffect } from "react"

export const useTapOutside = (
  root: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
): void => {
  useEffect(() => {
    if (!active) return undefined
    const pressed = (event: PointerEvent): void => {
      const inside = event.target instanceof Node && root.current?.contains(event.target) === true
      if (!inside) onOutside()
    }
    document.addEventListener("pointerdown", pressed)
    return () => document.removeEventListener("pointerdown", pressed)
  }, [root, active, onOutside])
}
