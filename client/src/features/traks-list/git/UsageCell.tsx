/**
 * One CLI's plan usage on the desk's git bar: the CLI's mark, the leading window's short name, a
 * 32px meter, the percentage, and the polling dot while a turn polls. A reading past
 * `STALE_AFTER` with no turn dims to half opacity. Pressing it opens a 300px panel rising
 * from the cell with every window.
 *
 * **It shuts on Escape, on focus leaving, or on a press anywhere outside it** —
 * `ProcessCell`'s rule. `open` is the strip's, because the git notice
 * gives way to it as it does to the processes popover.
 */

import type { FocusEvent, KeyboardEvent, ReactNode } from "react"
import { useCallback, useRef } from "react"
import type { CliUsageDto } from "../../../api/types"
import { cliGlyph } from "../../../format/modelName"
import { useSecond } from "../../../hooks/useSecond"
import { useTapOutside } from "../../../hooks/useTapOutside"
import UsageList from "./UsageList"
import UsageTick from "./UsageTick"
import UsageMeter from "./UsageMeter"
import UsagePercent from "./UsagePercent"
import UsagePollDot from "./UsagePollDot"
import { cellView, cliName } from "./usageView"

const UsageCell = ({
  usage,
  open,
  setOpen,
}: {
  readonly usage: CliUsageDto
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
}): ReactNode => {
  const now = useSecond(true) * 1000
  const cell = cellView(usage, now)
  const Mark = cliGlyph(`${usage.cli}/`)
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
        setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label={`${cliName(usage.cli)} usage`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(!open)
        }}
        className={`flex items-center gap-1.5 px-3 text-sm transition-colors hover:bg-hover-bare ${open ? "bg-surface-2" : ""}`}
      >
        <span
          className={`flex items-center gap-1.5 ${cell._tag === "Meter" && cell.stale ? "opacity-50" : ""}`}
        >
          <Mark size={14} aria-hidden className="shrink-0 text-fg-muted" />
          {cell._tag === "Meter" ? (
            <>
              <span className="text-fg-muted">{cell.window.short}</span>
              <UsageMeter window={cell.window} width={32} height="cell" />
              <UsagePercent window={cell.window} />
              {cell.polling && <UsagePollDot />}
            </>
          ) : (
            <span className="text-fg-subtle">
              {cell._tag === "Unavailable" ? "Usage unavailable" : "Usage not read"}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${cliName(usage.cli)} usage`}
          tabIndex={-1}
          className="absolute bottom-full left-0 mb-2 flex w-[300px] flex-col rounded-surface border border-border bg-surface p-3 shadow-menu outline-none"
        >
          <div className="flex flex-col gap-3">
            <UsageList usage={usage} tap={false} />
            {usage.usage._tag === "Read" && <UsageTick />}
          </div>
        </div>
      )}
    </span>
  )
}

export default UsageCell
