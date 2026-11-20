/**
 * What the phone's directive row says about the position on screen, as pure functions.
 */

import { pieceWord } from "../../../../format/pieceWord"
import type { Band, Spot } from "../family"

/**
 * What heads the block: the piece's distinguishing word and the row's title where the spot
 * is a piece's, the row's title — what runs the position — everywhere else.
 *
 * **A piece leads with its word, never the agent alone** — a spawn usually fans one agent
 * across every piece, and four pieces headed `builder` are one name four times. `pieceWord`
 * cuts the word from the piece's own instruction against its siblings'.
 */
export const headOf = (spot: Spot, bands: readonly Band[], parent: string): string => {
  if (spot.trak.id === parent) return spot.row.title
  const band = bands.find((b) => b.columns.some((column) => column.id === spot.trak.id))
  const pieces = (band?.columns ?? []).flatMap((column) => {
    const trak = column.spots[0]?.trak
    return trak === undefined ? [] : [{ id: column.id, instruction: trak.description }]
  })
  const own = pieces.find((p) => p.id === spot.trak.id)
  const word =
    own === undefined
      ? undefined
      : pieceWord(
          own.instruction,
          pieces.flatMap((p) => (p.id === own.id ? [] : [p.instruction])),
        )
  return word === undefined ? spot.row.title : `${word} · ${spot.row.title}`
}
