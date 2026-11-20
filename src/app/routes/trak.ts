// A trak as the screens read it — the list, the detail, its record, a picture out of its
// checkout, its deploy, what the viewer may do to it — and forgetting one. Answers with
// `@orkestra/shared/dto/trak`.

import { Preparation } from "../../vcs/ports/preparation.js"
import { Clock, Effect, Option } from "effect"
import * as Headers from "@effect/platform/Headers"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { RecordsWrittenDto } from "@orkestra/shared/dto/actions"
import { DrivingDto, NotOwnerDto } from "@orkestra/shared/dto/common"
import type { TrakAccessDto, TrakListDto } from "@orkestra/shared/dto/trak"
import { Lib } from "../../library/ports/library.js"
import { handOffPending, type TrakId } from "../../workflow/domain/trak.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { recordText } from "../../workflow/domain/record.js"
import { Archive } from "../../workflow/ports/archive.js"
import { Checks } from "../../workflow/ports/checks.js"
import { GoalStore } from "../../workflow/ports/goal-store.js"
import { Idle } from "../../workflow/ports/idle.js"
import { HostedProcesses } from "../../workflow/ports/hosted-processes.js"
import { Outages } from "../../workflow/ports/outages.js"
import { Runs } from "../../workflow/ports/runs.js"
import { SeamStatuses } from "../../workflow/ports/seam-status.js"
import { Store } from "../../workflow/ports/store.js"
import { handsOffToGoal, replayGoal } from "../../workflow/domain/goal.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import {
  loggedDeployOf,
  nextChecksOf,
  toDeployDto,
  toDetailDto,
  latestStretch,
  toSummaryDto,
} from "../dto.js"
import { liveTrak } from "../archive.js"
import { Conditions } from "../conditions.js"
import { Deploys } from "../deploys.js"
import { Details } from "../details.js"
import { Drives } from "../drive.js"
import { handoffFor, sandboxRebuildOf } from "../handoff.js"
import { trakImage } from "../images.js"
import { trakRecord, writeCorpus } from "../records.js"
import { levelHere, levelsHere, ownershipHere } from "../people.js"
import { heldNow, pathId, reasonPhrase, refuse } from "./common.js"
import { runnerFilesNow } from "../../vcs/ports/runners.js"

/** The preparation the trak is in now, or nothing where none is or no layer keeps one. */
const preparingOf = (id: TrakId) =>
  Effect.flatMap(Effect.serviceOption(Preparation), (held) =>
    Option.isNone(held) ? Effect.succeed(undefined) : held.value.of(id),
  )

/** The trak's action at the seam now, or nothing where none is or no layer keeps one. */
const seamOf = (id: TrakId) =>
  Effect.flatMap(Effect.serviceOption(SeamStatuses), (held) =>
    Option.isNone(held) ? Effect.succeed(undefined) : held.value.of(id),
  )

/**
 * One row, or nothing to show.
 *
 * **A trak that is put away is nothing to show, and its log is not opened for it.**
 * `liveTrak` answers off the `Archive` first, and classifies what it does read — so the
 * first list after a boot reads every log the sweep has not yet reached, and no list
 * after that opens an archived one.
 *
 * **An idle trak is its kept row, and its log is not opened for it either.** `Idle` holds
 * the row the last read built, until an append moves the log; a trak nothing drives that
 * has been left three days is served that row, so a list of fifty forgotten traks reads
 * none of their logs. What the row carries beside the log — the deploy, the preparation,
 * the seam — is about a wait or a drive, which an idle trak has neither of.
 *
 * **The transcript is read only for a trak something is driving.** Its last line is
 * news while a run is writing it and stale the moment none is, so a trak nothing is
 * driving has no `activity` to send — and the file is never opened for it. A list of
 * thirty settled traks costs exactly what it did before.
 *
 * **Driving is asked of the daemon, not of the disk.** One process does all the
 * writing, so its drives in flight — and the parents their landings carry — are the
 * whole truth and cost nothing; a `run.json` read per row was a file per trak per
 * poll to learn something this process already knew.
 *
 * **`StoreUndecodable` is left out.** A trak whose log was written against a
 * variant that no longer exists is one trak's problem, and taking the list down
 * with it leaves the UI drawing *"Could not reach the engine"* and retrying
 * forever. Logged rather than dropped in silence: a row nobody can see and
 * nothing recorded is a row nobody can debug.
 *
 * **The warning is one bounded line, not the whole reason.** Every mounted tab
 * polls this route, so an undecodable trak logs on a timer forever — and a
 * `ParseError` against the `Event` union renders every variant, which is
 * kilobytes. `reasonPhrase` keeps the half that identifies it: the trak, the
 * file and the line.
 *
 * **`StoreFailed` is deliberately not caught.** A disk that will not answer is
 * not a trak that is fine to omit — a list that quietly shortened would be the
 * engine turning *I could not tell* into a count.
 */
const summaryFor = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    const drives = yield* Drives
    const idle = yield* Idle
    const now = yield* Clock.currentTimeMillis
    const running = yield* drives.running(id)
    const kept = running ? undefined : yield* idle.rowAt(id, now)
    if (kept !== undefined) return kept
    const live = yield* liveTrak(id)
    if (live === undefined) return undefined
    const { trak, events } = live
    const activity = running ? latestStretch(yield* store.transcript(id)) : undefined
    // The record only while something is driving, as the activity line is: a turn a
    // dead daemon left on the record is not a turn anyone is running, and its reading
    // would draw as live until `reap` cleared it.
    const inFlight = running ? yield* (yield* Runs).inFlight(id) : undefined
    // The daemon's memory first and the log second, as the sweep reads its own
    // interval — and only for a trak waiting on `deployed`, which `loggedDeployOf`
    // decides for both: a merged trak's page asks the deploy route instead.
    const logged = loggedDeployOf(trak, events)
    const deploy = logged === undefined ? undefined : ((yield* (yield* Deploys).last(id)) ?? logged)
    const row = toSummaryDto({
      trak,
      history: events,
      running,
      activity,
      deploy,
      inFlight,
      preparing: yield* preparingOf(id),
      seam: yield* seamOf(id),
      lib: yield* Lib,
      runner: (yield* runnerFilesNow).runner?.description,
      now,
    })
    if (!running) yield* idle.keep(id, events.length, row)
    return row
  }).pipe(
    Effect.catchTag("StoreUndecodable", (e) =>
      Effect.as(Effect.logWarning(`left out of the list: ${reasonPhrase(e.reason)}`), undefined),
    ),
  )

/** The traks this request's viewer holds `owner` on — every one, for a viewer who names nobody. */
const ownedHere = Effect.gen(function* () {
  const levelOf = yield* levelsHere
  return yield* Effect.filter(yield* (yield* Store).list(), (id) =>
    Effect.map(levelOf({ trak: id }), (level) => level === "owner"),
  )
})

/**
 * The list: a row per live trak the viewer sees — store.list → `summaryFor` each, minus
 * the ones left out — and beside them how many traks are put away. The count is of the
 * parentless ones, because a header's count is of groups: an archived child is not a row
 * anywhere. A trak the viewer does not see is left out before its row is built.
 */
const summaries = Effect.gen(function* () {
  const store = yield* Store
  const archive = yield* Archive
  const levelOf = yield* levelsHere
  const ids = yield* Effect.filter(yield* store.list(), (id) =>
    Effect.map(levelOf({ trak: id }), (level) => level !== undefined),
  )
  return Effect.gen(function* () {
    // The lambda is load-bearing: `forEach` passes `(item, index)`.
    const rows = yield* Effect.forEach(ids, (id) => summaryFor(id))
    const list: TrakListDto = {
      traks: rows.flatMap((row) => (row === undefined ? [] : [row])),
      // Read after the rows, so a trak the rows' own reads classified is in it.
      archived: yield* archive.count,
    }
    return list
  })
})

/**
 * Full projection for one trak, including custody, log, transcript.
 *
 * The log and the transcript come through `Details`, which keeps what it last decoded
 * and reads a file again only when the store says it has moved — a page polls this
 * route, and each poll was both files read and decoded whole. Everything else here
 * is asked fresh, because no file records it.
 *
 * Custody is `heldNow`: the list's answer to *is this busy*, with the record's *since
 * when* beside it.
 */
const detailFor = (id: TrakId) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const checks = yield* Checks
    const lib = yield* Lib
    const { trak, events, transcript } = yield* (yield* Details).files(id)
    if (events.length === 0) return undefined
    const holder = yield* heldNow(id)
    // The turn on the record only while something drives the trak, for `summaryFor`'s
    // reason: a record a dead daemon left behind names a turn nobody is running.
    const inFlight = holder === undefined ? undefined : yield* runs.inFlight(id)
    // Daemon memory too: whether the engine is reaching for that turn's sandbox again.
    const outages = Option.getOrUndefined(yield* Effect.serviceOption(Outages))
    const outage = outages === undefined ? undefined : yield* outages.of(id)
    // The daemon's own memory, like custody: a check's output is never written down, so
    // this is the only thing a screen that refetched mid-run can be caught up from.
    const check = yield* checks.live(id)
    // Daemon memory too, for the same reason: no log holds when the next ask falls.
    const nextAsk = yield* (yield* Conditions).nextAsk(trak, events)
    // Where a hand-off goes, read as `HandOff` reads it when the gate goes past: to the
    // trak's goal while that goal is going, and the ordinary way otherwise. The goal's log
    // is asked only while a hand-off is on the table; after the gate, the `HandedOff` on
    // the trak's log says which way it went, and the goal is only what the card links to.
    const pending = handOffPending(trak)
    const handOffGoal =
      trak.goal === undefined ||
      (pending &&
        !handsOffToGoal(replayGoal(trak.goal, yield* (yield* GoalStore).events(trak.goal))))
        ? undefined
        : trak.goal
    // Git's answer, asked only while an ordinary hand-off is on the table: it is what the
    // card at the plan gate names as the base, and a `git` per poll on every other trak
    // would buy nothing. Once the gate goes past, the `HandedOff` on the log carries it.
    const handOffBase =
      pending && handOffGoal === undefined ? yield* (yield* Vcs).defaultBranch() : undefined
    return toDetailDto({
      trak,
      events,
      transcript,
      holder,
      check,
      inFlight,
      outage,
      // Policy, read here for the reason `agentsRoute` reads it: which scripts a step
      // runs, and whether there is a deploy to ask about, are `.orkestra/`'s to say, and
      // the screen is told rather than knowing.
      asked: {
        nextChecks: nextChecksOf(trak, lib),
        deployScript: lib.deploy !== undefined,
        handOffBase,
        ...(handOffGoal === undefined ? {} : { handOffGoal }),
        lib,
      },
      nextAsk,
      // Asked fresh, like custody: whether the checkout is in a sandbox is the runner
      // file's to say, read on every call.
      handoff: yield* handoffFor(trak, lib),
      rebuild:
        trak.worktree === undefined ? undefined : yield* sandboxRebuildOf(trak.worktree.path),
      preparing: yield* preparingOf(id),
      runner: (yield* runnerFilesNow).runner?.description,
      seam: yield* seamOf(id),
      // Asked of who is looking, so a frame never carries it.
      ownership: yield* ownershipHere(trak.owner),
    })
  })

/**
 * Read routes — free; read the on-disk logs, and the detail off what was last read of
 * them where nothing has moved. Do NOT spend tokens.
 * Failing to list a non-existent id returns a 404.
 *
 * Wraps each detail payload in `ServerResponse.json` (an Effect), so the
 * handler's overall Effect yields one. List returns an Effect too, so we
 * `Effect.map` the summaries into the response.
 */
const readRoutes = Router.empty.pipe(
  Router.get(
    "/api/traks",
    Effect.gen(function* () {
      const sums = yield* Effect.flatten(summaries)
      return yield* ServerResponse.json(sums)
    }),
  ),
  Router.get(
    "/api/traks/:id",
    Effect.gen(function* () {
      const id = yield* pathId
      const detail = yield* detailFor(id)
      if (detail === undefined) return ServerResponse.empty({ status: 404 })
      return yield* ServerResponse.json(detail)
    }).pipe(
      // 422 rather than the 404 the list's silence would suggest: somebody
      // holding this URL is asking about *this* trak, and "it does not exist"
      // is false. 500 would be a lie about whose fault it is — the request is
      // well formed, the stored representation is not. The reason rides the
      // status line, which the client already renders; one line, and short
      // enough for a header.
      Effect.catchTag("StoreUndecodable", (e) =>
        Effect.succeed(ServerResponse.empty({ status: 422, statusText: reasonPhrase(e.reason) })),
      ),
    ),
  ),
)

/**
 * A trak's record: how it went, as markdown.
 *
 * **A route rather than something a caller computes.** `app/dto.ts` maps domain to DTO
 * one way only, so a client building this for itself would need the inverse for every
 * event variant — and the daemon is already holding the events. Free: it replays a log
 * and writes a document.
 */
const recordRoute = Router.get(
  "/api/traks/:id/record",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    return ServerResponse.text(recordText(yield* trakRecord(id, events)), {
      contentType: "text/markdown",
    })
  }).pipe(
    Effect.catchTag("StoreUndecodable", (e) =>
      Effect.succeed(ServerResponse.empty({ status: 422, statusText: reasonPhrase(e.reason) })),
    ),
  ),
)

/**
 * A picture out of that trak's own checkout.
 *
 * **Free, and the only route that serves something the log does not hold.** An agent can
 * take a screenshot of what it built, and a `![proof](.atelier/proof/.shots/x.png)` in
 * what it writes is a broken-image icon until something serves the file — the surface has
 * no access to the disk, and the SPA answers `200 text/html` for any path at all, so the
 * failure is silent.
 *
 * **404 for everything that is not an image inside this trak's checkout**, and
 * `app/images.ts` carries what that costs to decide: the path was written by a model, so
 * the root and the file are compared only after their symlinks are resolved. The
 * client draws the alt text on a 404, which is also what a shot that died with its
 * checkout gets.
 *
 * `nosniff` because the type is decided by the extension: without it a browser is free to
 * read a `.png` full of markup as a document, which would put a model's text back in this
 * origin by the route the allowlist exists to close. `no-store` keeps a shot out of the
 * disk cache, where it would outlive the checkout it was taken in. It does not make a
 * browser re-fetch a shot overwritten in place under the name it already drew: an `<img>`
 * is served out of the document's own list of images ahead of the HTTP cache, so the
 * client versions the address instead, and this route ignores everything but `path`.
 */
const imageRoute = Router.get(
  "/api/traks/:id/image",
  Effect.gen(function* () {
    const id = yield* pathId
    const params = yield* ServerRequest.ParsedSearchParams
    const requested = params["path"]
    if (typeof requested !== "string") return ServerResponse.empty({ status: 400 })

    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const worktree = replayHistory(id, events).worktree
    if (worktree === undefined) return ServerResponse.empty({ status: 404 })

    const image = yield* trakImage(worktree.path, requested)
    if (image === undefined) return ServerResponse.empty({ status: 404 })
    if (image === "stopped") {
      return ServerResponse.empty({
        status: 404,
        statusText: "the trak's sandbox is stopped, so nothing in its checkout can be read",
      })
    }
    return ServerResponse.uint8Array(image.bytes, {
      contentType: image.contentType,
      headers: Headers.fromInput({
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      }),
    })
  }),
)

/**
 * The corpus, rebuilt from the log of every trak whose checkout is gone.
 *
 * **A POST that drives nothing.** It takes no custody and appends no event — the
 * records are a view, so rewriting them can only ever disagree with the logs by being
 * stale. It is a POST rather than a GET because it writes to disk, and the daemon owns
 * the writing for the reason `ork` owns none of it: a local script rebuilding the
 * corpus behind the daemon's back would be a second reader of the log with its own
 * idea of the format.
 *
 * This is also the format-change path. Nothing migrates a record; the whole corpus is
 * re-rendered from history, which is what makes the shape safe to keep changing.
 */
const regenerateRecordsRoute = Router.post(
  "/api/records",
  Effect.gen(function* () {
    const folders = yield* writeCorpus()
    return yield* ServerResponse.json(RecordsWrittenDto.make({ folders }))
  }),
)

/**
 * What `deploy.sh` says about this trak's merge commit, now.
 *
 * Asked while a merged trak's page is open, the way the pull request pane polls — and
 * unlike that pane's route it runs a script, so `Deploys` shares one run across every
 * tab asking and hands the same answer back for a short while. A trak with no merge
 * commit, or a project with no script, is `none` and costs no run: the page decides
 * whether to draw a band off `landed` and the state, and the answer says the same.
 *
 * Nothing here catches anything: `Checks` has no error channel, so a script that
 * cannot be run is an answer rather than a failure — see the port.
 */
const deployRoute = Router.get(
  "/api/traks/:id/deploy",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const trak = replayHistory(id, events)
    return yield* ServerResponse.json(toDeployDto(yield* (yield* Deploys).status(trak)))
  }),
)

/**
 * What the viewer may do to this trak — `TrakAccessDto`. The gate in front answers 404 for a
 * trak they do not see, and this one for a trak that does not exist. The host asks it as the
 * user before serving a page of the trak's process.
 */
const accessRoute = Router.get(
  "/api/traks/:id/access",
  Effect.gen(function* () {
    const id = yield* pathId
    if ((yield* (yield* Store).events(id)).length === 0)
      return ServerResponse.empty({ status: 404 })
    const level = yield* levelHere({ trak: id })
    if (level === undefined) return ServerResponse.empty({ status: 404 })
    const access: TrakAccessDto = { level }
    return yield* ServerResponse.json(access)
  }).pipe(
    Effect.catchTag("StoreUndecodable", (e) =>
      Effect.succeed(ServerResponse.empty({ status: 422, statusText: reasonPhrase(e.reason) })),
    ),
  ),
)

/**
 * Forget a trak, or all of them.
 *
 * Not an event: wiping is not something that happened *to* a trak, it is the trak
 * ceasing to have happened. A drive in flight is refused rather than raced — the
 * directory would be removed from under it.
 *
 * **Only the owner forgets one**, and forgetting all of them forgets only the presser's
 * own: a caller who names nobody still forgets everything.
 */
const wipeRoute = Router.del(
  "/api/traks/:id",
  Effect.gen(function* () {
    const id = yield* pathId
    if ((yield* levelHere({ trak: id })) !== "owner") {
      return yield* refuse(
        403,
        NotOwnerDto.make({ reason: "Only this trak's owner may forget it." }),
      )
    }
    const store = yield* Store
    const drives = yield* Drives
    if (yield* drives.driving(id)) return yield* refuse(409, DrivingDto.make({}))
    // A process left running for a trak nobody can see any more has no stop press.
    yield* (yield* HostedProcesses).stopAll(id)
    // Its recorded base and fork name a trak that no longer exists, and nothing reads
    // them again; the branch stays, holding whatever work it has.
    yield* (yield* Vcs).forgetTrak(id)
    yield* store.remove(id)
    return ServerResponse.empty({ status: 204 })
  }),
)

const wipeAllRoute = Router.del(
  "/api/traks",
  Effect.gen(function* () {
    const store = yield* Store
    const drives = yield* Drives
    const ids = yield* ownedHere
    // Checked before any of them go: a sweep that removed half and then refused
    // would leave the caller with no way to say what happened.
    for (const id of ids) {
      if (yield* drives.driving(id)) return yield* refuse(409, DrivingDto.make({}))
    }
    const hosted = yield* HostedProcesses
    const vcs = yield* Vcs
    yield* Effect.forEach(ids, (id) =>
      Effect.andThen(Effect.andThen(hosted.stopAll(id), vcs.forgetTrak(id)), store.remove(id)),
    )
    return ServerResponse.empty({ status: 204 })
  }),
)

export const trakRoutes = readRoutes.pipe(
  Router.concat(
    Router.empty.pipe(
      recordRoute,
      imageRoute,
      regenerateRecordsRoute,
      deployRoute,
      accessRoute,
      wipeRoute,
      wipeAllRoute,
    ),
  ),
)
