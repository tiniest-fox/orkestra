/**
 * A composer turn the provider lost, as a card at the top of the Traks tab: why, Retry,
 * and New session. Not a gate — nothing was proposed — so it is not drawn as one of
 * `gate/`'s cards.
 *
 * **Both presses spend**: each owes the composer a turn. New session lets the composer's
 * session go, so the turn opens with the whole goal brief and none of what the old
 * session held — the recovery where the session itself is what failed.
 */

import { MessageSquare } from "lucide-react"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import Button from "../../components/Button"
import { goalAsk } from "../../format/goal"
import type { GoalAct } from "./useGoalAct"

const FailedCard = ({
  goal,
  act,
  onChat,
}: {
  readonly goal: GoalDto
  readonly act: GoalAct
  readonly onChat: () => void
}): ReactNode => {
  const { state } = goal
  if (state._tag !== "Failed") return undefined
  const ask = goalAsk(goal)
  return (
    <section
      aria-label={ask}
      className="flex flex-col gap-3 rounded-surface border border-border bg-surface p-3 sm:p-4"
    >
      <h2 className="text-base font-medium text-fg">{ask}</h2>
      <p className="text-sm text-fg-muted">{state.reason}</p>
      {goal.offers.includes("Retry") && (
        <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-1">
          <Button
            busy={act.isPending}
            disabled={act.disabled}
            onClick={() => act.act({ _tag: "Retry" })}
          >
            Retry
          </Button>
          {goal.offers.includes("NewSession") && (
            <Button
              variant="quiet"
              busy={act.isPending}
              disabled={act.disabled}
              onClick={() => act.act({ _tag: "NewSession" })}
            >
              New session
            </Button>
          )}
        </div>
      )}
      {act.said === undefined ? undefined : (
        <p role="alert" className="text-sm text-tone-bad">
          {act.said}
        </p>
      )}
      {goal.offers.includes("Chat") && (
        <div>
          <Button variant="quiet" size="sm" icon={MessageSquare} onClick={onChat}>
            Ask the composer about this
          </Button>
        </div>
      )}
    </section>
  )
}

export default FailedCard
