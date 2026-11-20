/**
 * The pieces a spawn has out, abreast under the row that spawned them.
 *
 * The same drawing the map makes of a spawn, on the other surface: columns side by side
 * say the pieces are running at once, where a stack of rows says one after another. It
 * is the whole argument for the treatment, so a reader who has opened a trak has
 * already learned the list and the other way round.
 *
 * **On the canvas, no box and no bracket.** The inset past the gutter is what says the
 * band belongs to the row above it; the split-and-rejoin bracket was drawn, looked at
 * and turned off for the list, where a wide band leaves a long straight rule between
 * the ticks and reads as a rule rather than a fan.
 *
 * **Row gap, not gap.** Wrapped, two pieces end up in the same column with the gap
 * between them, so reading down a column gives the tail of one piece and the head of
 * another with nothing saying they are unrelated. The horizontal gap stays tight
 * because adjacent columns *are* related.
 *
 * **The band reflows as pieces land**: the columns share the width of what is still
 * out, so four become three become two and each survivor widens. Spanning the full
 * original count and leaving landed slots empty is a different design.
 *
 * **Stacked while a drawer is open.** The drawer is `fixed` over the right of the list
 * and the list keeps its full width under it, so three columns abreast put the
 * rightmost one or two behind the drawer — exactly the pieces a person opened the
 * drawer to watch. One piece per row keeps every one in the strip still showing. The
 * page decides it, because only the page knows what is open over the list.
 */

import type { ReactNode } from "react"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import BandPiece from "./BandPiece"
import type { Rungs } from "./pullRung"

/**
 * Columns before it wraps. Eight is the case that decides it, and it is a real one now
 * that a band holds a spawn's live pieces whatever section each is in: at five, eight
 * wraps 5 + 3 and the second band reads as a different, narrower thing. At four it is
 * 4 + 4, two even bands, for the same height.
 */
const WRAP = 4

const TrakBand = ({
  pieces,
  of,
  parent,
  rungs,
  agents,
  stacked,
}: {
  /** The library, for the mark a piece mid-turn wears — `TrakMark`. */
  readonly agents: readonly AgentDto[]
  readonly pieces: readonly TrakSummaryDto[]
  /** The parent's name. The band's own name, and the only thing that says out loud
   *  what these columns are to the row above them — nothing on screen has to, because
   *  the inset does it, and nothing read aloud gets that. */
  readonly of: string
  /** The parent's id, which is where a piece's link goes — `BandPiece` carries why. */
  readonly parent: string
  /** The whole page's, looked up per piece: a piece that has finished has a branch and a
   *  pull request of its own, and reads exactly as a row would. */
  readonly rungs: Rungs
  /** One piece per row rather than abreast — while a drawer covers the right of the list. */
  readonly stacked: boolean
}): ReactNode => (
  // `pl-8` inside the gutter is the 32px inset; `gridTemplateColumns` is geometry a
  // utility cannot carry, since the count is only known at render.
  <div className="px-gutter pb-2">
    <ul
      aria-label={`Pieces of ${of}`}
      className="grid gap-x-1 gap-y-5 pl-8"
      style={{
        gridTemplateColumns: `repeat(${String(stacked ? 1 : Math.min(pieces.length, WRAP))}, minmax(0, 1fr))`,
      }}
    >
      {pieces.map((trak) => (
        <BandPiece
          key={trak.id}
          trak={trak}
          parent={parent}
          rung={rungs.get(trak.id)}
          agents={agents}
        />
      ))}
    </ul>
  </div>
)

export default TrakBand
