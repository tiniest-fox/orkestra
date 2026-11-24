import type { ReactNode } from "react"
import { useState } from "react"
import { Unplug } from "lucide-react"
import EmptyState from "../../components/EmptyState"
import type { RailProjectDto } from "../../api/types"
import { usePhone } from "../../hooks/usePhone"
import { useHostRail } from "../../slots"
import type { HostPresses } from "../../slots"
import { useOpenProject } from "../launcher/useOpenProject"
import type { OpenProject } from "../launcher/useOpenProject"
import ClonePane from "./ClonePane"
import EmptyWindow from "./EmptyWindow"
import FailedPane from "./FailedPane"
import OrkestraPane from "./OrkestraPane"
import ProjectFrames from "./ProjectFrames"
import ProjectHeader from "./ProjectHeader"
import ProjectRail from "./ProjectRail"
import ProjectSheet from "./ProjectSheet"
import StartPane from "./StartPane"
import { useFrameScreen } from "./useFrameScreen"
import { usePane } from "./usePane"
import { useRail } from "./useRail"
import { useRailPresses } from "./useRailPresses"
import type { RailPresses } from "./useRail"
import { useVisited } from "./useVisited"

/**
 * What the pane draws for the project the rail has selected.
 *
 * **A started project draws the same frame as one that is starting**, and that is the
 * point: the frame
 * is the trak list's own first load, the shell lays the project's client over it the
 * moment its engine answers, and the client's first paint is this frame again — so the
 * app arrives in place. The shell never says an engine is starting, which was accepted. A
 * clone does say so, since nothing of the project exists yet for the frame to stand for,
 * and so does a host project whose boot says how far it has got.
 *
 * On a host's page the start page's button opens the repo search, a failed project's
 * remove asks first, and a project with no `.orkestra/` asks whether to start it.
 */
const Pane = ({
  project,
  presses,
  open,
  host,
  admin,
  add,
}: {
  readonly project: RailProjectDto | undefined
  readonly presses: RailPresses
  readonly open: OpenProject
  /** A host's own presses; absent in the shell. */
  readonly host: HostPresses | undefined
  /** Whether the device acts as an admin of the project; a member adds, starts and removes nothing. */
  readonly admin: boolean
  /** Whether the empty window offers the host's Add, which a host with teams leaves to each team's menu. */
  readonly add: boolean
}): ReactNode => {
  const onAsk = host?.ask
  if (project === undefined)
    return (
      <EmptyWindow
        press={open}
        host={host !== undefined}
        onSearch={add ? host?.search : undefined}
      />
    )
  if (project.progress !== undefined)
    return <ClonePane name={project.name} progress={project.progress} />
  if (project.noOrkestra !== undefined && host !== undefined)
    return (
      <OrkestraPane
        project={project}
        busy={host.answering === project.path}
        said={host.answerSaid?.path === project.path ? host.answerSaid.said : undefined}
        onStart={host.start}
        onCancel={host.cancel}
        onRemove={host.ask}
        admin={admin}
      />
    )
  if (project.engine === "failed" || project.engine === "refused")
    return (
      <FailedPane
        project={project}
        onRetry={onAsk === undefined ? presses.retry : undefined}
        onRemove={host === undefined ? presses.remove : admin ? onAsk : undefined}
        removeLabel={onAsk === undefined ? "Remove from window" : "Remove project…"}
      />
    )
  // A project the page frames itself draws its frame over this box, and nothing under it.
  if (project.engine === "started" && project.href !== undefined) return null
  if (project.engine === "starting" && project.phase !== undefined)
    return <StartPane name={project.name} phase={project.phase} />
  return <EmptyState loading />
}

/** The pane before the rail's first read: loading, or why it could not be read. */
const Unread = ({ error }: { readonly error: Error | null }): ReactNode =>
  error === null ? (
    <EmptyState loading />
  ) : (
    <EmptyState tone="bad" icon={Unplug} title="Could not read this window’s projects">
      {error.message}
    </EmptyState>
  )

/**
 * A window of Orkestra.app, or a host's page: the project rail down its left edge, and
 * the pane.
 *
 * **In the shell, most of the time the pane is not this page's.** Each started project is
 * the engine's own client in a native view the shell lays over the pane, and the view of a
 * project that is not selected stays alive off screen — which is what lets a switch keep
 * each project's place. So this page draws the rail always, and the pane only for a
 * project with no client: starting, failed, refused, or none at all. `usePane` tells the
 * shell where that box is.
 *
 * **On a host's page the page is the shell.** A started project carries an `href`, and
 * `ProjectFrames` keeps a frame per project shown over the pane, hidden rather than
 * unmounted when another is picked. Its list is `host`: the add tile opens a search of
 * the person's GitHub repos, the tile's menu and the remove it confirms are the page's own
 * (the host's presses and overlays), and the rail ends in a gear that opens the host's settings
 * in the pane. **Every part only a host draws is the host's to provide**, reached through one slot,
 * `useHostRail` in `slots.tsx`, whose public answer draws nothing. **While they are open no project is selected**, so every frame is hidden
 * and none covers them; a press on a tile closes them. A project's own settings open in the
 * same pane, from its tile's menu.
 *
 * **A host's member is offered only what a member may do** — the slot's role: no Add, no
 * Remove, no Start and no Project settings, and in Settings only their own credential
 * and devices.
 *
 * **On a host with two or more teams the rail and the sheet group projects by team**
 * (the slot's `tiles` and `sections`), each team's header the way into its menu: Expand or Collapse, and for an
 * admin of the team, Add to it and its settings, which open in the pane in Settings'
 * place. A team's admin removes and starts its projects and opens their Project
 * settings as a host admin does. Which groups are folded is this device's own.
 *
 * The host's overlays draw after the phone's sheet, so a tile's menu opened from it draws over it.
 *
 * **The phone layout is a host's alone.** On a phone the rail becomes a strip across the
 * top that opens a sheet — but the shell's window can be narrowed past the breakpoint
 * too, and there the sheet would draw under the native view laid over the pane. So the
 * strip is drawn only for a list the page frames itself, and while the first read is
 * still out, since a phone that waited on it would draw a desk's rail first.
 *
 * **The strip is the whole header** — `ProjectHeader`, which adds the other projects
 * waiting and the frame's search, while the frame draws no bar of its own. It is the same
 * header over every screen of the frame and over every pane without one, the host's
 * settings among them.
 */
const RailPage = (): ReactNode => {
  const { state, presses } = useRail()
  const folder = useOpenProject()
  const pane = usePane()
  const phone = usePhone()
  const [sheet, setSheet] = useState(false)
  const rail = state.data
  const host = rail?.host === true
  const compact = phone && (rail === undefined || host)
  const projects = rail?.projects ?? []
  const cloud = useHostRail({
    host,
    rail,
    phone: compact,
    onChosen: () => setSheet(false),
  })
  const settingsOpen = cloud.open
  const edits = cloud.presses
  const { select, onMenu } = useRailPresses(edits, presses)
  const open = settingsOpen ? undefined : rail?.selected
  const selected = projects.find((project) => project.path === open)
  const visited = useVisited(selected?.path)
  const search = useFrameScreen(selected, compact)
  return (
    <div className={`flex h-full bg-canvas text-fg ${compact ? "flex-col" : ""}`}>
      {compact ? (
        <ProjectHeader
          project={selected}
          settings={cloud.title}
          projects={projects}
          search={search}
          onOpen={() => setSheet(true)}
        />
      ) : (
        <ProjectRail
          projects={projects}
          selected={open}
          adding={folder.disabled}
          onSelect={select}
          onMenu={onMenu}
          onAdd={host ? (cloud.add ? edits?.search : undefined) : folder.pick}
          addLabel={host ? "Add a project from GitHub…" : "Open another folder…"}
          settings={cloud.gear}
          grouped={cloud.tiles}
        />
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col pb-safe-b">
        <main ref={pane} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {settingsOpen ? (
            cloud.pane
          ) : rail !== undefined ? (
            <Pane
              project={selected}
              presses={presses}
              open={folder}
              host={edits}
              admin={cloud.adminFor(selected?.path)}
              add={cloud.add}
            />
          ) : (
            <Unread error={state.error} />
          )}
        </main>
        <ProjectFrames projects={projects} visited={visited} selected={selected?.path} />
      </div>
      {compact && sheet && (
        <ProjectSheet
          projects={projects}
          selected={open}
          onSelect={select}
          onMenu={host ? onMenu : undefined}
          onAdd={cloud.add ? edits?.search : undefined}
          settings={cloud.gear?.onOpen}
          grouped={cloud.sections}
          onClose={() => setSheet(false)}
        />
      )}
      {cloud.overlays}
    </div>
  )
}

export default RailPage
