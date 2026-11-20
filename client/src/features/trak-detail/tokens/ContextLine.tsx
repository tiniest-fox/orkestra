/**
 * How full the step's context window is, drawn as a 4px line at the foot of the chat bar,
 * and the press that opens what is in it.
 *
 * **The line sits in the bar's bottom padding, as wide as the bar less its padding.** It
 * once replaced the box's bottom border and fought the field for that edge, and then ran
 * as wide as the box, which changed its length whenever a press beside the box came or
 * went. `ChatBar`'s `foot` now places it under the spend row, 4px above the pane's bottom
 * on a desk and above the home indicator's inset on a phone, at a width nothing beside the
 * box moves.
 *
 * **The whole range is drawn as a faint track, and the fill is the squares' ink** below
 * 70%, amber from 70%, red from 90% — `fullness` in `squares.ts`. With no window known
 * only the track is drawn: there is a reading, and nothing to be a percentage of.
 *
 * **The press is taller than the line, and taller again on a phone**, rising up from the
 * bar's bottom. 12px at a desk, so a pointer can find the line, and inside the bar's 16px
 * padding. Below the breakpoint it is 44px — the touch floor — reaching up over the spend
 * row, which has no press of its own. `z-10` keeps it over that row's squares.
 *
 * **The breakdown rises from the line, over the box, and stops 24px short of each end** so
 * it is not the same width as the box it covers. Hover opens it on a mouse, a tap pins it,
 * and a tap elsewhere or Escape lets it go. It carries the reading and the segmented strip
 * at its head, since nothing else on screen says the figure. It stays in this tree, on the
 * rung its wrapper holds (`components/README`). `useTapOutside` carries why a tap
 * elsewhere is a document listener and not a blur, and touch is told from a mouse by the
 * pointer's own type: a tap also raises the enter a mouse would, and would open and toggle
 * shut on one press.
 */

import type { KeyboardEvent, PointerEvent, ReactNode } from "react"
import { useCallback, useId, useRef, useState } from "react"
import TokenBar from "./TokenBar"
import TokenHead from "./TokenHead"
import { fullness, percentOf } from "./squares"
import { segmentsOf, type StepUsage } from "./usage"
import { useTapOutside } from "../../../hooks/useTapOutside"

const isMouse = (event: PointerEvent<HTMLElement>): boolean => event.pointerType === "mouse"

const ContextLine = ({
  reading,
}: {
  readonly reading: NonNullable<StepUsage["context"]>
}): ReactNode => {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const legendId = useId()
  const root = useRef<HTMLDivElement>(null)
  const unpin = useCallback(() => setPinned(false), [])
  useTapOutside(root, pinned, unpin)
  const open = hovering || pinned
  const pct = percentOf(reading.used, reading.ceiling)
  return (
    <div
      ref={root}
      className="absolute inset-x-0 bottom-0 z-10"
      onPointerEnter={(event: PointerEvent<HTMLDivElement>) => {
        if (isMouse(event)) setHovering(true)
      }}
      onPointerLeave={(event: PointerEvent<HTMLDivElement>) => {
        if (isMouse(event)) setHovering(false)
      }}
    >
      <button
        type="button"
        className="absolute inset-x-0 bottom-0 h-3 max-sm:h-11"
        aria-label="What is in the context window"
        aria-expanded={open}
        aria-controls={legendId}
        onClick={() => setPinned((p) => !p)}
        onBlur={() => setPinned(false)}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === "Escape") setPinned(false)
        }}
      >
        <span className="absolute inset-x-0 bottom-1 flex h-1 overflow-hidden rounded-pill bg-fg-subtle/15">
          {pct !== undefined && (
            <span
              className={fullness(pct).bar}
              style={{ width: `${String(Math.min(100, pct))}%` }}
            />
          )}
        </span>
      </button>
      {open && (
        <div
          id={legendId}
          className="absolute inset-x-6 bottom-3.5 flex flex-col gap-1.5 rounded-surface border border-border bg-surface px-3 py-2 shadow-menu"
        >
          <TokenHead used={reading.used} ceiling={reading.ceiling} bare="in context" />
          <TokenBar segments={segmentsOf(reading.held)} ceiling={reading.ceiling} />
        </div>
      )}
    </div>
  )
}

export default ContextLine
