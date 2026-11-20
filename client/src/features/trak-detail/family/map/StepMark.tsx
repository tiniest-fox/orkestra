/**
 * Who runs one row of the map, as a tone-marked plate.
 *
 * Literally the list row's leading square — both are `components/Plate` — because a plan
 * entry and a trak are the same kind of thing at two scales, and a reader who has learned
 * the list has already learned this. What is this file's own is nothing but the
 * arrangement: the box and the colour belong to the plate, the tone is decided on the row,
 * and so now is the glyph.
 *
 * **The glyph says which agent; the plate's fill and its travelling segment say how the
 * position is going.** The glyph used to say the second, which the colour already said —
 * `stepTone` maps the five statuses onto the five tones one to one, so the two channels
 * were one fact drawn twice. Spending the freed one on *who* is the whole change; the
 * segment replacing the spinner is forced by it rather than decorative, because with the
 * glyph spoken for the running signal has nowhere else to live.
 *
 * **Nothing on this square is a status glyph any more, and nothing may put one back.**
 * What that costs is the reader who cannot see colour, and `statusText` on the row's press
 * is where that fact went — see `TrakMap` and `TrakRail`, which draw the words. The 14px
 * tile inside a spawn (`RailSpawn`) draws the same `mark` on the same plate, so the rule
 * holds at both sizes and no second table decides what a small square wears.
 *
 * **It takes the row rather than its parts**, which arrived with the ending: that row has
 * no `StepStatus` at all, so a caller spelling out `status` and `kind` would have had to
 * invent one for it.
 */

import type { ReactNode } from "react"
import { CircleDashed } from "lucide-react"
import Plate from "../../../../components/Plate"
import type { MapRow } from "../rows"

const StepMark = ({
  row,
}: {
  /** `undefined` before the map has anything in it — the bar draws the mark for an entry
   *  that has not run, so nothing moves when the plan arrives. */
  readonly row: Pick<MapRow, "mark" | "status" | "tone"> | undefined
}): ReactNode => {
  // A row that does not exist yet is not an agent's turn and must not draw one: the dashed
  // circle is what *nothing has reached this* looks like everywhere else. Not a chevron —
  // an entry that has not run is not a thing that opens, and beside a disclosure control
  // the two would be the same glyph twice.
  const Glyph = row?.mark ?? CircleDashed
  return (
    <Plate tone={row?.tone ?? "neutral"} running={row?.status === "running"}>
      <Glyph size={14} aria-hidden />
    </Plate>
  )
}

export default StepMark
