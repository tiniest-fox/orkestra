import type { MouseEvent, ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import Button from "../../components/Button"
import type { RailProjectDto } from "../../api/types"
import CloneRing from "./CloneRing"
import ProjectPicture from "./ProjectPicture"
import { owedOf, statusOf, tileLabel } from "./tile"

/**
 * One project in the phone's sheet: its picture, its name over what its marks say, and
 * the count of what waits on the person where the tile would wear it. The whole row is
 * the press, `RecentRow`'s overlay, and the open project wears the tile's accent bar and
 * its `aria-current`.
 *
 * **A host's row ends in a `⋯`** that opens the tile's menu, since a phone has no
 * right-click. It
 * sits over the row's press, on the rung `Row` raises a control to.
 */
const ProjectRow = ({
  project,
  selected,
  onSelect,
  onMenu,
}: {
  readonly project: RailProjectDto
  readonly selected: boolean
  readonly onSelect: (path: string) => void
  /** Absent where the list has no menu, which draws no `⋯`. */
  readonly onMenu: ((path: string, x: number, y: number) => void) | undefined
}): ReactNode => {
  const owed = owedOf(project.traks) ?? 0
  const status = statusOf(project)
  return (
    <li>
      <div className="group relative flex min-h-11 items-center gap-3 px-gutter py-2.5 transition-colors hover:bg-hover-row">
        {selected && (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-pill bg-accent"
          />
        )}
        {project.progress === undefined ? (
          <span
            className={`flex size-8 shrink-0 overflow-hidden rounded-control ${project.engine === "off" ? "opacity-45 grayscale" : ""}`}
          >
            <ProjectPicture project={project} />
          </span>
        ) : (
          <span className="relative size-8 shrink-0">
            <CloneRing progress={project.progress}>
              <ProjectPicture project={project} />
            </CloneRing>
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            aria-label={tileLabel(project)}
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(project.path)}
            className="block w-full min-w-0 truncate text-left text-base font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:-outline-offset-2 focus-visible:after:outline-2 focus-visible:after:outline-accent"
          >
            {project.name}
          </button>
          {status !== undefined && <span className="truncate text-xs text-fg-muted">{status}</span>}
        </div>
        {owed > 0 && (
          <span
            aria-hidden
            className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-pill bg-tone-waiting px-1 font-mono text-2xs font-semibold text-surface"
          >
            {owed}
          </span>
        )}
        {onMenu !== undefined && (
          <span className="relative z-10 -mr-2 shrink-0">
            <Button
              variant="ghost"
              size="md"
              icon={MoreHorizontal}
              aria-label={`${project.name} — more`}
              aria-haspopup="menu"
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                const box = event.currentTarget.getBoundingClientRect()
                onMenu(project.path, box.right, box.bottom)
              }}
            />
          </span>
        )}
      </div>
    </li>
  )
}

export default ProjectRow
