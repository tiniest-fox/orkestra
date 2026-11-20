/**
 * Tier 1: which corner each of a plate's marks takes, with no React.
 *
 * What is worth pinning is the collision that shipped: two facts on one row both drawn at
 * the right corner, the second painting over the first with both still read aloud.
 */

import { Hand } from "lucide-react"
import { describe, expect, it } from "vitest"
import { corners } from "./corners"
import { composeRow, runningRow, stepRow } from "../map.fixtures"
import type { MapRow } from "../rows"

const asked: MapRow = {
  ...composeRow,
  atGate: { _tag: "Uneventful", at: 0, ambiguity: "none" },
  badge: { glyph: Hand, tone: "waiting", says: "something asked for this" },
}

const MAP = ["gate", "handUp", "badge", "continues"] as const
const RAIL = ["count", "badge", "continues"] as const

describe("corners", () => {
  it("gives a settled ask the engine gated both its marks, on two corners", () => {
    expect([...corners(asked, MAP)]).toEqual([
      ["gate", "right"],
      ["badge", "left"],
    ])
  })

  it("places only what the surface draws, so the rail's badge keeps the right corner", () => {
    expect([...corners(asked, RAIL)]).toEqual([["badge", "right"]])
  })

  it("steps a continues mark left of the count on the rail, as it always did", () => {
    const continued: MapRow = {
      ...runningRow,
      outstanding: 2,
      continues: { key: "1-experiment", to: "step:1", fresh: false },
    }
    expect([...corners(continued, RAIL)]).toEqual([
      ["count", "right"],
      ["continues", "left"],
    ])
    expect([...corners(continued, MAP)]).toEqual([["continues", "right"]])
  })

  it("draws nothing for a person's own hold, which the band inside the document says", () => {
    expect(corners({ ...stepRow, atGate: { _tag: "Held", at: 1 } }, MAP).size).toBe(0)
  })

  it("draws no third mark, rather than a third on a corner already taken", () => {
    const three: MapRow = {
      ...asked,
      continues: { key: "1-experiment", to: "step:1", fresh: false },
    }
    expect([...corners(three, MAP).keys()]).toEqual(["gate", "badge"])
  })
})
