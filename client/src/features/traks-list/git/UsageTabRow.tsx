/**
 * One CLI's row in the phone's usage tab when it holds more than one: the mark, a thin 24px
 * meter of the leading window and its percentage, and the polling dot. A CLI with no
 * meter draws a dashed empty track and `—`, so it never reads as 0% used. A stale row dims
 * on its own unless the whole tab already has.
 */

import type { ReactNode } from "react"
import type { CliUsageDto } from "../../../api/types"
import { cliGlyph } from "../../../format/modelName"
import UsageMeter from "./UsageMeter"
import UsagePercent from "./UsagePercent"
import UsagePollDot from "./UsagePollDot"
import type { CellView } from "./usageView"

const UsageTabRow = ({
  cli,
  cell,
  dim,
}: {
  readonly cli: CliUsageDto["cli"]
  readonly cell: CellView
  readonly dim: boolean
}): ReactNode => {
  const Mark = cliGlyph(`${cli}/`)
  return (
    <span className={`flex h-3.5 items-center gap-1 ${dim ? "opacity-50" : ""}`}>
      <Mark size={12} aria-hidden className="shrink-0 text-fg-muted" />
      {cell._tag === "Meter" ? (
        <>
          <UsageMeter window={cell.window} width={24} height="thin" />
          <span className="text-xs leading-none">
            <UsagePercent window={cell.window} />
          </span>
          {cell.polling && <UsagePollDot />}
        </>
      ) : (
        <>
          <span
            role="img"
            aria-label={cell._tag === "Unavailable" ? "Unavailable" : "Not read"}
            className="inline-block w-6 border-t border-dashed border-fg-subtle"
          />
          <span aria-hidden className="text-xs leading-none text-fg-subtle">
            —
          </span>
        </>
      )}
    </span>
  )
}

export default UsageTabRow
