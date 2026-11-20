/**
 * Are you sure, on a phone: `Confirmation` in a bottom sheet rising from the foot, under the
 * thumb. At a desk the same question
 * stays where it is asked, in a menu or floated over the row; each caller picks between the
 * two from `usePhone`, because only one of them may be in the tree.
 *
 * `Sheet`'s frame: `fixed inset-0` at `z-40` on the wash with no portal, the rounded top, the
 * grab bar, the home indicator paid at the foot, and Escape and a press on the wash as plain
 * handlers on this node — both cancel. **No swipe**: the grab bar is drawn, as in every
 * other sheet, and nothing closes on one.
 *
 * **It takes no focus onto the frame, which is where it parts from `Sheet`.** `Confirmation`
 * focuses its own press in a layout effect, and a parent's layout effect runs after its
 * child's, so a frame that focused itself would take focus off the press. The press is
 * inside the frame, so Escape still reaches the handler here.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import Confirmation, { type ConfirmationProps } from "./Confirmation"

const ConfirmSheet = (props: ConfirmationProps): ReactNode => (
  <div
    role="dialog"
    aria-label={props.heading}
    className="fixed inset-0 z-40 flex flex-col justify-end bg-scrim"
    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") props.onCancel()
    }}
    onClick={(event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) props.onCancel()
    }}
  >
    <div className="flex max-h-[85%] min-h-0 flex-col overflow-y-auto rounded-t-sheet bg-surface pt-2 pb-safe-b shadow-modal">
      <span aria-hidden className="mx-auto mb-3 block h-1 w-9 shrink-0 rounded-pill bg-border" />
      <Confirmation {...props} sheet />
    </div>
  </div>
)

export default ConfirmSheet
