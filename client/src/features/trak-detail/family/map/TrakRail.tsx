/**
 * Every position of the plan, as marks down the drawer's left edge.
 *
 * **What it is for is orientation, not navigation** — though it does both. Reading a
 * transcript, nothing on the screen said whether you were at the second position of six or
 * the last: `StepBar` dropped its counter deliberately (a step's number is the engine's own
 * and 0-based, so *step 0 of 6* read as the zeroth), and the Map answers it only at the cost
 * of leaving the conversation. This is that answer, at rest, on every surface but the map —
 * which draws every one of these positions at full size, so beside it the strip was a
 * second copy. `TrakDetailPage` slides it out there and back on the way off; it stays
 * mounted, and `Rail` carries what that costs.
 *
 * **It draws exactly what the arrows walk.** `walk(bands)` is the navigation order and the
 * rail is one mark per spot in it, so pressing a mark and pressing *next* land in the same
 * place.
 *
 * **The arrows stay, though every position is its own press.** A piece's tile is 14px, so
 * stepping through a spawn by aiming at tiles is harder than pressing an arrow twice. **So
 * the marks are a way to move and not the way**, which is also why nothing here worries
 * about their hit area. A rail that were the only route would have to.
 *
 * **A spawn is `RailSpawn`, and it is the Map's own arrangement at half scale.** Both draw
 * a child as a column and put the columns side by side, so down is one trak's progress and
 * across is two traks at once in either place. They differ in what they can afford: the Map
 * has at least 780px, so it fans every piece abreast and draws the rejoin; the rail has 48, so it
 * takes two at a time and wraps.
 *
 * **That agreement is worth not undoing.** A 48px strip looks too narrow to hold lanes —
 * against a 24px plate it is — but at 14px two columns and a rule come to about 41px and
 * fit, so there is no reason for the two surfaces to draw a spawn differently.
 *
 * **It is labelled *Positions*, and the map is labelled *Plan*.** They hold the same items
 * under the same names, so without two labels a screen reader meets one list twice with no
 * way to tell which is which — and a query for a position becomes ambiguous, which is how
 * this was noticed. The names inside are the same on purpose: it is the same position, and
 * the list it is in is what says whether you are reading the plan or steering by it.
 *
 * **The guide stops at a spawn and picks up after it**, which is the whole of what says
 * *these ran at once*: a continuous line through a parallel block would draw the opposite,
 * and `TrakMap` learned the same thing about its own route. Drawn per slot rather than once
 * down the rail — a single absolute line cannot know that anything branches.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import type { Band } from "../family"
import RailMark from "./RailMark"
import RailSpawn from "./RailSpawn"

const TrakRail = ({
  bands,
  at: picked,
  onPick,
}: {
  readonly bands: readonly Band[]
  /** The picked spot's key — `family.ts`'s, so a spawn's piece can be the current one. */
  readonly at: string | undefined
  readonly onPick: (key: string) => void
}): ReactNode => {
  /**
   * Keep the live position on screen.
   *
   * **Not a nicety — it is what pays for the arrows being gone.** A re-composed plan is
   * longer than the rail is tall, so without this a trak whose current position has
   * scrolled out has no visible way back to it and no `next` to press either.
   *
   * A `useLayoutEffect` in a presentational file, which `client-style`'s table otherwise
   * reads as banned: the same exception `DrawerPane` and `Field` take, and for the same
   * reason. It measures and moves one box, that box is this component's own, and a frame
   * painted before it is a visible jump. Nothing outside the ref is touched.
   *
   * Found by `aria-current` rather than by a ref on the live mark, because the live mark
   * is sometimes a plate this file draws and sometimes a tile `RailSpawn` does — one
   * query answers both, where a ref would have to be threaded through a component that
   * has no other reason to know about it.
   */
  const box = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    box.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest" })
  }, [picked])

  return (
    <ol ref={box} aria-label="Positions" className="flex flex-col items-center">
      {bands.map((band, i) =>
        band.columns.length === 0 ? (
          <li key={band.spot.key} className="relative flex items-center justify-center py-1">
            {/* Behind the plate, so the mark paints over it — `TrakMap`'s device, and the
              reason nothing here is measured against a row's height. Trimmed at the ends
              of a run: a slot next to a spawn is an end of the line even mid-plan. */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 w-px bg-guide"
              style={{
                top: i === 0 || bands[i - 1]?.columns.length !== 0 ? "50%" : 0,
                bottom: i === bands.length - 1 || bands[i + 1]?.columns.length !== 0 ? "50%" : 0,
              }}
            />
            <RailMark spot={band.spot} current={band.spot.key === picked} onPick={onPick} />
          </li>
        ) : (
          <RailSpawn key={band.spot.key} columns={band.columns} at={picked ?? ""} onPick={onPick} />
        ),
      )}
    </ol>
  )
}

export default TrakRail
