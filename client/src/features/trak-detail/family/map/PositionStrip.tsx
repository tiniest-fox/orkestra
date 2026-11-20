/**
 * The phone's rail: every position of the plan as marks across the screen, under the
 * surface tabs and on the Agent tab only.
 *
 * **`TrakRail` turned on its side.** The same `walk(bands)` order, the same 24px plates
 * and corner marks (`RailMark`), the same 14px tiles inside a spawn (`StripSpawn`), so
 * pressing a mark and pressing *next* in the directive block land in the same place.
 *
 * **The marks are a way to move and not the way**, which is the desk rail's rule: the
 * arrows in `DirectiveBlock` are the presses that clear the 44px touch floor. A plate's press
 * still reaches the strip's full height (`RailMark`'s `reach`), so it is 32×44 while the
 * plate stays 24; a spawn's 14px tile is left as it is, since two rows of them share the
 * 44px and a taller reach would overlap the row beside it.
 *
 * **It scrolls sideways and opens with the current mark in the middle**, cut at the edges
 * where the plan is longer than the screen — a twelve-position plan is. Labelled
 * *Positions*, like the desk rail it stands in for, and the two are never on screen
 * together.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import type { Band } from "../family"
import RailMark from "./RailMark"
import StripSpawn from "./StripSpawn"

const PositionStrip = ({
  bands,
  at,
  onPick,
}: {
  readonly bands: readonly Band[]
  /** The picked spot's key — `family.ts`'s, so a spawn's piece can be the current one. */
  readonly at: string | undefined
  readonly onPick: (key: string) => void
}): ReactNode => {
  // Brings the current mark to the middle, and follows a pick made elsewhere — an arrow,
  // a map row. Its own node and nothing else, which is what lets a view carry an effect;
  // `scrollLeft` rather than `scrollIntoView`, which would scroll the page as well.
  // Found by `aria-current` for `TrakRail`'s reason: the mark is a plate or a tile.
  const box = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    const mark = node.querySelector('[aria-current="step"]')
    if (!(mark instanceof HTMLElement)) return
    const strip = node.getBoundingClientRect()
    const here = mark.getBoundingClientRect()
    node.scrollLeft += here.left - strip.left - (strip.width - here.width) / 2
  }, [at])

  return (
    <ol
      ref={box}
      aria-label="Positions"
      className="flex h-11 shrink-0 items-center overflow-x-auto border-b border-border bg-surface px-gutter [scrollbar-width:none]"
    >
      {bands.map((band, i) => (
        <li key={band.spot.key} className="flex shrink-0 items-center">
          {/* The desk rail's guide, on its side: a hairline between slots, never through
              a spawn, which is what says its pieces ran at once. */}
          {i > 0 && <span aria-hidden className="h-px w-2 shrink-0 bg-guide" />}
          {band.columns.length === 0 ? (
            <RailMark spot={band.spot} current={band.spot.key === at} onPick={onPick} reach />
          ) : (
            <StripSpawn columns={band.columns} at={at} onPick={onPick} />
          )}
        </li>
      ))}
    </ol>
  )
}

export default PositionStrip
