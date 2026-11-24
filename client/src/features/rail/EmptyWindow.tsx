import type { ReactNode } from "react"
import { FolderOpen, Plus, Unplug } from "lucide-react"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"
import Mark from "../../components/Mark"
import RecentRow from "../launcher/RecentRow"
import type { OpenProject } from "../launcher/useOpenProject"
import { useRecents } from "../launcher/useRecents"

/**
 * The pane of a window that holds no project — one New Window opened, or one whose last
 * project was removed: the recent projects, one press each, and the button for a folder
 * that is not on the list.
 *
 * The launch window's list and button again, in one 480px column at the top of the pane, so
 * the button sits with the list and the window reads as a start page.
 *
 * The rows and both hooks are the launch window's own. A press adds the project to this
 * window's rail; one another window already holds brings that window forward instead,
 * which is the shell's rule and not this page's.
 *
 * **A host's page is its start page too**, with no project in its address: the same rows
 * are the host's projects and a press opens one, and the button opens the repo search
 * instead of a folder picker.
 */
const EmptyWindow = ({
  press,
  host,
  onSearch,
}: {
  readonly press: OpenProject
  /** Whether this is a host's page rather than the shell's window. */
  readonly host: boolean
  /** A host's repo search, which takes the folder button's place; absent for a member. */
  readonly onSearch: (() => void) | undefined
}): ReactNode => {
  const recents = useRecents()
  if (recents.data === undefined)
    return recents.isError ? (
      <EmptyState tone="bad" icon={Unplug} title="Could not read the recent projects">
        {recents.error.message}
      </EmptyState>
    ) : (
      <EmptyState loading />
    )

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-gutter py-10">
      <div className="flex min-h-0 w-full max-w-[480px] flex-col gap-4">
        <div className="flex items-center gap-2">
          <Mark />
          <span className="text-base font-semibold tracking-wider text-fg uppercase">Orkestra</span>
        </div>
        {recents.data.length === 0 ? (
          <p className="text-base text-fg-muted">
            <span className="block font-semibold text-fg">
              {host ? "No projects yet" : "No projects in this window"}
            </span>
            {host
              ? onSearch === undefined
                ? "An admin adds one from GitHub."
                : "Add one from your GitHub repositories and Orkestra clones it here."
              : "Open a folder with a repository in it and Orkestra will keep it here."}
          </p>
        ) : (
          <div className="flex min-h-0 flex-col gap-1.5">
            <h1 className="font-mono text-2xs tracking-wider text-fg-subtle uppercase">
              {host ? "Projects" : "Recent projects"}
            </h1>
            <div className="min-h-0 overflow-y-auto rounded-surface border border-border bg-surface">
              <ul>
                {recents.data.map((project) => (
                  <RecentRow
                    key={project.path}
                    project={project}
                    busy={press.opening === project.path}
                    disabled={press.disabled}
                    onOpen={press.open}
                  />
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="shrink-0">
          {host ? (
            onSearch !== undefined && (
              <Button variant="primary" size="md" icon={Plus} block onClick={onSearch}>
                Add from GitHub…
              </Button>
            )
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}

export default EmptyWindow
