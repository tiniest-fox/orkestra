/**
 * A chat that does not exist yet.
 *
 * **New Trak with everything that is a form taken off it, but one.** Same drawer, same
 * four bands — header, inert navigator, pane, chat bar — so a chat is not a different
 * place; but no shelf, no mode strip, and the cursor already in the field, because the
 * whole point of this door is that the first thing you do is type. The one thing left to
 * choose is which model answers, and it stands in the pane where New Trak's shelf does —
 * `ModelGrid` says why. What it opens is an ordinary trak: its own worktree,
 * the remembered mode, and a one-entry conversational plan on the engine's own agent —
 * the same request New Trak sends with that agent's tile picked, plus the model where
 * one was pressed, but never in `auto`. There is no special kind of trak behind this
 * screen, and nothing here says otherwise.
 *
 * **The model governs this chat's own turns only.** It rides the one plan entry this
 * door opens, so if the chat raises work and is replanned, every step the composer adds
 * runs on its own agent file's `model:`. And it is sent only when a tile was pressed:
 * until then the request is exactly what it was before the picker existed, and the
 * engine runs the default — which is also the tile drawn as chosen, so pressing it or
 * not pressing it asks for the same thing.
 *
 * **The remembered mode, but never `auto`.** The mode is set at creation and inherited
 * by whatever the chat becomes, so a chat that always opened in `manual` made somebody
 * who runs in `smart` approve every step it raised by hand. `auto` is what it must not
 * be: `approvedInAdvance` short-circuits every stop in `attention.ts`, so the chat would
 * answer, close, and plan and run whatever it raised with nobody reading any of it.
 * `forChat` reads `auto` as `smart`, which is not the hazard — `plannedAsConversation`
 * holds a conversational entry at its gate whatever it filed. Picking this same agent's
 * tile on New Trak sends the remembered mode and has no such guard. This screen reads
 * `useRunMode` but does not offer the strip, so a chat never changes what is remembered.
 *
 * **Below the phone breakpoint the inert bands are not drawn**, for New Trak's reason
 * and by the same test: the bands exist so the page does not change shape when the trak
 * starts, and on a phone the keyboard is up for most of this screen's life, so the pane
 * they cost is worth more than the jump they save. Header, pane and composer, and no
 * disabled navigator and no empty rail.
 *
 * **The phone door is the list's dock.** The app bar's slot is hidden below the
 * breakpoint, and `traks-list/Dock` carries both doors as one split pill — New Chat is
 * its left half.
 *
 * Submitting spends money — `useCreateTrak` carries the rules that come with that. On
 * `202` the id arrives and this navigates to the real drawer, which the stream fills in.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import ChatBar from "../../components/ChatBar"
import Drawer from "../../components/Drawer"
import ScreenHeader from "../../components/ScreenHeader"
import Rail from "../../components/Rail"
import StepBar from "../../components/StepBar"
import { RefusedError } from "../../api/http"
import { GENERIC_AGENT } from "../../format/engineAgent"
import { usePhone } from "../../hooks/usePhone"
import ModelGrid from "./ModelGrid"
import RefusalNotice from "./RefusalNotice"
import { forChat } from "./runMode"
import { useCreateTrak } from "./useCreateTrak"
import { useRunMode } from "./useRunMode"
import { useModels } from "../../hooks/useModels"

const PLACEHOLDER = "How does the export command decide which fields to write?"

/**
 * The list could not be read. Not the whole screen's failure — a chat sent with no model
 * runs on the engine's default, which is what every chat did before there was a list, so
 * the field stays live and the sentence says so rather than reading as an outage.
 */
const NO_MODELS = "Could not read which models a chat can run on. It runs on the default."

const NewChatPage = (): ReactNode => {
  const navigate = useNavigate()
  const phone = usePhone()
  const [description, setDescription] = useState("")
  /** `undefined` until a tile is pressed — the engine's default, which is what is sent: nothing. */
  const [model, setModel] = useState<string | undefined>(undefined)
  const models = useModels()
  const mode = forChat(useRunMode().mode)
  const started = useCreateTrak((id) => {
    void navigate({ to: "/traks/$id", params: { id } })
  })

  // Blank is refused here rather than by the engine, for New Trak's reason: a round
  // trip to be told there is nothing to say is a round trip that spends nothing.
  const ready = !started.disabled && description.trim() !== ""
  const send = (): void => {
    if (ready)
      started.start({
        description: description.trim(),
        agent: GENERIC_AGENT,
        mode,
        model,
        autoMerge: false,
        attachments: [],
      })
  }

  return (
    <Drawer label="New Chat">
      <ScreenHeader title="New Chat" meta={["not started"]} phone={phone} />

      {/* The real navigator, disabled, and the rail's box with nothing in it — for
          New Trak's reason: nothing moves when the trak this becomes arrives. Neither
          is drawn on a phone, which is the docstring's reversal. */}
      {!phone && <StepBar level="step" caption="Waiting for a message" disabled />}

      <div className="flex min-h-0 flex-1">
        {!phone && <Rail />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
            {/* No skeleton while the list is out, for New Trak's reason: the field below
                is already live and a send without a pick is the default, so ghosts would
                promise something the screen does not need in order to work. */}
            <ModelGrid
              models={models.data?.allowed ?? []}
              chosen={model ?? models.data?.default}
              onPick={setModel}
              said={models.data === undefined && models.isError ? NO_MODELS : undefined}
            >
              The first thing you send starts a trak, on its own branch, with {GENERIC_AGENT}{" "}
              answering. Ask it to build something and it can raise that as work.
            </ModelGrid>
          </div>

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
            id="new-chat-description"
            label="What do you want to know?"
            value={description}
            onChange={setDescription}
            onSend={send}
            placeholder={PLACEHOLDER}
            busy={started.isPending}
            disabled={started.disabled}
            autoFocus
            sendLabel="Start chat"
          />
        </div>
      </div>
    </Drawer>
  )
}

export default NewChatPage
