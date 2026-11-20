/**
 * One conversation in the Review section: a line until it is pressed, and the whole
 * exchange — the hunk, the comments, the way out — where it sits once it is.
 *
 * **Pressing the row opens it; the tick is a column of its own at the left edge.** Both
 * gestures are full-size — the tick's column is the 44px touch floor tall, the rest of the
 * row is the opener — so selecting is not fiddly and opening is not accidental. A row with
 * no tick keeps the column empty so the names line up down the card; a pane with nowhere
 * to send a pick draws no column at all.
 *
 * **The close is one control in the head, at its right**, the size of a control rather
 * than the width of the row, and in the place a lid is closed from.
 *
 * **The thread is the unit and not one reply in it.** Resolution belongs to the thread in
 * the forge's model, and answering half a settled conversation is incoherent — so one tick
 * covers every comment in it, and `threadPick` quotes them all in order.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { X } from "lucide-react"
import ConversationHead from "./ConversationHead"
import ForgeComment from "./ForgeComment"
import ForgeLink from "./ForgeLink"
import type { Picked } from "../picks/reentryBody"
import type { Line } from "./reviewLines"
import Tick from "../../../../components/Tick"

const ConversationRow = ({
  line,
  on,
  onToggle,
  now,
}: {
  readonly line: Line
  /** Whether this line's pick is in the list. Always false for a line with no tick. */
  readonly on: boolean
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  readonly now: number
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const press = (): void => {
    setOpen(!open)
  }
  const [first, ...replies] = line.comments
  return (
    <div className={`flex min-w-0 flex-col ${on ? "bg-accent/8" : open ? "bg-hover-row" : ""}`}>
      <div
        className={`flex min-w-0 items-center gap-2 pl-2.5 pr-2 ${open ? "border-b border-border" : ""}`}
      >
        {onToggle !== undefined &&
          (line.pick === undefined ? (
            <span aria-hidden className="w-8 shrink-0" />
          ) : (
            <label className="flex h-11 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-hover-bare">
              <Tick
                on={on}
                label={line.pick.label}
                onChange={() => {
                  if (line.pick !== undefined) onToggle(line.pick)
                }}
              />
            </label>
          ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={press}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control py-2 text-left max-sm:min-h-11"
        >
          <ConversationHead line={line} open={open} />
        </button>
        {open && (
          <button
            type="button"
            aria-label="Close this conversation"
            onClick={press}
            className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:bg-hover-bare hover:text-fg max-sm:size-11"
          >
            <X size={13} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div className="flex min-w-0 flex-col gap-2.5 px-2.5 pb-3 pt-2">
          {line.hunk !== undefined && (
            <pre className="min-w-0 overflow-x-auto whitespace-pre rounded-control bg-surface-2 p-2 font-mono text-2xs text-fg-muted">
              {line.hunk}
            </pre>
          )}
          {first !== undefined && <ForgeComment comment={first} now={now} bare />}
          {replies.map((comment) => (
            <ForgeComment key={comment.url} comment={comment} now={now} reply />
          ))}
          {line.out !== undefined && (
            <span className="flex items-center text-xs text-fg-subtle">
              <ForgeLink url={line.out.url} label={line.out.label} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default ConversationRow
