/**
 * The goal's head: `components/ScreenHeader` with the goal's title over its id, and its
 * `⋯` holding Pause or Resume and Drop — the title row alone, with no actions row.
 *
 * **A sub-goal's meta row leads with `↰ <parent title>`**, a link to the parent, before its
 * id, so the way up is the first thing on the line.
 *
 * **No state chip, no line and no settings.** What the goal is doing is the tabs' to say,
 * and its line, its settings and the trak that opened it are the Goal tab's —
 * `GoalTab`.
 *
 * **Pause is offered wherever something can move without a person**: at a question or a
 * request for work by hand, where traks may still run, but not at the plan or done gate,
 * where nothing runs until they answer, and not once the goal is at rest. Resume is offered
 * wherever the goal is paused.
 *
 * **Drop is offered wherever the goal is not at rest**, wider than Pause: a goal waiting
 * at a gate is the one a person most often changes their mind about. It folds the goal to
 * its rest row on the traks list, whose Dismiss is a second press.
 */

import { Link } from "@tanstack/react-router"
import { CornerLeftUp } from "lucide-react"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import ScreenHeader from "../../components/ScreenHeader"
import { goalAtRest, goalTitle, openTraks } from "../../format/goal"
import GoalMenu from "./GoalMenu"
import type { GoalDrop as Dropping } from "./useDropGoal"
import type { GoalPause } from "./usePauseGoal"

const pausable = (goal: GoalDto): boolean => {
  if (goalAtRest(goal) || goal.paused) return false
  return !(
    goal.state._tag === "AtGate" &&
    goal.state.gate !== "escalation" &&
    goal.state.gate !== "action"
  )
}

/** `true` offers Pause, `false` Resume, `undefined` neither. */
const pausing = (goal: GoalDto): boolean | undefined => {
  // Resuming owes the composer a turn, which only the owner starts.
  if (goal.paused && !goalAtRest(goal)) return goal.ownership === undefined ? false : undefined
  return pausable(goal) ? true : undefined
}

const GoalHead = ({
  goal,
  phone,
  pause,
  drop,
  onDrop,
}: {
  readonly goal: GoalDto
  readonly phone: boolean
  readonly pause: GoalPause
  readonly drop: Dropping
  /** Asks the screen's sheet to show, which a phone's Drop does — `GoalMenu`. */
  readonly onDrop: (asking: true) => void
}): ReactNode => {
  const offered = pausing(goal)
  const open = goalAtRest(goal) ? undefined : openTraks(goal)
  return (
    <ScreenHeader
      title={goalTitle(goal)}
      meta={
        goal.parent === undefined
          ? [goal.id]
          : [
              <Link
                key="parent"
                to="/goals/$id"
                params={{ id: goal.parent.id }}
                aria-label={`Parent goal: ${goal.parent.title}`}
                className="flex min-w-0 items-center gap-1 text-fg-muted underline decoration-border underline-offset-2 hover:decoration-fg-subtle"
              >
                <CornerLeftUp size={11} aria-hidden className="shrink-0" />
                <span className="truncate">{goal.parent.title}</span>
              </Link>,
              goal.id,
            ]
      }
      phone={phone}
      menu={
        offered === undefined && open === undefined ? undefined : (
          <GoalMenu
            pausing={offered}
            pause={pause}
            open={open}
            dropping={drop}
            onDrop={phone ? () => onDrop(true) : undefined}
          />
        )
      }
    />
  )
}

export default GoalHead
