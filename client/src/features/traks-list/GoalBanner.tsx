/**
 * A goal over the list's sections: a ring for its progress and its state, its title and
 * count, the state as a coloured word leading its one line, and a rail of one segment per
 * planned trak as the card's bottom edge. Pressing it opens the goal. Its traks are
 * ordinary rows in their sections below.
 *
 * **Every state is the same height**: the title row, the line and the rail, the rail one
 * empty bar while nothing is planned. The title row is the title's own height and the
 * ring overhangs it, so the ring's size never spaces the title and the line apart.
 *
 * **The outline is drawn over the card**, so hover and open close on all four sides,
 * across the rail too. The bottom corners are square so the rail's ends are not clipped,
 * and the top ones round only on the first card of the goal stack, which reads as one block.
 *
 * **A goal going, never one at rest.** `GoalStack` folds a goal at rest to a one-line
 * `GoalRestRow`, so the banner has no
 * actions, and pressing anywhere on it opens the goal. The title is the link and its
 * `::after` covers the card, which keeps its accessible name the title alone.
 *
 * A link rather than a button, so the goal has an address a person can come back to.
 *
 * **A parent's live sub-goals are tiles inside its card**, under the rail —
 * `SubgoalTiles` — so a family reads as one card. The link covers the banner alone, so a
 * tile is its own press. The banner keeps the parent's own state word and line whatever
 * its sub-goals need; a tile's ring carries that. The rail and count take the sub-goals of
 * its plan beside its traks, a sub-goal's segment filled once it is done.
 */

import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import { goalAsk, goalInk, goalSolid, goalTitle, goalWords } from "../../format/goal"
import { familyProgress } from "../../format/subgoals"
import { ringMark } from "./ringMark"
import GoalRing from "./GoalRing"

const GoalBanner = ({
  goal,
  open,
  first,
  tiles,
}: {
  readonly goal: GoalDto
  /** The goal is open in the drawer beside the list. */
  readonly open: boolean
  /** The top of the goal stack, which rounds its top corners. */
  readonly first: boolean
  /** Its live sub-goals as tiles, where it has any. */
  readonly tiles: ReactNode
}): ReactNode => {
  const { label, ink } = goalWords(goal)
  const ask = goalAsk(goal)
  const { landed, planned } = familyProgress(goal)
  const title = goalTitle(goal)
  // What it needs, or else what it is.
  const line = ask ?? goal.line ?? goal.asked ?? ""
  const corners = first ? "rounded-t-surface" : ""
  return (
    <div
      className={`group relative mx-gutter flex flex-col overflow-hidden bg-surface text-left ${corners}`}
    >
      <div className="relative flex flex-col">
        <span className="flex flex-col gap-0.5 px-3 py-2.5">
          <span className="flex h-5 items-center gap-2">
            <span className="flex h-5 w-7 shrink-0 items-center justify-center">
              <GoalRing ink={ink} mark={ringMark(goal)} landed={landed} planned={planned} />
            </span>
            <Link
              to="/goals/$id"
              params={{ id: goal.id }}
              aria-label={`Goal: ${title}`}
              className="min-w-0 flex-1 truncate text-base font-medium text-fg outline-none after:absolute after:inset-0"
            >
              {title}
            </Link>
            {planned > 0 && (
              <span className="shrink-0 font-mono text-xs text-fg-muted">
                {`${String(landed)} of ${String(planned)}`}
                <span className="max-sm:hidden"> landed</span>
              </span>
            )}
          </span>
          <span
            className={`truncate pl-9 text-sm ${ask !== undefined ? goalInk[ink] : "text-fg-subtle"}`}
          >
            <span className={`font-medium ${goalInk[ink]}`}>
              {label}
              {line !== "" && <span> · </span>}
            </span>
            {line}
          </span>
        </span>
        <span aria-hidden className="flex h-1 gap-0.5">
          {planned === 0 ? (
            <span className="flex-1 bg-border" />
          ) : (
            Array.from({ length: planned }, (_, i) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- one segment per planned trak, positional
                key={i}
                className={`flex-1 ${i < landed ? goalSolid[ink] : "bg-border"}`}
              />
            ))
          )}
        </span>
      </div>
      {tiles}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 border ${corners} ${open ? "border-accent/60" : "border-border group-hover:border-accent/60 group-has-[a:focus-visible]:border-accent"}`}
      />
    </div>
  )
}

export default GoalBanner
