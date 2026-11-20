import type { ReactNode } from "react"
import { FolderPlus, Play, X } from "lucide-react"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"
import type { RailProjectDto } from "../../api/types"

/**
 * The pane for a host project with no `.orkestra/`, which the host holds rather than
 * retrying: the engine refuses such a folder every time. The person chooses.
 *
 * **Start says what it writes**, because it is a write into their checkout: an empty,
 * untracked `.orkestra/` the host makes before it boots the engine. A folder somebody has
 * since added through git simply boots.
 *
 * **The other press depends on where the project came from.** Straight from Add it is
 * *Cancel*, which deletes the clone with no confirm — nothing of the person's is in it
 * yet. A project the host already listed is removed through the usual confirm instead,
 * since its clone may hold work.
 *
 * **A member is offered neither**: only an admin starts or removes a project, so the pane
 * says so and draws no press.
 */
const OrkestraPane = ({
  project,
  busy,
  said,
  onStart,
  onCancel,
  onRemove,
  admin,
}: {
  readonly project: RailProjectDto
  /** A start or a cancel is out for this project. */
  readonly busy: boolean
  /** Why the last one was refused. */
  readonly said: string | undefined
  readonly onStart: (path: string) => void
  readonly onCancel: (path: string) => void
  /** The remove that confirms first. */
  readonly onRemove: (path: string) => void
  /** Whether the device acts as an admin, who alone may start or remove a project. */
  readonly admin: boolean
}): ReactNode => {
  const added = project.noOrkestra?.added === true
  return (
    <EmptyState
      tone="waiting"
      icon={FolderPlus}
      title={`${project.name} has no .orkestra/ folder`}
      action={
        admin && (
          <>
            <Button
              variant="primary"
              icon={Play}
              busy={busy}
              disabled={busy}
              onClick={() => onStart(project.path)}
            >
              Start with an empty .orkestra/
            </Button>
            {added ? (
              <Button
                variant="quiet"
                icon={X}
                disabled={busy}
                onClick={() => onCancel(project.path)}
              >
                Cancel
              </Button>
            ) : (
              <Button variant="quiet" icon={X} onClick={() => onRemove(project.path)}>
                Remove from host…
              </Button>
            )}
          </>
        )
      }
      under={
        said === undefined ? undefined : (
          <p role="alert" className="text-base text-tone-bad">
            {said}
          </p>
        )
      }
    >
      {admin
        ? `Orkestra needs one to start. Start writes an empty, untracked .orkestra/ folder into the checkout. ${added ? "Cancel deletes the clone." : "Remove takes it off this host."}`
        : "Orkestra needs one to start. An admin of this host can start it with an empty .orkestra/ folder."}
    </EmptyState>
  )
}

export default OrkestraPane
