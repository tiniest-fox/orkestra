/**
 * Tier 1: the footer's arithmetic. What would go wrong quietly is a row whose worth moves
 * with its width — the same step reading half full at a desk and full on a phone.
 */

import { describe, expect, it } from "vitest"
import { FULL_ROW, fitting, fullness, percentOf, squares } from "./squares"

/** The share of the row a spend fills, partial square included. */
const filled = (spent: number, fit: number): number => {
  const s = squares(spent, fit)
  return (s.whole + s.part) / fit
}

describe("squares", () => {
  it("fills the same share of the row at a desk track and a phone track", () => {
    // 638px holds 80 squares and 246px holds 31; a p75 step is 28% of a 20m row at both.
    expect(fitting(638)).toBe(80)
    expect(fitting(246)).toBe(31)
    expect(filled(5_600_000, 80)).toBeCloseTo(0.28, 5)
    expect(filled(5_600_000, 31)).toBeCloseTo(0.28, 5)
    const desk = squares(5_600_000, 80)
    expect(desk.whole).toBe(22)
    expect(desk.part).toBeCloseTo(0.4, 5)
    expect(desk.times).toBeUndefined()
  })

  it("keeps the row full past 20m and says how many rows' worth", () => {
    expect(squares(49_100_000, 80)).toEqual({ whole: 80, part: 0, times: 2.455 })
    // Exactly full is a full row and no multiple.
    expect(squares(FULL_ROW, 31)).toEqual({ whole: 31, part: 0, times: undefined })
  })

  it("never fits zero squares, so a square is always worth something", () => {
    expect(fitting(0)).toBe(1)
  })
})

describe("the context reading", () => {
  it("is a percentage only against a known window", () => {
    expect(percentOf(150_000, 1_000_000)).toBe(15)
    expect(percentOf(150_000, undefined)).toBeUndefined()
  })

  it("is quiet below 70%, amber from 70% and red from 90%", () => {
    expect(fullness(69).bar).toBe("bg-source-human/70")
    expect(fullness(70).bar).toBe("bg-tone-waiting")
    expect(fullness(90).bar).toBe("bg-tone-bad")
  })
})
