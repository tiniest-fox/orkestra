/**
 * One sub-goal inside its parent's card on the traks list: a 20px ring and `n of m` on top,
 * the title over two lines at most, and a 2px rail pinned to the tile's foot, square at the
 * bottom corners. No state line: the ring carries the state in its ink.
 *
 * **One the plan has not opened is dashed on the canvas**, with the door's grey ring, its
 * title in muted ink and no count, rail or link — there is no page to open.
 *
 * `fixed` is the phone's scrolling row, where every tile is one width.
 */

import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { GoalDto, PlannedSubgoalDto } from "../../api/types"
import { goalSolid, goalTitle, goalWords } from "../../format/goal"
import GoalRing from "./GoalRing"
import { ringMark } from "./ringMark"

export type SubgoalTileOf =
  | { readonly _tag: "Opened"; readonly goal: GoalDto }
  | { readonly _tag: "Pending"; readonly planned: PlannedSubgoalDto }

const SubgoalTile = ({
  tile,
  fixed,
}: {
  readonly tile: SubgoalTileOf
  readonly fixed: boolean
}): ReactNode => {
  const width = fixed ? "w-40 shrink-0" : "min-w-0"
  if (tile._tag === "Pending")
    return (
      <div
        className={`flex flex-col rounded-t-control border border-dashed border-border bg-canvas ${width}`}
      >
        <span className="flex flex-1 flex-col gap-1 px-2.5 pt-2 pb-2">
          <span className="flex h-5 items-center [&>svg]:size-5">
            <GoalRing ink={undefined} mark="door" landed={0} planned={0} />
          </span>
          <span className="line-clamp-2 text-sm font-medium text-fg-muted">
            {tile.planned.title}
          </span>
          <span className="sr-only">Not opened yet</span>
        </span>
      </div>
    )
  const { goal } = tile
  const { label, ink } = goalWords(goal)
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-t-control border border-border bg-surface hover:border-accent/60 has-[a:focus-visible]:border-accent ${width}`}
    >
      {/* `flex-1`, so the rail sits on the tile's foot whatever the title's line count. */}
      <span className="flex flex-1 flex-col gap-1 px-2.5 pt-2 pb-2">
        <span className="flex h-5 items-center justify-between">
          <span className="[&>svg]:size-5">
            <GoalRing ink={ink} mark={ringMark(goal)} landed={goal.landed} planned={goal.planned} />
          </span>
          {goal.planned > 0 && (
            <span className="font-mono text-2xs text-fg-subtle">
              {`${String(goal.landed)} of ${String(goal.planned)}`}
            </span>
          )}
        </span>
        <Link
          to="/goals/$id"
          params={{ id: goal.id }}
          aria-label={`Sub-goal: ${goalTitle(goal)}, ${label}`}
          className="line-clamp-2 text-sm font-medium text-fg outline-none after:absolute after:inset-0"
        >
          {goalTitle(goal)}
        </Link>
      </span>
      <span aria-hidden className="flex h-0.5 gap-0.5">
        {Array.from({ length: goal.planned }, (_, i) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- one segment per planned trak, positional
            key={i}
            className={`flex-1 ${i < goal.landed ? goalSolid[ink] : "bg-border"}`}
          />
        ))}
      </span>
    </div>
  )
}

export default SubgoalTile
