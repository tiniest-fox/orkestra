import type { ReactNode } from "react"
import { Chase } from "../../components/Plate"
import type { RailProjectDto } from "../../api/types"
import ProjectPicture from "./ProjectPicture"
import { owedOf, runningOf, tileLabel } from "./tile"

/**
 * The ring's corner: the picture's, plus the 1px gap and the 2px ring, so the two stay
 * concentric. The gap's own corner is the picture's plus 1px.
 */
const RING = "rounded-[calc(var(--radius-surface)+3px)]"
const GAP = "rounded-[calc(var(--radius-surface)+1px)]"

/**
 * One project on the rail: its picture, and at most one mark at the 32px slot's corner.
 *
 * The rules the tile holds to:
 *
 * - **The picture is one size in every state** — 26px, `rounded-surface`, set in from the
 *   slot by a 2px ring band and a 1px gap that are kept at rest too, so nothing moves
 *   when a turn starts or ends. The gap is opaque surface, which is what lets a faded
 *   picture sit over a filled ring without the fill showing through it.
 * - **Selected** is a 3px accent bar at the window's edge, and nothing on the picture.
 * - **Not started** is the picture grey and faint, with no count and no
 *   running mark, since no engine has said anything. A tile whose engine is starting is
 *   drawn started: it was pressed, and the pane is what shows the wait.
 * - **Running** is `Chase`'s travelling segment in the ring band, with no track.
 * - **The corner holds a count of what waits on the person, or a red dot for a project
 *   that did not start** — never both, because a project with no engine has no count. A
 *   clone that failed wears the same dot.
 * - **Cloning** is the picture set back, with the ring band filled to how far git has
 *   come on the running mark's track, and no marks.
 *
 * A `<button>` with `aria-current`, in a `<nav>`: the rail moves between projects the way
 * tabs do, and the name a screen reader hears carries what the marks say. The context
 * menu is the shell's own, native, or on a host's page the page's own — this only asks,
 * with where the pointer was.
 */
const ProjectTile = ({
  project,
  selected,
  onSelect,
  onMenu,
}: {
  readonly project: RailProjectDto
  readonly selected: boolean
  readonly onSelect: (path: string) => void
  /** Absent where there is no menu, and the browser's own is left alone. */
  readonly onMenu: ((path: string, x: number, y: number) => void) | undefined
}): ReactNode => {
  const owed = owedOf(project.traks) ?? 0
  const running = runningOf(project.traks)
  const stopped = project.engine === "failed" || project.engine === "refused"
  const cloning = project.progress !== undefined
  return (
    <button
      type="button"
      title={project.name}
      aria-label={tileLabel(project)}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(project.path)}
      onContextMenu={
        onMenu === undefined
          ? undefined
          : (event) => {
              event.preventDefault()
              onMenu(project.path, event.clientX, event.clientY)
            }
      }
      className="group relative flex min-h-11 w-full shrink-0 items-center justify-center focus-visible:outline-none"
    >
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-pill bg-accent"
        />
      )}
      <span
        className={`relative flex size-8 ${RING} text-tone-working group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent`}
      >
        {project.progress !== undefined ? (
          // A figure rather than a utility, as in `CloneRing`.
          <span
            aria-hidden
            className={`absolute inset-0 ${RING}`}
            style={{
              background: `conic-gradient(currentColor ${String(project.progress * 3.6)}deg, var(--color-tone-working-track) 0deg)`,
            }}
          />
        ) : (
          running && <Chase radius={RING} tone="working" track={false} />
        )}
        <span className={`absolute inset-0.5 bg-surface p-px ${GAP}`}>
          <span
            className={`flex size-full overflow-hidden rounded-surface ${project.engine === "off" || cloning ? "opacity-45 grayscale" : ""}`}
          >
            <ProjectPicture project={project} inset={false} />
          </span>
        </span>
        {!cloning && owed > 0 && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-tone-waiting px-1 font-mono text-2xs font-semibold text-surface"
          >
            {owed}
          </span>
        )}
        {!cloning && stopped && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 size-3.5 rounded-pill border-2 border-surface bg-tone-bad"
          />
        )}
      </span>
    </button>
  )
}

export default ProjectTile
