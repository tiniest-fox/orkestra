/**
 * A shut disclosure whose summary is the whole of what it is standing in for.
 *
 * The review conversations somebody has already settled fold behind it, shut. They may not
 * be summarised as *fine* — the summary is a count of resolved conversations — so the
 * caller writes the words and this owns only the opening. The checks that are not failing
 * used to fold here too; their fold is now the Checks section's own verdict, which
 * `PullRequestSection`'s `press` draws.
 *
 * **A real press with a chevron, not a grey line saying *hidden*.** `aria-expanded` is what
 * says which state it is in, which is also what a test reads.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronRight } from "lucide-react"

const Fold = ({
  summary,
  children,
}: {
  /** What the shut fold says it is holding. Counted, never a verdict about the contents. */
  readonly summary: string
  readonly children: ReactNode
}): ReactNode => {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
        className="flex w-fit items-center gap-1 rounded-control text-sm text-fg-subtle hover:text-fg"
      >
        <ChevronRight size={12} aria-hidden className={open ? "rotate-90" : ""} />
        {summary}
      </button>
      {open && children}
    </div>
  )
}

export default Fold
