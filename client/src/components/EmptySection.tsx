import type { ReactNode } from "react"
import Skeleton, { type Shape, shapeMark } from "./Skeleton"

/**
 * A section with nothing in it, inside a view whose other sections are full.
 *
 * **`EmptyState`'s sibling, not its small size.** The shell takes a whole region and may
 * do so because nothing else there is true; a section has neighbours that are still
 * true, so it can take neither the room nor the graphic nor the action. What is left is
 * the shape: the sentence stands where the first entry would, and the entries after it
 * are ghosts that fade out — so the section keeps its proportions and the pane does not
 * re-flow when the first one arrives. Not a bare sentence, and not a small plate: the
 * plate repeats badly, and two of them read as two notices rather than as two quiet
 * absences.
 *
 * **The sentence is metadata, not prose.** This is the section talking about itself, and
 * at body size it competes with the entries it is standing in for.
 *
 * It says nothing about what would fill the section — that is the section's own note,
 * and a note describing a list is dropped while there is no list to describe.
 */
export default function EmptySection({
  shape = "decisions",
  count = 2,
  children,
}: {
  /** Which drawing the ghosts take. The mark beside the sentence comes with it. */
  readonly shape?: Shape
  /** Ghosts below the sentence. Two, unless the section usually holds more. */
  readonly count?: number
  /** The sentence. One line, in the section's own voice — "Nothing decided yet." */
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex gap-2">
        <span aria-hidden className={`shrink-0 bg-surface-2 opacity-60 ${shapeMark[shape]}`} />
        <span className="font-mono text-2xs text-fg-muted">{children}</span>
      </p>
      <Skeleton shape={shape} count={count} fade />
    </div>
  )
}
