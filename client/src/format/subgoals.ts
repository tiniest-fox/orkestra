/**
 * A parent goal's sub-goals as the goal page's Sub-goals group and the traks list's tiles
 * order them, and the parent's progress counting its sub-goals beside its traks.
 *
 * **Stuck, then asks you, then running, oldest first within each**, and what the plan has
 * not opened after all of them, so what needs the person is on top. A sub-goal reads as
 * stuck once its
 * composer's turn failed, which the engine still counts as live.
 *
 * **What is still to open is read off the plan by title**, as `features/goal/groups` reads
 * the traks: `open_subgoal` takes the plan entry's title as the sub-goal's own.
 */

import type { GoalDto, PlannedSubgoalDto } from "../api/types"
import { goalAsk } from "./goal"

const rank = (goal: GoalDto): number =>
  goal.state._tag === "Failed" ? 0 : goalAsk(goal) === undefined ? 2 : 1

/** The parent's live sub-goals, among `goals`, in the order a person reads them. */
export const liveSubgoals = (
  parent: Pick<GoalDto, "subgoals">,
  goals: readonly GoalDto[],
): readonly GoalDto[] => {
  const byId = new Map(goals.map((g) => [g.id, g] as const))
  return parent.subgoals
    .filter((s) => s.status === "live")
    .flatMap((s) => {
      const goal = byId.get(s.id)
      return goal === undefined ? [] : [goal]
    })
    .toSorted((a, b) => rank(a) - rank(b))
}

/** The sub-goals the parent's plan holds and its composer has not opened yet. */
export const pendingSubgoals = (
  parent: Pick<GoalDto, "subgoalPlan" | "subgoals">,
): readonly PlannedSubgoalDto[] => {
  const opened = new Set(parent.subgoals.map((s) => s.title))
  return parent.subgoalPlan.filter((p) => !opened.has(p.title))
}

/**
 * The parent's rail: one segment per trak and per sub-goal of its own plan, a sub-goal's
 * filled once it is done. The wire's `landed` and `planned` count traks alone.
 */
export const familyProgress = (
  goal: Pick<GoalDto, "landed" | "planned" | "subgoalPlan" | "subgoals">,
): { readonly landed: number; readonly planned: number } => ({
  landed: goal.landed + goal.subgoals.filter((s) => s.status === "done").length,
  planned: goal.planned + goal.subgoalPlan.length,
})
