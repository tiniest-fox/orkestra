/**
 * The phone's usage tab body for one CLI: the mark and the meter stand where a
 * tab's glyph would, with `5h 72%` as its label under them. With no reading the mark
 * stands alone over `Unavailable` or `Not read`, so nothing reads as an empty meter.
 */

import type { ReactNode } from "react"
import type { CliUsageDto } from "../../../api/types"
import { cliGlyph } from "../../../format/modelName"
import UsageMeter from "./UsageMeter"
import UsagePercent from "./UsagePercent"
import UsagePollDot from "./UsagePollDot"
import type { CellView } from "./usageView"

const UsageTabSingle = ({
  cli,
  cell,
}: {
  readonly cli: CliUsageDto["cli"]
  readonly cell: CellView
}): ReactNode => {
  const Mark = cliGlyph(`${cli}/`)
  return cell._tag === "Meter" ? (
    <>
      <span className="flex h-4 items-center gap-1">
        <Mark size={14} aria-hidden className="shrink-0 text-fg-muted" />
        <UsageMeter window={cell.window} width={32} height="cell" />
        {cell.polling && <UsagePollDot />}
      </span>
      <span className="flex gap-1 text-xs">
        <span className="text-fg-muted">{cell.window.short}</span>
        <UsagePercent window={cell.window} />
      </span>
    </>
  ) : (
    <>
      <Mark size={16} aria-hidden className="shrink-0 text-fg-subtle" />
      <span className="text-xs text-fg-subtle">
        {cell._tag === "Unavailable" ? "Unavailable" : "Not read"}
      </span>
    </>
  )
}

export default UsageTabSingle
