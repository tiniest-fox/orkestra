// The HTTP API: list and detail (free, read `.orkestra/.database/`) plus act
// and resume (drive the engine — these spawn a real `claude` and spend money).
//
// Routes:
//   GET  /api/traks                 the live traks the viewer sees as rows, and a count of the archived
//                                   ones — no row is built, sent or drawn for a trak that
//                                   is put away, and its log is not opened. A trak whose
//                                   stored log will not decode is left out; a store that
//                                   cannot be read is still a 500
//   GET  /api/traks/:id              one trak's full projection + log + transcript + custody
//                                   422 when that one trak's log will not decode
//   POST /api/traks/:id/act         body ActRequestDto → advance(id, HumanActed{…})
//   POST /api/traks/:id/resume      body ResumeRequestDto → advance(id, Restarted{sessionId?})
//   POST /api/traks/:id/close       no body → archive a finished trak: checkout, branch and
//                                   forge copy go, and GitHub is asked once what merged
//   POST /api/traks                  body CreateTrakRequestDto → a new trak, driven
//   POST /api/traks/:id/merge        its branch into the host's, or into its parent's
//   POST /api/traks/:id/abandon      body AbandonRequestDto → archive a trak that has not
//                                   finished: the turn in flight is interrupted, then the
//                                   same four things go
//   POST /api/traks/:id/stop         no body → the turn in flight is killed and the trak
//                                   parks at a gate. The other action that interrupts the
//                                   drive rather than being refused by it — every other
//                                   one is turned away while a trak is being driven
//   POST /api/traks/:id/background/:taskId/stop  no body → one background task of the
//                                   turn in flight is stopped, via a control line down
//                                   the turn's own open pipe. Spends nothing and kills
//                                   no turn; the outcome arrives on the stream as the
//                                   level shrinking and the task's stopped notification
//   POST /api/traks/:id/mode         body ModeRequestDto → the run mode from the next gate
//                                   on. Appends while a turn runs and kills nothing
//   POST /api/traks/:id/hold         body HoldRequestDto → hold the current step until it
//                                   is accepted, or take that back. Same door as mode
//   POST /api/traks/:id/auto-merge   body AutoMergeRequestDto → auto-merge on or off, at
//                                   Finished too. Same door as mode; on starts it afresh
//   POST /api/traks/:id/merge-method body MergeMethodRequestDto → the method the merge press
//                                   and auto-merge use. Same door as auto-merge. On a
//                                   host with two or more users, every route under
//                                   /api/traks/:id answers 404 to anyone but the owner —
//                                   the one gate, `trakGate` in `routes/common.ts`
//   POST /api/traks/:id/reenter      body ReenterRequestDto → picked up from outside
//   POST /api/traks/:id/run-now      no body → the step a resting trak is held at runs
//                                   now, its wait unmet. `merged` is asked once more
//                                   first, and the step is told what it was waiting on
//   POST /api/traks/:id/skip-effects no body → a trak stopped on a failed effect enters the
//                                   next step with that effect and the ones after it unrun
//   GET  /api/traks/:id/processes    every declared hosted process at the trak, run or
//                                   not, with its log — daemon memory, like a check's run
//   POST /api/traks/:id/processes/:name/{start,restart,stop}  answers once the start
//                                   is decided. Spends nothing: a script in the checkout
//   GET  /api/traks/:id/processes/:name/logs  that run's log, as plain text
//   POST /api/traks/:id/sandbox/rebuild  no body → the trak's sandbox made again with its
//                                   uncommitted changes carried, at the next gap. Spends
//                                   nothing, appends nothing; queued in daemon memory
//   GET  /api/traks/:id/tools        the turn's engine tools as MCP lists them
//   POST /api/traks/:id/tools/:name  one call, forwarded by `orkestra trak-tools`, for the
//                                   turn in flight: a check, answered once it has run, or
//                                   a process tool, or one of the engine tools the
//                                   engine's own agent gets
//   POST /api/traks/:id/mcp          the same tools as one streamable-HTTP MCP endpoint,
//                                   for a session in the trak's sandbox
//   *    /api/traks/:id/mcp/:server  a `Connection` server the host lists, proxied
//                                   with the host's token for it
//   POST /api/traks/:id/github       a GH_TOKEN the host mints at the call, for the gh
//                                   wrapper and git helper of a turn in the trak's sandbox.
//                                   These and the four above are the one route family a
//                                   turn's own token reaches
//   GET  /api/processes · POST /api/processes/:name/{start,restart,stop} ·
//   GET  /api/processes/:name/logs  the same on the project checkout, which no trak owns
//   DELETE /api/traks/:id            forget one, the owner's alone · DELETE /api/traks
//                                   forgets all of the presser's own, or all of them for
//                                   a caller who names nobody
//   GET  /api/traks/:id/access       TrakAccessDto — what the viewer may do to the trak
//   GET  /api/traks/:id/record       how it went, as markdown
//   GET  /api/traks/:id/image?path=  a picture out of that trak's own checkout
//   GET  /api/traks/:id/changes?at=  what the work did to the files — all, uncommitted,
//                                   or one step; &path= for one file with its hunks
//   POST /api/records                every ended trak's record, rewritten from its log
//   GET  /api/traks/:id/{resume,merge}  what each would do, before anything is spent
//   GET  /api/traks/:id/pull-request  what the forge says about its branch — read-only,
//                                   and *I could not ask* rather than an error
//   GET  /api/traks/:id/deploy       what `.orkestra/deploy.sh` says about its merge
//                                   commit — one script run shared across every tab
//                                   asking, and `none` where there is nothing to ask
//   GET  /api/pull-requests?branch=  the same, coarsely, about the branches a caller
//                                   names — one call whatever it is drawing
//   GET  /api/agents                 the agents a trak may be opened with — policy, not a log
//   GET  /api/models                 `models.yaml` as loaded: every model a step may run
//                                   on, and the default a chat runs on when nobody picks
//   GET  /api/openers                the terminals and editors installed on this machine,
//                                   their icons, and which of each a press would open.
//                                   macOS only — 404 anywhere else, and the surface hides
//                                   both controls on it
//   POST /api/openers                store the terminal or editor to open, once per machine
//   POST /api/traks/:id/open         open the chosen terminal or editor at that trak's
//                                   checkout. Spends nothing: no agent, one `open` process.
//                                   A sandboxed trak's terminal is a shell in its sandbox
//   GET  /api/traks/:id/shell        the runner's shell line for a sandboxed trak, with no
//                                   secret in it, for `pnpm host shell <project> <trak>`
//   POST /api/open                   the same at the project checkout, which no trak owns
//   GET  /api/push                   the VAPID public key a browser subscribes with
//   POST /api/push                   keep a browser's push subscription · DELETE forgets
//                                   the one `?endpoint=` names. Both write the push record and
//                                   neither reads a trak
//   POST /api/push/notify            HostNotifyDto → 204; one notification the host has to
//                                   say, to the users it names; refused from the proxy
//   GET  /api/git                    the project checkout's branch, upstream and counts,
//                                   and this engine's last fetch — starting a fetch first,
//                                   unawaited, when that one began over five minutes ago
//   GET  /api/usage                  each named CLI's plan usage as this engine's turns on it
//                                   last reported it — memory, never a read of its own
//   POST /api/git/{fetch,pull,reconcile,push}
//                                   no body → the same, after the press. Spends nothing:
//                                   `git` against the project checkout. 409 for a press the
//                                   repository's state refuses; a git failure is a 200 whose
//                                   body carries it, since the bar is where it is read.
//                                   pull and reconcile take `{ stash: true }`, which sets a
//                                   dirty tree aside and puts it back — `stashed` on the
//                                   answer where putting it back would conflict
//   GET  /api/files                  every file git sees in the project checkout, on disk
//                                   now — tracked, and untracked but not ignored
//   GET  /api/files/content?path=    one file that list names, as text, or its size where
//                                   it is binary or over 1 MB. 404 for any path the list
//                                   does not name — `..`, an ignored `.env` — and for a
//                                   link to a file the list does not name
//   GET  /api/files/search?q=        the lines of those files holding `q`, ignoring case
//   GET  /api/traks/archived?q=      the put-away traks whose title or id holds `q`, read
//                                   off the archived set with no log opened
//   GET  /api/goals                  every goal this project has started that the viewer
//                                   sees, newest first
//   GET  /api/goals/:id              one goal, its log and its composer's transcript
//   POST /api/goals                  body StartGoalRequestDto → a goal from a sentence,
//                                   whose spec the composer drafts.
//                                   Spends: the composer drafts at once
//   POST /api/attachments            body the file's bytes → AttachmentUploadedDto, or 413/415
//   POST /api/goals/:id/act          body GoalActionDto → approve, answer, confirm, chat,
//                                   retry, retry in a new session. Approving a draft makes
//                                   the spec it names the goal's, and writes nothing to git
//                                   but a goal branch it names; 409 GoalBranchRefused where
//                                   that fails. A chat while a turn runs or is owed waits
//                                   for that turn
//   POST /api/goals/:id/stop         the running composer turn killed, and the goal settled
//                                   where it would have ended; 409 NothingToStop
//   POST /api/goals/:id/dismiss      a goal at rest off the traks list; 409 while it is going
//   POST /api/goals/:id/{pause,resume}  holds on the goal's live traks, on or off.
//                                   On a host with two or more users, every route
//                                   under /api/goals/:id answers 404 to anyone but the
//                                   owner — `goalGate` in `goals.ts`
//   POST /api/goals/:id/drop         body DropGoalRequestDto → its turn killed, nothing more asked
//   GET  /api/goals/:id/tools        the composer's tools as MCP lists them
//   POST /api/goals/:id/tools/:name  one tool call, forwarded by `orkestra goal-tools`
//   POST /api/goals/:id/mcp          the same tools as one streamable-HTTP MCP endpoint, for a
//                                   composer in the project's sandbox. These three are the
//                                   goal routes the composer's own token reaches
//   GET  /api/health                 who this daemon is, so a client can tell it apart, and
//                                   the build id of the client it serves now
//   POST /api/reload                 read `.orkestra/` and the templates again; 204, or 422
//                                   ReloadFailed and the old pair still serves. Interrupts
//                                   nothing that is running
//   GET  /api/stream                 SSE: every append, as it lands
//   GET|POST /api/session            answered by the guard in front of this router, not
//                                   by it — `app/guard.ts`. Every route above but
//                                   `/api/health` wants the cookie it issues, or the
//                                   daemon's own token, once a passphrase is set
//   GET  *                           the built client out of `client/dist`: a file that is
//                                   in it, else `index.html` — never for a target the
//                                   router routes under `/api/`, where an unmatched path
//                                   stays a 404. 503 until the client is built. Outside
//                                   `/api/`, so the guard passes it through with no
//                                   credential — the login screen is in this bundle
//
// **An action answers 202 and forks.** It says the drive was accepted, not what the
// trak became: the turn runs on a fiber whose lifetime is the daemon's rather than the
// request's, so a closed tab, a reload or a navigation no longer interrupts an agent
// mid-turn. What a caller watches instead is the stream — every append reaches it as a
// frame, so the state a synchronous response used to carry arrives there, along with
// everything that happened on the way to it.
//
// The 4xx paths stay synchronous, and that is the split worth seeing: a refusal is a
// fact about the *request*, decided before anything is forked, so it is still an answer
// to the POST. Only the work is asynchronous.
//
// Mutations are one event through one function — the same design `ork.ts` follows.
// Every user-facing action is one event through `advance`, which is the argument for
// the whole shape.
//
// **This file only assembles.** Each route group is a file of its own under `routes/`,
// named for the `shared/src/dto/` slice it answers with where one exists, and nothing
// re-exports them: one group may import `routes/common.ts` and no other group, which lint
// enforces, so an edit to one group's routes is a diff in that file alone.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import { Runs } from "../workflow/ports/runs.js"
import { withProjectFiles } from "../workflow/ports/project-files.js"
import { clientRoute } from "./client-bundle.js"
import { goalRoutes } from "./goals.js"
import { trakMcpRoutes } from "./trak-mcp.js"
import { trakToolRoutes } from "./trak-tools.js"
import { actionRoutes } from "./routes/actions.js"
import { attachmentRoutes } from "./routes/attachments.js"
import { trakGate } from "./routes/common.js"
import { changeRoutes } from "./routes/changes.js"
import { fileRoutes } from "./routes/files.js"
import { fleetRoutes } from "./routes/fleet.js"
import { forgeRoutes } from "./routes/forge.js"
import { gitRoutes } from "./routes/git.js"
import { hostRoutes } from "./routes/host.js"
import { mergeRoutes } from "./routes/merge.js"
import { openerRoutes } from "./routes/openers.js"
import { processRoutes } from "./routes/processes.js"
import { settingRoutes } from "./routes/settings.js"
import { stopRoutes } from "./routes/stop.js"
import { streamRoutes } from "./routes/stream.js"
import { trakRoutes } from "./routes/trak.js"
import { usageRoutes } from "./routes/usage.js"
import { viewRoutes } from "./routes/views.js"

// ============================================================================
// Reaping — sweep stray agent processes a crashed run left billing before any
// request runs. Matches `ork.ts`'s reapAndReport behaviour. Runs at server
// boot; its result is logged but otherwise unused.
// ============================================================================

export const reapStrays = Effect.gen(function* () {
  const runs = yield* Runs
  return yield* runs.reap()
})

/** What an entry point adds to the engine's routes. */
export interface ApiOptions<E, R> {
  /** Routes of its own, beside every route here. */
  readonly routes?: Router.HttpRouter<E, R>
  /** The built client served at `/` and named by `/api/health`; `client/dist` where left out. */
  readonly client?: string
}

/**
 * Several `pipe`s rather than one, and it is the compiler's limit rather than a grouping:
 * `pipe` is overloaded to twenty arguments and the twenty-first is a type error naming
 * neither the route nor the reason. Adding one goes on the end of whichever has room.
 *
 * `clientRoute` is the wildcard, and the router matches a named path ahead of it
 * whatever the order here — so it is last for reading, not for precedence. What it
 * changes is that no GET is ever unmatched: a `/api/...` nothing names reaches it and is
 * answered 404 there, rather than by the platform's own not-found.
 */
export const apiRouter = <E = never, R = never>(options: ApiOptions<E, R> = {}) => {
  const extra: Router.HttpRouter<E, R> = options.routes ?? Router.empty
  return (
    trakRoutes
      .pipe(
        Router.concat(actionRoutes),
        Router.concat(attachmentRoutes),
        Router.concat(stopRoutes),
        Router.concat(settingRoutes),
        Router.concat(mergeRoutes),
        Router.concat(forgeRoutes),
        Router.concat(changeRoutes),
        Router.concat(viewRoutes),
        Router.concat(processRoutes),
        Router.concat(openerRoutes),
        Router.concat(fileRoutes),
        Router.concat(gitRoutes),
        Router.concat(usageRoutes),
        Router.concat(fleetRoutes),
        Router.concat(hostRoutes(options.client)),
        Router.concat(streamRoutes),
      )
      .pipe(
        Router.concat(goalRoutes),
        Router.concat(trakToolRoutes),
        Router.concat(trakMcpRoutes),
        Router.concat(extra),
        Router.concat(Router.empty.pipe(clientRoute(options.client))),
      )
      // Every per-trak route behind the one check: a trak the viewer does not see is a 404. The
      // goal routes carry their own, in `goals.ts` and `trak-mcp.ts`.
      .pipe(Router.use(trakGate))
      // Each request takes the project files held now, so a reload is the next request's. The
      // stream outlives one, so it reads the library again for every frame — see `streamRoute`.
      .pipe(Router.use((app) => withProjectFiles(app)))
  )
}

/**
 * A plain RequestError surface is enough for MVP: nothing here escapes the
 * Handler's `R` of `Store`/`Runs`/`advance` deps. Per-route handlers narrow
 * 4xx themselves; a 5xx is the engine's failure and stays in the Effect error.
 * See `effect-idiom` on the catch-all trap — we do not catch here and *turn*
 * an engine failure into something; we let the platform render it as 500.
 */

// (Reaped used in serve.ts via `../workflow/ports/runs.js` direct import — not re-exported
// here to avoid knip flagging the unused passthrough.)
