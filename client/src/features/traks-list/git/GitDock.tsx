/**
 * The phone's git bar, in the list's dock. **Four equal tabs**: left of the pill the
 * processes and Files, right of it every named CLI's plan usage, in one tab, and the one git
 * action. The branch name is not drawn — the sheet names it whole — so nothing in the band
 * grows with it. The action tab opens a bottom sheet holding the card, with the action and
 * Fetch as full-width rows under it: **the action tab does not press**, because a glyph a
 * thumb meets on its way to the pill is too easy a way to pull.
 *
 * **There is no branch tab**, and the usage tab takes its place: a branch tab would open
 * the same sheet as the action tab, and the usage tab's mark and meter need more width than
 * a third tab in a half has.
 *
 * **What each git and process tab says at rest is its glyph and a corner badge** —
 * `actionBadge` for git, `processCount` for processes. A detached head is the action tab's
 * broken link.
 *
 * **A problem rises as a row above the band**, with its way through in it. Dismissed, the
 * action tab carries an amber `!` in place of its count.
 *
 * **The project checkout's processes are the leftmost tab**, their worst state's glyph and
 * a count. **Each tab opens a sheet of its own**: the processes tab the process list, the
 * action tab the git card and the usage tab the usage list, with no switch between them —
 * the dock already holds every tab, so a switch inside the sheet only repeated them. A
 * process's log replaces the list in the sheet, which grows tall to hold it.
 *
 * On the traks list only: the dock is the list's, and a trak opened over it takes the
 * whole screen, so a trak page on a phone shows no git status.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { FileText } from "lucide-react"
import Sheet from "../../../components/Sheet"
import Dock from "../Dock"
import DockTab from "../DockTab"
import ActionTab from "./ActionTab"
import GitAction, { GIT_GLYPH } from "./GitAction"
import GitCard from "./GitCard"
import GitNotice from "./GitNotice"
import type { GitView } from "./gitView"
import type { GitBar } from "./useGitBar"
import ProcessList from "../processes/ProcessList"
import ProcessesTab from "../processes/ProcessesTab"
import type { ProjectProcesses } from "../processes/useProjectProcesses"
import type { CliUsageDto } from "../../../api/types"
import UsageSheet from "./UsageSheet"
import UsageTab from "./UsageTab"

const SIZE = 20

/** The sheet's presses: the action and, where it is another, Fetch — full-width rows. */
const SheetPresses = ({ view, bar }: { readonly view: GitView; readonly bar: GitBar }): ReactNode =>
  view.cell._tag === "Press" && (
    // Edge to edge under the card and ruled off from it, as the bar's cells are.
    <div className="-mx-4 flex flex-col border-t border-border">
      <GitAction view={view} press={bar.press} tap />
      {view.menu && (
        <button
          type="button"
          disabled={!view.idle}
          onClick={() => {
            bar.press({ action: "fetch", stash: false })
          }}
          className="flex h-12 items-center justify-center gap-2 border-t border-border px-5 text-base font-medium text-fg disabled:text-fg-muted"
        >
          <GIT_GLYPH.fetch size={16} aria-hidden />
          Fetch
        </button>
      )}
    </div>
  )

/** Which sheet is open: the git card, the processes, or every CLI's usage. */
type Open = "git" | "processes" | "usage"

/** A tab's place held before its first answer, so the other three keep their widths. */
const Held = (): ReactNode => <span className="flex-1" />

/**
 * **One `Dock` at one place in the tree, with or without a status.** The dock is the
 * list's and is drawn in every state of the page, so before the first answer it is the
 * pill and the Files tab — and the answer arriving fills the held tabs rather than
 * mounting another.
 */
const GitDock = ({
  bar,
  processes: project,
  usage,
  onFiles,
}: {
  readonly bar: GitBar
  readonly processes: ProjectProcesses
  /** Each CLI's plan usage, `undefined` until the first answer. */
  readonly usage: readonly CliUsageDto[] | undefined
  /** Open the project's file tree. */
  readonly onFiles: () => void
}): ReactNode => {
  const [sheet, setSheet] = useState<Open | undefined>(undefined)
  const [log, setLog] = useState<string | undefined>(undefined)
  const { view } = bar
  const { processes, presses, origins } = project
  const risen =
    view?.problem !== undefined && view.risen && sheet === undefined ? view.problem : undefined
  const close = (): void => {
    setSheet(undefined)
  }
  const openGit = (): void => {
    setSheet("git")
  }
  const openUsage = (): void => {
    setSheet("usage")
  }

  return (
    <>
      <Dock
        above={
          view !== undefined &&
          risen !== undefined && (
            <GitNotice problem={risen} idle={view.idle} tap fix={bar.fix} dismiss={bar.dismiss} />
          )
        }
        left={
          <>
            {processes === undefined ? (
              <Held />
            ) : (
              <ProcessesTab
                processes={processes}
                onClick={() => {
                  setSheet("processes")
                }}
              />
            )}
            <DockTab
              label="Project files"
              glyph={<FileText size={SIZE} aria-hidden />}
              badge={undefined}
              muted={false}
              onClick={onFiles}
            />
          </>
        }
        right={
          <>
            {usage === undefined ? <Held /> : <UsageTab usage={usage} onClick={openUsage} />}
            {view === undefined ? <Held /> : <ActionTab view={view} onClick={openGit} />}
          </>
        }
      />
      {sheet === "processes" && processes !== undefined && (
        <Sheet
          label="Project checkout's processes"
          tall={processes.some((p) => p.name === log)}
          onClose={close}
        >
          <ProcessList
            processes={processes}
            presses={presses}
            origins={origins}
            log={log}
            onLog={setLog}
            tap
          />
        </Sheet>
      )}
      {sheet === "usage" && usage !== undefined && <UsageSheet usage={usage} onClose={close} />}
      {sheet === "git" && (
        <Sheet label="Project checkout" tall={false} onClose={close}>
          {view === undefined ? (
            <p className="text-base text-fg-muted">Could not read the project checkout’s git.</p>
          ) : (
            <GitCard view={view}>
              <SheetPresses view={view} bar={bar} />
            </GitCard>
          )}
        </Sheet>
      )}
    </>
  )
}

export default GitDock
