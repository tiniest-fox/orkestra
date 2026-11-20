/**
 * The file a change map's Open in Changes asked the Changes tab for, held until the tab
 * has opened on it.
 *
 * **Held by the page, read by the list.** The press is on the step and the jump is on the
 * tab, which does not exist yet when the press lands, so the path has to wait somewhere
 * both can reach. The list says when it has used it, and any other way of leaving the step
 * drops it, so a later visit to the tab opens where the reader left it rather than
 * jumping again.
 */

import { useState } from "react"

export interface Landing {
  readonly path: string | undefined
  /** Picks the slice, holds the path, and shows the tab. */
  readonly land: (at: string, path: string) => void
  /** The list has opened on it, or the reader went somewhere else. */
  readonly drop: () => void
}

export const useLanding = (pick: (at: string) => void, show: () => void): Landing => {
  const [path, setPath] = useState<string | undefined>(undefined)
  return {
    path,
    land: (at, to) => {
      pick(at)
      setPath(to)
      show()
    },
    drop: () => {
      setPath(undefined)
    },
  }
}
