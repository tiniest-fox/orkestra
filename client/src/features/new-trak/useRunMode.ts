/**
 * How much of the next trak this person wants to stand at, and what they picked last
 * time.
 *
 * **A hook rather than page state, because the value outlives the screen.** Somebody
 * who runs their traks unattended says so once, and a picker that reset to the default
 * on every visit would ask them again every time — which is the same question the
 * engine's default already answers.
 *
 * **`localStorage` rather than the engine.** There is no project setting for this and
 * there is not going to be one: the mode is a fact about a trak, fixed when it is
 * created, and *what I picked last time* is a fact about a browser. Sending it to the
 * engine would make one person's habit everybody's default.
 *
 * It is read once, in the initializer, so a value written by another tab does not move
 * a field somebody is looking at. The next New Trak reads it.
 */

import { useState } from "react"
import type { RunModeDto } from "../../api/types"
import { storageKey } from "../../base"
import { MODE_KEY, remembered } from "./runMode"

export interface RunModeChoice {
  readonly mode: RunModeDto
  readonly pick: (mode: RunModeDto) => void
}

export const useRunMode = (): RunModeChoice => {
  const key = storageKey(MODE_KEY, document.baseURI)
  const [mode, setMode] = useState<RunModeDto>(() =>
    remembered(window.localStorage.getItem(key) ?? undefined),
  )
  return {
    mode,
    pick: (next) => {
      setMode(next)
      window.localStorage.setItem(key, next)
    },
  }
}
