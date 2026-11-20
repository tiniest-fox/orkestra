/** Tier 1: the rule a denial names, in the words a call's line draws. */

import { describe, expect, it } from "vitest"
import { makeDenied } from "../fixtures"
import { deniedOn, deniedRule, deniedText } from "./denied"

describe("deniedRule", () => {
  it("takes the brackets off a classifier rule", () => {
    expect(deniedRule(makeDenied())).toBe("Safety Bypass Flag")
  })

  it("keeps a reason that is not bracketed as written", () => {
    expect(deniedRule(makeDenied({ reason: "This command requires approval" }))).toBe(
      "This command requires approval",
    )
  })

  it("falls back to what refused it, and to nothing", () => {
    expect(deniedRule(makeDenied({ reason: undefined }))).toBe("classifier")
    expect(deniedText(makeDenied({ reason: undefined, source: undefined }))).toBe("Denied")
  })
})

describe("deniedOn", () => {
  it("finds the denial for one call and no other", () => {
    const denied = makeDenied({ call: "a" })
    expect(deniedOn([denied], "a")).toBe(denied)
    expect(deniedOn([denied], "b")).toBeUndefined()
    expect(deniedOn([denied], undefined)).toBeUndefined()
  })
})
