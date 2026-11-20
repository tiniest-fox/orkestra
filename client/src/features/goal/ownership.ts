/**
 * The goal as a viewer who is not its owner sees it: offering only the presses that start
 * no turn. Every card and bar on the screen draws a press from `GoalDto.offers`, so narrowing
 * the list here is what takes Approve, Answer, Retry and Chat off the screen in one place —
 * the engine refuses each of them to anyone but the owner. Only `Confirm` stays, the one
 * press that owes no turn.
 */

import type { GoalDetailDto } from "../../api/types"

export const ownersView = (detail: GoalDetailDto): GoalDetailDto =>
  detail.goal.ownership === undefined
    ? detail
    : {
        ...detail,
        goal: { ...detail.goal, offers: detail.goal.offers.filter((o) => o === "Confirm") },
      }
