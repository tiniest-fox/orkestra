/**
 * One thing that can be sent back into the trak, as a card you press.
 *
 * **The checkbox stays, and colour is additive on top of it.** `Tick` is the real `input`
 * and the accessible name; the accent edge and tint on the card ride on top of it rather
 * than instead of it, so the state is still there in greyscale.
 *
 * **The whole card is the press, except a drag and except anything with its own job.**
 * The head row is the `label`, so the tick has the association a screen reader expects; a
 * click anywhere else on the card toggles the same pick, because the tick is a
 * fourteen-pixel target on a card that is mostly prose. Two clicks are left alone: one on
 * anything with a job of its own — a link, the label, a control, the dialog a comment's
 * picture opens in — and one that ends a drag, since reviewer text has to be copyable and
 * the click a drag ends with is told apart from a press by the selection it leaves behind.
 *
 * **No `onToggle` is no tick, and it is the whole of how the pane is drawn read-only.** The
 * card keeps its border and its hover goes: a card that looks pressable and then refuses is
 * worse than a row. `FinishedView` asks `changesOffered` once and the answer arrives here
 * as this prop being absent.
 */

import type { MouseEvent, ReactNode } from "react"
import type { Picked } from "./reentryBody"
import Tick from "../../../../components/Tick"

/**
 * Anything on the card with a job of its own, whose click is not a press on the card: the
 * label, which has already toggled the tick; a link, which is leaving; a form control; and
 * a dialog, which is the picture or diagram a comment opens in the card's own tree — the
 * press that shuts it bubbles up here, and a comment must not tick because its picture was
 * closed. The list is the kinds, not the cases seen so far.
 */
const OWN_JOB = "a, button, label, input, select, textarea, [role='dialog']"

/**
 * Whether a click on the card's body is a press on the card. Not one that landed on
 * something with a job of its own, and not the click that ends a drag, which is what a
 * selection means at the moment the button comes up.
 */
const pressesCard = (event: MouseEvent<HTMLDivElement>): boolean =>
  !(event.target instanceof Element && event.target.closest(OWN_JOB) !== null) &&
  document.getSelection()?.isCollapsed !== false

const SelectCard = ({
  picked,
  on,
  onToggle,
  mark,
  head,
  out,
  meta,
  children,
}: {
  readonly picked: Picked
  readonly on: boolean
  /** Absent where this state has nothing to send a pick to, which draws no tick at all. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  /** A verdict glyph or nothing — whatever names the thing at a glance. */
  readonly mark?: ReactNode
  /** The head row, which is the label: pressing it toggles the tick. */
  readonly head: ReactNode
  /** The way out to the forge, drawn at the right of the head row and outside the label. */
  readonly out?: ReactNode
  readonly meta?: ReactNode
  readonly children?: ReactNode
}): ReactNode => {
  const edge =
    onToggle === undefined
      ? "border-border bg-surface"
      : on
        ? "border-accent bg-accent/8"
        : "border-border bg-surface hover:border-fg-subtle/40 hover:bg-hover-row"
  const Head = onToggle === undefined ? "div" : "label"

  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-surface border px-3 py-2.5 ${edge} ${
        onToggle === undefined ? "" : "cursor-pointer"
      }`}
      onClick={
        onToggle === undefined
          ? undefined
          : (event) => {
              if (pressesCard(event)) onToggle(picked)
            }
      }
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Head className="flex min-w-0 flex-1 items-start gap-2.5">
          {onToggle !== undefined && (
            <span className="flex shrink-0 pt-0.5">
              <Tick
                on={on}
                label={picked.label}
                onChange={() => {
                  onToggle(picked)
                }}
              />
            </span>
          )}
          {mark}
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {head}
          </span>
        </Head>
        {out}
      </div>
      {(children !== undefined || meta !== undefined) && (
        <div className="flex min-w-0 flex-col gap-1 pl-6">
          {children}
          {meta !== undefined && (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-2xs text-fg-subtle">
              {meta}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default SelectCard
