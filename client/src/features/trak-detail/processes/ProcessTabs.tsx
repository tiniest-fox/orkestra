/**
 * The side panel's items as browser-style tabs across its top: each process wearing its state's
 * glyph, then the pull request wearing its own. Drawn when there is more than one process, and
 * whenever there is a pull request — its tab stands even alone, last and straight after the
 * processes, labelled `PR #N`.
 *
 * It scrolls sideways rather than wrapping, so a panel with more tabs than fit keeps its
 * header where it was.
 */

import type { ReactNode } from "react"
import type { HostedProcessDto } from "../../../api/types"
import PullRequestGlyph from "../pull-request/PullRequestGlyph"
import type { PanelItem, PanelPull } from "./panelItem"
import ProcessGlyph from "../../../components/ProcessGlyph"

const tabClass = (on: boolean): string =>
  `flex min-w-28 shrink-0 items-center gap-1.5 rounded-t-control px-3 text-sm ${
    on ? "bg-surface font-medium text-fg" : "text-fg-muted hover:bg-hover-row"
  }`

const ProcessTabs = ({
  processes,
  pull,
  current,
  onPick,
}: {
  readonly processes: readonly HostedProcessDto[]
  readonly pull: PanelPull | undefined
  /** The process drawn, or `undefined` while the pull request is. */
  readonly current: string | undefined
  readonly onPick: (item: PanelItem) => void
}): ReactNode => (
  <div
    role="tablist"
    aria-label="Side panel"
    className="flex h-9 shrink-0 items-stretch gap-px overflow-x-auto bg-surface-2 px-1 pt-1 max-sm:h-12"
  >
    {processes.map((process) => (
      <button
        key={process.name}
        type="button"
        role="tab"
        aria-selected={process.name === current}
        onClick={() => onPick({ kind: "process", name: process.name })}
        className={tabClass(process.name === current)}
      >
        <ProcessGlyph tag={process.state._tag} />
        {process.name}
      </button>
    ))}
    {pull !== undefined && (
      <button
        type="button"
        role="tab"
        aria-selected={current === undefined}
        aria-label={`Pull request #${String(pull.heading.number)}`}
        onClick={() => onPick({ kind: "pull" })}
        className={tabClass(current === undefined)}
      >
        <PullRequestGlyph pull={pull.heading} confirmed={pull.confirmed} />
        <span>
          PR <span className="font-mono">#{String(pull.heading.number)}</span>
        </span>
      </button>
    )}
  </div>
)

export default ProcessTabs
