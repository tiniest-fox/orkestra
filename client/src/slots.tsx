import type { ReactNode } from "react"
import type { HostTransport } from "./api/rail"
import type { GoalDto, RailProjectDto, RailStateDto, TrakDetailDto } from "./api/types"

// Where a host may draw something of its own into a public screen. Each slot is a
// component, or for the rail's host parts a hook whose answer draws nothing, and its public
// default draws nothing. A host's client build may redirect every import of this file to
// its own module, which exports the same names with the same props — so which file this
// is, the build decides.
// No registry and no lookup at runtime.
//
// **A band slot draws exactly where the item's `ownership` is set**, and the gates around
// each call site stay public on that promise: `bandBelow`, the drawer's safe-area padding,
// the skip, the gate presses, the finish doors, the paused band, Resume and `ownersView`.
// A band also pays the phone's home-indicator inset (`pb-foot`), as the chat bar it stands
// in for does (`DrawerPane` names every payer). Nothing sets `ownership` on an engine nobody
// hosts, so these defaults are never asked.

export type TrakBandProps = { readonly trak: TrakDetailDto }
export type GoalBandProps = { readonly goal: GoalDto }

/** The trak screen's footer, for a viewer who is not the trak's owner. */
export const TrakBand = (_props: TrakBandProps): ReactNode => null

/** The goal screen's foot, for a viewer who is not the goal's owner. */
export const GoalBand = (_props: GoalBandProps): ReactNode => null

/**
 * The rail's and the launcher's transport on a page with no Orkestra.app bridge: a host's
 * HTTP API. Not a component or a hook but the transport itself, which `useRail`, `useRecents`
 * and `useOpenProject` hand to `api/rail.ts` and `api/launcher.ts`. The public build has no
 * host, so it answers nothing, and a page with no bridge says it could not read its projects.
 */
export const hostTransport: HostTransport | undefined = undefined

/** The host's presses on its own list that the public rail and pane make. */
export interface HostPresses {
  /** Open the repo search for the host's own list. */
  readonly search: () => void
  /** Ask before removing a project from the host. */
  readonly ask: (path: string) => void
  /** Boot a project held for a missing `.orkestra/`, making the empty folder. */
  readonly start: (path: string) => void
  /** Take a project held at Add off the host and delete its clone, with no confirm. */
  readonly cancel: (path: string) => void
  /** The project a start or a cancel is out for. */
  readonly answering: string | undefined
  /** Why the last start or cancel was refused, and the project it was for. */
  readonly answerSaid: { readonly path: string; readonly said: string } | undefined
  /** The settings pane gives way to a project being selected. */
  readonly closeSettings: () => void
  /** Open a tile's menu at a point, the page's own rather than the shell's. */
  readonly openMenu: (at: { readonly path: string; readonly x: number; readonly y: number }) => void
}

export interface HostRailArgs {
  /** The page is a host's rather than a window of Orkestra.app. */
  readonly host: boolean
  readonly rail: RailStateDto | undefined
  /** The rail is the phone's strip and sheet. */
  readonly phone: boolean
  /** An item in a tile's or a team's menu was chosen — the phone's sheet under it closes. */
  readonly onChosen: () => void
}

/** What the rail draws of a host's own: its presses, role, teams, overlays and settings. */
export interface HostRail {
  /** The host's presses on its list; absent where the page is not a host's. */
  readonly presses: HostPresses | undefined
  /** The device may add to the host's own list — an admin, on a host with no teams' groups. */
  readonly add: boolean
  /** Whether the device acts as an admin of the project at `path`, which offers it Remove and Start. */
  readonly adminFor: (path: string | undefined) => boolean
  /** The rail's tiles grouped by team, each drawn by `tile`; absent for the plain list. */
  readonly tiles: ((tile: (project: RailProjectDto) => ReactNode) => ReactNode) | undefined
  /**
   * The phone sheet's list grouped by team, its rows and add rows drawn by the sheet's own `row`
   * and `add`; absent for the plain list.
   */
  readonly sections:
    | ((
        row: (project: RailProjectDto) => ReactNode,
        add: (label: string, press: () => void) => ReactNode,
      ) => ReactNode)
    | undefined
  /** The settings are open in the pane, in a project's place: no project is selected. */
  readonly open: boolean
  /** What the phone's strip calls the open settings. */
  readonly title: string | undefined
  /** What the pane draws while they are open. */
  readonly pane: ReactNode
  /**
   * The host's overlays over the whole page — the repo search, a tile's or a team's menu, the
   * remove it confirms, and the questions a save, a copy or a revoke asks first. Drawn after
   * the phone's sheet, so a menu opened from it draws over it.
   */
  readonly overlays: ReactNode
  /** The rail's gear and the sheet's settings row; absent where there are no settings. */
  readonly gear: { readonly open: boolean; readonly onOpen: () => void } | undefined
}

const NO_HOST: HostRail = {
  presses: undefined,
  add: false,
  adminFor: () => false,
  tiles: undefined,
  sections: undefined,
  open: false,
  title: undefined,
  pane: null,
  overlays: null,
  gear: undefined,
}

/**
 * The rail's host parts — the host's presses on its list, the device's role, the teams' groups,
 * the overlays, and the gear and the panes it opens. **One hook rather than several components**, because the rail reads them
 * in many places — the add tile, the pane, both lists, the overlays and the phone's title — and
 * the teams, the role and the settings decide one another. Only a host has any of them.
 */
export const useHostRail = (_args: HostRailArgs): HostRail => NO_HOST
