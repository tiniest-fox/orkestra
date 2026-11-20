import type { ReactNode } from "react"
import type { RailProjectDto } from "../../api/types"

/**
 * The client of every project a host's page has shown, one frame each, over the pane.
 *
 * **A frame is hidden, never unmounted, when another project is selected.** Each project
 * is its own document under its own engine, so one unmounted is a reload and loses its
 * place — the shell keeps its native views alive off screen for the same reason. `hidden`
 * takes it off screen and `inert` out of the focus order and the accessibility tree, and
 * each kept frame holds its own stream open, which is the price of keeping its place.
 *
 * **Only a project whose engine is started has a frame.** The host answers a project it
 * cannot forward to with a JSON body, and a frame would show it as text; the pane draws
 * the loading frame or the failure instead, and the frame mounts once the engine answers.
 */
const ProjectFrames = ({
  projects,
  visited,
  selected,
}: {
  readonly projects: readonly RailProjectDto[]
  readonly visited: readonly string[]
  readonly selected: string | undefined
}): ReactNode =>
  projects.map((project) =>
    project.href === undefined ||
    project.engine !== "started" ||
    !visited.includes(project.path) ? null : (
      // The box is what is positioned, because a frame is a replaced element: placed by its
      // four edges alone it keeps its intrinsic 300×150. It stops short of the home
      // indicator, which a document inside a frame cannot see to pay for itself.
      <div
        key={project.path}
        hidden={project.path !== selected}
        inert={project.path !== selected}
        className="absolute inset-x-0 top-0 bottom-safe-b"
      >
        {/* No sandbox, unlike a view's frame: this is the app itself, on this origin, and it
            needs its scripts and its origin both — a sandbox granting the two is none. */}
        {/* oxlint-disable-next-line react/iframe-missing-sandbox -- the frame is this origin's own app */}
        <iframe src={project.href} title={project.name} className="size-full border-0 bg-canvas" />
      </div>
    ),
  )

export default ProjectFrames
