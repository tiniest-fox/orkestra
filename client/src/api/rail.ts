/**
 * The project rail's seam — the one file in `client/` that reads `window.orkestraRail`.
 *
 * Two pages load `rail.html`: every window of Orkestra.app but the launch window, whose
 * preload puts a `RailBridge` on it before the page runs, and a host's root, which has
 * none. **The bridge is used wherever it is present, and the host's transport otherwise**,
 * asked per call rather than once. A host provides its transport: a hook hands it in from
 * the `hostTransport` slot (`client/src/slots.tsx`), which the public build leaves
 * `undefined`, so a public page with no bridge reads nothing and says so as the query's
 * error. A hook depends on the functions below and never learns which one answered; the
 * state says what differs — a host's projects carry an `href` to frame, and its list is
 * `host`.
 *
 * With no bridge only `select` does anything. Retry, remove and the tile's menu are the
 * shell's; a host retries by itself, and its page removes through the host's transport and draws
 * its own menu. `placePane` lays a native view the page has not got.
 *
 * What comes over the bridge is `unknown` by contract and decoded here, `http.ts`'s rule.
 */

import { Schema } from "effect"
import type { PageBounds } from "@orkestra/shared/page"
import type { RecentProjectDto } from "@orkestra/shared/launcher"
import type { RailBridge } from "@orkestra/shared/rail"
import { RailStateDto as RailStateSchema } from "@orkestra/shared/rail"

declare global {
  interface Window {
    /** Present only on a window of Orkestra.app that draws the rail; the preload puts it here. */
    orkestraRail?: RailBridge
  }
}

type RailStateDto = Schema.Schema.Type<typeof RailStateSchema>

/**
 * What a page with no bridge reads its rail and its recent projects through: a host's HTTP
 * API, which only a host's build has.
 */
export interface HostTransport {
  readonly readRail: () => Promise<RailStateDto>
  /** Every later state, and `lost` each time the host's stream is shut for good. */
  readonly watchRail: (listener: (state: RailStateDto) => void, lost: () => void) => () => void
  readonly select: (path: string) => void
  readonly readRecents: () => Promise<readonly RecentProjectDto[]>
}

const decodeRail = Schema.decodeUnknownSync(RailStateSchema)

/** What a page with neither a bridge nor a host's transport says it could not read. */
export const NO_RAIL = "This page has no Orkestra.app window and no host behind it."

export const readRail = async (host: HostTransport | undefined): Promise<RailStateDto> => {
  const bridge = window.orkestraRail
  if (bridge !== undefined) return decodeRail(await bridge.state())
  if (host === undefined) throw new Error(NO_RAIL)
  return host.readRail()
}

/**
 * Every later state of the rail, whole and decoded, and `lost` each time the host's stream
 * is shut for good — a bridge never is. Returns the unsubscribe.
 */
export const watchRail = (
  listener: (state: RailStateDto) => void,
  lost: () => void,
  host: HostTransport | undefined,
): (() => void) =>
  window.orkestraRail === undefined
    ? (host?.watchRail(listener, lost) ?? (() => {}))
    : window.orkestraRail.onState((state) => listener(decodeRail(state)))

/** Show a project on the pane; the shell starts its engine the first time. */
export const selectProject = (path: string, host: HostTransport | undefined): void => {
  if (window.orkestraRail === undefined) host?.select(path)
  else window.orkestraRail.select(path)
}

/** Start a project whose engine failed to start. */
export const retryProject = (path: string): void => window.orkestraRail?.retry(path)

/** Take a project off this window; the shell asks first when a turn is running. */
export const removeProject = (path: string): void => window.orkestraRail?.remove(path)

/** The tile's native menu, drawn by the shell. */
export const projectMenu = (path: string): void => window.orkestraRail?.menu(path)

/** Where the pane is on the page, which is where the shell lays the selected project. */
export const placePane = (bounds: PageBounds): void => window.orkestraRail?.place(bounds)
