/**
 * A done or dropped sub-goal on its parent's Traks tab, folded to one line — ring, title
 * and state word, no count and no rail — as a goal at rest folds on the traks list.
 * Finished shows less: what landed is on its own page, which the row opens.
 */

import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import { goalInk, goalTitle, goalWords } from "../../format/goal"
import GoalRing from "../traks-list/GoalRing"
import { ringMark } from "../traks-list/ringMark"

const SubgoalRestRow = ({ goal }: { readonly goal: GoalDto }): ReactNode => {
  const { label, ink } = goalWords(goal)
  const title = goalTitle(goal)
  return (
    <li className="relative flex h-11 items-center gap-2 px-3 hover:bg-hover-row">
      <span className="flex w-7 shrink-0 items-center justify-center">
        <GoalRing ink={ink} mark={ringMark(goal)} landed={goal.landed} planned={goal.planned} />
      </span>
      <Link
        to="/goals/$id"
        params={{ id: goal.id }}
        aria-label={`Sub-goal: ${title}`}
        className={`min-w-0 flex-1 truncate text-base outline-none after:absolute after:inset-0 ${goal.state._tag === "Dropped" ? "text-fg-subtle line-through" : "text-fg-muted"}`}
      >
        {title}
      </Link>
      <span className={`shrink-0 text-sm font-medium ${goalInk[ink]}`}>{label}</span>
    </li>
  )
}

export default SubgoalRestRow
