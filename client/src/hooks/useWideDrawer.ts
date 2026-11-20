/**
 * Whether a drawer is open wide — the trak with its side panel beside it, which leaves the
 * list only its first 48px. The list reads it to draw that slice as an index rail; the trak
 * page holds it while it draws the wide drawer.
 *
 * **Held by the drawer that is drawn, not by the panel's preference.** The two routes are
 * two features, and the list cannot ask whether the trak page's panel has anything in it
 * or whether the trak page is mounted at all; the page can, so it says so. A count rather
 * than a flag, so a drawer unmounting as the next one mounts cannot leave the list a frame
 * behind.
 *
 * **A layout effect**, so the list's slice redraws in the same frame the drawer widens —
 * a passive effect would paint one frame of section titles cut off at 48px.
 */

import { useLayoutEffect, useSyncExternalStore } from "react"

let holders = 0
const listeners = new Set<() => void>()

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

const set = (by: number): void => {
  holders += by
  for (const listener of listeners) listener()
}

/** `true` while any drawer on screen is wide. */
export const useWideDrawer = (): boolean => useSyncExternalStore(subscribe, () => holders > 0)

/** Hold the list in its rail form for as long as `wide` is true and the caller is mounted. */
export const useHoldWideDrawer = (wide: boolean): void => {
  useLayoutEffect(() => {
    if (!wide) return undefined
    set(1)
    return () => {
      set(-1)
    }
  }, [wide])
}
