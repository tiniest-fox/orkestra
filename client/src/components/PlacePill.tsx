/**
 * Where a piece of work ran, on the row of the thing that ran: a cloud and the sandbox id
 * in one small pill, and nothing at all for work on the engine's own host.
 *
 * **Only remote work is marked** — local is the ordinary case, and a mark on every row
 * saying so would be noise on all of them. **No word and no runner name on the pill**: the
 * id is what a reader matches across rows, and the runner's own description is one press
 * away, in `PlaceDetail`. A runner that printed no id draws the cloud alone. The pill says
 * nothing about the sandbox's state now, by decision: it records where the work *did* run.
 *
 * **On a desk** a press opens the detail under the pill, right-aligned, and a second press,
 * Escape or a press outside shuts it. **On a phone** it opens as a `Sheet`, and the pill's
 * press is a 44px box centred on it that overhangs the line without moving it —
 * `HookMark`'s shape, which this mirrors.
 *
 * `compact` is the phone's step head under the rail, which has no room for an id:
 * `CloudDisc` inside a 44px press.
 */

import type { KeyboardEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"
import { Cloud } from "lucide-react"
import type { PlaceDto } from "../api/types"
import { usePhone } from "../hooks/usePhone"
import { useTapOutside } from "../hooks/useTapOutside"
import CloudDisc from "./CloudDisc"
import PlaceDetail from "./PlaceDetail"
import Sheet from "./Sheet"

const DETAIL = "Where this ran"

const PlacePill = ({
  place,
  compact = false,
}: {
  /** Absent on a log written before places were recorded, which draws as `Local` does. */
  readonly place: PlaceDto | undefined
  readonly compact?: boolean
}): ReactNode => {
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const shut = useCallback(() => {
    setOpen(false)
  }, [])
  useTapOutside(root, open && !phone, shut)
  if (place?._tag !== "Remote") return undefined
  const label = place.sandbox === undefined ? "Ran in a sandbox" : `Ran in sandbox ${place.sandbox}`
  return (
    <span
      ref={root}
      className="relative inline-flex min-w-0 shrink"
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") shut()
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(!open)
        }}
        className={
          compact
            ? "flex size-11 shrink-0 items-center justify-center"
            : // A grid where there is an id, so the id's column counts nothing toward the
              // pill's min-content: a parent that keeps its child's floor (`GateStrip`)
              // can cut the id to nothing and still draw the cloud and the pill's edge.
              `relative min-w-0 grid-flow-col items-center gap-1 rounded-pill border border-guide px-1.5 py-px font-mono text-2xs leading-4 text-fg-muted hover:bg-hover-bare ${place.sandbox === undefined ? "flex" : "grid grid-cols-[auto_minmax(0,max-content)]"} ${open ? "bg-hover-bare" : ""}`
        }
      >
        {compact ? (
          <CloudDisc label={undefined} />
        ) : (
          <>
            {phone ? (
              <span
                aria-hidden
                className="absolute top-1/2 left-1/2 h-11 w-full min-w-11 -translate-x-1/2 -translate-y-1/2"
              />
            ) : undefined}
            <Cloud size={11} aria-hidden className="shrink-0 opacity-70" />
            {place.sandbox === undefined ? undefined : (
              <span className="min-w-0 truncate">{place.sandbox}</span>
            )}
          </>
        )}
      </button>
      {open && !phone ? (
        <span className="absolute top-full right-0 z-10 pt-1">
          <span
            role="dialog"
            aria-label={DETAIL}
            className="flex w-80 flex-col rounded-surface border border-border bg-surface px-3 py-2 text-left shadow-menu"
          >
            <PlaceDetail place={place} />
          </span>
        </span>
      ) : undefined}
      {open && phone ? (
        <Sheet label={DETAIL} tall={false} onClose={shut}>
          <PlaceDetail place={place} />
        </Sheet>
      ) : undefined}
    </span>
  )
}

export default PlacePill
