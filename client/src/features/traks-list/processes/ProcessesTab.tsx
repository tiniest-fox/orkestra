/**
 * The dock's processes tab: the worst state's glyph and a count on its corner, in the same
 * order as the strip's tally — `processCount`. With nothing up and nothing broken it is a
 * plain server glyph, and with nothing declared that glyph is muted with no badge.
 */

import type { ReactNode } from "react"
import { Server } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import ProcessGlyph from "../../../components/ProcessGlyph"
import { openerState } from "../../../format/hosted"
import DockTab from "../DockTab"
import { processCount, tally } from "./projectProcesses"

const SIZE = 20

const ProcessesTab = ({
  processes,
  onClick,
}: {
  readonly processes: readonly HostedProcessDto[]
  readonly onClick: () => void
}): ReactNode => {
  const worst = openerState(processes)
  const count = processCount(processes)
  return (
    <DockTab
      label={`Project checkout's processes: ${processes.length === 0 ? "none declared" : tally(processes)}`}
      glyph={
        worst === undefined ? (
          <Server size={SIZE} aria-hidden />
        ) : (
          <ProcessGlyph tag={worst} size={SIZE} />
        )
      }
      badge={count === undefined ? undefined : { text: String(count.n), tone: count.tone }}
      muted={processes.length === 0}
      onClick={onClick}
    />
  )
}

export default ProcessesTab
