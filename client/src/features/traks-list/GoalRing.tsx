/**
 * The goal banner's glyph: a progress ring in the state's ink, with the state's mark
 * inside it.
 *
 * The track is dashed while nothing is planned, and on a dropped goal. A composer turn
 * opens a gap in the inner ring and turns it; waiting on traks holds it still around
 * their count. A gate puts a blinking eye there, the trak
 * rows' own approval mark. Done closes the ring solid around a check. The door wears the
 * same ring, grey and empty.
 *
 * The ink is `currentColor` off `goalInk`, so the colors stay in
 * `format/goal` and `format/tone`.
 */

import type { ReactNode } from "react"
import { goalInk, type GoalInk } from "../../format/goal"
import type { RingMark } from "./ringMark"
import GoalRingMark from "./GoalRingMark"

const R = 8
const C = 2 * Math.PI * R

const GoalRing = ({
  ink,
  mark,
  landed,
  planned,
}: {
  /** `undefined` for the door, which is grey. */
  readonly ink: GoalInk | undefined
  readonly mark: RingMark | "door"
  readonly landed: number
  readonly planned: number
}): ReactNode => {
  const share = mark === "done" ? 1 : planned === 0 ? 0 : landed / planned
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={`size-7 shrink-0 ${ink === undefined ? "text-fg-subtle" : goalInk[ink]}`}
    >
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        strokeWidth="2"
        stroke="var(--color-border)"
        strokeDasharray={planned === 0 || mark === "dropped" ? "2 2.5" : undefined}
      />
      {share > 0 && (
        <circle
          cx="10"
          cy="10"
          r={R}
          fill="none"
          strokeWidth="2"
          stroke="currentColor"
          strokeDasharray={`${String(C * share)} ${String(C)}`}
          transform="rotate(-90 10 10)"
        />
      )}
      <GoalRingMark mark={mark} />
    </svg>
  )
}

export default GoalRing
