/**
 * The row under the phone's strip: the arrows that step through the plan, and between them
 * the position on screen — its mark and what the composer told it — on one 44px line.
 *
 * **The arrows are the main way to move on a phone**, as they are on the desk: the strip's
 * marks are a shortcut too small to aim at, and the arrows are `Button`s, which clear the
 * touch floor below the breakpoint. They take `StepBar`'s names, so a position is stepped
 * to by the same words at both widths.
 *
 * **One line, because the chrome above the pane stays pinned** and every pixel of it is a
 * pixel the pane does not get. **The line is the instruction**, truncated, and the step's
 * name is behind the press: pressing the line opens the name and the whole instruction
 * under it. A position with no instruction shows its name on the line instead.
 *
 * **No state in words.** The mark's tone and its ring on the strip carry it, and the pane
 * says it again. **It names only the current position**: another piece running is the
 * strip's to show, in its tiles, and so is a count of background jobs, in its corner numeral.
 *
 * The page keys this row to the position, so stepping closes what a press opened.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Button from "../../../../components/Button"
import PlacePill from "../../../../components/PlacePill"
import { toneInk } from "../../../../format/tone"
import type { Band, Spot } from "../family"
import { placeOfTurn } from "../../turns/turns"
import { headOf } from "./directive"

/** One of the pair, disabled at the end of the plan it points past. */
const Arrow = ({
  dir,
  to,
  onStep,
}: {
  readonly dir: "prev" | "next"
  readonly to: string | undefined
  readonly onStep: (to: string) => void
}): ReactNode => (
  <Button
    variant="ghost"
    size="sm"
    icon={dir === "prev" ? ChevronLeft : ChevronRight}
    aria-label={dir === "prev" ? "Previous step" : "Next step"}
    disabled={to === undefined}
    onClick={() => {
      if (to !== undefined) onStep(to)
    }}
  />
)

const DirectiveBlock = ({
  bands,
  parent,
  spot,
  prev,
  next,
  onStep,
}: {
  readonly bands: readonly Band[]
  /** The trak the page is of, by id — what tells its own rows from its pieces'. */
  readonly parent: string
  readonly spot: Spot | undefined
  /** The positions either side, `undefined` at the ends — `useSpot`'s. */
  readonly prev: string | undefined
  readonly next: string | undefined
  readonly onStep: (to: string) => void
}): ReactNode => {
  const [open, setOpen] = useState(false)
  if (spot === undefined) return undefined
  const { row } = spot
  const Mark = row.mark
  const name = headOf(spot, bands, parent)
  const told = row.caption !== ""
  return (
    <section
      aria-label="Current position"
      className="flex shrink-0 flex-col border-b border-border bg-surface px-gutter"
    >
      {/* A pager: the arrows bracket the position they step through, so back sits on the
          side it points to. `-mx-2` takes back the ghost buttons' own padding, so each
          chevron's ink sits on the gutter. The press between them is the row's full height,
          so it clears the floor without reaching under either arrow. */}
      <div className="-mx-2 flex min-h-11 min-w-0 items-center gap-1">
        <Arrow dir="prev" to={prev} onStep={onStep} />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open)
          }}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Mark size={14} aria-hidden className={`ml-1 shrink-0 ${toneInk[row.tone]}`} />
          <span
            className={`min-w-0 truncate text-sm ${told ? "text-fg-muted" : "font-medium text-fg"}`}
          >
            {told ? row.caption : name}
          </span>
        </button>
        {/* The cloud alone, with no id: the line has no room for one, and the detail is a
            tap away. The press is 44px and the row's height, so it sits between the line
            and the arrow without reaching under either. */}
        <PlacePill place={placeOfTurn(row.turns.at(-1))} compact />
        <Arrow dir="next" to={next} onStep={onStep} />
      </div>
      {open && (
        <div className="flex flex-col gap-1 pb-2 text-sm">
          <span className="font-medium text-fg">{name}</span>
          {told && <span className="text-fg-muted">{row.caption}</span>}
        </div>
      )}
    </section>
  )
}

export default DirectiveBlock
