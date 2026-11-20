/**
 * The checkbox: every pick on a trak's pull-request half, and the delete-the-clone choice
 * when a host's rail removes a project.
 *
 * **A real `input`, and colour is additive on top of it.** A tick carried in a border and a
 * fill alone is invisible in greyscale and to anyone who cannot separate two edges of nearly
 * the same colour — so the input is here, it is the accessible name, and the accent rides on
 * top of it rather than instead of it.
 *
 * **It names itself off the pick's own label**, which is the same string the box at the foot
 * lists — so the control a reader ticks and the line they can remove say one thing. The
 * caller decides the hit area: a card makes its whole body the press, a row gives the tick a
 * column of its own.
 *
 * **A tick over several picks draws a dash when some of them are on.** It is the input's own
 * `indeterminate`, set on the node rather than carried in a class, so a screen reader hears
 * *mixed* and the styling reads the same property the browser does. Pressing it in that
 * state ticks the rest — the caller's rule, not this file's.
 */

import type { ReactNode } from "react"
import { Check, Minus } from "lucide-react"

const Tick = ({
  on,
  some = false,
  label,
  onChange,
}: {
  readonly on: boolean
  /** Some but not all of what this tick reaches are on. Ignored where `on` is true. */
  readonly some?: boolean
  readonly label: string
  readonly onChange: () => void
}): ReactNode => (
  <span className="relative flex shrink-0 items-center">
    <input
      type="checkbox"
      checked={on}
      ref={(node) => {
        if (node !== null) node.indeterminate = !on && some
      }}
      aria-label={label}
      onChange={onChange}
      className="peer size-3.5 appearance-none rounded-control border border-fg-subtle/50 bg-surface checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent"
    />
    <Check
      size={10}
      aria-hidden
      strokeWidth={3.5}
      className="pointer-events-none absolute left-0.5 top-0.5 text-accent-ink opacity-0 peer-checked:opacity-100"
    />
    <Minus
      size={10}
      aria-hidden
      strokeWidth={3.5}
      className="pointer-events-none absolute left-0.5 top-0.5 text-accent-ink opacity-0 peer-indeterminate:opacity-100"
    />
  </span>
)

export default Tick
