import type { ReactNode } from "react"
import { ChevronRight, Folder, Loader2 } from "lucide-react"
import Row from "../../components/Row"
import type { RecentProjectDto } from "../../api/types"
import PathLine from "./PathLine"

/**
 * One recent project: the folder's name over its path, and the whole row is the press.
 *
 * A `<button>`, not a link: this presses something in the shell rather than going
 * anywhere. `after:inset-0` makes the whole row the target against `Row`'s own
 * `relative`, and the focus ring is drawn on that overlay so tabbing outlines the row
 * rather than the words. `aria-label` carries the path, because two of these can be
 * called `client` and the visible name alone cannot tell them apart.
 *
 * `busy` is the row that was pressed while the shell boots its engine; every row is
 * `disabled` meanwhile, since a second press would boot a second one.
 */
const RecentRow = ({
  project,
  busy,
  disabled,
  onOpen,
}: {
  readonly project: RecentProjectDto
  readonly busy: boolean
  readonly disabled: boolean
  readonly onOpen: (path: string) => void
}): ReactNode => (
  <Row
    leading={
      busy ? (
        <Loader2 size={14} aria-hidden className="mt-1 shrink-0 animate-spin text-fg-subtle" />
      ) : (
        <Folder size={14} aria-hidden className="mt-1 shrink-0 text-fg-subtle" />
      )
    }
    trailing={
      /* The client's own row affordance: the row is a destination, and it says so where
         the eye is already ending up. */
      <span
        aria-hidden
        className="text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
      >
        <ChevronRight size={13} />
      </span>
    }
  >
    <button
      type="button"
      aria-label={`${project.name} — ${project.short}`}
      disabled={disabled}
      onClick={() => onOpen(project.path)}
      className="block w-full min-w-0 truncate text-left text-base font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:-outline-offset-2 focus-visible:after:outline-2 focus-visible:after:outline-accent disabled:cursor-default"
    >
      {project.name}
    </button>
    <PathLine short={project.short} path={project.path} />
  </Row>
)

export default RecentRow
