/**
 * Whether the app is on a phone-sized viewport — the one JS copy of the breakpoint.
 *
 * **The query must agree with `max-sm:` and with the gutter override in `styles.css`**,
 * which carries the shared comment: all three are the same 640px seam, and a component
 * removed by this hook while a `max-sm:` rule still styles it is a layout half-switched.
 *
 * What reads it: the pages, which pass the answer down as a prop. Structural swaps — the
 * rail dropped for the strip across the Agent tab, the surface bar in the step bar's
 * place, the dock under the list — go through this hook so that only one of the two layouts is in the tree; purely cosmetic
 * differences stay in `max-sm:` variants. That split is also what keeps the tier-2 tests
 * honest: no test loads Tailwind's utilities, so a CSS-hidden phone layout would be *visible* to
 * every query in them, twice.
 *
 * **No `matchMedia` means desktop**, deliberately: the page tests are all written against
 * the desktop layout, and happy-dom's 1024px window reads as desktop too. A phone test stubs
 * `window.matchMedia` before rendering.
 */

import { useSyncExternalStore } from "react"

const PHONE = "(max-width: 639.98px)"

const query = (): MediaQueryList | undefined =>
  typeof window.matchMedia === "function" ? window.matchMedia(PHONE) : undefined

const subscribe = (onChange: () => void): (() => void) => {
  const q = query()
  if (q === undefined) return () => undefined
  q.addEventListener("change", onChange)
  return () => {
    q.removeEventListener("change", onChange)
  }
}

const snapshot = (): boolean => query()?.matches ?? false

export const usePhone = (): boolean => useSyncExternalStore(subscribe, snapshot)
