/**
 * The desktop's git bar: a 32px strip along the foot of the window, under the list and
 * under an open drawer alike, tools on the left and git on the right. **The tools sit at
 * the left edge** — Files, which opens the Files panel above it, then the processes cell.
 * **Git is one block at the right edge**, flush to the window and divided by full-height
 * hairlines: the branch name, which is the press that opens the card, the one action the
 * branch's state calls for, and a chevron holding Fetch where that action is another.
 *
 * **A problem rises by itself**, as a notice over the bar's right end with its way
 * through in it, and the action cell does not change. Dismissed, its title stays on the
 * bar left of the action. The notice gives way to the chevron's menu, which opens in the
 * same corner.
 *
 * **The project checkout's processes have a cell of their own** — `ProcessCell`. It and Files
 * are drawn whether or not the git status could be read, since those are separate
 * questions about the same checkout. The notice gives way to the processes popover as it
 * does to the menu.
 *
 * **Each CLI's plan usage is a cell after the processes** — `UsageCell`. Its panel rises
 * from the cell, and the notice gives way to it as it does to the processes popover.
 *
 * **It is never covered.** `Drawer` stops 32px short of the foot above the breakpoint, and
 * this sits on the drawer's rung and after it in the tree, so what it opens upward draws
 * over the drawer's foot rather than under it. The notice is a `dialog` for the reason
 * every overlay is: the desktop shell hides a native page under one.
 *
 * **The card toggles from the branch** — `GitBranchCell`, which says how it shuts.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { TriangleAlert } from "lucide-react"
import { toneInk } from "../../../format/tone"
import GitAction from "./GitAction"
import GitBranchCell from "./GitBranchCell"
import GitMenu from "./GitMenu"
import GitNotice from "./GitNotice"
import type { GitBar } from "./useGitBar"
import ProcessCell from "../processes/ProcessCell"
import FilesCell from "../../files/FilesCell"
import type { ProjectProcesses } from "../processes/useProjectProcesses"
import type { CliUsageDto } from "../../../api/types"
import UsageCells from "./UsageCells"

/** A hairline the bar's whole height — what divides its cells, in place of a box each. */
const Rule = (): ReactNode => <span aria-hidden className="w-px shrink-0 self-stretch bg-border" />

const GitStrip = ({
  bar,
  processes,
  files,
  usage,
}: {
  readonly bar: GitBar
  readonly processes: ProjectProcesses
  /** Each CLI's plan usage, `undefined` until the first answer. */
  readonly usage: readonly CliUsageDto[] | undefined
  /** Whether the Files panel is open, and the press that opens or shuts it. */
  readonly files: { readonly open: boolean; readonly toggle: () => void }
}): ReactNode => {
  const [menu, setMenu] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState<CliUsageDto["cli"] | undefined>(undefined)
  const { view } = bar
  const tools = (
    <span className="flex shrink-0 items-stretch">
      <FilesCell open={files.open} onClick={files.toggle} />
      <Rule />
      {processes.processes !== undefined && (
        <>
          <ProcessCell
            processes={processes.processes}
            presses={processes.presses}
            origins={processes.origins}
            open={listOpen}
            setOpen={setListOpen}
          />
          <Rule />
        </>
      )}
      {usage !== undefined && <UsageCells usage={usage} open={usageOpen} setOpen={setUsageOpen} />}
    </span>
  )

  return (
    <footer
      aria-label="Project checkout"
      className="fixed inset-x-0 bottom-0 z-30 flex h-8 items-stretch border-t border-border bg-surface"
    >
      {tools}
      {view === undefined ? (
        bar.unread && (
          <span className="ml-auto flex items-center px-3 text-sm text-fg-muted">
            Could not read the project checkout’s git.
          </span>
        )
      ) : (
        <>
          <span className="ml-auto flex min-w-0 items-stretch">
            {view.problem !== undefined && !view.risen && (
              <span
                className={`flex min-w-0 items-center gap-1 px-3 ${toneInk[view.problem.tone]}`}
              >
                <TriangleAlert size={12} aria-hidden className="shrink-0" />
                <span className="max-w-80 truncate text-sm">{view.problem.title}</span>
              </span>
            )}
            <Rule />
            <GitBranchCell view={view} />
            <Rule />
            <GitAction view={view} press={bar.press} tap={false} />
            {view.menu && (
              <>
                <Rule />
                <GitMenu view={view} press={bar.press} open={menu} setOpen={setMenu} />
              </>
            )}
          </span>
          {view.problem !== undefined &&
            view.risen &&
            !menu &&
            !listOpen &&
            usageOpen === undefined && (
              <div
                role="dialog"
                aria-label={view.problem.title}
                className="absolute right-2 bottom-full mb-2 w-90 rounded-surface border border-border bg-surface p-3 shadow-menu"
              >
                <GitNotice
                  problem={view.problem}
                  idle={view.idle}
                  tap={false}
                  fix={bar.fix}
                  dismiss={bar.dismiss}
                />
              </div>
            )}
        </>
      )}
    </footer>
  )
}

export default GitStrip
