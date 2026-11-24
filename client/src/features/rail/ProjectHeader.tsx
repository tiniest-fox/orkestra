import type { ReactNode } from "react"
import { Settings } from "lucide-react"
import Mark from "../../components/Mark"
import PhoneHeader from "../../components/PhoneHeader"
import PhoneSearch from "../../components/PhoneSearch"
import type { RailProjectDto } from "../../api/types"
import CloneRing from "./CloneRing"
import ProjectPicture from "./ProjectPicture"
import WaitingStack from "./WaitingStack"
import { tileLabel } from "./tile"

/**
 * A host's header on a phone: the picker on the left, the other projects waiting on the
 * person, and the frame's search on the right, over the frame, whose own bar stands down.
 *
 * The left side is the open project's picture, greyed in its ring while it clones; the
 * gear and *Settings* or a team's settings while those are open; the mark and *Projects* before anything
 * is chosen. Every one of them is the press that opens the sheet.
 *
 * Search asks the open project's frame to open its palette, so it is disabled wherever
 * no frame is there to ask — `PhoneSearch` says why it stays drawn.
 *
 * **It is the same header over every screen of the frame** — the list, a trak, a goal, a
 * new trak — so it takes no word from the frame about which one is open. A header that
 * shifts when a trak opens reads as a different page.
 */
const ProjectHeader = ({
  project,
  settings,
  projects,
  search,
  onOpen,
}: {
  readonly project: RailProjectDto | undefined
  /** The name of the settings open in the pane — the host's or a team's — or `undefined`. */
  readonly settings: string | undefined
  readonly projects: readonly RailProjectDto[]
  /** Open the frame's palette; absent where there is no frame to ask. */
  readonly search: (() => void) | undefined
  readonly onOpen: () => void
}): ReactNode => (
  <PhoneHeader
    label="Projects"
    subject={
      settings !== undefined ? (
        <span className="flex size-full items-center justify-center bg-surface-2 text-fg-muted">
          <Settings size={16} aria-hidden />
        </span>
      ) : project === undefined ? (
        <Mark size={28} />
      ) : project.progress === undefined ? (
        <ProjectPicture project={project} />
      ) : (
        <CloneRing progress={project.progress}>
          <ProjectPicture project={project} />
        </CloneRing>
      )
    }
    name={settings ?? project?.name ?? "Projects"}
    pick={{
      label:
        settings !== undefined
          ? `${settings} — switch project`
          : project === undefined
            ? "Choose a project"
            : `${tileLabel(project)} — switch project`,
      onPick: onOpen,
    }}
    waiting={
      <WaitingStack
        projects={projects.filter((other) => other.path !== project?.path)}
        onOpen={onOpen}
      />
    }
    end={<PhoneSearch onSearch={search} />}
  />
)

export default ProjectHeader
