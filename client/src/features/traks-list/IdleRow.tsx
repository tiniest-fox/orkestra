/**
 * A group nobody has touched in days, as one line at the foot of its section: a grey
 * tile in the marks' column, the title at 0.6, one grey tile per piece still out, the age,
 * and the way in.
 *
 *     ▫  Port every /api route to the Effect router      ▫▫▫▫▫▫▫▫  16d  ›
 *
 * One row for a trak, a strip of glyphs for a group, and the same line for the 48px
 * rail. **No state word**: the section already
 * names the pile, and the tile keeps the state glyph's shape with its colour drained. **No
 * press either**: an idle row is a way into the trak and nothing else, and whatever press
 * is made there is what wakes it.
 *
 * **The tile sits in the column a full row's plate does**, `px-gutter` and 24px wide, so
 * beside a wide drawer the rail's marks stay one vertical line and opening the drawer
 * moves nothing. The piece tiles sit right of the title and are behind the drawer there.
 *
 * **Every tile is grey, so a piece's state is its glyph's shape alone.** The person chose
 * that with the cost in view: in a small group a gate's glyph is hard to tell from a
 * failed check's.
 *
 * **28px on a desk with no vertical padding, 44px below the breakpoint**, and no hairline
 * between two idle rows. The phone keeps the
 * touch floor because the whole row is the press. `data-idle` is what `TrakSections`'
 * dividers read, so the rule under the live rows is drawn and none between idle ones.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { activeOf, idleAge } from "./idle"
import IdleTile from "./IdleTile"
import type { Rungs } from "./pullRung"
import TrakIcon from "./TrakIcon"
import type { TrakRow } from "./tree"

const IdleRow = ({
  row,
  rungs,
  phone,
}: {
  readonly row: TrakRow
  readonly rungs: Rungs
  /** Below the breakpoint the chevron always shows; on a desk it is the hover's. */
  readonly phone: boolean
}): ReactNode => {
  const { trak, band } = row
  const name = trak.title ?? trak.description
  const age = idleAge(activeOf(row), Date.now())
  return (
    <li data-idle>
      <div className="group relative flex min-h-11 items-center gap-4 px-gutter transition-colors hover:bg-hover-row sm:min-h-7">
        <span className="flex w-6 shrink-0 justify-center">
          <IdleTile trak={trak} rungs={rungs} />
        </span>
        <Link
          to="/traks/$id"
          params={{ id: trak.id }}
          className="min-w-0 flex-1 truncate text-sm text-fg opacity-60 after:absolute after:inset-0"
        >
          {name}
        </Link>
        {band.length > 0 && (
          <span
            role="group"
            aria-label={`Pieces of ${name}`}
            className="flex shrink-0 items-center gap-1"
          >
            {band.map((piece) => (
              <IdleTile key={piece.id} trak={piece} rungs={rungs} />
            ))}
          </span>
        )}
        {age !== undefined && (
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">{age}</span>
        )}
        <span
          className={`flex text-fg-subtle ${phone ? "" : "opacity-0 transition-opacity group-hover:opacity-100"}`}
        >
          <TrakIcon name="chevronRight" size={13} />
        </span>
      </div>
    </li>
  )
}

export default IdleRow
