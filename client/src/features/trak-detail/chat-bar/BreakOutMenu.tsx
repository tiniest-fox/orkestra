/**
 * The filing cluster on a phone: *File it* and *Recompose* behind one `⋯` at the bar's
 * right edge, rather than two presses beside the box.
 *
 * **Two plates cost the field about 96px at a phone's 375**, which is a third of what the
 * box had left; one press costs it half that. The desk keeps the pair, where the field has
 * room for both — `BreakOut` draws one or the other on `usePhone`'s answer.
 *
 * **The touch target runs to the screen's edge.** The trigger is a 44px square plus the
 * bar's own 16px of `px-4`, pulled into that padding by `-mr-4`, so a thumb pressing at the
 * edge lands on it. Nothing draws in the extra 16px: the trigger is ghost-like, with no
 * plate whose edge would show the box is wider than its glyph. The menu's `relative`
 * wrapper keeps the 44px width, so the panel's `right-0` sits on the bar's padding line
 * rather than flush with the glass.
 *
 * **Not in a `Reveal`.** Its inner span is `overflow-hidden`, which would clip both the
 * 16px pulled into the padding and the panel hanging above the trigger. So the press
 * arrives and leaves without the fade the desk pair keeps.
 *
 * **The trigger shows the filing's spinner.** Choosing *File it* shuts the panel, so the
 * item cannot carry `busy`; the trigger swaps to the spinner instead, one module-level
 * trigger per state so `OverflowMenu` keeps its identity across renders.
 */

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Loader2, MoreHorizontal, PackageCheck, Route } from "lucide-react"
import MenuItem from "../../../components/MenuItem"
import OverflowMenu, { type TriggerProps } from "../../../components/OverflowMenu"
import type { Filing } from "../useFile"
import type { Recomposing } from "./useRecompose"

const trigger = (busy: boolean) => {
  const Glyph = busy ? Loader2 : MoreHorizontal
  const Trigger = ({ open, toggle }: TriggerProps): ReactNode => (
    <button
      type="button"
      aria-label="More actions"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={toggle}
      className="-mr-4 inline-flex h-11 w-15 shrink-0 items-center justify-center pr-4 text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <Glyph size={18} aria-hidden className={busy ? "animate-spin" : undefined} />
    </button>
  )
  return Trigger
}

const IDLE = trigger(false)
const BUSY = trigger(true)

/** A glyph and its words, at the size `Button` draws a glyph beside a label. */
const Item = ({
  icon: Icon,
  children,
}: {
  readonly icon: LucideIcon
  readonly children: string
}): ReactNode => (
  <span className="flex items-center gap-2">
    <Icon size={13} aria-hidden />
    {children}
  </span>
)

const BreakOutMenu = ({
  filing,
  recomposing,
}: {
  /** The filing press, where the state offers it. `undefined` leaves its item out. */
  readonly filing: Filing | undefined
  /** The recompose press, where the state offers it here. `undefined` leaves its item out. */
  readonly recomposing: Recomposing | undefined
}): ReactNode =>
  filing === undefined && recomposing === undefined ? undefined : (
    <span className="ml-1 flex">
      <OverflowMenu up trigger={filing?.isPending === true ? BUSY : IDLE}>
        {(shut) => (
          <>
            {filing !== undefined && (
              <MenuItem
                disabled={filing.disabled || filing.isPending}
                onClick={() => {
                  shut()
                  filing.file()
                }}
              >
                <Item icon={PackageCheck}>File it</Item>
              </MenuItem>
            )}
            {recomposing !== undefined && (
              <MenuItem
                // Live while something else drives, as the desk's press is: it opens a
                // field, and the send inside the sheet is what the custody guard is on.
                disabled={recomposing.asking}
                onClick={() => {
                  shut()
                  recomposing.open()
                }}
              >
                <Item icon={Route}>Recompose</Item>
              </MenuItem>
            )}
          </>
        )}
      </OverflowMenu>
    </span>
  )

export default BreakOutMenu
