// The contract between an Orkestra.app window's own page — the project rail — and the
// process that opened it.
//
// Not a wire the engine serves, for `launcher.ts`'s reason: `desktop/` puts the bridge on
// the window and `client/` reads it, and neither may import the other.
//
// A window's page is the rail and the pane right of it. Each started project is the
// engine's own client in a native view the shell lays over the pane, so the page draws the
// pane only for a project with no client to show — one starting, one that failed, a folder
// the shell refuses, or a window holding none. What crosses is `unknown` on the reading
// side and decoded with the Schema below, `launcher.ts`'s rule.
//
// A host serves the same page with no bridge on it, and the page's seam builds this state
// itself out of the host's HTTP API. The fields only that page sets — `href`, `owned` and
// `host` — are what tell the page to frame each project and to edit the list through the
// host rather than the shell.

import { Schema } from "effect"
import { TrakSummaryDto } from "./dto/trak.js"
import type { PageBounds } from "./page.js"

/**
 * One project on a window's rail.
 *
 * `engine` is where the project's engine stands for this app: `off` until its tile is
 * first selected, `starting` from that press until the engine answers, then `started`.
 * `failed` is an engine that exited or never answered; `refused` is a folder the shell
 * will not start one in. `failure` is present on those two, and its `output` — the last
 * lines the engine printed — only on `failed`.
 *
 * `icon` is a `data:` address for the picture found in the checkout, absent where none
 * was. `traks` is the engine's own list, absent until a started engine has answered —
 * and for as long as it refuses the app's credential — so a tile with none draws no count
 * rather than a zero.
 *
 * `progress` is how far a clone has come, 0–100, on a host project still `starting`
 * because it is being cloned — present for the whole clone, so its presence is what says
 * the project is cloning. `phase` is how far a host project's boot has got, as
 * `HostProjectDto` says it, on one `starting` and not cloning. `owned` is a clone the host
 * made under its own projects folder, the only kind a remove may delete. `noOrkestra` is a
 * host project `refused` because its folder has no `.orkestra/`, which the host starts
 * once a person asks — `added` when it came straight from Add. The shell sends none of the
 * four.
 *
 * `href` is where the page itself frames the project's client, relative to the page. The
 * shell never sends it, since it lays a native view over the pane instead; a host's page
 * sets it on every started project.
 *
 * `team` is the id of the host team the project belongs to — `host` for the original team.
 * A host's page sets it on every project; the shell never does.
 */
export const RailProjectDto = Schema.Struct({
  path: Schema.String,
  /** The folder's own name. */
  name: Schema.String,
  /** The path as a person reads it: `~` for the home directory, the rest whole. */
  short: Schema.String,
  icon: Schema.optional(Schema.String),
  engine: Schema.Literal("off", "starting", "started", "failed", "refused"),
  failure: Schema.optional(
    Schema.Struct({ reason: Schema.String, output: Schema.optional(Schema.String) }),
  ),
  traks: Schema.optional(Schema.Array(TrakSummaryDto)),
  progress: Schema.optional(Schema.Number),
  phase: Schema.optional(Schema.Literal("engine")),
  owned: Schema.optional(Schema.Boolean),
  noOrkestra: Schema.optional(Schema.Struct({ added: Schema.Boolean })),
  href: Schema.optional(Schema.String),
  team: Schema.optional(Schema.String),
})
export type RailProjectDto = Schema.Schema.Type<typeof RailProjectDto>

/**
 * One window's rail, top to bottom, and the path of the project its pane shows.
 *
 * `host` is a host's list. The page adds to it from GitHub and removes from it through the
 * host's own routes, and draws no folder picker, no Try again — the host retries a crash by
 * itself, and a folder with no `.orkestra/` has a Start of its own — and no native menu.
 * The shell never sends it.
 *
 * A host's page may carry more than this, in shapes the host defines and its own client
 * reads.
 */
export const RailStateDto = Schema.Struct({
  projects: Schema.Array(RailProjectDto),
  selected: Schema.optional(Schema.String),
  host: Schema.optional(Schema.Boolean),
})
export type RailStateDto = Schema.Schema.Type<typeof RailStateDto>

/**
 * What the shell exposes to a window's own page as `window.orkestraRail`.
 *
 * `state` answers with the rail as it is now and `onState` is every later change, sent
 * whole. The presses are fire-and-forget: each one's result is the next state, so nothing
 * on the page waits on the shell. `select` starts the project's engine the first time;
 * `retry` starts one that failed; `remove` takes the project off the window and stops an
 * engine the app started, after the shell's own question when a turn is running; `menu`
 * opens the tile's native menu.
 *
 * `place` says where the pane is, in CSS pixels from the top-left of the page — the
 * shell lays the selected project's view over exactly that box.
 *
 * The same window also carries `window.orkestra`, the launch window's bridge, for the
 * recent projects and the folder picker.
 */
export interface RailBridge {
  readonly state: () => Promise<unknown>
  /** Returns the unsubscribe. */
  readonly onState: (listener: (state: unknown) => void) => () => void
  readonly select: (path: string) => void
  readonly retry: (path: string) => void
  readonly remove: (path: string) => void
  readonly menu: (path: string) => void
  readonly place: (bounds: PageBounds) => void
}
