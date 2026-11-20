/**
 * What the forge currently says about this trak's branch — the second read on this screen
 * that is not about the trak.
 *
 * **Beside the pane rather than in `hooks/`, because one feature asks.** It sat in
 * `hooks/` while the traks list read it too; the list now asks a different question
 * through a different route — every branch at once, coarsely — so this is back where
 * `client-style` puts a thing with one reader. `traks-list/useForgeListing` is the other
 * half, and the two share neither a key nor a shape on purpose: this is a pane's whole
 * payload about one branch, that is a row's four fields about all of them.
 *
 * **`enabled` rather than a poll predicate**, `useMergePreview`'s split: the finished
 * position is the only place any of this is drawn, so nothing asks anywhere else — and
 * wherever it is asked it polls unconditionally, because mergeability comes back *not
 * worked out yet* for a while after every push and the poll is the whole of the retry.
 * No retry loop lives under this.
 *
 * **The poll is `POLL_MS` and must not be made faster.** Every answer costs the engine a
 * forge process, where the other reads on this screen are a log replay.
 *
 * Nothing invalidates this key: no press on this pane writes to the forge, so no action
 * here can change what it would answer.
 *
 * **It is one of the two keys the browser writes down**, and the one whose key survives a
 * reload untouched, because it names a trak rather than a question — so a reloaded finished
 * page has its whole card in hand on the frame it paints. `forgeMemory` holds the hour that
 * bounds it.
 *
 * **The coarse answer rides alongside, and it costs nothing.** The traks list already asks
 * about every finished branch at once, and this pane's own answers feed the same
 * freshest-per-branch store — so whatever the browser last heard about this branch is in
 * the cache already, carrying the pull request's number, title, link and three verdicts,
 * which is a card's whole head. Asking the engine for this branch on its own would be a
 * second `gh` process per open trak page, which is the fan-out `useForgeListing` exists to
 * have got rid of. The traffic runs the other way too: what this pane reads is projected
 * into the store, so the row behind this page says what the card said without waiting out
 * the list's poll.
 */

import { useQuery } from "@tanstack/react-query"
import { pullRequest } from "../../../api/forge"
import type { PullRequestDto } from "../../../api/types"
import { useForgeMemory } from "../../../hooks/useForgeMemory"
import { POLL_MS, queryKeys } from "../../../queryCache"
import type { Forge } from "./pullRequest"

export const pullRequestQueryOptions = (
  id: string,
  enabled: boolean,
  queryFn: () => Promise<PullRequestDto> = () => pullRequest(id),
) => ({
  queryKey: queryKeys.pullRequest(id),
  queryFn,
  enabled,
  refetchInterval: POLL_MS,
})

/**
 * `enabled` is the caller's, and it is two facts: the plan has run out *and* something was
 * committed to the branch — a branch with no commits can have no pull request to report.
 * `useFinishing`'s `finishingLive` is where both halves are decided. `branch` is the trak's
 * own, which is what the list's answer is matched on.
 *
 * **`isFetchedAfterMount` is what *confirmed* means**, and it is the right question rather
 * than a comparison of timestamps: it is false for an answer restored from storage and
 * true the moment this page's own read lands, which is exactly when the card may claim its
 * colour.
 */
export const usePullRequest = (id: string, enabled: boolean, branch: string | undefined): Forge => {
  const query = useQuery(pullRequestQueryOptions(id, enabled))
  // Unconditionally, above the branch that reads it: a hook behind an `if` is a hook that
  // stops being called the moment a trak turns out to have no branch.
  const memory = useForgeMemory()
  const row = branch === undefined ? undefined : memory.get(branch)
  // A detail that could not be asked draws nothing of its own — `cardOf` falls back to the
  // row — so its moment is not the card's.
  const drawn = query.data?._tag === "ForgeUnavailable" ? undefined : query.data
  return {
    pull: query.data,
    row,
    // Whichever of the two is being drawn is the one the synced line is about.
    at: drawn === undefined ? row?.at : query.dataUpdatedAt,
    confirmed: query.isFetchedAfterMount,
    fetching: query.isFetching,
  }
}
