/**
 * Every CLI's plan usage on a phone: the bottom sheet the dock's usage tab opens. Each
 * CLI's section is the desk panel's list, Claude first and ruled apart from the next, with
 * the tick taught once at the foot and a Done press under it.
 */

import type { ReactNode } from "react"
import type { CliUsageDto } from "../../../api/types"
import Sheet from "../../../components/Sheet"
import UsageList from "./UsageList"
import UsageTick from "./UsageTick"
import { tabLabel } from "./usageView"

const UsageSheet = ({
  usage,
  onClose,
}: {
  readonly usage: readonly CliUsageDto[]
  readonly onClose: () => void
}): ReactNode => (
  <Sheet label={tabLabel(usage)} tall={false} onClose={onClose}>
    <div className="flex flex-col gap-3">
      {usage.map((cli, i) => (
        <div key={cli.cli} className={i > 0 ? "border-t border-border pt-3" : ""}>
          <UsageList usage={cli} tap />
        </div>
      ))}
      {usage.some((cli) => cli.usage._tag === "Read") && <UsageTick />}
    </div>
    <button
      type="button"
      onClick={onClose}
      className="mt-4 min-h-11 rounded-control bg-surface-2 text-base text-fg"
    >
      Done
    </button>
  </Sheet>
)

export default UsageSheet
