/**
 * The goal's Chat tab: the composer's session drawn as any agent's transcript is — the
 * same runs, bubbles and cards a trak's turn draws — with its moves on traks as call rows
 * that open into their views, each gate it opened as the gate's card, and the goal's own
 * lines where they happened. `thread.ts` lays the two logs together.
 *
 * Imports the trak screen's transcript rows rather than a copy of them: an ordinary
 * session is what the person asked this to be, and a second copy would drift from it. So
 * a burst of thinking draws its dots on the live tail alone (`withoutEndedPauses`), and
 * what the person wrote that the composer has not read sits at the foot as waiting.
 */

import type { ReactNode } from "react"
import type { GoalDetailDto } from "../../api/types"
import { goalAsk } from "../../format/goal"
import { groupEntries, withoutEndedPauses, workOnly } from "../../format/transcriptRows"
import WaitingMessages from "../trak-detail/turns/output/WaitingMessages"
import TurnRows from "../trak-detail/turns/TurnRows"
import { answerTo, askOfMove, doneMergeOf } from "./gate/gate"
import GateCard from "./gate/GateCard"
import MoveRow from "./moves/MoveRow"
import MoveView from "./moves/MoveView"
import { asksNow, isGateMove, threadOf, toolOf } from "./thread"
import ThreadLine from "./ThreadLine"
import type { GoalAct } from "./useGoalAct"
import { lineWords, moveAbout } from "./words"

const ChatTab = ({
  detail,
  act,
  phone,
}: {
  readonly detail: GoalDetailDto
  readonly act: GoalAct
  readonly phone: boolean
}): ReactNode => {
  const { goal, log } = detail
  const thread = threadOf(log, detail.transcript)
  const newestMove = thread.findLastIndex((item) => item._tag === "Move")
  const lastWork = thread.findLastIndex((item) => item._tag === "Work")
  if (thread.length === 0 && goal.messages.length === 0)
    return <p className="text-sm text-fg-subtle">The composer has not started yet.</p>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ol className="flex min-w-0 flex-col gap-2">
        {thread.map((item, i) => {
          switch (item._tag) {
            case "Work": {
              const live = goal.running && i === lastWork
              return (
                <TurnRows
                  // oxlint-disable-next-line react/no-array-index-key -- the thread is append-only
                  key={i}
                  rows={withoutEndedPauses(groupEntries(workOnly(item.entries)), live)}
                  live={live}
                  stopJob={undefined}
                />
              )
            }
            case "Move":
              if (isGateMove(item.event)) {
                const live = asksNow(goal, log, item.event)
                return (
                  // oxlint-disable-next-line react/no-array-index-key -- the thread is append-only
                  <li key={i} className="min-w-0">
                    {/* The open gate's card is named by what it asks, as the head says it. */}
                    <section aria-label={live ? goalAsk(goal) : undefined} className="min-w-0">
                      <GateCard
                        ask={askOfMove(item.event)}
                        live={live}
                        offers={goal.offers}
                        act={act}
                        answer={
                          item.event._tag === "Escalated" ? answerTo(log, item.event) : undefined
                        }
                        merge={doneMergeOf(goal)}
                        phone={phone}
                      />
                    </section>
                  </li>
                )
              }
              return (
                <MoveRow
                  // oxlint-disable-next-line react/no-array-index-key -- the thread is append-only
                  key={i}
                  name={item.call?.detail ?? toolOf(item.event)}
                  about={moveAbout(item.event, goal, log)}
                  startOpen={i === newestMove}
                >
                  <MoveView move={item.event} goal={goal} subgoals={detail.subgoals} log={log} />
                </MoveRow>
              )
            case "Line":
              // oxlint-disable-next-line react/no-array-index-key -- the thread is append-only
              return <ThreadLine key={i} words={lineWords(item.event, goal, log)} />
          }
        })}
      </ol>
      <WaitingMessages messages={goal.messages} />
    </div>
  )
}

export default ChatTab
