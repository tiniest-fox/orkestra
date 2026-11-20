/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * `client-style`'s hook shape is what makes this reachable — the decisions are the key, the
 * poll and the gate, and the hook itself is one line of `useQuery` with nothing left to
 * test.
 */

import { describe, expect, it } from "vitest"
import { POLL_MS, queryKeys } from "../../../queryCache"
import { pullRequestQueryOptions } from "./usePullRequest"

const answer = async () => Promise.resolve({ _tag: "NoPullRequest" } as const)

describe("pullRequestQueryOptions", () => {
  /** Its own key, sharing no prefix with `trak` — an ending invalidates the detail, and it
   *  must not sweep away an answer about somebody else's forge with it. */
  it("keys the forge's answer apart from the trak", () => {
    expect(pullRequestQueryOptions("t1", true, answer).queryKey).toEqual(
      queryKeys.pullRequest("t1"),
    )
    expect(queryKeys.pullRequest("t1")[0]).not.toBe(queryKeys.trak("t1")[0])
  })

  /**
   * A number rather than a predicate, and the same one every other read on this screen
   * uses. Mergeability comes back *not worked out yet* for a while after every push, and
   * this is the whole of the retry — there is no loop under it.
   */
  it("polls unconditionally, at the backstop interval", () => {
    expect(pullRequestQueryOptions("t1", true, answer).refetchInterval).toBe(POLL_MS)
  })

  /** Gated by the caller — every answer costs the engine a forge process, so the pane asks
   *  only at the finished position and only about a branch something was committed to
   *  (`finishingLive`), and the list asks only about the traks the engine says are
   *  `Finished`. */
  it("asks only where the caller says to", () => {
    expect(pullRequestQueryOptions("t1", false, answer).enabled).toBe(false)
    expect(pullRequestQueryOptions("t1", true, answer).enabled).toBe(true)
  })
})
