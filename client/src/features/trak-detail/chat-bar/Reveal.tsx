/**
 * A press that arrives and leaves — fading and widening, so the field takes the space
 * back when it goes.
 *
 * **Always mounted, and the wrapper animates rather than the button.** A press that
 * unmounted could not leave, only vanish; a `max-width` on the `Button` would fight its
 * own `size-*`. So the button keeps its box and this clips it.
 *
 * **A grid column from `1fr` to `0fr`, never a `max-width` to a number.** The number would
 * have to be right about the control's width, which depends on the size and on the
 * breakpoint — `Button` gives an icon-only press `max-sm:min-w-11`, so it is 36 wide at a
 * desk and 44 on a phone, and a wrapper clamped to 36 with `overflow-hidden` cuts 8px of
 * glyph on every phone. `0fr` is *none of the space* and `1fr` is *what the content wants*,
 * so the collapse is right at any measure, at any `Button` size, and with a label beside
 * the glyph. The inner span's `min-w-0 overflow-hidden` is what lets the column go below
 * the content's intrinsic width rather than refusing to.
 *
 * **The gap is a margin here, never a flex `gap` on the row.** A `gap` is drawn between
 * rendered children, and a collapsed child is still a child — the row would keep 4px for
 * a press that is not there.
 *
 * **Hidden is out of the tree for everything but the paint.** `aria-hidden` and `inert`
 * by hand, kept on while it is collapsed — a press at zero width is still in the focus
 * order and still hit-testable without them, which is `Rail`'s rule for the same reason.
 * `motion-reduce` skips the transition rather than the change: a person who asked for no
 * motion should find the press already there.
 *
 * It fades and widens over 200ms ease-out, near `--animate-drop`'s quarter second so a
 * one-shot arrival lands rather than bounces.
 */

import type { ReactNode } from "react"

const Reveal = ({ shown, children }: { readonly shown: boolean; readonly children: ReactNode }) => (
  <span
    aria-hidden={!shown}
    inert={!shown}
    style={{ gridTemplateColumns: shown ? "1fr" : "0fr", marginLeft: shown ? 4 : 0 }}
    className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
      shown ? "opacity-100" : "pointer-events-none opacity-0"
    }`}
  >
    <span className="min-w-0 overflow-hidden">{children}</span>
  </span>
)

export default Reveal
