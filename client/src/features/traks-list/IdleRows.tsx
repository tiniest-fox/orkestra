/**
 * A pile of idle rows with the `+N more` cut applied (`idleCut`): the rows it keeps, then
 * one line saying how many it hides, an up-down chevron, and one grey tile per hidden
 * group. Pressing it draws the rest in place and leaves a `Show fewer` line under them.
 *
 * The chevron says the press can
 * be undone before it is made. **Whether it is open is local state and forgotten on
 * reload**, for the reason a section's lid is: it is how far a person happens to be
 * reading, not a preference. The hidden tiles are hidden from a screen reader too, so the
 * press is named by its words alone; the rows they stand for are a press away.
 */

import { useState, type ReactNode } from "react"
import { idleCut } from "./idle"
import IdleMore from "./IdleMore"
import IdleRow from "./IdleRow"
import IdleTile from "./IdleTile"
import type { Rungs } from "./pullRung"
import TrakIcon from "./TrakIcon"
import type { TrakRow } from "./tree"

const IdleRows = ({
  rows,
  rungs,
  phone,
}: {
  readonly rows: readonly TrakRow[]
  readonly rungs: Rungs
  /** Cuts after one row below the breakpoint, three above it. */
  readonly phone: boolean
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const cut = idleCut(rows.length, phone)
  const hidden = rows.slice(cut)
  return (
    <>
      {(open ? rows : rows.slice(0, cut)).map((row) => (
        <IdleRow key={row.trak.id} row={row} rungs={rungs} phone={phone} />
      ))}
      {hidden.length > 0 &&
        (open ? (
          <IdleMore expanded onPress={() => setOpen(false)}>
            Show fewer
          </IdleMore>
        ) : (
          <IdleMore expanded={false} onPress={() => setOpen(true)}>
            <span className="shrink-0">+{hidden.length} more</span>
            <span aria-hidden className="flex shrink-0">
              <TrakIcon name="chevronsUpDown" size={12} />
            </span>
            {/* Clipped rather than capped: a long pile runs its tiles to the edge. */}
            <span aria-hidden className="flex min-w-0 items-center gap-1 overflow-hidden">
              {hidden.map((row) => (
                <IdleTile key={row.trak.id} trak={row.trak} rungs={rungs} />
              ))}
            </span>
          </IdleMore>
        ))}
    </>
  )
}

export default IdleRows
