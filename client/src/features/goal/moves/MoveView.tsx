/**
 * What one of the composer's moves did, drawn in React inside the view frame its call row
 * opens. Keyed by the move rather than by an HTML document: the goal's tools serve no
 * `ui://` view, and inside a view a trak is the real list row, which a frame cannot hold.
 *
 * A move that opens a gate is not here: it is drawn as the gate's card instead
 * (`gate/GateCard`), so the person answers it where it was asked.
 *
 * Drawn from the goal event the call left — what the engine recorded — never from the
 * call's arguments, which a refused call also had.
 */

import type { ReactNode } from "react"
import type { GoalDto, GoalEventDto, GoalTrakDto } from "../../../api/types"
import { goalAtRest } from "../../../format/goal"
import GoalTrakRow from "../GoalTrakRow"
import SubgoalRestRow from "../SubgoalRestRow"
import SubgoalRow from "../SubgoalRow"
import { dropCount, planChange, type CallMoveDto, type DropMoveDto } from "../thread"
import ReplanView from "./ReplanView"

/** One trak inside a view, as the row the list draws. */
const OneRow = ({
  goal,
  id,
}: {
  readonly goal: Pick<GoalDto, "traks">
  readonly id: string
}): ReactNode => {
  const trak: GoalTrakDto | undefined = goal.traks.find((t) => t.id === id)
  return trak === undefined ? undefined : (
    <ul className="min-w-0">
      <GoalTrakRow trak={trak} />
    </ul>
  )
}

/** `drop_trak`'s view: why, the trak as its row where it stands now, then what the plan lost. */
const DropView = ({
  move,
  goal,
  log,
}: {
  readonly move: DropMoveDto
  readonly goal: Pick<GoalDto, "traks">
  readonly log: readonly GoalEventDto[]
}): ReactNode => {
  const title = goal.traks.find((t) => t.id === move.trak)?.title
  const { before, after, landed } = dropCount(log, move, title)
  return (
    <div className="flex flex-col gap-1 py-1">
      <p className="px-3 pt-1 text-sm text-fg-muted">{move.reason}</p>
      <OneRow goal={goal} id={move.trak} />
      <p className="px-3 pb-1 font-mono text-2xs text-fg-subtle">
        {`planned ${String(before)} → ${String(after)} · ${String(landed)} landed`}
      </p>
    </div>
  )
}

/** `open_subgoal`'s view: the sub-goal as its parent's Traks tab draws it now. */
const SubgoalView = ({ sub }: { readonly sub: GoalDto | undefined }): ReactNode =>
  sub === undefined ? undefined : (
    <ul className="min-w-0">
      {goalAtRest(sub) ? (
        <SubgoalRestRow goal={sub} />
      ) : (
        <SubgoalRow goal={sub} startOpen={false} />
      )}
    </ul>
  )

const MoveView = ({
  move,
  goal,
  subgoals,
  log,
}: {
  readonly move: CallMoveDto
  readonly goal: Pick<GoalDto, "traks">
  /** Each sub-goal the goal opened, as its own goal. */
  readonly subgoals: readonly GoalDto[]
  readonly log: readonly GoalEventDto[]
}): ReactNode => {
  switch (move._tag) {
    case "TrakDropped":
      return <DropView move={move} goal={goal} log={log} />
    case "Replanned":
      return <ReplanView change={planChange(log, move)} why={move.why} />
    case "TrakOpened":
      return <OneRow goal={goal} id={move.trak} />
    case "SubgoalOpened":
      return <SubgoalView sub={subgoals.find((g) => g.id === move.goal)} />
    case "TrakMessaged":
      return (
        <div className="flex flex-col gap-1 py-1">
          <blockquote className="mx-3 mt-1 border-l-2 border-border pl-2 text-sm text-fg">
            {move.message}
          </blockquote>
          <OneRow goal={goal} id={move.trak} />
        </div>
      )
    case "TrakRecomposed":
      return (
        <div className="flex flex-col gap-1 py-1">
          <p className="px-3 pt-1 text-sm text-fg-muted">{move.why}</p>
          <OneRow goal={goal} id={move.trak} />
        </div>
      )
  }
}

export default MoveView
