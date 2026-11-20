/**
 * The chat bar under the goal's Chat tab. **Send spends**: what is said owes the composer
 * a turn on its session, which runs at once unless the goal is paused.
 *
 * Open wherever the goal offers `Chat` — at each gate, while it watches its traks, after a
 * failed turn, and while a composer turn runs or is owed. A message sent then starts no
 * turn: the engine keeps it, the running composer reads it, and the Chat tab draws it as
 * waiting until it does. The draft is this bar's own; the screen is keyed on the goal, so
 * a draft never follows the reader to another one.
 *
 * **While the composer works the box's one control follows the draft**, as a trak's bar
 * does: with the field empty it is a stop (`StopControl`), which spends nothing and leaves
 * the goal where the turn would have ended, and once the field holds text it is the send.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import type { GoalDto } from "../../api/types"
import ChatBar from "../../components/ChatBar"
import { goalAtRest } from "../../format/goal"
import StopControl from "../trak-detail/chat-bar/StopControl"
import type { Stopping } from "../trak-detail/useStop"
import type { GoalAct } from "./useGoalAct"

const placeholderOf = (goal: GoalDto, open: boolean): string => {
  if (goalAtRest(goal) || !open) return "The goal is at rest"
  if (goal.paused) return "Message the composer — it answers once you resume"
  return goal.running ? "Message the composer — it reads it as it works" : "Message the composer"
}

const GoalChatBar = ({
  goal,
  act,
  stopping,
}: {
  readonly goal: GoalDto
  readonly act: GoalAct
  readonly stopping: Stopping
}): ReactNode => {
  const [draft, setDraft] = useState("")
  const open = goal.offers.includes("Chat")
  const message = draft.trim()
  return (
    <ChatBar
      id="goal-chat"
      label="Message the composer"
      value={draft}
      onChange={setDraft}
      onSend={() => {
        if (!open || message === "") return
        act.say(message, () => {
          setDraft("")
        })
      }}
      placeholder={placeholderOf(goal, open)}
      busy={act.isPending}
      disabled={!open || act.isPending}
      said={act.said ?? stopping.said}
      sendLabel="Send"
      attach={act.attached}
      control={
        goal.running && message === "" ? (
          <StopControl stopping={stopping} label="Stop the composer" />
        ) : undefined
      }
    />
  )
}

export default GoalChatBar
