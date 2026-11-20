/**
 * Every CLI's usage cell on the desk's git bar, each followed by the bar's hairline. Which
 * one is open is the strip's, because the git notice gives way to an open panel.
 */

import type { ReactNode } from "react"
import type { CliUsageDto } from "../../../api/types"
import UsageCell from "./UsageCell"

type Cli = CliUsageDto["cli"]

const UsageCells = ({
  usage,
  open,
  setOpen,
}: {
  readonly usage: readonly CliUsageDto[]
  readonly open: Cli | undefined
  readonly setOpen: (cli: Cli | undefined) => void
}): ReactNode =>
  usage.map((cli) => (
    <span key={cli.cli} className="flex items-stretch">
      <UsageCell
        usage={cli}
        open={open === cli.cli}
        setOpen={(next) => {
          setOpen(next ? cli.cli : undefined)
        }}
      />
      <span aria-hidden className="w-px shrink-0 self-stretch bg-border" />
    </span>
  ))

export default UsageCells
