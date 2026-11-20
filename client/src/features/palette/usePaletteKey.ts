/**
 * ⌘K opens the palette from anywhere in the tab on Apple platforms, and Ctrl+K elsewhere —
 * `paletteChord`, the same answer every hint is drawn from.
 *
 * **`preventDefault` is the half that matters**: the browser owns the chord first —
 * Firefox puts the cursor in its own search bar on it — so a listener that only opened the
 * palette would open it behind the browser's own. A window listener, so it is a hook.
 */

import { useEffect } from "react"
import { paletteChord, setPaletteOpen } from "../../hooks/usePalette"

export const usePaletteKey = (): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const held = paletteChord.meta ? event.metaKey : event.ctrlKey
      if (event.key.toLowerCase() !== "k" || !held) return
      if (event.altKey || event.shiftKey || (paletteChord.meta ? event.ctrlKey : event.metaKey))
        return
      event.preventDefault()
      setPaletteOpen(true)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [])
}
