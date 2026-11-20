// A terminal or editor opened at a checkout, and a sandboxed trak's shell line and
// rebuild. Answers with `@orkestra/shared/dto/openers`.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import {
  ChooseOpenerRequestDto,
  OpenCheckoutRequestDto,
  type OpenerKindDto,
  OpenerDto,
  OpenerListDto,
  OpenersDto,
  SandboxRebuildDto,
  SandboxShellDto,
} from "@orkestra/shared/dto/openers"
import type { CheckoutPlace } from "../../vcs/index.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { Store } from "../../workflow/ports/store.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import {
  NO_LOCAL_PATH,
  rebuildSandboxAt,
  sandboxPlaceOf,
  sandboxShellOf,
  shellEnv,
} from "../handoff.js"
import { type OpenerListing, Openers } from "../openers.js"
import { pathId, PROJECT } from "./common.js"

/** One kind's half of the listing, as the wire carries it. */
const toOpenerListDto = (listing: OpenerListing): OpenerListDto =>
  OpenerListDto.make({
    apps: listing.apps.map((app) =>
      OpenerDto.make({
        id: app.id,
        name: app.name,
        ...(app.icon === undefined ? {} : { icon: app.icon }),
      }),
    ),
    ...(listing.chosen === undefined ? {} : { chosen: listing.chosen }),
  })

/**
 * The terminals and editors this machine has, and the one of each a press on its
 * control opens.
 *
 * **204 is the platform saying no, and the surface's cue to hide both controls.** On
 * anything but macOS nothing is detected and nothing is served — see `app/openers.ts`.
 * Not a 404: every route's chrome asks for this listing, and a browser logs any 4xx a
 * fetch gets as a console error whether the page handles it or not.
 * The route cannot instead be gated on *where the viewer is*: a tunnelled request
 * reaches the engine over loopback exactly like a local one (`app/guard.ts`), so which
 * machine is asking is unknowable here, and the phone layout hiding the controls is the
 * one case that is.
 */
const openersRoute = Router.get(
  "/api/openers",
  Effect.gen(function* () {
    const listing = yield* (yield* Openers).list
    if (listing === undefined) return ServerResponse.empty({ status: 204 })
    return yield* ServerResponse.json(
      OpenersDto.make({
        terminal: toOpenerListDto(listing.terminal),
        editor: toOpenerListDto(listing.editor),
      }),
    )
  }),
)

/**
 * An explicit pick for one kind, stored once per machine — the only thing that ever
 * writes the preference; a guess never does.
 *
 * A 400 rather than a `RefusalDto`, for the create route's reason: the dropdown only
 * ever offers what `GET /api/openers` listed under that kind, so an identifier the scan
 * does not return is a hand-written request — and a refusal variant would put a case in
 * the client's exhaustive switch that its own UI cannot produce.
 */
const chooseOpenerRoute = Router.post(
  "/api/openers",
  Effect.gen(function* () {
    const request = yield* ServerRequest.schemaBodyJson(ChooseOpenerRequestDto)
    const outcome = yield* (yield* Openers).choose(request.kind, request.id)
    if (outcome === "unsupported") return ServerResponse.empty({ status: 404 })
    if (outcome === "unknown") {
      return ServerResponse.empty({
        status: 400,
        statusText: `no ${request.kind} \`${request.id}\` is installed`,
      })
    }
    return ServerResponse.empty({ status: 204 })
  }),
)

/**
 * Open the chosen terminal or editor at this trak's checkout. **Spends nothing** — no
 * agent, no custody, no event; one `open` process on the engine's machine, which is
 * where the window appears.
 *
 * 404 for all four ways there is nothing to open — an unknown trak, one whose checkout
 * has not been made yet, a checkout the archive has deleted (`Trak.worktree` keeps
 * naming it — see `replay.ts` at `WorktreeRemoved`), and a platform with no scan. The
 * surface only draws a control when the wire carries a checkout path, so each is a
 * request its own UI cannot produce.
 */
const openCheckoutRoute = Router.post(
  "/api/traks/:id/open",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(OpenCheckoutRequestDto)
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const worktree = replayHistory(id, events).worktree
    if (worktree === undefined) return ServerResponse.empty({ status: 404 })

    const place = yield* sandboxPlaceOf(worktree.path)
    if (place !== undefined) return yield* openSandboxed(request.kind, place)
    const outcome = yield* (yield* Openers).openAt(request.kind, worktree.path)
    if (outcome !== "opened") return ServerResponse.empty({ status: 404, statusText: outcome })
    return ServerResponse.empty({ status: 204 })
  }),
)

/**
 * The press on a trak whose checkout is in a sandbox, where this machine has nothing to
 * open. The terminal runs the runner's `shell` verb at the checkout, in the sandbox, with
 * the runner's secret and the agent CLIs' tokens handed through `runInTerminal`'s pipe
 * rather than written anywhere. The editor is a 409: there is no local path to open, and
 * the screen draws that control disabled, so the press is one its own UI cannot produce.
 */
const openSandboxed = (kind: OpenerKindDto, place: CheckoutPlace) =>
  Effect.gen(function* () {
    if (kind === "editor") return ServerResponse.empty({ status: 409, statusText: NO_LOCAL_PATH })
    const shell = yield* sandboxShellOf(place)
    if (shell === undefined) return ServerResponse.empty({ status: 404 })
    const outcome = yield* (yield* Openers).runInTerminal(
      shell.command,
      shellEnv(shell, process.env),
      PROJECT,
    )
    if (outcome !== "opened") return ServerResponse.empty({ status: 404, statusText: outcome })
    return ServerResponse.empty({ status: 204 })
  })

/**
 * The runner's `shell` line for this trak's sandbox, for `pnpm host shell <project>
 * <trak>` to run on the host's machine — the handoff a screen under a host shows in place
 * of the terminal press. **No secret crosses**: each name in `inherited` is valued by the
 * host from the secrets it already hands this engine. Spends nothing and starts nothing.
 *
 * 404 for an unknown trak, one with no checkout, and one whose checkout is not in a sandbox.
 */
const sandboxShellRoute = Router.get(
  "/api/traks/:id/shell",
  Effect.gen(function* () {
    const id = yield* pathId
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const worktree = replayHistory(id, events).worktree
    const place = worktree === undefined ? undefined : yield* sandboxPlaceOf(worktree.path)
    const shell = place === undefined ? undefined : yield* sandboxShellOf(place)
    if (shell === undefined) return ServerResponse.empty({ status: 404 })
    return yield* ServerResponse.json(SandboxShellDto.make(shell))
  }),
)

/**
 * A person's Rebuild of this trak's sandbox: made again with its uncommitted changes
 * carried, at once where nothing holds it and otherwise once the turn, check or effect
 * holding it ends — answered with which, and read back on the trak as `rebuild`. No
 * custody and no event, as a process press: it is not a step, and it never interrupts the
 * drive. Spends nothing — git, the runner and the setup script, and no agent.
 *
 * 404 for an unknown trak, one with no checkout, and one whose checkout is not in a sandbox.
 * 409 while `refs/orkestra/carried/<trak>` still holds changes an earlier remake left
 * behind: the capture would have to overwrite them, so a person applies or deletes the ref
 * first, and the reason says so.
 */
const sandboxRebuildRoute = Router.post(
  "/api/traks/:id/sandbox/rebuild",
  Effect.gen(function* () {
    const id = yield* pathId
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const worktree = replayHistory(id, events).worktree
    const place = worktree === undefined ? undefined : yield* sandboxPlaceOf(worktree.path)
    if (worktree === undefined || place === undefined)
      return ServerResponse.empty({ status: 404, statusText: "not in a sandbox" })
    const left = yield* (yield* Vcs).leftBehind(id)
    if (left !== undefined)
      return ServerResponse.empty({
        status: 409,
        statusText: `Changes an earlier remake left behind are still at ${left}. Apply them or delete that ref first.`,
      })
    const rebuild = yield* rebuildSandboxAt(worktree.path)
    if (rebuild === undefined)
      return ServerResponse.empty({ status: 404, statusText: "not in a sandbox" })
    return yield* ServerResponse.json(SandboxRebuildDto.make({ rebuild }))
  }),
)

/**
 * Open the chosen terminal or editor at the project checkout — the repository this engine
 * drives, which no trak owns. **Spends nothing**, for `openCheckoutRoute`'s reasons, and
 * flat beside `/api/git` because both act on that checkout rather than on a trak.
 *
 * 404 for a platform with no scan and a machine with nothing of that kind — the surface
 * hides the control in both, so neither is a request its own UI produces.
 */
const openProjectRoute = Router.post(
  "/api/open",
  Effect.gen(function* () {
    const request = yield* ServerRequest.schemaBodyJson(OpenCheckoutRequestDto)
    const outcome = yield* (yield* Openers).openAt(request.kind, PROJECT)
    if (outcome !== "opened") return ServerResponse.empty({ status: 404, statusText: outcome })
    return ServerResponse.empty({ status: 204 })
  }),
)

export const openerRoutes = Router.empty.pipe(
  openersRoute,
  chooseOpenerRoute,
  openCheckoutRoute,
  openProjectRoute,
  sandboxShellRoute,
  sandboxRebuildRoute,
)
