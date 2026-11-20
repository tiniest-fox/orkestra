import type { ReactNode } from "react"
import type { RailProjectDto } from "../../api/types"
import ProjectPicture from "./ProjectPicture"
import { owedOf } from "./tile"

/** Pictures drawn before the rest become one `+n` tile. */
const MOST = 3

/**
 * The other projects with traks waiting on the person, on a phone's header: up to three
 * 22px pictures overlapped by a third of their side, then one `+n` tile for the rest. No
 * number beside them — the pictures alone, as *Waiting Elsewhere* was saved. Nothing at
 * all where no other project is waiting, which gives the name the width.
 *
 * Waiting is the rail tile's own count (`owedOf`), and the order is the rail's.
 *
 * A press, opening the sheet the switch is made in: the pictures say where, and the
 * sheet is where a person goes there. At least 44px wide at every count — one picture is
 * 30px with its gap — with the pictures kept against search and the slack to their left.
 */
const WaitingStack = ({
  projects,
  onOpen,
}: {
  /** Every project but the one open. */
  readonly projects: readonly RailProjectDto[]
  readonly onOpen: () => void
}): ReactNode => {
  const waiting = projects.filter((project) => (owedOf(project.traks) ?? 0) > 0)
  if (waiting.length === 0) return undefined
  const shown = waiting.slice(0, MOST)
  const more = waiting.length - shown.length
  const owed = waiting.reduce((sum, project) => sum + (owedOf(project.traks) ?? 0), 0)
  const projectsWord = waiting.length === 1 ? "project" : "projects"
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${String(owed)} waiting on you in ${String(waiting.length)} other ${projectsWord}`}
      onClick={onOpen}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-end pl-2 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {shown.map((project) => (
        // The 1.5px surface ring is what parts one picture from the one it overlaps.
        <span
          key={project.path}
          className="flex size-[22px] overflow-hidden rounded-control shadow-[0_0_0_1.5px_var(--color-surface)] not-first:-ml-[7px]"
        >
          <ProjectPicture project={project} small />
        </span>
      ))}
      {more > 0 && (
        <span className="-ml-[7px] flex size-[22px] items-center justify-center rounded-control bg-surface-2 text-2xs font-semibold text-fg-muted shadow-[0_0_0_1.5px_var(--color-surface)]">
          +{more}
        </span>
      )}
    </button>
  )
}

export default WaitingStack
