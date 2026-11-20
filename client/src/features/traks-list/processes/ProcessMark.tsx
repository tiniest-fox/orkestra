/**
 * What the git bar says about the project checkout's processes at rest: the worst state's
 * glyph and a tally on the strip.
 *
 * The glyph is the side panel opener's — `openerState` — and where nothing is up and
 * nothing is broken it is a plain server glyph, since the cell has to name what it opens.
 * With nothing declared it is a quiet word and no glyph.
 */

import type { ReactNode } from "react"
import { Server } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import ProcessGlyph from "../../../components/ProcessGlyph"
import { openerState } from "../../../format/hosted"
import { tally } from "./projectProcesses"

const ProcessMark = ({
  processes,
}: {
  readonly processes: readonly HostedProcessDto[]
}): ReactNode => {
  if (processes.length === 0) return <span className="text-sm text-fg-subtle">No processes</span>
  const worst = openerState(processes)
  return (
    <span className="flex items-center gap-1.5 text-sm text-fg">
      {worst === undefined ? (
        <Server size={12} aria-hidden className="shrink-0 text-fg-muted" />
      ) : (
        <ProcessGlyph tag={worst} size={12} />
      )}
      <span className="whitespace-nowrap">{tally(processes)}</span>
    </span>
  )
}

export default ProcessMark
