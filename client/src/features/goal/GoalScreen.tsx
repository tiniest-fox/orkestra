/**
 * One goal, in the drawer over the traks list: its head, then three tabs — Traks, with a
 * lost turn or an idle goal on top, Chat, the composer's session and every gate's card,
 * and Goal, what the goal is and its settings — and the chat bar under Chat.
 *
 * **Chat opens first at a gate, paused or not, since its card is the one place the gate
 * is answered. Away from a gate, Traks opens first when something is owed there, the goal
 * is paused or it is at rest; Chat otherwise.** The tab holding what is owed carries the
 * `· 1`. Goal never opens first: it is where a reader goes to read or change the settings,
 * not where anything is owed. A press on a tab is the reader's choice and stands until
 * they leave the goal.
 *
 * A view: everything arrives as props, and the rows under it read `GoalRows`.
 */

import { ListTree, MessageSquare, Target } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import type { GoalDetailDto } from "../../api/types"
import Drawer from "../../components/Drawer"
import Tab from "../../components/Tab"
import TabBar from "../../components/TabBar"
import { goalAsk, goalAtRest, openTraks } from "../../format/goal"
import ChatTab from "./ChatTab"
import DropQuestion from "./DropQuestion"
import GoalChatBar from "./GoalChatBar"
import GoalHead from "./GoalHead"
import GoalTab from "./GoalTab"
import { GoalRows, type GoalRowsValue } from "./GoalTrakRow"
import TraksTab from "./TraksTab"
import type { GoalAct } from "./useGoalAct"
import type { GoalSettingsChange } from "./useGoalSettings"
import type { GoalDrop } from "./useDropGoal"
import type { GoalPause } from "./usePauseGoal"
import type { Stopping } from "../trak-detail/useStop"
import { GoalBand } from "../../slots"

type TabName = "traks" | "chat" | "goal"

/**
 * The foot: at rest, that nothing moves the goal again, on every tab. For a viewer who is not
 * the owner, the `GoalBand` slot — whose it is, under a host — on every tab, since every
 * press that would start a composer turn is the owner's. Otherwise the chat bar, on Chat.
 */
const footOf = (
  goal: GoalDetailDto["goal"],
  onChat: boolean,
  presses: { readonly act: GoalAct; readonly stopping: Stopping },
): ReactNode => {
  if (goalAtRest(goal))
    return (
      <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-4 pt-3 pb-foot text-sm text-fg-subtle">
        <Target size={13} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1">
          {goal.state._tag === "Done"
            ? "The goal is done. Nothing moves it again."
            : "The goal was dropped. Nothing moves it again."}
        </span>
      </footer>
    )
  if (goal.ownership !== undefined) return <GoalBand goal={goal} />
  return onChat ? (
    <GoalChatBar goal={goal} act={presses.act} stopping={presses.stopping} />
  ) : undefined
}

const GoalScreen = ({
  detail,
  rows,
  act,
  pause,
  drop,
  settings,
  stopping,
  now,
}: {
  readonly detail: GoalDetailDto
  readonly rows: GoalRowsValue
  readonly act: GoalAct
  readonly pause: GoalPause
  readonly drop: GoalDrop
  readonly settings: GoalSettingsChange
  readonly stopping: Stopping
  readonly now: number
}): ReactNode => {
  const { goal } = detail
  const [picked, setPicked] = useState<TabName | undefined>(undefined)
  const [dropping, setDropping] = useState(false)
  const gate = goal.state._tag === "AtGate"
  // A gate is answered in Chat; a lost turn and an idle goal are called out on Traks.
  const owedOnTraks = !gate && goalAsk(goal) !== undefined
  const rest = goalAtRest(goal)
  const tab = picked ?? (!gate && (owedOnTraks || goal.paused || rest) ? "traks" : "chat")
  return (
    <Drawer label="Goal">
      <GoalRows value={rows}>
        <GoalHead goal={goal} phone={rows.phone} pause={pause} drop={drop} onDrop={setDropping} />
        <div className="shrink-0">
          <TabBar label="Goal">
            <Tab
              label={owedOnTraks ? "Traks · 1" : "Traks"}
              icon={ListTree}
              current={tab === "traks"}
              grow
              onClick={() => {
                setPicked("traks")
              }}
            />
            <Tab
              label={gate ? "Chat · 1" : "Chat"}
              icon={MessageSquare}
              current={tab === "chat"}
              grow
              onClick={() => {
                setPicked("chat")
              }}
            />
            <Tab
              label="Goal"
              icon={Target}
              current={tab === "goal"}
              grow
              onClick={() => {
                setPicked("goal")
              }}
            />
          </TabBar>
        </div>
        {/* Reversed on Chat, so the session opens at its newest line as a transcript does. */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto bg-canvas ${tab === "chat" ? "flex flex-col-reverse" : ""}`}
        >
          <div className="flex w-full flex-col p-4 sm:p-6">
            {tab === "traks" ? (
              <TraksTab
                goal={goal}
                subgoals={detail.subgoals}
                act={act}
                pause={pause}
                onChat={() => setPicked("chat")}
                now={now}
              />
            ) : tab === "chat" ? (
              <ChatTab detail={detail} act={act} phone={rows.phone} />
            ) : (
              <GoalTab goal={goal} phone={rows.phone} settings={settings} />
            )}
          </div>
        </div>
        {footOf(goal, tab === "chat", { act, stopping })}
        {/* A phone's Drop, asked from the head's `⋯` and drawn last — `DropQuestion` says why. */}
        {dropping && !rest && (
          <DropQuestion
            open={openTraks(goal)}
            dropping={drop}
            sheet
            onCancel={() => setDropping(false)}
          />
        )}
      </GoalRows>
    </Drawer>
  )
}

export default GoalScreen
