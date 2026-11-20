/**
 * Whether the document's web fonts are still loading — `"loading"` or `"loaded"`, and a
 * new value each time a load starts or ends.
 *
 * **What reads it: anything that measures its own text once and keeps the number.** The
 * type comes from a stylesheet over the network with `display=swap`, so the first layout
 * can be set in the fallback face and the real one swapped in later with no resize and no
 * rerender. A measurement taken in between is a height for text the screen no longer
 * shows — `Field` held a one-line placeholder at two lines that way, which moved every
 * box below it by 20px and is what the phone spec's low-tap test kept failing on.
 *
 * **No `document.fonts` means `"loaded"`**: happy-dom has none, and nothing there is measured.
 */

import { useSyncExternalStore } from "react"

const fonts = (): FontFaceSet | undefined => ("fonts" in document ? document.fonts : undefined)

const subscribe = (onChange: () => void): (() => void) => {
  const set = fonts()
  if (set === undefined) return () => undefined
  set.addEventListener("loading", onChange)
  set.addEventListener("loadingdone", onChange)
  set.addEventListener("loadingerror", onChange)
  return () => {
    set.removeEventListener("loading", onChange)
    set.removeEventListener("loadingdone", onChange)
    set.removeEventListener("loadingerror", onChange)
  }
}

const snapshot = (): FontFaceSetLoadStatus => fonts()?.status ?? "loaded"

export const useFontsStatus = (): FontFaceSetLoadStatus => useSyncExternalStore(subscribe, snapshot)
