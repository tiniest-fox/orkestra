// Merging a finished trak: where it would go and whether it would conflict, the merge
// itself, its pull request's merge on the forge, and commit-and-merge into a parent.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { DirtyDto, NotFinishedDto, PullNotMergedDto } from "@orkestra/shared/dto/common"
import { type ForgeAnswer, ForgeMerge } from "../../vcs/index.js"
import { Events } from "../../workflow/domain/event.js"
import { commitMessage } from "../../workflow/domain/git-message.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { Store } from "../../workflow/ports/store.js"
import { Forge } from "../../vcs/ports/forge.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import { toMergePreviewDto } from "../dto.js"
import { HostGit } from "../host-git.js"
import { destinationDirty, parentCheckout, wouldConflict } from "../merge-destination.js"
import { startDrive } from "../drive.js"
import { pathId, refuse } from "./common.js"

/**
 * Where a merge would put it, and whether it would go in. **Shown and confirmed,
 * never assumed** — a host merge goes into whatever branch the daemon's machine is
 * standing on, and that is a fact about somebody else's checkout.
 */
const mergePreviewRoute = Router.get(
  "/api/traks/:id/merge",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const vcs = yield* Vcs
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const trak = replayHistory(id, events)
    return yield* ServerResponse.json(
      toMergePreviewDto(trak, yield* vcs.hostBranch(), yield* wouldConflict(trak)),
    )
  }),
)

/**
 * Its branch into the one the host is on — or, for a child, into its parent's.
 *
 * **The dirty check is made of the destination, whichever it is.** Git refuses to merge
 * over an uncommitted copy of a file the branch touches, so a merge pressed against a
 * dirty tree fails the trak with the files in git's own sentence, and the finishing
 * card goes with it. Asked first, the trak stays at `Finished` with its press, and the
 * refusal names the same files. A parent's checkout is ordinarily clean while its
 * children run — every gate keeps the work before the plan moves on — so what this
 * finds there is a person's own edits, and `/commit-and-merge` is the press for that.
 *
 * Not the only guard, and it cannot be: a resume re-issues the merge without passing
 * through here, so the failure path stays for it.
 *
 * **Taken from the failure as well as from `Finished`.** A merge git refused leaves the
 * trak at `Failed{merge}` with its finishing card still drawn and the same press on it,
 * and that press is this route: `Restarted` re-issues the merge, the same door
 * `/commit-and-merge` takes out of the failure. The pre-check runs there too, so a parent
 * still dirty answers with its files instead of failing the trak a second time.
 */
const mergeRoute = Router.post(
  "/api/traks/:id/merge",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const refused = trak.state._tag === "Failed" && trak.state.kind === "merge"
    if (trak.state._tag !== "Finished" && !refused) {
      return yield* refuse(409, NotFinishedDto.make({}))
    }
    const [first, ...rest] = yield* destinationDirty(trak)
    if (first !== undefined) {
      return yield* refuse(409, DirtyDto.make({ files: [first, ...rest] }))
    }
    return yield* startDrive(id, (resuming) =>
      refused ? Events.restarted(resuming?.sessionId) : Events.merged(),
    )
  }),
)

/** Why there is no pull request to merge, for each answer that is not one. */
const NO_PULL_REQUEST = {
  None: "there is no pull request",
  NoOrigin: "there is no `origin` remote",
  Unavailable: "GitHub could not be asked",
} satisfies Record<Exclude<ForgeAnswer["_tag"], "Found">, string>

/**
 * Merge a finished trak's pull request on the forge — the press a person would make there,
 * made from the finished band. By the method picked on the trak, and by the repository's
 * default where none was or the pick is no longer allowed: `Forge.merge` settles which.
 *
 * **The forge decides whether it goes in**, under the repository's own rules: nothing here
 * judges the checks or the reviews, and a refusal comes back in the forge's words. The
 * forge is asked first for whether there is a pull request at all, and for its base.
 *
 * **No event and no drive.** Nothing runs on the trak, so there is no custody to claim; the
 * forge's next answer is the record, exactly as for a merge made on the forge, and it is
 * what turns the band's press into Archive and releases a step held on `merged`. A race
 * with the auto-merge sweep ends in the forge refusing the second merge, which is harmless.
 * The branch stays, as `Forge.merge` leaves it — the archive removes it. A merge that went
 * in starts `HostGit.afterMerge` on the pull request's base, and the 204 does not wait on it.
 *
 * 404 unknown id · 409 `NotFinished` not finished, landed, or no branch · 409
 * `PullNotMerged` no pull request, or the forge's refusal.
 */
const mergePullRequestRoute = Router.post(
  "/api/traks/:id/merge-pull-request",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const branch = trak.worktree?.branch
    if (trak.state._tag !== "Finished" || trak.landed !== undefined || branch === undefined) {
      return yield* refuse(409, NotFinishedDto.make({}))
    }
    const forge = yield* Forge
    const answer = yield* forge.pullRequest(branch)
    if (answer._tag !== "Found") {
      const why = NO_PULL_REQUEST[answer._tag]
      return yield* refuse(409, PullNotMergedDto.make({ why }))
    }
    const base = answer.pullRequest.base
    return yield* ForgeMerge.$match(yield* forge.merge(branch, trak.mergeMethod), {
      Merged: () =>
        Effect.as(
          base === undefined ? Effect.void : Effect.flatMap(HostGit, (git) => git.afterMerge(base)),
          ServerResponse.empty({ status: 204 }),
        ),
      Refused: ({ why }) => refuse(409, PullNotMergedDto.make({ why })),
    })
  }),
)

/**
 * Commit whatever is uncommitted in the parent's checkout, under the parent's own
 * name, then merge the child into it — the press behind both refusals a dirty parent
 * produces: the one `/merge` makes before starting, and the `Failed{merge}` a merge
 * that was issued anyway lands in.
 *
 * **A parent's checkout only.** The host repository keeps its refusal at `/merge`: a
 * person's working directory holds their own files and there is no trak to name them
 * by, where a parent's checkout is one Orkestra made and has that trak's description
 * for the message. A trak with no parent is a request the client never sends, so it is
 * a 400 rather than a refusal variant — the same reasoning as the create route's.
 *
 * The commit is git in a tree the child does not own and no event on the parent
 * records it, deliberately: the parent's log says what the engine did, and its own
 * commit at the next boundary reads the branch and finds the work already kept. What
 * the child's log records is the merge, through the same two doors any merge takes —
 * `Merged` from `Finished`, and `Restarted` from the failure, which re-issues it.
 *
 * 404 unknown id · 400 no parent · 409 not finished and not a refused merge · 409 held
 * by another process.
 */
const commitAndMergeRoute = Router.post(
  "/api/traks/:id/commit-and-merge",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const trak = replayHistory(id, events)
    const parent = trak.parent
    if (parent === undefined) {
      return ServerResponse.empty({
        status: 400,
        statusText: "only a parent's checkout is committed on a person's behalf",
      })
    }
    const state = trak.state
    const refused = state._tag === "Failed" && state.kind === "merge"
    if (state._tag !== "Finished" && !refused) {
      return yield* refuse(409, NotFinishedDto.make({}))
    }

    const into = yield* parentCheckout(trak)
    if (into !== undefined) {
      const parentTrak = replayHistory(parent.id, yield* store.events(parent.id))
      yield* (yield* Vcs).commitWork(into, commitMessage(parentTrak, undefined))
    }
    return yield* startDrive(id, (resuming) =>
      refused ? Events.restarted(resuming?.sessionId) : Events.merged(),
    )
  }),
)

export const mergeRoutes = Router.empty.pipe(
  mergePreviewRoute,
  mergeRoute,
  mergePullRequestRoute,
  commitAndMergeRoute,
)
