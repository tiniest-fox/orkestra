/**
 * What the goal banner's ring carries inside it. The outer ring is progress whatever the
 * state; this is the mark within, which says what the goal is doing. Read off the same
 * state `goalWords` reads, so the mark and the coloured word cannot disagree — a paused
 * goal at a gate wears the eye, because the gate is what the person came for.
 *
 * **Motion means the composer; a still number means the traks.** A composer turn turns the
 * ring; waiting on traks holds it still around how many are open.
 */

import type { GoalDto } from "../../api/types"
import { openTraks } from "../../format/goal"

export type RingMark =
  | "spin"
  | "eye"
  | "fail"
  | "pause"
  | "done"
  | "dropped"
  | { readonly open: number }

export const ringMark = (goal: Pick<GoalDto, "state" | "paused" | "traks">): RingMark => {
  switch (goal.state._tag) {
    case "AtGate":
      return "eye"
    case "Failed":
      return "fail"
    case "Done":
      return "done"
    case "Dropped":
      return "dropped"
    case "Composing":
      return goal.paused ? "pause" : "spin"
    case "Watching":
      return goal.paused ? "pause" : { open: openTraks(goal) }
  }
}
