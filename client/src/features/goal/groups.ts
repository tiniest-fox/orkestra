/**
 * The goal's traks as its Traks tab groups them: the ones running, the ones the plan has
 * still to open, the ones landed and the ones dropped.
 *
 * **What is still to open is read off the plan by title.** The plan is the composer's
 * whole list — opened, landed and still to come — and carries no id, so a planned trak
 * counts as opened once a trak of the goal has its title. `open_trak` takes the plan's
 * title as its own, which is what makes the two the same string.
 */

import type { GoalDto, GoalTrakDto, PlannedTrakDto } from "../../api/types"

export interface GoalGroups {
  readonly live: readonly GoalTrakDto[]
  readonly next: readonly PlannedTrakDto[]
  readonly landed: readonly GoalTrakDto[]
  readonly dropped: readonly GoalTrakDto[]
}

export const goalGroups = (goal: Pick<GoalDto, "plan" | "traks">): GoalGroups => {
  const opened = new Set(goal.traks.map((t) => t.title))
  return {
    live: goal.traks.filter((t) => t.status === "live"),
    next: goal.plan.filter((p) => !opened.has(p.title)),
    landed: goal.traks.filter((t) => t.status === "landed"),
    dropped: goal.traks.filter((t) => t.status === "dropped"),
  }
}
