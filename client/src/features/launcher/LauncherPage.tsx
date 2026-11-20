import type { ReactNode } from "react"
import { FolderOpen, Unplug } from "lucide-react"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"
import Mark from "../../components/Mark"
import type { RecentProjectDto } from "../../api/types"
import RecentRow from "./RecentRow"
import { useOpenProject } from "./useOpenProject"
import { useRecents } from "./useRecents"

/**
 * The desktop shell's launch window: the projects you last worked in, one press each,
 * and the one button for a folder that is not on the list.
 *
 * Identity at the top, the list in the middle, one filled button in a footer that never
 * moves, so a first launch and a hundredth teach the same thing. The header is inset
 * 80px because the window's traffic lights sit over it on a bare title bar; the rows keep
 * the gutter and do not align with it, chosen knowingly over the alternatives that do.
 * The header is also the window's drag handle, since there is no title bar to hold.
 *
 * Not a phone surface: an Electron `BrowserWindow` on macOS, resizable down to 380px,
 * so there is no 640px seam here and no second layout.
 *
 * The list is `EmptyState` when there is nothing in it — a region, by
 * `components/README.md`'s rule — with no `action`, so the footer keeps the only button.
 */
const Recents = ({
  recents,
  opening,
  disabled,
  onOpen,
}: {
  readonly recents: readonly RecentProjectDto[]
  readonly opening: string | undefined
  readonly disabled: boolean
  readonly onOpen: (path: string) => void
}): ReactNode =>
  recents.length === 0 ? (
    <EmptyState shape="rows" icon={FolderOpen} title="No projects yet">
      Open a folder with a repository in it and Orkestra will keep it here.
    </EmptyState>
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul>
        {recents.map((project) => (
          <RecentRow
            key={project.path}
            project={project}
            busy={opening === project.path}
            disabled={disabled}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  )

const LauncherPage = (): ReactNode => {
  const recents = useRecents()
  const press = useOpenProject()

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface pr-gutter pl-20 select-none [-webkit-app-region:drag]">
        <Mark />
        <span className="text-base font-semibold tracking-wider text-fg uppercase">Orkestra</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-gutter pt-4 pb-1.5">
          <h1 className="font-mono text-2xs tracking-wider text-fg-subtle uppercase">
            Recent projects
          </h1>
        </div>
        {recents.data !== undefined ? (
          <Recents
            recents={recents.data}
            opening={press.opening}
            disabled={press.disabled}
            onOpen={press.open}
          />
        ) : recents.isError ? (
          <EmptyState tone="bad" icon={Unplug} title="Could not read the recent projects">
            {recents.error.message}
          </EmptyState>
        ) : (
          <EmptyState loading />
        )}
      </div>

      <footer className="flex shrink-0 items-center border-t border-border bg-surface px-gutter py-3">
        <Button
          variant="primary"
          size="md"
          icon={FolderOpen}
          block
          busy={press.picking}
          disabled={press.disabled}
          onClick={press.pick}
        >
          Open a folder…
        </Button>
      </footer>
    </div>
  )
}

export default LauncherPage
