/**
 * The frame every block of markdown that is not prose stands in: a table, a diagram, a
 * code, diff, output or pseudo fence, and the three navigators. One line all round, one
 * header band, one footer.
 *
 * - **A 1px `guide` line, the control radius, on `canvas`.** No figure's ground is darker
 *   than the canvas; what sits inside on `surface` (a table's rows, a navigator's panel) is
 *   lifted, never recessed.
 * - **The header band names the figure** — its kind, or a code fence's language — in 9px
 *   caps on `surface`, with a rule under it. `end` rides at its right edge: a count, or a
 *   walkthrough's paths. A table draws no band: its column heads are its header.
 * - **The footer** is the same type on `canvas`, with a rule over it: a table's key, an
 *   overview's order, a walkthrough's Back and Next.
 *
 * **6px of margin above and below**, so the 12px between blocks of markdown becomes 24px
 * around a figure — a rhythm a flex `gap` alone cannot vary.
 *
 * **It is a container, and being one costs it its width, so it asks for one.** Inline-size
 * containment makes the element's own min- and max-content width zero, and a parent that
 * shrinks to fit — `AgentMessage`'s bubble is `max-w-[80%]` with no width — then sizes to
 * the prose around the figure and draws it a few words wide. `w-screen` is the intrinsic
 * width that parent sizes to, and `max-w-full` caps it at whatever the parent allows. Do not
 * drop either half.
 */

import type { ReactNode, Ref } from "react"

/** The 9px caps every band in a figure speaks in: the header, a table's heads, the footer. */
export const CAPS = "text-2xs leading-4 font-semibold uppercase tracking-wider text-fg-subtle"

const Figure = ({
  label,
  end,
  footer,
  ref,
  children,
}: {
  /** What the header band names; no band where it is `undefined`. */
  readonly label: ReactNode
  readonly end?: ReactNode
  readonly footer?: ReactNode
  readonly ref?: Ref<HTMLElement>
  readonly children: ReactNode
}): ReactNode => (
  <figure
    ref={ref}
    className="@container mx-0 my-1.5 w-screen min-w-0 max-w-full overflow-hidden rounded-control border border-guide bg-canvas text-base leading-5"
  >
    {label !== undefined && (
      <div
        className={`flex min-w-0 items-center gap-2 border-b border-guide bg-surface px-2.5 py-0.75 ${CAPS}`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {end}
      </div>
    )}
    {children}
    {footer !== undefined && (
      <div
        className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-guide bg-canvas px-2.5 py-0.75 ${CAPS}`}
      >
        {footer}
      </div>
    )}
  </figure>
)

export default Figure
