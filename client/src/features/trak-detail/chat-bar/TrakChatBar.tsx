/**
 * The shared `ChatBar` as this feature words it — the footer band of a loaded trak.
 *
 * **A view, because the page ran out of room.** `TrakHeader` took the header band and
 * `LoadingDrawer` took the first frame for the same reason; the page composes bands and
 * builds the presses that hang off them, and the wiring for the footer is the next thing
 * that is not a decision. `max-lines-per-function` is the forcing function, and
 * `client-style` says the answer to it is a view rather than a relaxation.
 *
 * **Why the bar is shut still belongs to the page.** `chatClosed` reads the state, the
 * row and custody together — three things this file does not have and should not ask
 * for — so it arrives as `closed`, and everything here is how that one word is drawn: as
 * the placeholder, because a field greyed out with its ordinary invitation still showing
 * reads as broken, and as half of `disabled`.
 *
 * **Custody shuts the send, never the field.** `chat.disabled` is a send in flight or
 * somebody else driving at a state that keeps nothing — and the second comes and goes for
 * one frame each time a turn parks at a gate. A disabled textarea is a blurred one, so
 * that half reaches the button alone and the field keeps the cursor of whoever is typing.
 *
 * **While an agent is working the box's one control follows the draft.** With the field
 * empty it is a stop, which takes the send's place inside the box rather than sitting
 * beside it — `ChatBar`'s `control` slot, which exists for exactly this. Once the field
 * holds text it is the send again: the field is open while a turn runs, and what is sent
 * waits for the agent. One button either way, at one size, so the field keeps its width.
 *
 * **The break-out cluster is outside the box**, whichever meaning the box's control has:
 * `BreakOut` draws it beside the box on the bar's own ground, and each press arrives when
 * the page hands its hook in. Where nothing is filed it is File it and Recompose; where a
 * document gate's prose reply has taken its presses off their card it is Approve and
 * Recompose. On a phone the first pair is one `⋯` instead. The bar takes its cluster at
 * every state so the presses can leave rather than vanish — `Reveal` carries why.
 *
 * **The row under the box and the line at the bar's foot are the step on screen's usage** —
 * everything it has spent, and how full its context window is. Both are about the step the reader
 * is looking at, not the one running, so stepping back to an earlier step shows that
 * step's figures; both grow while that step's turn runs. `usage` arrives folded, and
 * `SpendRow` and `ContextLine` carry how each is drawn.
 *
 * **The model and effort that step runs on lead the row under the box**, before the spend
 * figure — under the field it governs rather than in the header. The same place at a
 * piece's step, where the token is the piece's. It draws alone where nothing was spent yet,
 * and the row is not drawn at all where there is neither.
 *
 * **Several hooks can refuse, and the bar has one line for it.** The chat's, the stop's, the
 * approval's and the filing's sentences are drawn in the same place, first defined first:
 * they are about the same footer, and at most one of those presses is live at any state.
 */

import type { ReactNode } from "react"
import ChatBar from "../../../components/ChatBar"
import BackgroundStrip from "../turns/jobs/BackgroundStrip"
import BreakOut from "./BreakOut"
import ModelToken from "../ModelToken"
import ContextLine from "../tokens/ContextLine"
import SpendRow from "../tokens/SpendRow"
import type { StepUsage } from "../tokens/usage"
import type { OutstandingJob } from "../turns/jobs/outstanding"
import type { Approval } from "../useApprove"
import type { Filing } from "../useFile"
import type { Recomposing } from "./useRecompose"
import type { Chat } from "./useSendChat"
import type { Stopping } from "../useStop"
import type { StoppingJob } from "../useStopJob"
import StopControl from "./StopControl"

/** A stable empty list, so the default prop is not re-created per render. */
const NO_JOBS: readonly OutstandingJob[] = []

const TrakChatBar = ({
  chat,
  stopping,
  approving,
  filing,
  recomposing,
  closed,
  outstanding = NO_JOBS,
  stoppingJob,
  cancelling,
  usage,
  model,
  effort,
  phone,
}: {
  readonly chat: Chat
  /** The press, while a turn is in flight to interrupt. `undefined` offers none. */
  readonly stopping?: Stopping
  /**
   * The gate's approval, where a prose reply has taken it off its card so it welds to the
   * recompose beside the bar instead. `undefined` offers none.
   */
  readonly approving?: Approval
  /** The filing press, where the state offers it. `undefined` offers none. */
  readonly filing?: Filing
  /** The recompose press, where the state offers it *here*. `undefined` offers none. */
  readonly recomposing?: Recomposing
  /** Why the bar is shut, in a sentence, or `undefined` when it is open. */
  readonly closed?: string
  /**
   * The background work still running, for the strip on the box's top edge. The page
   * folds it from the transcript and empties it where nothing is driving — a stored
   * level from a dead turn is work that died with it.
   */
  readonly outstanding?: readonly OutstandingJob[]
  /** The per-job stop, for the strip's rows. `undefined` draws the list with no press. */
  readonly stoppingJob?: StoppingJob
  /**
   * The press that ends a check in flight. Drawn in the check console's band, not here —
   * the bar reads it for its refusal alone, because a sentence has one home on this screen
   * and the band has no room for one.
   */
  readonly cancelling?: Stopping
  /** The step on screen's spend and last reading. `undefined` where nothing was measured. */
  readonly usage: StepUsage | undefined
  /** The model the step on screen runs on, or nothing where it is not one agent's turn. */
  readonly model: string | undefined
  /** The effort beside it, or nothing where none was declared. */
  readonly effort: string | undefined
  /** `usePhone`'s answer, for the break-out cluster — `BreakOut`. */
  readonly phone: boolean
}): ReactNode => (
  <ChatBar
    id="trak-chat"
    label="Say something to the agent"
    value={chat.draft}
    onChange={chat.write}
    onSend={chat.send}
    // Short, at both measures: at a phone's 358 the box beside two presses has about 122px
    // of text, and *Say something to the agent…* clipped in it. What it gives up is the
    // word *agent*, which was the only thing on the bar saying who is on the other end.
    placeholder={closed ?? "Say something…"}
    busy={chat.isPending}
    // The state and the row say the bar is shut; a send in flight shuts it too. Somebody
    // else driving refuses the send alone — the file's header says why.
    disabled={closed !== undefined || chat.isPending}
    sendDisabled={chat.disabled}
    said={
      chat.said ??
      stopping?.said ??
      approving?.said ??
      filing?.said ??
      stoppingJob?.said ??
      cancelling?.said
    }
    above={
      outstanding.length === 0 ? undefined : (
        <BackgroundStrip jobs={outstanding} stopping={stoppingJob} />
      )
    }
    sendLabel="Send"
    attach={chat.attached}
    control={
      // The draft decides: something typed is something to send, and the stop comes
      // back the moment the field is empty again.
      stopping === undefined || chat.draft.trim() !== "" ? undefined : (
        <StopControl stopping={stopping} label="Stop the agent" />
      )
    }
    below={
      model === undefined && usage === undefined ? undefined : (
        <div className="flex min-w-0 items-start gap-2">
          {model !== undefined && (
            // Level with the spend row's figure, which sits `pt-2` below the box.
            <span className="flex min-w-0 shrink pt-1.5">
              <ModelToken model={model} effort={effort} />
            </span>
          )}
          {usage !== undefined && (
            <div className="min-w-0 flex-1">
              <SpendRow usage={usage} />
            </div>
          )}
        </div>
      )
    }
    foot={usage?.context === undefined ? undefined : <ContextLine reading={usage.context} />}
    beside={
      <BreakOut approving={approving} filing={filing} recomposing={recomposing} phone={phone} />
    }
  />
)

export default TrakChatBar
