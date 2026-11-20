/** The `forge` slice's routes: one trak's pull request, and many branches' at once. */

import { Schema } from "effect"
import {
  ForgeListingDto as ForgeListingSchema,
  PullRequestDto as PullRequestSchema,
  PULL_REQUEST_BRANCH_LIMIT,
} from "@orkestra/shared/dto/forge"
import { get, trakPath } from "./http"
import type { ForgeListingDto, PullRequestDto } from "./types"

/**
 * `Sync` like every decoder in `api/`, and the union is the whole point of decoding it: *the forge
 * could not be asked* and *there is no pull request* are two members a surface has to tell
 * apart, and a `res.json()` would hand both over as an object with a string on it.
 */
const decodePullRequest = Schema.decodeUnknownSync(PullRequestSchema)
/**
 * The listing's union is decoded for the same reason and one further one: absence *in*
 * the answer is what a caller reads as a fact, so a body that arrived half-shaped and was
 * trusted would be read as pull requests that do not exist.
 */
const decodeForgeListing = Schema.decodeUnknownSync(ForgeListingSchema)

/**
 * `GET /api/traks/:id/pull-request`. Free of a `claude`, and **not free of a process**: the
 * engine runs the forge's CLI once per request, so this polls at `POLL_MS` and never faster.
 *
 * **Three answers, and only one of them is a pull request.** *The forge could not be asked*
 * is an ordinary answer rather than an error — no `gh`, not authenticated, no remote, a
 * remote that is not a forge, a network failure, a timeout — and a surface says nothing at
 * all there. So this route does not fail for any of them, and a rejected promise here means
 * the engine itself broke.
 *
 * No credential comes back and there is no route that serves one: the engine's CLI reads
 * the machine's own keyring.
 */
export const pullRequest = async (id: string): Promise<PullRequestDto> =>
  decodePullRequest(await get(`${trakPath(id)}/pull-request`))

/**
 * `GET /api/pull-requests?branch=…&branch=…`. **One call however many branches are named**,
 * which is the whole of why it exists beside the one above: that one is per branch, so a
 * list drawing twenty finished traks paid twenty processes and twenty network calls a
 * poll, over a set that only grows.
 *
 * **Two answers, and a caller must not collapse them.** *We could not ask* is not *there
 * is nothing to say* — the first licenses saying nothing about any branch, the second is
 * a fact about all of them. And within the second, a branch with **an entry and no pull
 * request** has none, where a branch with **no entry** was not answered about and nothing
 * may be drawn on it.
 *
 * Not under `/api/traks`: it takes no id and replays no log. The branches are the caller's
 * to name and the entries are the caller's to match back, by branch. It polls at `POLL_MS`
 * and never faster — the engine runs the forge's CLI once per request.
 *
 * **`branchLimit` is the most this may name**, re-exported below so a caller can cut its
 * list before it gets here.
 */
export const pullRequests = async (branches: readonly string[]): Promise<ForgeListingDto> => {
  const query = new URLSearchParams(branches.map((branch) => ["branch", branch])).toString()
  return decodeForgeListing(await get(`/api/pull-requests${query === "" ? "" : `?${query}`}`))
}

/**
 * How many branches `pullRequests` may name — **the engine's own number, not a second
 * one**, which is why it is re-exported here rather than written down again.
 *
 * It sits at this seam because it is a fact about the wire: the branches ride on the query
 * string, and past roughly three hundred of them the request line outgrows the server's
 * default header budget and the whole read is refused rather than bounded. A caller cutting
 * its list here keeps every request servable, and the branches it cut come back with no
 * entry — which the surface already draws as *we could not ask*, the same as the ones the
 * engine itself declines to ask about.
 *
 * Re-exported rather than reached for directly because `@orkestra/shared` is a value
 * import, which only `api/` may make. A hook takes it from here; a pure module cannot
 * hold it at all.
 */
export const branchLimit = PULL_REQUEST_BRANCH_LIMIT
