// The contract between a project window's page and the desktop shell that draws a hosted
// process's page, or the trak's pull request on GitHub, over it.
//
// Not a wire the engine serves, for `launcher.ts`'s reason: `desktop/` puts the bridge on
// the window and `client/` reads it, and neither may import the other.
//
// The page is drawn by a native view the shell lays over the window, not by anything in
// the document — so the client says where the pane is and the shell puts the view there.
// A native view sits above every element of the page, which is why `hide` exists: the
// client calls it whenever something of its own has to be drawn where the view is.
//
// One thing comes back: where the pull request view's GitHub login stands, which the client
// draws as a line over the view. What crosses is `unknown` on the reading side and decoded
// with the Schema below, `launcher.ts`'s rule.

import { Schema } from "effect"

/** The pane's box in CSS pixels, from the top-left of the window's page. */
export interface PageBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Where the pull request view's GitHub login stands, after the shell last copied it from
 * the default browser — or tried to. `browser` is that browser as macOS names it.
 *
 * - `copied` — the view carries the browser's login, and nothing is drawn.
 * - `signed-out` — the browser has no login, and the view never had one.
 * - `browser-out` — the browser has no login, and the view had one until this copy.
 * - `waiting` — a sign-in was handed to the browser and has not come back.
 * - `keychain` — macOS did not let the shell read the browser's key.
 * - `not-chromium` — the browser is not one the shell can copy from.
 */
export const PageLogin = Schema.Struct({
  state: Schema.Literal(
    "copied",
    "signed-out",
    "browser-out",
    "waiting",
    "keychain",
    "not-chromium",
  ),
  browser: Schema.String,
})
export type PageLogin = Schema.Schema.Type<typeof PageLogin>

/**
 * What the shell exposes to a project window as `window.orkestraPage`.
 *
 * `show` loads `url` when `run` is not the run the view already holds, then places and
 * shows the view; a second call with the same `run` only moves it. **The run decides,
 * not the address**: the engine gives a process the same port run after run, so a restart
 * arrives at the same `url`, and a view keyed on it would go on showing the stopped run's
 * page. `run` is opaque to the shell — the client names one run of one process at one
 * trak with it, and a new run is a new string. `url` has to be a loopback
 * `http:` address or an `https://github.com` pull request — the shell refuses anything else
 * and the view stays hidden. **The address picks the view**: the shell keeps one for each of
 * the two, so switching between them reloads neither, and `hide` and `reload` act on
 * whichever is showing. Every call is fire-and-forget: nothing the page does waits on the
 * shell.
 *
 * The pull request view copies the default browser's GitHub login as it is shown, and
 * again whenever the window comes back to the front; `onLogin` hears each result. `copyLogin`
 * copies again at once, and `signIn` opens GitHub's sign-in in the default browser.
 */
export interface PageBridge {
  readonly show: (run: string, url: string, bounds: PageBounds) => void
  readonly hide: () => void
  readonly reload: () => void
  /** Returns the unsubscribe. */
  readonly onLogin: (listener: (login: unknown) => void) => () => void
  readonly copyLogin: () => void
  readonly signIn: () => void
}
