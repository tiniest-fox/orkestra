/**
 * The goal a trak was opened by, as its header links back to it: the id off the trak's
 * own projection, and the title off the goals the list's banner already polls — so the
 * link costs no read of its own. `undefined` on a trak no goal opened.
 */

import { goalTitle } from "../../format/goal"
import { useGoals } from "../traks-list/useGoals"

export interface GoalLinkTo {
  readonly id: string
  readonly title: string
}

export const useGoalLink = (goal: string | undefined): GoalLinkTo | undefined => {
  const goals = useGoals()
  if (goal === undefined) return undefined
  const found = goals.data?.goals.find((g) => g.id === goal)
  return { id: goal, title: found === undefined ? "Goal" : goalTitle(found) }
}
