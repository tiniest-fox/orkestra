/**
 * A goal that does not exist yet, started from a sentence: the New Trak drawer band for
 * band, so starting a goal is not a different place. Header naming it not started, the
 * goal's two tabs drawn inert where New Trak has its step bar, a pane saying what the
 * start will do, the modes its traks may open on where New Trak's mode strip sits, and
 * the chat bar.
 *
 * On a phone the inert tabs are not drawn, as on New Trak and for
 * its reason: the keyboard is up for most of this screen's life.
 *
 * **Sending spends**: the composer starts at once and drafts the goal file, which the
 * person then approves on the goal's own screen — where a 202 navigates to. Another goal
 * going is no reason to hold the send: a project runs any number at once.
 */

import { ListTree, MessageSquare } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { RefusedError } from "../../api/http"
import ChatBar from "../../components/ChatBar"
import Drawer from "../../components/Drawer"
import ScreenHeader from "../../components/ScreenHeader"
import Tab from "../../components/Tab"
import TabBar from "../../components/TabBar"
import { useAttachments } from "../../hooks/useAttachments"
import { usePhone } from "../../hooks/usePhone"
import RefusalNotice from "../new-trak/RefusalNotice"
import GoalModesPicker from "./GoalModesPicker"
import { OPENING_MODES, toggleMode } from "./modes"
import { useStartGoal } from "./useStartGoal"

const STEPS = [
  ["Reads the code", "The composer looks at the repo before it writes anything."],
  [
    "Drafts the goal file",
    "A title, one line, the finished state and limits, for you to approve or correct.",
  ],
  [
    "Opens the first traks",
    "Once you approve the file, with nothing more to approve. It adds traks as they land.",
  ],
] as const

/** The pane before anything runs — where New Trak has its grid, what the start will do. */
const Before = (): ReactNode => (
  <ol className="mx-auto flex max-w-[560px] flex-col gap-3 px-4 py-6 text-sm text-fg-muted">
    {STEPS.map(([title, line], i) => (
      <li key={title} className="flex gap-3 rounded-surface bg-surface p-3 ring-1 ring-border">
        <span className="font-mono text-2xs text-fg-subtle">{String(i + 1)}</span>
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-medium text-fg">{title}</span>
          <span>{line}</span>
        </span>
      </li>
    ))}
  </ol>
)

const NewGoalPage = (): ReactNode => {
  const navigate = useNavigate()
  const phone = usePhone()
  const [asked, setAsked] = useState("")
  const [modes, setModes] = useState(OPENING_MODES)
  const started = useStartGoal((id) => {
    void navigate({ to: "/goals/$id", params: { id } })
  })
  // One addressee, so one scope. A 202 navigates away, which is what empties the box.
  const attached = useAttachments("new-goal")
  const disabled = started.isPending
  const send = (): void => {
    if (!disabled && !attached.uploading && asked.trim() !== "")
      started.start({ asked: asked.trim(), modes, attachments: attached.ids })
  }
  const refused = started.error instanceof RefusedError ? started.error.refusal : undefined

  return (
    <Drawer label="New Goal">
      <ScreenHeader title="New Goal" meta={["not started"]} phone={phone} />

      {!phone && (
        <div className="shrink-0">
          <TabBar label="Goal">
            <Tab label="Traks" icon={ListTree} disabled grow />
            <Tab label="Chat" icon={MessageSquare} disabled grow />
          </TabBar>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <Before />
        </div>
        <GoalModesPicker chosen={modes} onToggle={(m) => setModes(toggleMode(modes, m))} />
        {started.error === undefined ? undefined : (
          <div className="shrink-0 bg-canvas px-4 pt-3">
            {refused === undefined ? (
              <p role="alert" className="text-base text-tone-bad">
                {started.error.message}
              </p>
            ) : (
              <RefusalNotice refusal={refused} />
            )}
          </div>
        )}
        <ChatBar
          id="new-goal"
          label="What should be true when this is done?"
          value={asked}
          onChange={setAsked}
          onSend={send}
          placeholder="Every trak can be found by typing…"
          busy={started.isPending}
          disabled={disabled}
          attach={attached}
          sendLabel="Draft the goal"
        />
      </div>
    </Drawer>
  )
}

export default NewGoalPage
