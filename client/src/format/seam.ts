/**
 * A trak's action at the seam in words: what the engine is doing at the boundary with
 * where the work runs, and how that is going — the phrase a row's aside takes, and the
 * line on the trak's own screen.
 *
 * **The action's name is the engine's grammar, not this project's.** `stop` is the one
 * action crossing the seam today; any other is drawn by its own name rather than guessed
 * at, so an action the engine adds later reads plainly before it gets words of its own.
 *
 * In `format/` because both features say it: the list's row and the trak's screen.
 */

import type { SeamStatusDto } from "../api/types"

export interface SeamWords {
  /** What the engine is doing, in a phrase. */
  readonly label: string
  /** How it is going — the clause after the label, and a row's whole aside. */
  readonly line: string
}

const actionWords = (action: string): string =>
  action === "stop" ? "Stopping the turn" : `Sandbox action: ${action}`

const progressWords = (seam: SeamStatusDto): string => {
  switch (seam.phase) {
    case "readying":
      return "checking the sandbox"
    case "crossing":
      return seam.attempt > 1
        ? `reaching into the sandbox, try ${String(seam.attempt)}`
        : "reaching into the sandbox"
    case "waiting":
      return seam.lastError?.kind === "unreachable"
        ? "sandbox provider unreachable, trying again"
        : "sandbox unreachable, trying again"
  }
}

export const seamWords = (seam: SeamStatusDto): SeamWords => ({
  label: actionWords(seam.action),
  line: progressWords(seam),
})
