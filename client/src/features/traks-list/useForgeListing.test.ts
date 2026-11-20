/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `client-style`'s hook shape is what makes this reachable — the decisions are the key, the
 * poll and the gate, and the hook itself is one line of `useQuery` with nothing left to
 * test.
 */

import { describe, expect, it } from "vitest"
import { keepPreviousData } from "@tanstack/react-query"
import { branchLimit } from "../../api/forge"
import { POLL_MS, queryKeys } from "../../queryCache"
import { forgeListingQueryOptions } from "./useForgeListing"

const answer = async () => Promise.resolve({ _tag: "PullRequests", entries: [] } as const)

/** More branches than one call may name, each distinct. */
const many = (howMany: number): readonly string[] =>
  Array.from({ length: howMany }, (_, i) => `trak/${String(i).padStart(4, "0")}`)

describe("forgeListingQueryOptions", () => {
  /**
   * Its own root, sharing no prefix with the pane's `["pull-request", id]`. The two ask one
   * service about the same kind of thing and are different shapes from different routes, so
   * a prefix would tie a sweep of one to the other.
   */
  it("keys many branches' answer apart from one branch's", () => {
    expect(forgeListingQueryOptions(["trak/a"], answer).queryKey).toEqual(
      queryKeys.pullRequests(["trak/a"]),
    )
    expect(queryKeys.pullRequests([])[0]).not.toBe(queryKeys.pullRequest("t1")[0])
  })

  /** The branch set is the question, so two sets are two answers rather than one that
   *  overwrites the other. */
  it("keys one set of branches apart from another", () => {
    expect(forgeListingQueryOptions(["trak/a"], answer).queryKey).not.toEqual(
      forgeListingQueryOptions(["trak/a", "trak/b"], answer).queryKey,
    )
  })

  /** A number rather than a predicate, for `useTraks`' reason: a query that decides whether
   *  to ask needs a fetch to learn that fetching was warranted. */
  it("polls unconditionally, at the backstop interval", () => {
    expect(forgeListingQueryOptions(["trak/a"], answer).refetchInterval).toBe(POLL_MS)
  })

  /**
   * The gate is the branch set being empty, and it is what keeps the cost at zero on a list
   * with nothing finished on it: one call is cheap where N were not, but it is still a `gh`
   * process every fifteen seconds for as long as a tab is open.
   */
  it("asks nothing where there is no branch to ask about", () => {
    expect(forgeListingQueryOptions([], answer).enabled).toBe(false)
    expect(forgeListingQueryOptions(["trak/a"], answer).enabled).toBe(true)
  })

  /** The branches are the question, so what is keyed and what is sent are one list rather
   *  than two that could come to disagree. */
  it("sends the branches it keyed on", async () => {
    let sent: readonly string[] = []
    await forgeListingQueryOptions(["trak/a", "trak/b"], async (branches) => {
      sent = branches
      return answer()
    }).queryFn()
    expect(sent).toStrictEqual(["trak/a", "trak/b"])
  })

  /**
   * The fault this covers: a trak finishing changes the set, so it changes the key, and a
   * key with nothing cached hands the page `undefined`. Every finished row then draws from
   * an answer nobody has — which `rungsOf` now reads as *we could not ask*, but the page
   * should not be reduced to saying that every time anything on it finishes.
   */
  it("keeps the last answer in hand while a new branch set is in flight", () => {
    expect(forgeListingQueryOptions(["trak/a"], answer).placeholderData).toBe(keepPreviousData)
  })

  /**
   * Past the wire's bound the engine answers about nothing extra, and past roughly three
   * hundred branches the request line is too long to be served at all — which arrives as no
   * answer rather than as a bounded one, and takes every row on the page with it.
   */
  it("names no more branches than one call may carry", () => {
    const asked = forgeListingQueryOptions(many(branchLimit + 50), answer)
    expect(asked.queryKey).toEqual(queryKeys.pullRequests(many(branchLimit)))
  })

  /** Cut once: the list that goes out is the list that was keyed, or the cache would be
   *  keyed on a question nobody asked. */
  it("sends the cut list it keyed on, not the whole one", async () => {
    let sent: readonly string[] = []
    await forgeListingQueryOptions(many(branchLimit + 50), async (branches) => {
      sent = branches
      return answer()
    }).queryFn()
    expect(sent).toStrictEqual(many(branchLimit))
  })
})
