/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network — the key,
 * the poll and the gate, which is everything the hook decides.
 */

import { describe, expect, it } from "vitest"
import { POLL_MS, queryKeys } from "../../../queryCache"
import { deployQueryOptions } from "./useDeploy"

const answer = async () => Promise.resolve({ answer: "none" } as const)

describe("deployQueryOptions", () => {
  /** Its own key, sharing no prefix with `trak` — an ending invalidates the detail and
   *  must not sweep an answer about a world outside this engine with it. */
  it("keys the deploy's answer apart from the trak", () => {
    expect(deployQueryOptions("t1", true, answer).queryKey).toEqual(queryKeys.deploy("t1"))
    expect(queryKeys.deploy("t1")[0]).not.toBe(queryKeys.trak("t1")[0])
    expect(queryKeys.deploy("t1")[0]).not.toBe(queryKeys.pullRequest("t1")[0])
  })

  /** A number, and the backstop's own: every answer but `none` may run a script, and the
   *  engine reuses an answer for a while precisely so that several tabs are not several
   *  runs. */
  it("polls unconditionally, at the backstop interval", () => {
    expect(deployQueryOptions("t1", true, answer).refetchInterval).toBe(POLL_MS)
  })

  /** Gated by the caller — `finishingLive`, which asks only where there is a merge commit
   *  to hand the script. */
  it("asks only where the caller says to", () => {
    expect(deployQueryOptions("t1", false, answer).enabled).toBe(false)
    expect(deployQueryOptions("t1", true, answer).enabled).toBe(true)
  })
})
