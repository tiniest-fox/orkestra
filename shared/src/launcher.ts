// The contract between the desktop shell's launch window and the process that opened it.
//
// Not a wire the engine serves: Electron loads the page off disk and the page talks to
// the main process over a preload bridge. It is in this package because two packages have
// to agree on it — `desktop/` puts the bridge on the page and `client/` reads it — and
// neither may import the other.
//
// What crosses is `unknown` on the reading side, the way a response body is: the page's
// seam decodes it with the Schema below, so a shell that sent the wrong shape fails there
// rather than in a row.

import { Schema } from "effect"

/** One recent project, as a row draws it. */
export const RecentProjectDto = Schema.Struct({
  path: Schema.String,
  /** The folder's own name. */
  name: Schema.String,
  /** The path as a person reads it: `~` for the home directory, the rest whole. */
  short: Schema.String,
})
export type RecentProjectDto = Schema.Schema.Type<typeof RecentProjectDto>

/**
 * What the shell exposes to the launch window as `window.orkestra`.
 *
 * `recents` answers with the list as it is now; `onRecents` is every later change, so a
 * row that stopped opening leaves the window without the page asking again. `open` and
 * `pick` settle once the shell has finished with the press — the project's window is up,
 * or the shell has said why not — and never reject for a refusal the shell has already
 * reported.
 */
export interface LauncherBridge {
  readonly recents: () => Promise<unknown>
  /** Returns the unsubscribe. */
  readonly onRecents: (listener: (recents: unknown) => void) => () => void
  readonly open: (path: string) => Promise<void>
  readonly pick: () => Promise<void>
}
