/**
 * The box in the band — above the press row at desk, in its place on a phone: what has been
 * ticked, the sentence to send with it, where it goes, and — at its foot — the send and the
 * way out, which
 * `FinishedActs` hands in as `actions`. It sits inside the pinned band so the send is on
 * screen whenever the box is, and nothing is inserted into the row while it is open.
 *
 * **A box a door press opens takes focus into its field** — `useTakeFocus`. A box a tick
 * opens takes none: the reader is on the card, and a phone keyboard rising over it would
 * be the wrong answer.
 *
 * **One box, two doors, and three strings between them.** Which press opened it decides the
 * label, the line at the foot and the words on the send — `doorWords`, in `finished.ts` with
 * the rest of this pane's copy — and, through the agent it names, who reads what is sent.
 * Nothing in here is a control with a value: there is no picker, so no state can be left
 * disagreeing with the words around it, and no list grows when `.orkestra/agents/` does.
 *
 * **One request carries all of it.** Ticking three things and writing one sentence sends a
 * single re-entry, not four — *fix the checks, resolve the conflict and address these three
 * comments* is one piece of work, and `reentryBody` is where it becomes one string. That
 * holds through either door: a tick and a question is one re-entry too.
 *
 * **`POST /reenter` takes one required string**, so the send is never a bare press — and
 * the copy says where it goes, because somebody who reads the box as a note to themselves
 * will write one and it will become a plan. `reentryBody` is composed by the send
 * `FinishedActs` hands in, off the same list and sentence drawn here.
 *
 * **At desk, what has been picked shows as named lines here, each with its own remove**,
 * rather than as a count or as the ticks alone: the row a tick is on can be several folds
 * away by the time the sentence is written. Removing a line is the same act as unticking its
 * row — `reentryBody` holds the one list both read. **On a phone it is a count** at the right
 * of the label line, with no list and no remove: the chrome above the pane stays pinned there,
 * and the box has to leave room for the ticks above it, which are where unticking happens.
 *
 * `components/Field` rather than a `textarea`: it is the one control you type into here, it
 * grows with what is in it, and the chat bar already uses it.
 */

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { X } from "lucide-react"
import Button from "../../../../components/Button"
import Field from "../../../../components/Field"
import type { Door } from "../finished"
import { doorWords, pickedCount } from "../finished"
import type { Picked } from "../../pull-request/picks/reentryBody"
import type { Changes } from "./useReenter"
import { useTakeFocus } from "./useTakeFocus"

const ChangeRequest = ({
  door,
  glyph,
  changes,
  picked,
  onRemove,
  taken,
  phone,
  actions,
}: {
  /** Which press opened it, and so where what is in it goes. `doorWords`. */
  readonly door: Door
  /** Whether a door press is what opened it, or switched it — the case that takes focus. */
  readonly taken: boolean
  /** Below the seam, where the focus raises a keyboard over the band. `useTakeFocus`. */
  readonly phone: boolean
  /** The mark the ask door's agent wears, off the wire. Unused at the plan door, which
   *  names nobody — `agentGlyph` is what resolves it, and `FinishedView` asks. */
  readonly glyph: LucideIcon
  readonly changes: Changes
  /** What was ticked on the pull-request half. Empty on a trak that has no pull request. */
  readonly picked: readonly Picked[]
  readonly onRemove: (key: string) => void
  /** The send and the way out, drawn at the foot beside where it goes. */
  readonly actions: ReactNode
}): ReactNode => {
  const words = doorWords(door)
  const Glyph = glyph
  // Per door, so the label and the control it names cannot be two boxes' worth apart.
  // Only one is ever mounted: `FinishedActs` holds one door at a time.
  const field = `reentry-${door}`
  useTakeFocus(field, taken, phone)

  return (
    <div className="flex flex-col gap-2 rounded-surface border border-border bg-surface p-3">
      <div className="flex items-baseline gap-2">
        <label className="min-w-0 flex-1 text-sm font-medium text-fg" htmlFor={field}>
          {words.label}
        </label>
        {phone && picked.length > 0 && (
          <span className="shrink-0 text-sm text-fg-subtle">{pickedCount(picked.length)}</span>
        )}
      </div>
      {/* Two lines, then it scrolls in place: the box is in the pinned band, and a list
          that grew with every tick covered the card being ticked. */}
      {!phone && picked.length > 0 && (
        <div className="flex max-h-14 flex-col gap-2 overflow-y-auto max-sm:max-h-24">
          {picked.map((one) => (
            <span key={one.key} className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
              <span className="min-w-0 flex-1 truncate">{one.label}</span>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                aria-label={`Remove ${one.label}`}
                disabled={changes.disabled}
                onClick={() => {
                  onRemove(one.key)
                }}
              />
            </span>
          ))}
        </div>
      )}
      <Field
        id={field}
        label={words.label}
        value={changes.what}
        onChange={changes.write}
        disabled={changes.disabled}
        placeholder={words.placeholder}
      />
      {/* Where this is going, in the same place at both doors. The agent's name is drawn
          the way every other name on this pane is — mono, off the wire — and its mark
          beside it, which is the only thing here that knows an agent exists at all. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-fg-subtle">
          {words.agent !== undefined && <Glyph size={13} aria-hidden className="shrink-0" />}
          <span className="min-w-0">
            {words.agent !== undefined && (
              <>
                <span className="font-mono text-fg">{words.agent}</span>{" "}
              </>
            )}
            {words.foot}
          </span>
        </span>
        {actions}
      </div>
    </div>
  )
}

export default ChangeRequest
