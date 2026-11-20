/**
 * The launch window's seam — the one file in `client/` that reads `window.orkestra`.
 *
 * The desktop shell's preload puts a `LauncherBridge` there before the page runs, and
 * this is the client's side of it, the way the engine's files in `api/` are the client's side of `fetch`:
 * a hook depends on the four functions below and never learns what is behind them.
 *
 * **With no bridge the list is a host's**, through the host transport a hook hands in from
 * the `hostTransport` slot (`rail.ts` says why): its projects stand in for the recent ones,
 * opening one is the rail's own select, and there is no folder to pick — a host's list is
 * its operator's file. A page with no bridge and no host transport, `/launcher.html` off an
 * engine, gets that as the query's error rather than an empty list.
 *
 * What comes over the bridge is `unknown` by contract and decoded here with the wire
 * package's Schema, `http.ts`'s rule: a shape the shell got wrong fails in this file,
 * where the queryFn's throw is a query error, and not in a row.
 */

import { Schema } from "effect"
import type { LauncherBridge } from "@orkestra/shared/launcher"
import { RecentProjectDto as RecentProjectSchema } from "@orkestra/shared/launcher"
import { NO_RAIL } from "./rail"
import type { HostTransport } from "./rail"

declare global {
  interface Window {
    /** Present only inside Orkestra.app's launch window; the preload puts it here. */
    orkestra?: LauncherBridge
  }
}

const decodeRecents = Schema.decodeUnknownSync(Schema.Array(RecentProjectSchema))

export const readRecents = async (
  host: HostTransport | undefined,
): Promise<readonly RecentProjectDto[]> => {
  const bridge = window.orkestra
  if (bridge !== undefined) return decodeRecents(await bridge.recents())
  if (host === undefined) throw new Error(NO_RAIL)
  return host.readRecents()
}

/**
 * Every change to the list after the first read, decoded the same way. Returns the
 * unsubscribe, which is what a `useEffect` returns.
 *
 * With no bridge there is nothing to watch: a host's list is read once at its boot, and a
 * throw from inside an effect would reach no boundary and take the page down instead.
 */
export const watchRecents = (
  listener: (recents: readonly RecentProjectDto[]) => void,
): (() => void) =>
  window.orkestra === undefined
    ? () => {}
    : window.orkestra.onRecents((rows) => listener(decodeRecents(rows)))

/** Settles once the project's window is up, or the shell has said why it is not. */
export const openProject = async (path: string, host: HostTransport | undefined): Promise<void> => {
  const bridge: LauncherBridge | undefined = window.orkestra
  if (bridge === undefined) host?.select(path)
  else await bridge.open(path)
}

/** The shell's folder picker, then the same as `openProject` on what was chosen. */
export const pickProject = async (): Promise<void> => {
  const bridge: LauncherBridge | undefined = window.orkestra
  if (bridge === undefined)
    throw new Error("A host's projects are its own file; none is added here.")
  await bridge.pick()
}

type RecentProjectDto = Schema.Schema.Type<typeof RecentProjectSchema>
