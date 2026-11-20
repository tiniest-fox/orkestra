/**
 * The Traks tab's Landed and Dropped groups: a done or dropped sub-goal folded to one line
 * ahead of the traks that landed or were dropped.
 */

import type { ReactNode } from "react"
import type { GoalDto, GoalTrakDto } from "../../api/types"
import GoalTrakRow from "./GoalTrakRow"
import SubgoalRestRow from "./SubgoalRestRow"
import TraksGroup from "./TraksGroup"

/** The parent's sub-goals that ended `status`, as their own goals, oldest first. */
const ended = (
  goal: GoalDto,
  subgoals: readonly GoalDto[],
  status: "done" | "dropped",
): readonly GoalDto[] => {
  const ids = new Set(goal.subgoals.filter((s) => s.status === status).map((s) => s.id))
  return subgoals.filter((s) => ids.has(s.id))
}

const EndedGroups = ({
  goal,
  subgoals,
  landed,
  dropped,
}: {
  readonly goal: GoalDto
  /** Each sub-goal it opened, as its own goal. */
  readonly subgoals: readonly GoalDto[]
  readonly landed: readonly GoalTrakDto[]
  readonly dropped: readonly GoalTrakDto[]
}): ReactNode => {
  const done = ended(goal, subgoals, "done")
  const gone = ended(goal, subgoals, "dropped")
  return (
    <>
      <TraksGroup title="Landed" count={done.length + landed.length}>
        {done.map((g) => (
          <SubgoalRestRow key={g.id} goal={g} />
        ))}
        {landed.map((t) => (
          <GoalTrakRow key={t.id} trak={t} />
        ))}
      </TraksGroup>
      <TraksGroup title="Dropped" count={gone.length + dropped.length}>
        {gone.map((g) => (
          <SubgoalRestRow key={g.id} goal={g} />
        ))}
        {dropped.map((t) => (
          <GoalTrakRow key={t.id} trak={t} />
        ))}
      </TraksGroup>
    </>
  )
}

export default EndedGroups
