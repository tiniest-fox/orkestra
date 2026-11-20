/**
 * The card a goal at rest leads its Traks tab with, in the gate card's place: how it ended
 * and when, in its own words, and its progress as traks landed of planned.
 */

import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import { goalEnding, pastWhen } from "../../format/goal"
import Progress from "../../components/Progress"

const RestCard = ({ goal, now }: { readonly goal: GoalDto; readonly now: number }): ReactNode => {
  const ending = goalEnding(goal)
  if (ending === undefined) return undefined
  const done = goal.state._tag === "Done"
  const when = goal.endedAt === undefined ? undefined : pastWhen(goal.endedAt, now)
  const head = [done ? "Done" : "Dropped", when, done ? "you confirmed it" : "by you"]
  return (
    <section
      aria-label={done ? "The goal is done" : "The goal was dropped"}
      className="flex flex-col gap-2 rounded-surface bg-surface p-4 ring-1 ring-border"
    >
      <span
        className={`font-mono text-2xs uppercase tracking-wider ${done ? "text-tone-good" : "text-fg-muted"}`}
      >
        {head.filter((part) => part !== undefined).join(" · ")}
      </span>
      <p className="text-base text-fg">{ending}</p>
      <Progress landed={goal.landed} planned={goal.planned} />
    </section>
  )
}

export default RestCard
