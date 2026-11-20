/**
 * What the git bar's processes open onto, in the desk's popover and the phone's sheet
 * alike: every process the project declares as a row, or one process's log in the list's
 * place, with its row kept above the log and *Processes* to go back.
 *
 * `log` is the name of the process whose log is shown. A name the list no longer holds
 * falls back to the list, so a declaration removed under an open log leaves no blank.
 */

import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import ProcessLog from "../../../components/ProcessLog"
import type { PageOrigins } from "../../../format/hosted"
import type { ProcessPresses } from "../../../hooks/useProcessPress"
import { tally } from "./projectProcesses"
import ProcessRow from "./ProcessRow"

const ProcessList = ({
  processes,
  presses,
  origins,
  log,
  onLog,
  tap,
}: {
  readonly processes: readonly HostedProcessDto[]
  readonly presses: ProcessPresses
  readonly origins: PageOrigins | undefined
  readonly log: string | undefined
  readonly onLog: (name: string | undefined) => void
  readonly tap: boolean
}): ReactNode => {
  const shown = processes.find((p) => p.name === log)
  const said = presses.said !== undefined && (
    <p role="status" className="text-sm text-tone-bad">
      {presses.said}
    </p>
  )

  if (shown !== undefined)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <button
          type="button"
          onClick={() => onLog(undefined)}
          className={`-ml-1 flex items-center gap-1 self-start rounded-control px-1 text-sm text-fg-muted hover:bg-hover-bare ${tap ? "min-h-11" : "h-6"}`}
        >
          <ChevronLeft size={14} aria-hidden /> Processes
        </button>
        <ul aria-label="Processes">
          <ProcessRow
            process={shown}
            presses={presses}
            origins={origins}
            tap={tap}
            logOpen
            onLog={() => onLog(undefined)}
          />
        </ul>
        {said}
        <div
          className={`flex min-h-0 flex-col overflow-hidden rounded-control border border-border bg-canvas ${tap ? "flex-1" : "h-90"}`}
        >
          <ProcessLog key={`${shown.name}:${String(shown.run)}`} process={shown} />
        </div>
      </div>
    )

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between">
        <span className="font-mono text-2xs tracking-wider text-fg-subtle uppercase">
          Project checkout · processes
        </span>
        {processes.length > 0 && (
          <span className="text-2xs text-fg-subtle">{tally(processes)}</span>
        )}
      </span>
      {processes.length === 0 ? (
        <p className={`text-fg-muted ${tap ? "text-base" : "text-sm"}`}>
          This project declares no processes. A script in{" "}
          <span className="font-mono text-fg">.orkestra/processes/</span> runs here.
        </p>
      ) : (
        <ul aria-label="Processes" className="flex flex-col divide-y divide-border">
          {processes.map((p) => (
            <ProcessRow
              key={p.name}
              process={p}
              presses={presses}
              origins={origins}
              tap={tap}
              logOpen={false}
              onLog={() => onLog(p.name)}
            />
          ))}
        </ul>
      )}
      {said}
    </div>
  )
}

export default ProcessList
