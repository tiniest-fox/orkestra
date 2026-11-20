// What the forge says about a trak's branch, or about many branches at once. Answers with
// `@orkestra/shared/dto/forge`.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { BranchName, ForgeAnswer } from "../../vcs/index.js"
import { replayHistory } from "../../workflow/domain/replay.js"
import { Store } from "../../workflow/ports/store.js"
import { Forge } from "../../vcs/ports/forge.js"
import { toForgeListingDto, toPullRequestDto } from "../dto.js"
import { pathId } from "./common.js"

/**
 * What the forge currently says about this trak's branch.
 *
 * **Not gated on the state, unlike the merge preview beside it**, and the asymmetry
 * is the wire's rather than a lapse: that one answers `undefined` where nobody asked,
 * and this one's only way of saying nothing is `NoPullRequest` — which is a claim
 * about the forge, not about who is asking. A trak mid-plan whose branch has a pull
 * request would be told it has none. Which surface draws it and when is that surface's
 * to decide.
 *
 * A trak with no branch has nothing to ask about, and the forge is not called for it.
 * The forge is asked by branch *name*, which a pull request keeps on the forge after the
 * branch itself is gone — so this still answers at `Merged` and `Closed`, where a
 * pull-request trak spends the rest of its life with its branch deleted by the archive.
 *
 * Nothing here catches anything: `Forge` has no error channel, because a forge that
 * cannot be reached is an answer rather than a failure. See the port.
 */
const pullRequestRoute = Router.get(
  "/api/traks/:id/pull-request",
  Effect.gen(function* () {
    const id = yield* pathId
    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })
    const worktree = replayHistory(id, events).worktree
    if (worktree === undefined) {
      return yield* ServerResponse.json(toPullRequestDto(ForgeAnswer.None(), undefined))
    }
    return yield* ServerResponse.json(
      toPullRequestDto(yield* (yield* Forge).pullRequest(worktree.branch), worktree.branch),
    )
  }),
)

/**
 * What the forge says about many branches at once — one call, whatever is on screen.
 *
 * **Not under `/api/traks`, and it takes no id**, because it is not about a trak: it
 * replays no log and reads no store. The caller names the branches it wants asked about,
 * repeating `branch` on the query string, and matches the entries back to its rows —
 * `branch` being the same key the per-branch route above is asked by and the only one the
 * `Forge` port speaks.
 *
 * **The caller names them rather than this route deriving them**, and that is the whole
 * of why it stays a route that replays nothing: working out which traks are finished here
 * would mean replaying every log in the store, and it would put a second definition of
 * *finished* in the engine beside the one the surface already holds.
 *
 * It exists because the per-branch route does not scale by caller. A list drawing N
 * finished traks asked it N times per poll — N processes, N network calls, over a pile
 * nothing archives — and each answer carried the whole pane's payload to read four fields
 * off. This is one process and a fraction of the payload, and its cost does not move when
 * N does.
 *
 * **No branches is an answer with no entries, not a 400.** A surface with nothing
 * finished on it asking about nothing is ordinary, and it costs no process.
 */
const forgeListingRoute = Router.get(
  "/api/pull-requests",
  Effect.gen(function* () {
    const params = yield* ServerRequest.ParsedSearchParams
    const asked = params["branch"]
    // Repeated once is a string and repeated twice is an array, which is the shape the
    // parser hands over rather than a choice made here.
    const branches = (typeof asked === "string" ? [asked] : (asked ?? [])).map((branch) =>
      BranchName.make(branch),
    )
    return yield* ServerResponse.json(toForgeListingDto(yield* (yield* Forge).listing(branches)))
  }),
)

export const forgeRoutes = Router.empty.pipe(pullRequestRoute, forgeListingRoute)
