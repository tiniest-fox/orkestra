/**
 * Whether the ⌘K palette is open — one flag for the tab, held outside React.
 *
 * **A module store rather than state in a component**, because the two things that open
 * it are in different trees: the top bar's door is the chrome's, which may hold no data
 * hook and draws nothing of a trak, and the palette is the traks list's, which holds every
 * query it searches. Both read this, so the door opens what the list draws without either
 * knowing the other.
 *
 * Kind `hook`: no JSX, and nothing fetched — the flag is the whole of it.
 */

import { useSyncExternalStore } from "react"
import { paletteChordOn, type PaletteChord } from "../format/paletteChord"

/** This tab's chord — read once, since the platform does not change under a page. */
export const paletteChord: PaletteChord = paletteChordOn(navigator.platform)

let open = false
const listeners = new Set<() => void>()

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

const snapshot = (): boolean => open

/** Open or shut it, from anywhere in the tab. */
export const setPaletteOpen = (next: boolean): void => {
  if (next === open) return
  open = next
  for (const listener of listeners) listener()
}

export const usePalette = (): boolean => useSyncExternalStore(subscribe, snapshot)
