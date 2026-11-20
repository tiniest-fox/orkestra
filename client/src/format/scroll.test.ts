/** Tier 1: what counts as the end of a box, for the two that follow their own bottom. */

import { describe, expect, it } from "vitest"
import { atBottom } from "./scroll"

describe("atBottom", () => {
  it("says yes a hairline short, since a real box lands on fractions", () => {
    expect(atBottom({ scrollTop: 690.5, scrollHeight: 1000, clientHeight: 300 })).toBe(true)
  })

  it("says no a line up, which is a reader reading rather than a rounding error", () => {
    expect(atBottom({ scrollTop: 660, scrollHeight: 1000, clientHeight: 300 })).toBe(false)
  })

  it("says yes where there is nothing to scroll", () => {
    expect(atBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true)
  })
})
