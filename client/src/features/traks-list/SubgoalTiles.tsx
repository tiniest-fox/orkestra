/**
 * A parent's sub-goals inside its card on the traks list: the live ones stuck first, then
 * asking the person, then running, and the ones its approved plan has not opened after
 * them.
 *
 * **A phone holds them in one row of fixed-width tiles that scrolls sideways**, so the card
 * is one row tall at any count. A desk lays them three to a row.
 */

import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import { liveSubgoals, pendingSubgoals } from "../../format/subgoals"
import SubgoalTile from "./SubgoalTile"

const SubgoalTiles = ({
  parent,
  goals,
  phone,
}: {
  readonly parent: GoalDto
  /** Every goal the list holds, the parent's sub-goals among them. */
  readonly goals: readonly GoalDto[]
  readonly phone: boolean
}): ReactNode => {
  const live = liveSubgoals(parent, goals)
  // A plan waiting on the person proposes its sub-goals; none of them is coming yet.
  const proposing = parent.state._tag === "AtGate" && parent.state.gate === "plan"
  const pending = proposing ? [] : pendingSubgoals(parent)
  if (live.length === 0 && pending.length === 0) return undefined
  return (
    <ul
      aria-label="Sub-goals"
      className={`border-t border-border bg-canvas p-2 ${phone ? "flex gap-2 overflow-x-auto" : "grid grid-cols-3 gap-2"}`}
    >
      {live.map((g) => (
        <li key={g.id} className="contents">
          <SubgoalTile tile={{ _tag: "Opened", goal: g }} fixed={phone} />
        </li>
      ))}
      {pending.map((p) => (
        <li key={p.title} className="contents">
          <SubgoalTile tile={{ _tag: "Pending", planned: p }} fixed={phone} />
        </li>
      ))}
    </ul>
  )
}

export default SubgoalTiles
