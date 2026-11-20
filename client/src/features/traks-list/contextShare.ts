/**
 * How full a row's context window is, for the ring at the far right of the row.
 *
 * **The engine has already chosen the reading.** `TrakSummaryDto.context` is the reading
 * at the position the trak stands at — the turn in flight's while one runs, the last
 * ending's there otherwise — and is absent on a trak that has ended and at a position
 * nothing has read yet, so a merged trak wears no ring and a step that has just started
 * wears none for the step before it. This asks nothing of the state: which position
 * counts is the engine's rule, and a second copy here would drift.
 *
 * **A fraction of the window, and nothing scaled against other rows.** The window is the
 * one the engine resolved — the provider's, else `models.yaml`'s — and with none there is
 * no fraction to draw: a ring against a guessed window would be a claim about headroom.
 *
 * Kind `pure`.
 */

import type { TrakSummaryDto } from "../../api/types"

/** `used / window` for the row's reading — past 1 where a reading exceeds the window — or `undefined` where no ring is drawn. */
export const contextShare = (trak: TrakSummaryDto): number | undefined => {
  const reading = trak.context
  if (reading?.window === undefined || reading.window <= 0) return undefined
  const { held } = reading
  const used = held.inputTokens + held.cacheReadTokens + held.cacheWriteTokens + held.outputTokens
  return used / reading.window
}
