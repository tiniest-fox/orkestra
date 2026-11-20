/**
 * The spawn band lying down: the pieces a spawn has out, as one horizontal row of cards
 * under the parent's row — the phone's answer to `TrakBand`, whose grid grows a row per
 * four pieces where this stays one row high at two pieces or seven.
 *
 * **A failed piece is ordered first.** The cards carry no state words — only the plate
 * says how a piece is going — and the ordering is what makes that safe: the piece that
 * needs a person is at the page gutter rather than three cards into the scroll.
 *
 * Masked at the right edge, `Rail`'s device turned sideways: the fade is on the scroll
 * container itself so it cannot scroll away with the content, and the trailing padding
 * is what lets the last card clear the fade at the end of the scroll.
 *
 * The distinguishing word is computed here rather than in the card, because it is a
 * comparison — `pieceWord` needs every sibling's instruction, and only the band holds
 * the set.
 */

import type { ReactNode } from "react"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import { pieceWord } from "../../format/pieceWord"
import type { Rungs } from "./pullRung"
import StripPiece from "./StripPiece"

const TrakStrip = ({
  pieces,
  of,
  parent,
  rungs,
  agents,
}: {
  readonly pieces: readonly TrakSummaryDto[]
  /** The parent's name — the band's accessible name, as on `TrakBand`. */
  readonly of: string
  /** The parent's id, which is where a piece's link goes. */
  readonly parent: string
  /** The whole page's, looked up per piece. */
  readonly rungs: Rungs
  /** The library, for the mark a piece mid-turn wears. */
  readonly agents: readonly AgentDto[]
}): ReactNode => {
  // Stable, so two failed pieces keep the order the spawn gave them.
  const ordered = [...pieces].sort(
    (a, b) => Number(b.state._tag === "Failed") - Number(a.state._tag === "Failed"),
  )

  return (
    <ul
      aria-label={`Pieces of ${of}`}
      className="flex gap-2 overflow-x-auto pb-2 pl-gutter pr-8"
      style={{ maskImage: "linear-gradient(to right, #000 calc(100% - 24px), transparent)" }}
    >
      {ordered.map((trak) => (
        <StripPiece
          key={trak.id}
          trak={trak}
          parent={parent}
          word={pieceWord(
            trak.description,
            pieces.flatMap((p) => (p.id === trak.id ? [] : [p.description])),
          )}
          rung={rungs.get(trak.id)}
          agents={agents}
        />
      ))}
    </ul>
  )
}

export default TrakStrip
