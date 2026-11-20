/**
 * A spawn, at rail scale: every child a column of its own steps, two children abreast.
 *
 *     two children, one step each      three children, two steps each
 *
 *       ▪  │  ▪                          ▪  │  ▪
 *                                        ▪  │  ▪
 *                                     ───────────
 *                                        ▪  │
 *                                        ▪  │
 *
 * **A column is one child, always.** That is the whole of it, and it is what the shape
 * before this could not promise: children used to stack with their steps running *across*,
 * so two children of one step and one child of two steps were the same two tiles in the
 * same place, told apart only by a hairline. Here the axes carry the meaning — down is one
 * trak's progress, across is two traks at once — which is the same thing `TrakMap`'s lanes
 * say at full size, and a reader who has learned the map has already learned this.
 *
 * **Two abreast, then wrap.** Two 14px columns and the rule between them come to about
 * 41px, inside the 48px rail — and a spawn of nine wraps to five rows rather than widening
 * anything, so the rail's width still does not move with the piece count.
 *
 * **The rules mean one thing between them.** A vertical rule separates two children abreast;
 * a horizontal one separates a wrapped row from the next. Both say *a different trak* — so
 * neither has to be read against the other, and `--color-guide` carries both because a line
 * that *is* the drawing needs to be seen rather than felt.
 *
 * **The rule after a lone child is deliberate.** A row holding one child still draws its
 * divider, so the grid stays two wide and the columns stay aligned down the whole block.
 * Without it the last row slides to the middle and reads as a different kind of thing.
 *
 * **Ragged, never levelled.** The work rejoins when the slowest piece finishes, so a short
 * column padded to its neighbour's height would say the opposite. The vertical rule takes
 * the row's full height rather than the column's, which is what keeps two ragged columns
 * legible as a pair.
 */

import type { ReactNode } from "react"
import type { Column } from "../family"
import RailTile from "./RailTile"

/** Two children abreast. The rail has room for two 14px columns and a rule, and no more. */
const PER_ROW = 2

const inPairs = (columns: readonly Column[]): readonly (readonly Column[])[] =>
  Array.from({ length: Math.ceil(columns.length / PER_ROW) }, (_, i) =>
    columns.slice(i * PER_ROW, (i + 1) * PER_ROW),
  )

const RailSpawn = ({
  columns,
  at,
  onPick,
}: {
  readonly columns: readonly Column[]
  readonly at: string
  readonly onPick: (key: string) => void
}): ReactNode => (
  <li className="flex flex-col py-1">
    {inPairs(columns).map((pair, r) => (
      // The first child of a wrapped row names it: the columns of one spawn never reorder
      // within a poll, and a child's id is the only stable name any of them has.
      <span key={pair[0]?.id} className="flex flex-col">
        {r > 0 && <span aria-hidden className="my-1 h-px w-full bg-guide" />}

        <span className="flex items-stretch justify-center gap-1.5">
          {/* One cell per slot rather than per child, so a lone child keeps its column and
              the rule after it still lands where every other row's does. */}
          {[pair[0], pair[1]].map((column, c) => (
            <span key={column?.id ?? `empty-${String(c)}`} className="flex items-stretch gap-1.5">
              {c > 0 && <span aria-hidden className="w-px self-stretch bg-guide" />}

              <span className="flex w-3.5 flex-col items-center gap-0.5">
                {column?.spots.map((spot) => (
                  <RailTile key={spot.key} spot={spot} current={spot.key === at} onPick={onPick} />
                ))}
              </span>
            </span>
          ))}
        </span>
      </span>
    ))}
  </li>
)

export default RailSpawn
