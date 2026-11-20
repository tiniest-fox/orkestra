/**
 * Whether the next trak merges its own pull request, opening on what this person picked
 * last time — kept the way `useRunMode` keeps the mode, and for its reasons: a habit is
 * a fact about a browser, not a project setting, and it is read once so another tab
 * does not move a switch somebody is looking at.
 *
 * Only the string `"true"` is on. Anything else — nothing stored, a value nobody
 * validates — is *nothing was chosen*, which is off: a trak that merges unread is never
 * one somebody got by accident.
 */

import { useState } from "react"
import { storageKey } from "../../base"

/** Where the last choice is kept, beside the mode's. */
const AUTO_MERGE_KEY = "orkestra.auto-merge"

export interface AutoMergeChoice {
  readonly on: boolean
  readonly pick: (on: boolean) => void
}

export const useAutoMerge = (): AutoMergeChoice => {
  const key = storageKey(AUTO_MERGE_KEY, document.baseURI)
  const [on, setOn] = useState(() => window.localStorage.getItem(key) === "true")
  return {
    on,
    pick: (next) => {
      setOn(next)
      window.localStorage.setItem(key, String(next))
    },
  }
}
