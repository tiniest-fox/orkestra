/** Tier 1 (`testing-tiers`): which groups are idle, how old the row says one is, and where
 *  a pile of them is cut. */

import { describe, expect, it } from "vitest"
import { makeParent, makeTrak } from "../../fixtures"
import { activeOf, idleAge, idleCut, idleOf, pileAge } from "./idle"

const DAY = 24 * 60 * 60 * 1000

describe("idleOf", () => {
  it("is idle only when the parent and every piece are", () => {
    const parent = makeTrak({ id: "p", idle: true })
    const idlePiece = makeTrak({ id: "a", idle: true, parent: makeParent({ id: "p" }) })
    const livePiece = makeTrak({ id: "b", parent: makeParent({ id: "p" }) })
    expect(idleOf({ trak: parent, band: [] })).toBe(true)
    expect(idleOf({ trak: parent, band: [idlePiece] })).toBe(true)
    expect(idleOf({ trak: parent, band: [idlePiece, livePiece] })).toBe(false)
    expect(idleOf({ trak: makeTrak({ id: "q" }), band: [idlePiece] })).toBe(false)
  })
})

describe("activeOf", () => {
  it("takes the newest activity across the group, skipping members with none", () => {
    const row = {
      trak: makeTrak({ active: 100 }),
      band: [makeTrak({ active: 300 }), makeTrak({})],
    }
    expect(activeOf(row)).toBe(300)
    expect(activeOf({ trak: makeTrak({}), band: [] })).toBeUndefined()
  })
})

describe("idleAge", () => {
  const now = 100 * DAY

  it("counts whole days", () => {
    expect(idleAge(now - 12 * DAY - 5, now)).toBe("12d")
    expect(idleAge(now - 3 * DAY + 1, now)).toBe("2d")
  })

  it("says nothing where nothing was timestamped, and 0d for a clock behind the engine's", () => {
    expect(idleAge(undefined, now)).toBeUndefined()
    expect(idleAge(now + DAY, now)).toBe("0d")
  })
})

describe("idleCut", () => {
  it("keeps three rows on a desk and one on a phone, and never hides exactly one", () => {
    expect(idleCut(3, false)).toBe(3)
    expect(idleCut(4, false)).toBe(4)
    expect(idleCut(5, false)).toBe(3)
    expect(idleCut(1, true)).toBe(1)
    expect(idleCut(2, true)).toBe(2)
    expect(idleCut(3, true)).toBe(1)
  })
})

describe("pileAge", () => {
  it("says the newest group's age, or nothing where no group has a time", () => {
    const now = 100 * DAY
    const rows = [
      { trak: makeTrak({ active: now - 9 * DAY }), band: [] },
      { trak: makeTrak({ active: now - 30 * DAY }), band: [makeTrak({ active: now - 4 * DAY })] },
      { trak: makeTrak({}), band: [] },
    ]
    expect(pileAge(rows, now)).toBe("4d")
    expect(pileAge([{ trak: makeTrak({}), band: [] }], now)).toBeUndefined()
  })
})
