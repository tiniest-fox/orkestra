/**
 * The wall clock to the second, ticking — the one store every clock in the app reads,
 * whether it counts down to a wait's next ask, up from a call still running, or the git
 * bar's age of the last fetch.
 *
 * **A store, not a `setInterval` in a component.** The presentational kind may not hold
 * a timer, and `client-style`'s ban on hand-rolled intervals is about a poll outliving its
 * subscriber — which `useSyncExternalStore` answers the same way TanStack does: the
 * interval runs exactly while something is subscribed, and a row that unmounts takes it
 * with it. Nothing is fetched on the tick.
 *
 * **The snapshot is the second, not the millisecond.** `useSyncExternalStore` re-renders on
 * a snapshot that changed, so a millisecond clock would re-render every subscriber on every
 * call — and it is cached in a module variable rather than read off `Date.now()` in the
 * getter, because React reads the getter twice per render and warns when the two differ.
 *
 * `active` false subscribes to nothing, so a caller with no clock to draw starts no
 * interval; what it reads back is then the second the store last held.
 */

import { useSyncExternalStore } from "react"

const second = (): number => Math.floor(Date.now() / 1000)

let tick = second()

const subscribe = (onChange: () => void): (() => void) => {
  tick = second()
  const id = setInterval(() => {
    tick = second()
    onChange()
  }, 1000)
  return () => {
    clearInterval(id)
  }
}

const idle = (): (() => void) => () => undefined

const snapshot = (): number => tick

/** Epoch seconds, redrawn every second while `active`. */
export const useSecond = (active: boolean): number =>
  useSyncExternalStore(active ? subscribe : idle, snapshot)
