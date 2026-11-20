/**
 * What the engine is doing at the seam for this trak — the boundary with where its work
 * runs — on the live row: the action, how far it has got, and the transport failure it is
 * waiting out, in the runner's words and since when.
 *
 * **One line for every action at the seam**, drawn off `TrakDetailDto.seam` alone, so a
 * surface waits on the engine the same way whichever action is crossing. A trak in
 * `Stopping` with no status yet — a local stop, which has no sandbox to cross into, or the
 * moment before the engine publishes one — still says the stop is under way.
 *
 * **On the live row only, and gone once the action ends**, for `Reattaching`'s reason: it
 * says what the engine is doing now, so the transcript keeps no copy of it.
 */

import type { ReactNode } from "react"
import { Square, Unplug } from "lucide-react"
import type { SeamStatusDto } from "../../../../api/types"
import { clockOf } from "../../../../format/hostWhen"
import { seamWords } from "../../../../format/seam"

const SeamLine = ({
  seam,
  stopping,
}: {
  readonly seam: SeamStatusDto | undefined
  /** Whether the trak is `Stopping`, so the line stands before any status arrives. */
  readonly stopping: boolean
}): ReactNode => {
  if (seam === undefined && !stopping) return undefined
  const words =
    seam === undefined ? { label: "Stopping the turn", line: "ending it" } : seamWords(seam)
  const waiting = seam?.phase === "waiting"
  const Glyph = waiting ? Unplug : Square
  return (
    <p role="status" className="flex min-w-0 items-start gap-1.5 text-sm text-fg-muted">
      <Glyph
        size={13}
        aria-hidden
        className={`mt-1 shrink-0 ${waiting ? "text-tone-waiting" : "text-tone-working"}`}
      />
      <span className="min-w-0 break-words">
        <span className="text-fg">{words.label}</span> — {words.line}
        {seam?.lastError === undefined
          ? undefined
          : ` since ${clockOf(seam.since)}: ${seam.lastError.said}`}
      </span>
    </p>
  )
}

export default SeamLine
