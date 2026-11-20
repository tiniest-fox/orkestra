/**
 * The project checkout's processes on the desk's git bar: a cell of their own, beside
 * Files at the strip's left edge, carrying the worst state's glyph and a tally. Pressing it
 * opens a popover over the strip's left end listing every process, and the cell stays lit
 * while it is open.
 *
 * **It shuts on Escape, on focus leaving, or on a press anywhere outside it** — the branch
 * card's rule, and `useTapOutside` says why focus alone does not do it. A press inside the
 * popover is inside, so a line of a log can be selected in it without shutting it. `open`
 * is the strip's, because the git notice gives way to it as it does to the chevron's menu.
 */

import type { FocusEvent, KeyboardEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"
import type { HostedProcessDto } from "../../../api/types"
import type { PageOrigins } from "../../../format/hosted"
import type { ProcessPresses } from "../../../hooks/useProcessPress"
import { useTapOutside } from "../../../hooks/useTapOutside"
import { tally } from "./projectProcesses"
import ProcessList from "./ProcessList"
import ProcessMark from "./ProcessMark"

const ProcessCell = ({
  processes,
  presses,
  origins,
  open,
  setOpen,
}: {
  readonly processes: readonly HostedProcessDto[]
  readonly presses: ProcessPresses
  readonly origins: PageOrigins | undefined
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
}): ReactNode => {
  const [log, setLog] = useState<string | undefined>(undefined)
  const root = useRef<HTMLSpanElement>(null)
  const shut = useCallback(() => {
    setOpen(false)
  }, [setOpen])
  useTapOutside(root, open, shut)
  return (
    <span
      ref={root}
      className="relative flex"
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") setOpen(false)
      }}
      onBlur={(event: FocusEvent<HTMLSpanElement>) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        if (event.relatedTarget === null && event.target.matches(":disabled")) return
        setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label={`Project checkout's processes: ${processes.length === 0 ? "none declared" : tally(processes)}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(!open)
        }}
        className={`flex items-center px-3 transition-colors hover:bg-hover-bare ${open ? "bg-surface-2" : ""}`}
      >
        <ProcessMark processes={processes} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Project checkout's processes"
          tabIndex={-1}
          className="absolute bottom-full left-0 mb-2 flex w-100 flex-col rounded-surface border border-border bg-surface p-3 shadow-menu outline-none"
        >
          <ProcessList
            processes={processes}
            presses={presses}
            origins={origins}
            log={log}
            onLog={setLog}
            tap={false}
          />
        </div>
      )}
    </span>
  )
}

export default ProcessCell
