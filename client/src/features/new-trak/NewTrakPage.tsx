/**
 * A trak that does not exist yet.
 *
 * **The same drawer the real one uses**, four bands in the same order: a header on
 * `surface`, an inert navigator on `surface`, a pane that scrolls on `canvas`, and the
 * chat bar at the foot — so starting a trak is not a different place.
 *
 * **One band the real drawer has no answer for, and it is the one place the two differ**:
 * the mode strip is pinned between the pane and the chat bar, so this foot is taller than
 * the detail drawer's and the pane grows by that much when the trak starts. Reachability
 * is what buys the jump — a strip scrolling with the grid keeps the two feet identical and
 * puts the one answer a trak cannot be given twice below every tile in the library. The
 * jump is paid once, on the move to a screen that is filling with something else anyway.
 *
 * **Below the phone breakpoint the inert bands are not drawn at all, and that reverses
 * the paragraph above knowingly.** The bands exist to stop the page changing shape when
 * the trak starts; the phone rounds measured what they cost there — 159px of pane with
 * the keyboard up against 280 without them — and chose the room: on a phone the keyboard
 * is up for most of this screen's life, and a pane too short to read the agent grid in
 * is a higher price than one jump on a navigation that repaints everything anyway. So
 * the phone gets header, pane, mode strip and composer, and no disabled navigator and no
 * empty rail. Do not "fix" the phone layout by putting the bands back. The header's
 * metadata row is not one of them: it is `ScreenHeader`'s at every width, one mono line.
 *
 * **A route, not a piece of local state.** The drawer is already URL-addressable, so
 * close and back work for free and a page test can mount it under a memory history.
 *
 * Submitting spends money — `useCreateTrak` carries the rules that come with that. On
 * `202` the id arrives and this navigates to the real drawer, which grows the same three
 * bands around its own first load while the engine composes and the stream fills it in.
 *
 * **The pane is the choice of what this trak will be**, which is what `AgentGrid` draws;
 * it replaced the empty state, because a screen with one field had nothing to say about
 * the fact that the composer is one option among nine. What is *typed* is unchanged
 * either way: the description is the request, and picking an agent never makes it
 * optional.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import ChatBar from "../../components/ChatBar"
import Drawer from "../../components/Drawer"
import ScreenHeader from "../../components/ScreenHeader"
import Rail from "../../components/Rail"
import StepBar from "../../components/StepBar"
import { RefusedError } from "../../api/http"
import AgentGrid from "./AgentGrid"
import AutoMergeSwitch from "./AutoMergeSwitch"
import ModePicker from "./ModePicker"
import RefusalNotice from "./RefusalNotice"
import { useAgents } from "../../hooks/useAgents"
import { useAttachments } from "../../hooks/useAttachments"
import { usePhone } from "../../hooks/usePhone"
import { useCreateTrak } from "./useCreateTrak"
import { useAutoMerge } from "./useAutoMerge"
import { useRunMode } from "./useRunMode"

const PLACEHOLDER = "Add an --json flag to the export command…"

/**
 * The grid could not be read. Not the whole screen's failure — Compose a plan is this
 * file's own copy and is the default, so the primary way to start a trak is unaffected
 * and the sentence says so rather than reading as an outage.
 */
const NO_AGENTS = "Could not read which agents can start a trak. Compose a plan still can."

const NewTrakPage = (): ReactNode => {
  const navigate = useNavigate()
  const phone = usePhone()
  // A description another screen wrote ahead of the person — the git bar's request for a
  // merge. Laid into the field during render, once per hand-over rather than in an
  // effect, because the page may already be open when one arrives; the person's own
  // typing after it is theirs.
  const handed = useRouterState({ select: (s) => s.location.state.description })
  const [taken, setTaken] = useState(handed)
  const [description, setDescription] = useState(handed ?? "")
  if (handed !== taken) {
    setTaken(handed)
    if (handed !== undefined) setDescription(handed)
  }
  /** `undefined` is Compose a plan — the absence of an agent, which is what is sent. */
  const [agent, setAgent] = useState<string | undefined>(undefined)
  /** Not page state: the last one picked is what the field opens on. See `useRunMode`. */
  const { mode, pick } = useRunMode()
  const { on: autoMerge, pick: pickAutoMerge } = useAutoMerge()
  const agents = useAgents()
  const started = useCreateTrak((id) => {
    void navigate({ to: "/traks/$id", params: { id } })
  })
  // One addressee, so one scope. A 202 navigates away, which is what empties the box.
  const attached = useAttachments("new-trak")

  // Blank is refused here rather than by the engine: there is nothing to compose from,
  // and a round trip to be told so is a round trip that spends nothing and says nothing.
  // Picking an agent is never enough on its own — an agent with no request is a turn
  // with nothing in it.
  const ready = !started.disabled && description.trim() !== "" && !attached.uploading
  const send = (): void => {
    // No model: New Chat is the one door with a pick, so a tile here — the engine's own
    // agent included — runs on its file's `model:`.
    if (ready) {
      started.start({
        description: description.trim(),
        agent,
        mode,
        model: undefined,
        autoMerge,
        attachments: attached.ids,
      })
    }
  }

  return (
    <Drawer label="New Trak">
      <ScreenHeader title="New Trak" meta={["not started"]} phone={phone} />

      {/* The real navigator with nothing behind it: the three segments are drawn and
          disabled, so starting a trak does not move the bar it arrives in. Not on the
          phone, which is the docstring's reversal. */}
      {!phone && <StepBar level="step" caption="Waiting for a description" disabled />}

      {/* Empty, and the same 48px the marks will take — so the pane does not slide
          sideways when the trak this describes starts and its plan arrives. Same reason
          the bar above is the real one, disabled. */}
      <div className="flex min-h-0 flex-1">
        {!phone && <Rail />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
            {/* No skeleton while the list is out: the card below it is already the
                default and already pressable, so ghosts would be promising something
                the screen does not need in order to work. */}
            <AgentGrid
              // Filtered here, because this is the one screen the question belongs to:
              // the route sends the whole library so a plan's `unblock` or `resolve` has
              // an icon something can reach, and `start:` is what says a person may open
              // a trak with one.
              agents={(agents.data ?? []).filter((a) => a.start)}
              picked={agent}
              onPick={setAgent}
              said={agents.data === undefined && agents.isError ? NO_AGENTS : undefined}
              phone={phone}
            />
          </div>

          {/* Pinned at the foot rather than scrolling with the grid above it, and after it
              in the reading order — what this trak will be, then how much of it you want to
              see. The grid is a list that grows with the library, so a strip inside it is
              reached only by scrolling past every tile, which is the wrong price for the one
              answer a trak cannot be given twice.

              **On the pane's ground with no edge**, which is `ChatBar`'s decision rather
              than a second one: the two are one footer, and a rule between them would say
              they are answering different things. It means the last tile scrolls up and
              out from under it with no seam — the same way a transcript meets the chat bar
              on the drawer this one is a copy of. */}
          <ModePicker picked={mode} onPick={pick} />
          <AutoMergeSwitch on={autoMerge} onToggle={pickAutoMerge} />

          {started.error instanceof RefusedError ? (
            <div className="shrink-0 bg-canvas px-4 pt-3">
              <RefusalNotice refusal={started.error.refusal} />
            </div>
          ) : started.error === undefined ? undefined : (
            <p role="alert" className="shrink-0 bg-canvas px-4 pt-3 text-base text-tone-bad">
              {started.error.message}
            </p>
          )}

          <ChatBar
            id="new-trak-description"
            label="What do you want done?"
            value={description}
            onChange={setDescription}
            onSend={send}
            placeholder={PLACEHOLDER}
            busy={started.isPending}
            disabled={started.disabled}
            attach={attached}
            /* The send is icon-only, so this reaches an `aria-label` and no pixels —
               and it is the only place the choice is spoken. What names the chosen
               agent on screen is its edge. */
            sendLabel={agent === undefined ? "Start trak" : `Start ${agent}`}
          />
        </div>
      </div>
    </Drawer>
  )
}

export default NewTrakPage
