import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import { Settings } from "lucide-react"
import type { RailProjectDto } from "../../api/types"
import ProjectRow from "./ProjectRow"
import AddRow from "./AddRow"

/**
 * Every project on a phone, as a sheet over the open one — `ChangeSheet`'s machinery and
 * its reasons: `fixed inset-0` behind a wash with no portal, so nothing above it may carry
 * a transform; focus taken onto the sheet before paint; Escape on its own node; a press on
 * the wash closing it. Picking a project closes it too, and those three are the ways out.
 *
 * It rises from the foot and pays the home indicator itself, as `ChangeSheet` does.
 *
 * **A host's sheet is also where its list is edited**: an add row under the projects, a
 * `⋯` on each, and the host's settings in a row at the foot. The add and the settings row
 * each close the sheet. A `⋯` does not: its menu opens over the sheet under that row, and the
 * sheet closes only once an item in it is chosen.
 *
 * **On a host with two or more teams the list is one section per team**, which the host draws
 * (`grouped`, from the rail's host slot) with this sheet's rows and add rows, so a press on
 * either closes the sheet the same way it does on the plain list.
 */
const ProjectSheet = ({
  projects,
  selected,
  onSelect,
  onMenu,
  onAdd,
  settings,
  grouped,
  onClose,
}: {
  readonly projects: readonly RailProjectDto[]
  readonly selected: string | undefined
  readonly onSelect: (path: string) => void
  readonly onMenu: ((path: string, x: number, y: number) => void) | undefined
  /** Absent where the list cannot be added to, which draws no add row. */
  readonly onAdd: (() => void) | undefined
  /** Open the host's settings in the pane; absent where there are none. */
  readonly settings: (() => void) | undefined
  /**
   * The list grouped by team, drawn with the sheet's own rows and add rows; absent for the
   * plain list. A team's menu opens over the sheet, which stays under it.
   */
  readonly grouped:
    | ((
        row: (project: RailProjectDto) => ReactNode,
        add: (label: string, press: () => void) => ReactNode,
      ) => ReactNode)
    | undefined
  readonly onClose: () => void
}): ReactNode => {
  const sheet = useRef<HTMLDivElement>(null)
  const row = (project: RailProjectDto): ReactNode => (
    <ProjectRow
      key={project.path}
      project={project}
      selected={project.path === selected}
      onSelect={(path) => {
        onSelect(path)
        onClose()
      }}
      // Not closed here: the sheet stays under the menu, so the row it was opened
      // from stays on screen, and the page closes it once an item is chosen.
      onMenu={onMenu}
    />
  )
  const add = (label: string, press: () => void): ReactNode => (
    <AddRow
      label={label}
      onPress={() => {
        onClose()
        press()
      }}
    />
  )

  useLayoutEffect(() => {
    sheet.current?.focus()
  }, [])

  return (
    <div
      ref={sheet}
      role="dialog"
      aria-label="Projects"
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col justify-end bg-scrim outline-none"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") onClose()
      }}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85%] min-h-0 flex-col overflow-hidden rounded-t-sheet bg-surface pb-safe-b shadow-modal">
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-pill bg-border" />
        <span className="shrink-0 px-gutter pt-1.5 pb-2 font-mono text-2xs tracking-wider text-fg-subtle uppercase">
          Projects
        </span>
        {grouped === undefined ? (
          <ul className="min-h-0 overflow-y-auto overscroll-contain pb-2">
            {projects.map(row)}
            {onAdd !== undefined && add("Add from GitHub…", onAdd)}
          </ul>
        ) : (
          grouped(row, add)
        )}
        {settings !== undefined && (
          <button
            type="button"
            onClick={() => {
              onClose()
              settings()
            }}
            className="flex min-h-11 shrink-0 items-center gap-3 border-t border-border px-gutter py-2.5 text-left text-base text-fg-muted transition-colors hover:bg-hover-row focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex size-8 shrink-0 items-center justify-center">
              <Settings size={16} aria-hidden />
            </span>
            Settings
          </button>
        )}
      </div>
    </div>
  )
}

export default ProjectSheet
