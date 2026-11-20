/**
 * Tier 1 (`testing-tiers`): the options factory, with no React and no network.
 *
 * Two decisions, and both fail silently. A committed slice that polls asks git for a range
 * between two shas every fifteen seconds forever, and nothing on screen ever changes to
 * report it. A key that dropped the slice would make the picker's last press overwrite the
 * answer before it, so two rows would draw one diff.
 */

import { describe, expect, it } from "vitest"
import { POLL_MS } from "../../../queryCache"
import { makeChanges } from "../../../fixtures"
import { changedFileQueryOptions, changesQueryOptions } from "./useChanges"
import { ALL, UNCOMMITTED } from "./slices"

const ID = "trak-1"
const answer = () => Promise.resolve(makeChanges())

describe("changesQueryOptions", () => {
  it("keys by the slice as well as the trak, so three rows are three answers", () => {
    expect(changesQueryOptions(ID, ALL, true, answer).queryKey).toEqual(["changes", ID, ALL])
    expect(changesQueryOptions(ID, "3", true, answer).queryKey).toEqual(["changes", ID, "3"])
  })

  it("polls only the uncommitted slice, which is the only one an agent can move", () => {
    expect(changesQueryOptions(ID, UNCOMMITTED, true, answer).refetchInterval).toBe(POLL_MS)
    expect(changesQueryOptions(ID, ALL, true, answer).refetchInterval).toBe(false)
    expect(changesQueryOptions(ID, "3", true, answer).refetchInterval).toBe(false)
  })

  it("holds a step's slice fresh, so a refocus does not re-read a settled range", () => {
    expect(changesQueryOptions(ID, "3", true, answer).staleTime).toBe(Number.POSITIVE_INFINITY)
  })

  it("holds the whole branch stale, since a commit the engine did not make sends no event", () => {
    expect(changesQueryOptions(ID, ALL, true, answer).staleTime).toBe(0)
    expect(changesQueryOptions(ID, UNCOMMITTED, true, answer).staleTime).toBe(0)
  })

  it("asks nothing while the drawer is at another altitude", () => {
    expect(changesQueryOptions(ID, UNCOMMITTED, false, answer).enabled).toBe(false)
  })
})

describe("changedFileQueryOptions", () => {
  it("keys one file under its slice, so whatever sweeps the slice sweeps the file", () => {
    expect(changedFileQueryOptions(ID, "3", "a.tsx", true, answer).queryKey).toEqual([
      "changes",
      ID,
      "3",
      "file",
      "a.tsx",
    ])
  })

  it("asks nothing until the card is opened", () => {
    expect(changedFileQueryOptions(ID, ALL, "a.tsx", false, answer).enabled).toBe(false)
  })
})
