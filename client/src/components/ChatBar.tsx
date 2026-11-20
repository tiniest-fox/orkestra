/**
 * Somewhere to answer from, at the foot of the drawer.
 *
 * **The footer the trak-detail page argued itself out of, built for the one thing it was
 * wrong about.** An action *bar* was rejected because it would be the drawer answering for
 * whatever the pane happens to be showing — a person standing on an earlier run of a
 * re-composed trak is looking at a proposal nobody is being asked about, and a press
 * there is an event `decide` settles as `Failed{engine}`. That argument holds for
 * presses, which is why approving is still in the proposal card's own header. It does not
 * hold for a place to type: a bar that closes when the pane is not where the trak is
 * waiting sends nothing wrong, and it is the one control that has to be findable without
 * first finding the card that owns it.
 *
 * **No edge, and on the pane's own ground** — which is the one thing here that is not
 * this file's call. The composer sits on the transcript's ground with a send button beside
 * it, and the artifact's header carries no *Reply*, because the chat bar **is** the reply and a
 * button beside a box you type into is two front doors to one room. A rule above it would
 * put the two back in different rooms. The system's *a bar takes an edge* is about a
 * navigator — the step bar has one — and this is the bottom of the conversation.
 *
 * **One box, and what is inside it is the message.** The field and the send share one edge:
 * the send sits inside the field's box, at its end, and the field is `bare` inside it.
 * **Attached files are part of the message, so they sit in the message's box** — the
 * paperclip at its leading edge, the tiles above the text, the sentence for a refused file
 * under them, and the box's own edge as the drop outline (`ChatBox`). A press that acts on
 * the trak rather than on the message is not the box's business and goes `beside`, on the
 * bar's own ground. **`control` is the send changing its meaning, never a second send**: the
 * trak's bar puts the stop there while a turn runs, because the stop *is* the send
 * transformed.
 *
 * **The button sits beside the field, never under it.** The field grows with what you
 * type, and anything below it would move while you were writing.
 *
 * **Lifted here from `features/trak-detail/`** so `new-trak` and `trak-detail` render the
 * same band rather than two copies drifting apart — the two agreeing is the whole point
 * of the New Trak rework. Its two closing decisions (the sentence a shut field shows, and
 * why it is shut) stayed at the two call sites: a `components/` file may not import a
 * feature's type, and `closed`/`disabled` are each feature's own words for it.
 */

import type { KeyboardEvent, ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import Button from "./Button"
import ChatBox from "./ChatBox"
import type { Attachments } from "../hooks/useAttachments"

/**
 * Enter sends; shift-enter is a newline — on a hardware keyboard.
 *
 * On a touch keyboard Enter is a newline and the send button is the send: there is no
 * Shift to reach for, so an Enter that sent would make a two-line message untypeable on
 * a phone. `pointer: coarse` is the question — it is about the input device where the
 * viewport width is not, and an iPad with a hardware keyboard attached reports `fine`
 * and keeps Enter-to-send. Read at the keystroke rather than subscribed to, because the
 * answer is only needed when a key is down; where `matchMedia` does not exist or matches nothing, as
 * under happy-dom, the pointer is fine and Enter sends, which is what the tests are written against.
 *
 * The one keyboard rule either screen using this bar has, so it lives here rather than
 * being copied at each call site.
 */
const sendOnEnter =
  (send: () => void) =>
  (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) return
    if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)
      return
    event.preventDefault()
    send()
  }

const BESIDE = "grid-cols-[minmax(0,1fr)_auto]"
const corners = (above: ReactNode): string =>
  above === undefined ? "rounded-control" : "rounded-b-control"

/**
 * The cell under the box and the presses beside it, across every column: `below`, and
 * `foot` pinned to the bar's bottom padding. `-bottom-4` is `pb-foot`'s 16px and not its
 * inset, so the foot's wrapper bottoms out where the home indicator's inset begins, which
 * is 0 on a desk.
 */
const Under = ({
  below,
  foot,
}: {
  readonly below: ReactNode
  readonly foot: ReactNode
}): ReactNode => (
  <div className="relative col-span-full min-w-0">
    {below}
    {foot === undefined ? undefined : <div className="absolute inset-x-0 -bottom-4">{foot}</div>}
  </div>
)

const ChatBar = ({
  id,
  label,
  value,
  onChange,
  onSend,
  placeholder,
  rows = 1,
  busy = false,
  disabled = false,
  sendDisabled = false,
  autoFocus = false,
  said,
  sendLabel,
  control,
  beside,
  above,
  below,
  foot,
  attach,
}: {
  readonly id: string
  /** Names the field where nothing visible does — `Field`'s own `label`. */
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** Send what is in the field. Called on the button press and on Enter alike. */
  readonly onSend: () => void
  /** Where a field says things about itself — the closing, when the bar is shut. */
  readonly placeholder: string
  readonly rows?: number
  readonly busy?: boolean
  readonly disabled?: boolean
  /**
   * The send alone refused, with the field left open. Disabling a textarea blurs it, so a
   * refusal that can come and go while somebody is typing belongs here, not in `disabled`.
   */
  readonly sendDisabled?: boolean
  /** `Field`'s own: the cursor lands here on mount. */
  readonly autoFocus?: boolean
  /** Why the last send did not land, in a sentence. `undefined` when none has failed. */
  readonly said?: string
  /** The button's own name — the two call sites ask two different questions. */
  readonly sendLabel: string
  /**
   * What stands in the send's place inside the box, where the send's meaning has changed
   * — the trak's stop while a turn runs. One control, never a second beside the send.
   */
  readonly control?: ReactNode
  /** Presses that act on the trak rather than on the text, outside the box beside it. */
  readonly beside?: ReactNode
  /**
   * A band attached to the box's top edge — the trak's background-work list. When it is
   * present the box squares its top corners to meet it, so the two read as one thing:
   * what is above the field is what the conversation below it is still waiting on.
   */
  readonly above?: ReactNode
  /**
   * A row under the box and the presses `beside` it, as wide as the bar less its padding —
   * the trak's spend. The presses stay level with the box rather than the row, and coming
   * and going they leave the row's width alone.
   */
  readonly below?: ReactNode
  /**
   * Drawn in the bar's bottom padding, under `below` and as wide as it — the trak's context
   * fill. Its wrapper's bottom is the padding's 16px, so on a phone it sits on the home
   * indicator's inset rather than under it, and the slot positions itself upward from
   * there. The place and the width are deliberate: on the box's own bottom edge it fought
   * the field for that edge, and as wide as the box it changed length whenever a press
   * beside the box came or went.
   */
  readonly foot?: ReactNode
  /**
   * The files attached to this message, where the bar takes files — `useAttachments`. Its
   * absence draws no paperclip and takes no drop or paste. The send stays shut while any
   * of them is still uploading.
   */
  readonly attach?: Attachments
}): ReactNode => {
  const ready = !disabled && !sendDisabled && value.trim() !== "" && attach?.uploading !== true

  return (
    // `pb-foot` is `pb-4` plus the home indicator's inset — one token, because the two
    // paddings are one property. 16px exactly on desktop, where the inset is 0.
    <div className="flex shrink-0 flex-col gap-2 bg-canvas px-4 pb-foot pt-1">
      {said === undefined ? undefined : (
        <p role="alert" className="text-sm text-tone-bad">
          {said}
        </p>
      )}
      {/* A grid, so `beside` stays level with the box rather than dropping to the foot of
          what is under both. */}
      <div className={`grid items-end gap-x-2 ${beside === undefined ? "grid-cols-1" : BESIDE}`}>
        <div className="flex min-w-0 flex-col">
          {above}
          {/* The ring is the field's own treatment at offset 0, drawn on the box when the
              *field* is what has focus — `has-[textarea:focus-visible]` rather than
              `focus-within`, so the send taking focus does not ring the box around its own
              ring. */}
          <ChatBox
            field={{
              id,
              label,
              placeholder,
              rows,
              value,
              onChange,
              // Enter waits for the uploads as the button does: sent now, the message would
              // name only the files that had finished.
              onKeyDown: sendOnEnter(() => {
                if (attach?.uploading !== true) onSend()
              }),
              autoFocus,
            }}
            attach={attach}
            disabled={disabled}
            rounded={corners(above)}
            send={
              // Non-submittable while in flight, not merely spinning: the server cannot tell
              // a deliberate click from a double one, and two would be two turns.
              control ?? (
                <Button
                  variant="primary"
                  size="lg"
                  icon={ArrowUp}
                  aria-label={sendLabel}
                  busy={busy}
                  disabled={!ready}
                  onClick={onSend}
                />
              )
            }
          />
        </div>
        {/* **`mb-1.5` is the alignment and it is not a nudge.** The grid is `items-end`, so
            without it these sit on the box's bottom *edge* while the send sits 6px up inside
            the box's own `p-1.5` — controls of one height with their centres 8px apart, which
            reads as the outside ones being smaller rather than lower. It is the box's padding
            said again from the outside, so the two move together. */}
        {beside === undefined ? undefined : (
          <span className="mb-1.5 flex shrink-0 items-center">{beside}</span>
        )}
        {below === undefined && foot === undefined ? undefined : (
          <Under below={below} foot={foot} />
        )}
      </div>
    </div>
  )
}

export default ChatBar
