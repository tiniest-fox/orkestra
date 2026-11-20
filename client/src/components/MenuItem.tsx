/**
 * One press inside an `OverflowMenu`.
 *
 * Not a `Button`: the four variants are all about a control standing on a surface, and an
 * item in a menu is a full-width row of the panel it is in — no plate, no edge, and the
 * `bare` hover tint the ghost variant already uses. Its own file rather than ten lines
 * inside `OverflowMenu` because the finished position and the header's ending are two
 * callers, and a class string copied between them is an appearance free to drift.
 *
 * **`checked` makes it one of a set rather than a press**, and `role` says which kind of
 * set: a radio row is one of several where exactly one is true, a checkbox row is on or
 * off beside anything. Both carry `aria-checked`, which is what a screen reader reads off
 * a row whose visible state is a check or a `Switch` — either of which is `aria-hidden`.
 */

import type { ReactNode } from "react"

const MenuItem = ({
  role = "menuitem",
  checked,
  disabled = false,
  onClick,
  children,
}: {
  readonly role?: "menuitem" | "menuitemradio" | "menuitemcheckbox"
  /** Only meaningful on a radio or a checkbox row. */
  readonly checked?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): ReactNode => (
  <button
    type="button"
    role={role}
    aria-checked={role === "menuitem" ? undefined : checked === true}
    disabled={disabled}
    onClick={onClick}
    className="rounded-control px-2 py-1.5 text-left text-base text-fg transition-colors max-sm:min-h-11 hover:bg-hover-bare disabled:cursor-not-allowed disabled:opacity-45"
  >
    {children}
  </button>
)

export default MenuItem
