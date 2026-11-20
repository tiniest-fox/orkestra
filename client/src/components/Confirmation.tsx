/**
 * Are you sure — as the second state of the panel it was asked in, not as a dialog.
 *
 * **There is no dialog primitive to put this in, and `Lightbox` is not one** — that draws
 * one thing on a wash and knows nothing of headings, sentences or presses.
 *
 * **Two homes, and this file knows neither.** In an `OverflowMenu` it replaces the items
 * that opened it, at the same anchor and under the same shadow, so nothing moves and
 * nothing is covered — the whole exchange one popover wide, which is what makes a
 * destructive press affordable without a modal. Promoted beside a press instead
 * (`FinishedActs`), the caller floats it over the row in a `role="dialog"` wrapper of its
 * own, and it does cover what is behind — accepted there in favour of one placement rule.
 *
 * **Two presses, and the sentence is what the second one buys.** Killing a `claude`
 * mid-turn and taking a checkout away are both irreversible, and neither takes a typed
 * message — *without a message* was not read as *without a confirmation*. So the body says
 * what will happen in one line and the press says what it is, and there is no field.
 *
 * **Cancel first and both on one row.** Stacked, the destructive press is the biggest
 * target in the panel; side by side and right-aligned, the way out is the one under the
 * reading order's thumb.
 *
 * `said` is the refusal the press earned, drawn where the press is — the panel outlives a
 * refused press, because the way through one is to read it and try again.
 *
 * **It takes focus onto its own press as it opens, and that is a ref and an effect in a
 * primitive whose neighbours document themselves as having neither.** What opens it in the
 * menu is a `MenuItem` that unmounts in the same commit, and Chromium then puts focus on
 * `<body>` rather than anywhere in the panel — measured, with a mouse and with a keyboard.
 * So the panel stood there unfocused, and getting to *Cancel* meant tabbing from the top of
 * the page. Taking the focus is the whole fix, and it has to be here rather than in the
 * menu, which never knows what is in its slot.
 *
 * **Escape is the container's, in both homes, and never this file's** — `OverflowMenu`'s
 * own group in one, the promoted wrapper in the other, each a plain handler a keystroke
 * aimed at the document never reaches. That is what the focus-taking above buys: a
 * container that mounts this and owns no Escape handler is a panel Escape cannot shut.
 *
 * **`useLayoutEffect` and the mount alone.** Before paint, because a frame with focus
 * nowhere is a frame where a keystroke goes to the page instead of to the panel; and it
 * touches nothing but the ref it holds, which is what keeps this inside the presentational
 * kind's one exception rather than making it a hook. It does not chase focus afterwards —
 * the press disables itself while its own mutation is in flight, which drops focus back to
 * `<body>` a second time, and putting that back is a separate decision nobody has taken.
 *
 * **The press rather than Cancel**, which is otherwise the one under the reading order's
 * thumb: focus goes to what the panel is asking about, and Tab from it reaches Cancel. The
 * press that opened the panel cannot carry through into this one — Enter activates a button
 * on `keydown` and Space on `keyup`, so the event that is left over after the item is gone
 * is never the one that presses anything. `e2e/app.spec.ts` opens it with a real Enter and
 * asserts nothing was sent.
 *
 * **`sheet` is the third home: `ConfirmSheet`, a phone's bottom sheet.** The same parts at
 * the sheet's width — the refusal above the presses, Cancel on the left and the press filling
 * the rest of the row, both at the phone's 44px touch floor.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import { TriangleAlert } from "lucide-react"
import Button from "./Button"

export interface ConfirmationProps {
  readonly heading: string
  /** What the destructive press says. */
  readonly press: string
  readonly busy?: boolean
  readonly disabled?: boolean
  /** Why the last press did not land, in a sentence. */
  readonly said?: string | undefined
  readonly onCancel: () => void
  readonly onConfirm: () => void
  /** One line saying what will happen. */
  readonly children: ReactNode
}

const Confirmation = ({
  heading,
  press,
  busy = false,
  disabled = false,
  said,
  onCancel,
  onConfirm,
  sheet = false,
  children,
}: ConfirmationProps & {
  /** Laid out for `ConfirmSheet` rather than for a panel. */
  readonly sheet?: boolean
}): ReactNode => {
  const confirmPress = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    confirmPress.current?.focus()
  }, [])

  const confirm = (
    <Button
      ref={confirmPress}
      variant="danger"
      size={sheet ? "md" : "sm"}
      busy={busy}
      disabled={disabled}
      block={sheet}
      onClick={onConfirm}
    >
      {press}
    </Button>
  )
  return (
    <div className={sheet ? "flex flex-col gap-3 px-gutter pb-3" : "flex w-72 flex-col gap-2 p-2"}>
      <div className={sheet ? "flex items-start gap-2" : "flex items-center gap-1.5"}>
        <TriangleAlert
          size={sheet ? 16 : 13}
          className={sheet ? "mt-0.5 shrink-0 text-tone-bad" : "text-tone-bad"}
          aria-hidden
        />
        <span className="text-base font-medium text-fg">{heading}</span>
      </div>
      <p className="text-sm text-fg-muted">{children}</p>
      {said !== undefined && (
        <span role="alert" className="text-sm text-tone-bad">
          {said}
        </span>
      )}
      {sheet ? (
        <div className="flex gap-2 pt-1">
          <Button variant="quiet" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <span className="flex min-w-0 flex-1">{confirm}</span>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {confirm}
        </div>
      )}
    </div>
  )
}

export default Confirmation
