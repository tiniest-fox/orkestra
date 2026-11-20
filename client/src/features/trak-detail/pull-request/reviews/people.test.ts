/**
 * How a handle becomes a disc — the two facts the pane relies on and neither of which is
 * visible in a screenshot: two letters always, and one handle one hue forever.
 */

import { describe, expect, it } from "vitest"
import { avatarHue, initials } from "./people"

describe("initials", () => {
  it.each([
    ["jenny-w", "JW"],
    ["a-very-long-github-handle-indeed", "AV"],
    ["first.last", "FL"],
    ["first_last", "FL"],
    ["octocat", "OC"],
  ])("takes two letters from %s", (who, said) => {
    expect(initials(who)).toBe(said)
  })

  /** One letter in a disc reads as a bullet rather than as a person. */
  it("never draws one letter", () => {
    expect(initials("k")).toBe("KK")
    expect(initials("")).toBe("??")
  })
})

describe("avatarHue", () => {
  /** The whole point of deriving it: the same person is the same colour on every row, every
   *  poll and every trak, with no table to keep. */
  it("gives one handle the same hue every time", () => {
    expect(avatarHue("jenny-w")).toBe(avatarHue("jenny-w"))
  })

  it("stays a hue", () => {
    for (const who of ["a", "jenny-w", "marco", "ゆき", "release-bot"]) {
      expect(avatarHue(who)).toBeGreaterThanOrEqual(0)
      expect(avatarHue(who)).toBeLessThan(360)
    }
  })

  /**
   * **The case the modulo's position exists for.** Reduced inside the loop the avalanche
   * collapses and two handles differing only in their last character land a degree apart,
   * which is two people drawn the same colour.
   */
  it("puts handles differing in one trailing character far apart", () => {
    expect(Math.abs(avatarHue("marco1") - avatarHue("marco2"))).toBeGreaterThan(20)
  })
})
