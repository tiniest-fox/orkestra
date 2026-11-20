/**
 * One sub-goal going, on its parent's Traks tab, drawn as the traks list draws a goal: the
 * ring, the title with `n of m` at its right, the state word leading what it needs or else
 * its line, and a rail of one segment per planned trak as the row's foot. A done or dropped one
 * is `SubgoalRestRow`, and one not opened yet `SubgoalPendingRow`.
 *
 * **Pressing the row opens the sub-goal's page; the chevron alone opens it in place**, to
 * its live traks as the list's rows. A row with nothing live has no chevron. The title is
 * the link and its `::after` covers the row, so the chevron sits above it.
 */

import { Link } from "@tanstack/react-router"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import type { GoalDto } from "../../api/types"
import { goalAsk, goalInk, goalTitle, goalWords } from "../../format/goal"
import GoalRing from "../traks-list/GoalRing"
import { ringMark } from "../traks-list/ringMark"
import GoalTrakRow from "./GoalTrakRow"
import SubgoalRail from "./SubgoalRail"

const LIST =
  "flex min-w-0 flex-col overflow-hidden rounded-surface border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border"

const SubgoalRow = ({
  goal,
  startOpen,
}: {
  readonly goal: GoalDto
  readonly startOpen: boolean
}): ReactNode => {
  const [open, setOpen] = useState(startOpen)
  const { label, ink } = goalWords(goal)
  const ask = goalAsk(goal)
  const line = ask ?? goal.line ?? ""
  const title = goalTitle(goal)
  const live = goal.traks.filter((t) => t.status === "live")
  return (
    <li>
      <div className="relative flex items-start gap-1 hover:bg-hover-row">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5">
          <span className="flex h-5 items-center gap-2">
            <span className="flex h-5 w-7 shrink-0 items-center justify-center">
              <GoalRing
                ink={ink}
                mark={ringMark(goal)}
                landed={goal.landed}
                planned={goal.planned}
              />
            </span>
            <Link
              to="/goals/$id"
              params={{ id: goal.id }}
              aria-label={`Sub-goal: ${title}`}
              className="min-w-0 flex-1 truncate text-base font-medium text-fg outline-none after:absolute after:inset-0"
            >
              {title}
            </Link>
            {goal.planned > 0 && (
              <span className="shrink-0 font-mono text-xs text-fg-muted">
                {`${String(goal.landed)} of ${String(goal.planned)}`}
                <span className="max-sm:hidden"> landed</span>
              </span>
            )}
          </span>
          <span
            className={`truncate pl-9 text-sm ${ask === undefined ? "text-fg-subtle" : goalInk[ink]}`}
          >
            <span className={`font-medium ${goalInk[ink]}`}>
              {label}
              {line !== "" && <span> · </span>}
            </span>
            {line}
          </span>
        </span>
        {live.length > 0 ? (
          <button
            type="button"
            aria-label={open ? `Close ${title}` : `Open ${title} here`}
            aria-expanded={open}
            onClick={() => {
              setOpen(!open)
            }}
            className="relative z-10 mt-1.5 mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:bg-hover-bare"
          >
            {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          </button>
        ) : (
          <span aria-hidden className="mr-1.5 size-9 shrink-0" />
        )}
      </div>
      <SubgoalRail goal={goal} />
      {open && live.length > 0 && (
        <div className="bg-canvas py-2.5 pr-3 pl-12">
          <ul className={LIST}>
            {live.map((t) => (
              <GoalTrakRow key={t.id} trak={t} />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

export default SubgoalRow
