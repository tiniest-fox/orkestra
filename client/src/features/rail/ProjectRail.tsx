import type { ReactNode } from "react"
import { Plus, Settings } from "lucide-react"
import type { RailProjectDto } from "../../api/types"
import ProjectTile from "./ProjectTile"

/**
 * The rail: 48px on `surface`, a tile per project top to bottom, and the add tile at its
 * foot — which is all an empty window's rail holds. The add tile opens the folder picker
 * in the shell and the repo search on a host, whose rail also ends in a gear that opens the
 * host's settings in the pane.
 * While they are open the gear carries the selection bar an open tile does, since the pane
 * is the host's rather than a project's.
 *
 * **On a host with two or more teams the tiles are grouped under team headers**, which the host
 * draws (`grouped`, from the rail's host slot) around the tiles this rail hands it. Add is in
 * each header's menu then, so the caller passes no `onAdd` and the foot holds only the gear.
 *
 * The tiles scroll when there are more than the window is tall, with no scrollbar drawn:
 * one would take a fifth of the rail's width from every tile.
 */
const ProjectRail = ({
  projects,
  selected,
  adding,
  onSelect,
  onMenu,
  onAdd,
  addLabel,
  settings,
  grouped,
}: {
  readonly projects: readonly RailProjectDto[]
  readonly selected: string | undefined
  /** The folder picker is up, or a project it chose is being added. */
  readonly adding: boolean
  readonly onSelect: (path: string) => void
  readonly onMenu: ((path: string, x: number, y: number) => void) | undefined
  /** Absent where the list cannot be added to, which draws no add tile. */
  readonly onAdd: (() => void) | undefined
  /** What the add tile does, as its name. */
  readonly addLabel: string
  /** The host's settings — whether they are open, and the press that opens them — absent where there are none. */
  readonly settings: { readonly open: boolean; readonly onOpen: () => void } | undefined
  /** The tiles grouped by team, each drawn by the tile it is handed; absent for the plain list. */
  readonly grouped: ((tile: (project: RailProjectDto) => ReactNode) => ReactNode) | undefined
}): ReactNode => {
  const tile = (project: RailProjectDto): ReactNode => (
    <ProjectTile
      key={project.path}
      project={project}
      selected={project.path === selected}
      onSelect={onSelect}
      onMenu={onMenu}
    />
  )
  return (
    <nav
      aria-label="Projects"
      className="flex w-12 shrink-0 flex-col border-r border-border bg-surface pt-3 pb-2 select-none"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto [scrollbar-width:none]">
        {grouped === undefined ? projects.map(tile) : grouped(tile)}
      </div>
      {onAdd !== undefined && (
        <div className="flex shrink-0 justify-center py-1.5">
          <button
            type="button"
            title={addLabel}
            aria-label={addLabel}
            disabled={adding}
            onClick={onAdd}
            className="flex size-7 items-center justify-center rounded-control border border-dashed border-border text-fg-muted hover:border-accent/60 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60"
          >
            <Plus size={14} aria-hidden />
          </button>
        </div>
      )}
      {settings !== undefined && (
        <div className="relative flex shrink-0 justify-center py-1.5">
          {settings.open && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-pill bg-accent"
            />
          )}
          <button
            type="button"
            title="Host settings"
            aria-label="Host settings"
            aria-current={settings.open ? "true" : undefined}
            onClick={settings.onOpen}
            className={`flex size-7 items-center justify-center rounded-control hover:bg-hover-bare hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${settings.open ? "bg-hover-bare text-fg" : "text-fg-muted"}`}
          >
            <Settings size={16} aria-hidden />
          </button>
        </div>
      )}
    </nav>
  )
}

export default ProjectRail
