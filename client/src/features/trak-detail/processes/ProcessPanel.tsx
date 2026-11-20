/**
 * The side panel: the trak's hosted processes and, inside Orkestra.app, its pull request —
 * one showing at a time.
 *
 * Tabs across the top when there is more than
 * one item; under them the showing process's header; under that **Page** and **Log** as a
 * tab bar, with the page's address, Reload and Open in a browser at its right while the
 * page is up; then the view. **A process that serves no page shows its log straight under
 * the header with no views bar**, because one view is not a choice — and **so does every
 * process on a phone**, where a page on another port cannot be reached at all — unless a
 * host serves it at a hostname of its own, when the phone has both views too.
 *
 * The pull request's tab carries none of that: it is GitHub's page under one address bar —
 * `PullRequestPage`.
 *
 * Which item and which view are the page's to hold, so a surface change does not lose them.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronLeft } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import Button from "../../../components/Button"
import PullRequestPage from "../pull-request/PullRequestPage"
import ProcessBody from "./ProcessBody"
import ProcessTabs from "./ProcessTabs"
import type { ProcessView } from "./ProcessViews"
import { type PanelItem, type PanelPull, shownItem } from "./panelItem"
import type { HeldPage } from "./panelLink"
import type { PageOrigins } from "../../../format/hosted"
import type { ProcessPresses } from "../../../hooks/useProcessPress"

const ProcessPanel = ({
  trak,
  processes,
  pull,
  active,
  onActive,
  held,
  origins,
  view,
  onView,
  presses,
  startable,
  phone,
  full,
  onFull,
  onClose,
  back,
}: {
  /** The trak whose checkout the processes run in — part of what names one run. */
  readonly trak: string
  /** May be empty only where there is a pull request: the panel is not offered with neither. */
  readonly processes: readonly HostedProcessDto[]
  readonly pull: PanelPull | undefined
  /** The item picked, or `undefined` for the first. */
  readonly active: PanelItem | undefined
  readonly onActive: (item: PanelItem) => void
  /** The page a link in the trak's markdown asked for, if one did. */
  readonly held: HeldPage | undefined
  /** Where each process is served behind a host's page domain; `undefined` with none. */
  readonly origins: PageOrigins | undefined
  readonly view: ProcessView
  readonly onView: (view: ProcessView) => void
  readonly presses: ProcessPresses
  readonly startable: boolean
  readonly phone: boolean
  readonly full: boolean
  readonly onFull: (() => void) | undefined
  readonly onClose: (() => void) | undefined
  /** The phone's way back to the trak, under the trak's name; `undefined` on the desk. */
  readonly back: { readonly title: string; readonly onBack: () => void } | undefined
}): ReactNode => {
  const [reloads, setReloads] = useState(0)
  const item = shownItem(processes, pull !== undefined, active)
  if (item === undefined) return undefined
  const process = item.kind === "process" ? item.process : undefined

  return (
    <section aria-label="Side panel" className="flex h-full min-h-0 flex-col bg-canvas">
      {back !== undefined && (
        <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 pb-1 pt-3">
          <Button
            variant="ghost"
            size="md"
            icon={ChevronLeft}
            aria-label="Back to the trak"
            onClick={back.onBack}
          />
          <span className="truncate text-sm text-fg-muted">{back.title}</span>
        </header>
      )}
      {(processes.length > 1 || pull !== undefined) && (
        <ProcessTabs processes={processes} pull={pull} current={process?.name} onPick={onActive} />
      )}
      {process === undefined ? (
        pull !== undefined && (
          <PullRequestPage
            trak={trak}
            pull={pull.heading}
            reloads={reloads}
            onReload={() => setReloads((n) => n + 1)}
            full={full}
            onFull={onFull}
            onClose={onClose}
          />
        )
      ) : (
        <ProcessBody
          trak={trak}
          process={process}
          held={held}
          origin={origins === undefined ? undefined : { at: origins(process.name) }}
          view={view}
          onView={onView}
          presses={presses}
          startable={startable}
          phone={phone}
          full={full}
          onFull={onFull}
          onClose={onClose}
          reloads={reloads}
          onReload={() => setReloads((n) => n + 1)}
        />
      )}
    </section>
  )
}

export default ProcessPanel
