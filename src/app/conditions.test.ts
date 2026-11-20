// Tier-1: the two rules the sweep decides by, which are arithmetic over a clock and
// nothing else — when an ask is owed, and when the next one falls.

import { describe, expect, it } from "vitest"
import { due, nextAskFrom } from "./conditions.js"

const MINUTE = 60_000

describe("due", () => {
  it("is owed once the interval has passed since the last ask, and not before", () => {
    expect(due(1_000_000 + MINUTE - 1, 1_000_000, MINUTE)).toBe(false)
    expect(due(1_000_000 + MINUTE, 1_000_000, MINUTE)).toBe(true)
  })

  it("is owed at once where nothing says when it was last asked", () => {
    // A log written before events were stamped, or a wait nothing has asked yet:
    // unmeasured reads as due rather than as never.
    expect(due(1_000_000, undefined, MINUTE)).toBe(true)
  })
})

describe("nextAskFrom", () => {
  it("is one interval past the last ask", () => {
    expect(nextAskFrom(1_000_000, MINUTE)).toBe(1_000_000 + MINUTE)
  })

  it("is nothing where the last ask is unmeasured — a countdown from nowhere is a lie", () => {
    expect(nextAskFrom(undefined, MINUTE)).toBeUndefined()
  })
})
