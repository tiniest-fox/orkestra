/**
 * The order the goals over the list run in. Every goal going sits above every goal at rest;
 * among the going, one that owes the person something — a gate, a turn that failed, or an
 * idle goal — rises to the top, then the oldest first. The goals at rest run most recently
 * ended first.
 */

import type { GoalDto } from "../../api/types"
import { goalAsk, goalAtRest } from "../../format/goal"

export interface GoalStack {
  readonly going: readonly GoalDto[]
  readonly rest: readonly GoalDto[]
}

const owes = (goal: GoalDto): number => (goalAsk(goal) === undefined ? 0 : 1)

export const goalOrder = (goals: readonly GoalDto[]): GoalStack => ({
  going: goals
    .filter((g) => !goalAtRest(g))
    .toSorted((a, b) => owes(b) - owes(a) || (a.startedAt ?? 0) - (b.startedAt ?? 0)),
  rest: goals.filter(goalAtRest).toSorted((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)),
})
