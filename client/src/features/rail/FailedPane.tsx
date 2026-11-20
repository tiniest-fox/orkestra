import type { ReactNode } from "react"
import { FolderX, RotateCw, Unplug, X } from "lucide-react"
import Button from "../../components/Button"
import EmptyState from "../../components/EmptyState"
import type { RailProjectDto } from "../../api/types"

/**
 * The pane for a project with no client to show because its engine did not start, or
 * because the shell will not start one in its folder.
 *
 * The app's own error band, and under its presses the last lines the engine printed, in a
 * block that scrolls inside itself so a long trace does not push the presses away.
 *
 * **Try again is offered only where trying again could differ.** An engine that exited
 * may start once whatever it complained of is fixed; a folder that is gone, is not a
 * repository or has no `.orkestra/` is refused the same way every time, so that pane
 * offers *Remove from window* alone and has no output to show.
 *
 * **A host's project offers Remove alone**, which asks first. The host tries again by
 * itself, and its reason says when. One the host holds for a missing `.orkestra/` is
 * `OrkestraPane`'s instead, which can start it. A clone that failed is drawn the same way,
 * with git's lines as the output, and Remove is what dismisses it. A member of the host is
 * offered no Remove, which only an admin may press, and so no press at all.
 */
const FailedPane = ({
  project,
  onRetry,
  onRemove,
  removeLabel,
}: {
  readonly project: RailProjectDto
  /** Absent where nothing here starts an engine again — a host's page. */
  readonly onRetry: ((path: string) => void) | undefined
  /** Absent for a host's member, who may not remove a project. */
  readonly onRemove: ((path: string) => void) | undefined
  readonly removeLabel: string
}): ReactNode => {
  const refused = project.engine === "refused"
  const output = project.failure?.output
  return (
    <EmptyState
      tone="bad"
      icon={refused ? FolderX : Unplug}
      title={`${project.name} ${refused ? "cannot be opened" : "did not start"}`}
      action={
        <>
          {!refused && onRetry !== undefined && (
            <Button variant="primary" icon={RotateCw} onClick={() => onRetry(project.path)}>
              Try again
            </Button>
          )}
          {onRemove !== undefined && (
            <Button variant="quiet" icon={X} onClick={() => onRemove(project.path)}>
              {removeLabel}
            </Button>
          )}
        </>
      }
      under={
        output === undefined ? undefined : (
          <pre className="mt-2 max-h-40 w-full overflow-auto rounded-control bg-surface-2 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-fg">
            {output}
          </pre>
        )
      }
    >
      {project.failure?.reason ?? "The engine did not say why."}
    </EmptyState>
  )
}

export default FailedPane
