/**
 * The goal's Traks tab: what needs the person here first — a lost turn, an idle goal, or
 * the pause — then every trak of the goal grouped as running, still to open, landed and
 * dropped, each the list's own row. An open gate is not here: its card is in the Chat tab,
 * which the screen opens on while one is open.
 *
 * **A parent's sub-goals lead, in a Sub-goals group above Live**, stuck first, then the
 * ones asking the person — both opened in place — then running, then not opened yet. A
 * done or dropped one folds into Landed or Dropped, ahead of the traks there.
 *
 * **A goal at rest leads with how it ended instead.** A dropped goal's running traks come
 * first, under a heading saying they are the person's now, since nothing watches them for
 * the goal any more; what it planned and never opened is struck through at the foot.
 */

import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import { goalAsk, goalAtRest } from "../../format/goal"
import { liveSubgoals, pendingSubgoals } from "../../format/subgoals"
import FailedCard from "./FailedCard"
import GoalTrakRow from "./GoalTrakRow"
import IdleCard from "./IdleCard"
import { goalGroups } from "./groups"
import PausedBand from "./PausedBand"
import PlannedRow from "./PlannedRow"
import EndedGroups from "./EndedGroups"
import RestCard from "./RestCard"
import SubgoalPendingRow from "./SubgoalPendingRow"
import SubgoalRow from "./SubgoalRow"
import TraksGroup from "./TraksGroup"
import type { GoalAct } from "./useGoalAct"
import type { GoalPause } from "./usePauseGoal"

const TraksTab = ({
  goal,
  subgoals,
  act,
  pause,
  onChat,
  now,
}: {
  readonly goal: GoalDto
  /** Each sub-goal it opened, as its own goal. */
  readonly subgoals: readonly GoalDto[]
  readonly act: GoalAct
  readonly pause: GoalPause
  readonly onChat: () => void
  /** What a goal at rest says its end against. */
  readonly now: number
}): ReactNode => {
  const { live, next, landed, dropped } = goalGroups(goal)
  const going = liveSubgoals(goal, subgoals)
  const pending = pendingSubgoals(goal)
  const atPlan =
    goal.state._tag === "AtGate" &&
    goal.state.gate === "plan" &&
    goal.traks.length === 0 &&
    goal.subgoals.length === 0
  if (goalAtRest(goal))
    return (
      <div className="flex flex-col gap-5">
        <RestCard goal={goal} now={now} />
        <TraksGroup title="Still open — yours now" count={live.length}>
          {live.map((t) => (
            <GoalTrakRow key={t.id} trak={t} />
          ))}
        </TraksGroup>
        <EndedGroups goal={goal} subgoals={subgoals} landed={landed} dropped={dropped} />
        <TraksGroup title="Never opened" count={pending.length + next.length}>
          {pending.map((p) => (
            <SubgoalPendingRow key={p.title} planned={p} gone />
          ))}
          {next.map((p, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- a plan is positional, with no id on the wire
            <PlannedRow key={i} title={p.title} mode={p.mode} line="Not opened" look="gone" />
          ))}
        </TraksGroup>
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      <FailedCard goal={goal} act={act} onChat={onChat} />
      <IdleCard goal={goal} onChat={onChat} />
      {goal.paused && goal.ownership === undefined && <PausedBand pause={pause} />}
      {goal.file === undefined && goal.parent === undefined && goal.state._tag === "Composing" && (
        <p className="text-xs text-fg-subtle">
          The composer is drafting the goal file. Nothing is planned until you approve it.
        </p>
      )}
      {atPlan ? (
        <p className="text-xs text-fg-subtle">
          Nothing is open yet. Each trak gets its own page once the plan is approved.
        </p>
      ) : (
        <>
          <TraksGroup title="Sub-goals" count={going.length + pending.length}>
            {going.map((g) => (
              <SubgoalRow
                key={g.id}
                goal={g}
                startOpen={g.state._tag === "Failed" || goalAsk(g) !== undefined}
              />
            ))}
            {pending.map((p) => (
              <SubgoalPendingRow key={p.title} planned={p} gone={false} />
            ))}
          </TraksGroup>
          <TraksGroup title="Live" count={live.length}>
            {live.map((t) => (
              <GoalTrakRow key={t.id} trak={t} />
            ))}
          </TraksGroup>
          <TraksGroup title="Next" count={next.length}>
            {next.map((p, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- a plan is positional, with no id on the wire
              <PlannedRow key={i} title={p.title} mode={p.mode} line={p.description} look="next" />
            ))}
          </TraksGroup>
          <EndedGroups goal={goal} subgoals={subgoals} landed={landed} dropped={dropped} />
        </>
      )}
    </div>
  )
}

export default TraksTab
