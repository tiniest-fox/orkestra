// What every route group shares: the `:id` segment, the gate in front of it, the refusal
// body, the bounded reason phrase, the project checkout, and where a trak's checkout is. The one file a group may
// import from `routes/` — `app/server.ts` says how the groups fit together.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { NotOwnerDto, type RefusalDto } from "@orkestra/shared/dto/common"
import { TrakId, type UserId } from "../../workflow/domain/trak.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { Runs } from "../../workflow/ports/runs.js"
import { Store } from "../../workflow/ports/store.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import { Drives } from "../drive.js"
import { projectDir } from "../discovery.js"
import { hiddenUnseen, refusedPress } from "../people.js"

export const pathId = Effect.gen(function* () {
  const params = yield* Router.params
  const raw = params["id"]
  if (raw === undefined) return yield* Effect.fail(ServerResponse.empty({ status: 400 }))
  return TrakId.make(raw)
})

/**
 * The one check in front of every per-trak route — `/api/traks/:id` and everything under it,
 * GET and POST, a turn's tool routes included: a trak the viewer does not see answers the 404
 * of a missing one (`people.ts`). Applied once to the whole router, in `server.ts`, so a
 * route added to any group is behind it without asking.
 */
export const trakGate = hiddenUnseen("/api/traks/:id", (id) => ({ trak: TrakId.make(id) }))

/**
 * A decode failure, bounded: its first line, and not much of that.
 *
 * A reason names the trak, the file and the line, and then carries a
 * `ParseError` that renders every variant of the `Event` union — kilobytes,
 * with newlines. Both readers want the first half and neither can hold the
 * second: an HTTP reason phrase may not contain a newline, and a warning on a
 * poll timer may not be a page.
 */
export const reasonPhrase = (reason: string): string =>
  (reason.split("\n")[0] ?? reason).slice(0, 120)

/**
 * A refusal, as a body.
 *
 * The reason phrase stays as well, because it is what a curl or a log line shows — but
 * nothing branches on it. A client reads the body, which survives HTTP/2 and a proxy
 * rewriting the status line, and which is the only one of the two that can carry a list
 * of files.
 */
export const refuse = (status: number, refusal: RefusalDto) =>
  ServerResponse.json(refusal, { status, statusText: refusal._tag })

/**
 * The `403 NotOwner` a press that would start a turn on a trak `owner` owns is answered with,
 * where this request may not make it — `People.pressRefusal` answers it — and `undefined` where
 * it may. Asked after the trak is known and before anything is appended.
 */
export const ownerOnly = (owner: UserId | undefined) =>
  Effect.flatMap(refusedPress(owner, "trak"), (reason) =>
    reason === undefined ? Effect.succeed(undefined) : refuse(403, NotOwnerDto.make({ reason })),
  )

/**
 * Who this daemon is, so a client can tell it is the right one.
 *
 * A port derived from a path is a guess — a project whose pair was taken steps to
 * another, and a worktree of the same repository can be on it. The project root is what
 * a client compares, and it is the only thing standing between one worktree's `ork` and
 * another's traks.
 *
 * **Read from argv here rather than handed in, and both readings have to agree.** The
 * clients on the other side of this comparison — `pnpm ui`, `pnpm ui:stop`, `pnpm ork` —
 * derive their side the same way from their own command line, so the answer is only
 * sound because `projectDir` is the single place either side resolves one.
 */
export const PROJECT = projectDir(process.argv.slice(2)).root

/**
 * Where a process of this trak runs, or why there is nowhere: 404 for an unknown trak
 * and for one with no checkout — not made yet, or taken away by the archive, which
 * leaves `Trak.worktree` naming it.
 */
export const checkoutOf = (id: TrakId) =>
  Effect.gen(function* () {
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return undefined
    const worktree = replayHistory(id, events).worktree
    if (worktree === undefined) return undefined
    return (yield* (yield* Vcs).hasCheckout(id)) ? worktree.path : undefined
  })

/**
 * Who holds a trak, asked as the list asks it: `Drives.running` says whether anything
 * drives it — here, or another copy through its lease — and the record says only since
 * when. The record alone is not the answer: `run.json` keeps a holder a dead engine left,
 * and `Runs.holder` reads it as alive wherever `holderAlive` cannot rule that out — a
 * reissued pid with no start to compare. The page then hid Resume on a trak the list
 * showed as stopped, and nothing was driving it.
 */
export const heldNow = (id: TrakId) =>
  Effect.gen(function* () {
    if (!(yield* (yield* Drives).running(id))) return undefined
    return yield* (yield* Runs).holder(id)
  })
