/**
 * What the forge says about the page's branches at once — the list's second read, and the
 * one that is not about a trak.
 *
 * **One query for the whole page, whatever is on it.** It replaced a fan-out: the list
 * asked `["pull-request", id]` once per finished trak, so N rows cost N `gh` processes
 * and N network calls every fifteen seconds, over a pile nothing archives — and each
 * answer carried a pane's worth of comments, reviews and threads to read four fields
 * off. This asks once and reads a shape built for a row, and its cost does not move when
 * N does.
 *
 * **The caller names the branches, and they are the key.** The engine asks the forge about
 * those branches by name rather than about the repository, which is what makes an entry
 * with no pull request a fact rather than the edge of a page. So the branch set is the
 * question, and a different set is a different answer: the caller owes it sorted, or a
 * reordered list is a new key on every render and the interval below stops meaning
 * anything.
 *
 * **A different question must not mean no answer, and that is what `placeholderData` is
 * for.** A trak finishing, or one being merged out of the pile, changes the set and so
 * changes the key — the most ordinary event on this screen. Without the last answer
 * carried across, `useQuery` has nothing for the length of a `gh` call, and a finished row
 * with no rung is filed by `sections.ts` under *Ready to merge* — every branch it asks
 * about is one something was committed to, so that is the pile: every conflicting row on
 * the page drawn as landable, fifteen seconds at a time, from the change that was supposed
 * to be invisible. Carrying it is safe because `rungsOf` matches by branch and not by
 * position — a branch in the carried answer keeps a verdict at most one poll old, and the
 * newly-finished branch is not in it at all, so it reads *Asking GitHub…*, which is true of
 * it.
 *
 * **What it does not cover is a reload, and that is what the browser's memory is for.** The
 * key changes with the question, so an answer restored from storage is unreachable by key
 * on exactly the load where the set moved — a trak having finished or merged since. So the
 * restored answers are read by branch instead (`forgeMemory`), which is the same match
 * `rungsOf` was already making, and this query's own restore is a happy accident when the
 * set has not moved rather than the mechanism.
 *
 * **The cut at `branchLimit` is here rather than in `forgeBranches`** for two reasons that
 * agree: the number is the wire package's and only `api/` may hold a wire value, and the
 * key has to be the question that was actually asked. Cutting after keying would key a
 * question nobody sent.
 *
 * **It polls unconditionally, and `enabled` is a different question.** The interval is a
 * number rather than a predicate for `useTraks`' reason — a query that decides whether to
 * ask needs a fetch to learn that fetching was warranted. What `enabled` answers is
 * whether there is any branch on the page to ask about at all: one call is cheap where N
 * were not, but it is still a `gh` process every fifteen seconds, and a list of work still
 * in flight has nothing for it to say. The same split the finished pane's own read makes.
 * `POLL_MS` and no faster.
 *
 * **It has no error state on this screen and must not grow one.** The two answers are
 * both ordinary: a forge that could not be asked is a value, and the page draws it on the
 * rows it bears on rather than as a failure over work that is perfectly fine. A rejected
 * promise here means the engine itself broke, which the list already says once for every
 * read it makes.
 *
 * Nothing invalidates this key. No press in this client writes to a forge, so no action
 * can change the answer, and the poll is the whole of how it stays *current* — what the
 * persist plugin adds is not a second way of refreshing it but a floor under the moment
 * before the first poll lands.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { branchLimit, pullRequests } from "../../api/forge"
import type { ForgeListingDto } from "../../api/types"
import { POLL_MS, queryKeys } from "../../queryCache"

/**
 * The branches this page actually sends, which is every finished one up to the wire's
 * bound.
 *
 * **Exported because the cut is a fact two readers need.** This one keys the query and
 * fills the request; `rungsOf` needs the same list to tell a branch nothing has come back
 * for *yet* from one that was never asked about at all, and a second `slice` at the call
 * site would be a second bound to keep in step.
 */
export const askedBranches = (branches: readonly string[]): readonly string[] =>
  branches.slice(0, branchLimit)

/**
 * `queryFn` is injectable for the reason `traksQueryOptions` gives: the key and the
 * interval are then reachable from a tier-1 test with no React and no network, and the
 * hook below has nothing left to test.
 */
export const forgeListingQueryOptions = (
  branches: readonly string[],
  queryFn: (branches: readonly string[]) => Promise<ForgeListingDto> = pullRequests,
) => {
  // Cut once, and the same list keys the query and goes out on it — see the header.
  const asked = askedBranches(branches)
  return {
    queryKey: queryKeys.pullRequests(asked),
    queryFn: () => queryFn(asked),
    // Nothing to ask about is not a call: the gate is the branch set being empty rather
    // than a second predicate that could disagree with what is sent.
    enabled: asked.length > 0,
    refetchInterval: POLL_MS,
    // The last answer stays in hand while a new branch set is in flight. Not a nicety:
    // with nothing in hand every finished row this asks about reads *Ready to merge*.
    placeholderData: keepPreviousData,
  }
}

/** `branches` is every finished trak's branch that something was committed to, sorted,
 *  asked by the caller off the list it holds — `forgeBranches`. Longer than the wire allows
 *  is cut above, not here. */
export const useForgeListing = (branches: readonly string[]): UseQueryResult<ForgeListingDto> =>
  useQuery(forgeListingQueryOptions(branches))
