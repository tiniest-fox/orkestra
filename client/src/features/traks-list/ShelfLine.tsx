/**
 * One section on the idle shelf (`IdleShelf`), as one line: a caret, the section's word
 * in grey, its group count, and the newest group's age at the right, in the idle rows'
 * age column. Pressed, it opens the section's idle rows under it, indented 16px, with the
 * `+N more` cut applied there as anywhere.
 *
 * **Grey rather than the section's tone**: nothing on the shelf is owed today, and a
 * colored word would ask for the look a live header does. The line is an idle row's own
 * box, so the touch floor holds below the breakpoint.
 *
 * Beside a wide drawer the line is the header's rail form, a count over the marks' column.
 */

import { useState, type ReactNode } from "react"
import { pileAge } from "./idle"
import IdleRows from "./IdleRows"
import type { Rungs } from "./pullRung"
import RailCount from "./RailCount"
import TrakIcon from "./TrakIcon"
import type { TrakRow } from "./tree"

const ShelfLine = ({
  title,
  rows,
  rungs,
  phone,
  rail,
}: {
  readonly title: string
  readonly rows: readonly TrakRow[]
  readonly rungs: Rungs
  readonly phone: boolean
  readonly rail: boolean
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const age = pileAge(rows, Date.now())
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={rail ? title : undefined}
        className="flex min-h-11 w-full items-center gap-2 px-gutter text-left transition-colors hover:bg-hover-row sm:min-h-7"
      >
        {rail ? (
          <RailCount title={title} tone="neutral" count={rows.length} />
        ) : (
          <>
            <span
              aria-hidden
              className={`text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}
            >
              <TrakIcon name="chevronRight" size={11} />
            </span>
            <span className="font-mono text-2xs uppercase tracking-wider text-fg-muted">
              {title}
            </span>
            <span className="font-mono text-2xs tabular-nums text-fg-subtle">{rows.length}</span>
            {age !== undefined && (
              <span className="ml-auto font-mono text-2xs text-fg-subtle">{age}</span>
            )}
            {/* The idle rows' chevron column, held empty so the two ages line up. */}
            <span aria-hidden className="ml-2 w-[13px] shrink-0" />
          </>
        )}
      </button>
      {open && (
        <ul aria-label={title} className="flex flex-col pl-4">
          <IdleRows rows={rows} rungs={rungs} phone={phone} />
        </ul>
      )}
    </li>
  )
}

export default ShelfLine
