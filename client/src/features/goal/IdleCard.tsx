/**
 * An idle goal, as a card at the top of the Traks tab: nothing is running and no turn is
 * coming, so the goal waits on the person. Most often the composer's last message asked
 * for something without opening a gate, so the press is the Chat tab, where that message is.
 *
 * Not a gate — nothing was proposed — so it is not drawn as one of `gate/`'s cards.
 */

import { MessageSquare } from "lucide-react"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import Button from "../../components/Button"
import { goalAsk } from "../../format/goal"

const IdleCard = ({
  goal,
  onChat,
}: {
  readonly goal: GoalDto
  readonly onChat: () => void
}): ReactNode => {
  if (goal.state._tag !== "Watching") return undefined
  const ask = goalAsk(goal)
  if (ask === undefined) return undefined
  return (
    <section
      aria-label={ask}
      className="flex flex-col gap-3 rounded-surface border border-border bg-surface p-3 sm:p-4"
    >
      <h2 className="text-base font-medium text-tone-waiting">{ask}</h2>
      <p className="text-sm text-fg-muted">
        No trak of this goal is open and the composer is not taking a turn. Its last message may ask
        you for something.
      </p>
      {goal.offers.includes("Chat") && (
        <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-1">
          <Button icon={MessageSquare} onClick={onChat}>
            Open the chat
          </Button>
        </div>
      )}
    </section>
  )
}

export default IdleCard
