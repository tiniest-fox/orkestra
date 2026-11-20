/**
 * One process under its tab in the side panel: its header, a refusal from its last press,
 * its Page and Log views where it serves a page on the desk, and the view picked —
 * `ProcessPanel` carries the layout.
 *
 * **Behind a host with a page domain the page is at its own hostname**, the address shown,
 * opened and framed alike; and a phone, which cannot reach a loopback port, gets the Page
 * view as the desk does. A process whose name leaves no room for a hostname says so in
 * place of a frame that would load nothing.
 */

import type { ReactNode } from "react"
import { Unlink } from "lucide-react"
import type { HostedProcessDto } from "../../../api/types"
import EmptyState from "../../../components/EmptyState"
import HostedPage from "./HostedPage"
import ProcessAbsent from "./ProcessAbsent"
import ProcessHeader from "./ProcessHeader"
import ProcessLog from "../../../components/ProcessLog"
import ProcessViews, { type ProcessView } from "./ProcessViews"
import type { HeldPage } from "./panelLink"
import { onPageOrigin } from "../../../format/hosted"
import type { ProcessPresses } from "../../../hooks/useProcessPress"

const ProcessBody = ({
  trak,
  process,
  held,
  origin,
  view,
  onView,
  presses,
  startable,
  phone,
  full,
  onFull,
  onClose,
  reloads,
  onReload,
}: {
  readonly trak: string
  readonly process: HostedProcessDto
  /** The page a link asked for — used only while it names this process at this run. */
  readonly held: HeldPage | undefined
  /**
   * Where a host's page domain serves this process — `at` is `undefined` when its name is
   * too long for a hostname — or `undefined` with no page domain, and the loopback address.
   */
  readonly origin: { readonly at: string | undefined } | undefined
  readonly view: ProcessView
  readonly onView: (view: ProcessView) => void
  readonly presses: ProcessPresses
  readonly startable: boolean
  readonly phone: boolean
  readonly full: boolean
  readonly onFull: (() => void) | undefined
  readonly onClose: (() => void) | undefined
  readonly reloads: number
  readonly onReload: () => void
}): ReactNode => {
  const { state } = process
  const choice = process.page && (!phone || origin?.at !== undefined)
  const shown: ProcessView = choice ? view : "log"
  // A link's page belongs to the run that was up when it was pressed; a restart is a new
  // run, and loads the root.
  const asked = held?.name === process.name && held.run === process.run ? held : undefined
  const loopback = state._tag === "Running" ? (asked?.url ?? state.url) : undefined
  const at = origin?.at
  const page =
    loopback === undefined || origin === undefined
      ? loopback
      : at === undefined
        ? undefined
        : onPageOrigin(loopback, at)
  const url = shown === "page" ? page : undefined
  return (
    <>
      <ProcessHeader
        process={process}
        presses={presses}
        startable={startable}
        full={full}
        onFull={onFull}
        onClose={onClose}
      />
      {presses.said !== undefined && (
        <p role="status" className="shrink-0 bg-surface px-3 pb-2 text-sm text-tone-bad">
          {presses.said}
        </p>
      )}
      {choice && <ProcessViews shown={shown} onView={onView} url={url} onReload={onReload} />}
      {shown === "log" ? (
        <ProcessLog key={`${process.name}:${String(process.run)}`} process={process} />
      ) : state._tag !== "Running" ? (
        <ProcessAbsent state={state} onLog={() => onView("log")} />
      ) : page === undefined ? (
        <EmptyState icon={Unlink} title="No address for this page">
          {process.name}'s name is too long to make a hostname of at this trak, so the host cannot
          serve its page. A shorter process name fixes it.
        </EmptyState>
      ) : (
        <HostedPage
          name={process.name}
          // Each press of a link is a run of its own to the shell, which loads an address
          // only when the run moves — so a second link into a page already up still lands.
          run={JSON.stringify(
            asked === undefined
              ? [trak, process.name, process.run]
              : [trak, process.name, process.run, asked.click],
          )}
          url={page}
          ownOrigin={at !== undefined}
          reloads={reloads}
        />
      )}
    </>
  )
}

export default ProcessBody
