/**
 * Every named CLI's plan usage as one tab in the phone's dock, opening the usage sheet.
 * One CLI draws `UsageTabSingle`. More than one draws a `UsageTabRow` per CLI, stacked in
 * wire order, each ending in its own percentage so the figure never leaves a person asking
 * which CLI it means. No CLI named draws no tab.
 */

import type { ReactNode } from "react"
import type { CliUsageDto } from "../../../api/types"
import { useSecond } from "../../../hooks/useSecond"
import UsageTabRow from "./UsageTabRow"
import UsageTabSingle from "./UsageTabSingle"
import { cellView, tabDim, tabLabel } from "./usageView"

const UsageTab = ({
  usage,
  onClick,
}: {
  readonly usage: readonly CliUsageDto[]
  readonly onClick: () => void
}): ReactNode => {
  const now = useSecond(true) * 1000
  const rows = usage.map((cli) => ({ cli: cli.cli, cell: cellView(cli, now) }))
  const dim = tabDim(rows.map((row) => row.cell))
  const [only, ...rest] = rows
  if (only === undefined) return undefined
  return (
    <button
      type="button"
      aria-label={tabLabel(usage)}
      aria-haspopup="dialog"
      onClick={onClick}
      className={`flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 ${dim ? "opacity-50" : ""}`}
    >
      {rest.length === 0 ? (
        <UsageTabSingle cli={only.cli} cell={only.cell} />
      ) : (
        <span className="flex flex-col gap-1.5">
          {rows.map(({ cli, cell }) => (
            <UsageTabRow
              key={cli}
              cli={cli}
              cell={cell}
              dim={!dim && cell._tag === "Meter" && cell.stale}
            />
          ))}
        </span>
      )}
    </button>
  )
}

export default UsageTab
