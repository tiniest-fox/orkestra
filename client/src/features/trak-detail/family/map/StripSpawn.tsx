/**
 * A spawn, at strip scale: `RailSpawn` turned on its side. Every piece is a row of its own
 * 14px tiles, two pieces stacked in the slot, and further pieces wrap to the right behind a
 * rule.
 *
 *     two pieces              four pieces
 *
 *       ▪ ▪                     ▪ ▪  │  ▪
 *       ▪                       ▪    │  ▪ ▪
 *
 * **Across is one trak's progress and down is two traks at once** — the desk rail's axes
 * rotated with the rail, so the strip and the map still read a spawn the same way. Two
 * rows and the gap come to 32px, inside the strip's 44.
 */

import type { ReactNode } from "react"
import type { Column } from "../family"
import RailTile from "./RailTile"

/** Two pieces stacked. The strip has room for two 14px rows, and no more. */
const PER_SLOT = 2

const inSlots = (columns: readonly Column[]): readonly (readonly Column[])[] =>
  Array.from({ length: Math.ceil(columns.length / PER_SLOT) }, (_, i) =>
    columns.slice(i * PER_SLOT, (i + 1) * PER_SLOT),
  )

const StripSpawn = ({
  columns,
  at,
  onPick,
}: {
  readonly columns: readonly Column[]
  readonly at: string | undefined
  readonly onPick: (key: string) => void
}): ReactNode => (
  <span className="flex shrink-0 items-center gap-1.5">
    {inSlots(columns).map((slot, s) => (
      // The first piece of a slot names it, for `RailSpawn`'s reason: the pieces of one
      // spawn never reorder within a poll, and a piece's id is the only stable name.
      <span key={slot[0]?.id} className="flex items-center gap-1.5">
        {s > 0 && <span aria-hidden className="w-px self-stretch bg-guide" />}
        <span className="flex flex-col gap-1">
          {slot.map((column) => (
            <span key={column.id} className="flex items-center gap-1">
              {column.spots.map((spot) => (
                <RailTile key={spot.key} spot={spot} current={spot.key === at} onPick={onPick} />
              ))}
            </span>
          ))}
        </span>
      </span>
    ))}
  </span>
)

export default StripSpawn
