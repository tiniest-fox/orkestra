import type { ReactNode } from "react"
import type { RailProjectDto } from "../../api/types"
import { hueOf, initialsOf } from "./tile"
import { useIconForm } from "./useIconForm"

/**
 * A project's picture: the icon the shell found in its checkout, else two letters on a
 * colour taken from its name. Fills the box it is put in, which the tile sizes.
 *
 * **A found icon is drawn by its form**, which `useIconForm` reads off its corners. A
 * tile brings its own ground and goes edge to edge, in every place. A glyph is a shape on
 * a transparent ground, so it sits on the `surface-2` plate, set in 18% of the picture's
 * side on each edge — the rail's desktop tile included, so beside the lettered squares it
 * still reads as a tile with something on it. Percentage padding scales with the box, from
 * the 20px token panel to the 32px sheet row.
 *
 * **Until the form is known, the icon is drawn as it was before** — on the plate, inset by
 * `p-1` unless the caller turns `inset` off, as the desktop tile does — so nothing jumps
 * while the read is in flight, and a browser that refuses the read keeps that picture.
 *
 * The colour is computed rather than a token because it is the project's and not the
 * system's — there is one per name, and it has to be the same in both schemes for a tile
 * to be recognised by it.
 */
const ProjectPicture = ({
  project,
  inset = true,
  small = false,
}: {
  readonly project: RailProjectDto
  /** Whether a found icon is set in from its plate's edge while its form is unknown. */
  readonly inset?: boolean
  /** Letters a step smaller, for a picture under 24px — the phone header's waiting stack. */
  readonly small?: boolean
}): ReactNode => {
  const form = useIconForm(project.icon)
  if (project.icon === undefined)
    return (
      <span
        aria-hidden
        className={`flex size-full items-center justify-center font-mono font-semibold text-white ${small ? "text-2xs" : "text-sm"}`}
        style={{ background: `hsl(${String(hueOf(project.name))} 45% 42%)` }}
      >
        {initialsOf(project.name)}
      </span>
    )
  if (form === "tile") return <img src={project.icon} alt="" className="size-full object-cover" />
  const padding = form === "glyph" ? "p-[18%]" : inset ? "p-1" : ""
  return (
    <span className={`flex size-full items-center justify-center bg-surface-2 ${padding}`}>
      <img src={project.icon} alt="" className="size-full object-contain" />
    </span>
  )
}

export default ProjectPicture
