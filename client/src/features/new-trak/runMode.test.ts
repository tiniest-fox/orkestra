// Tier 1: what a stored preference is worth, and what it is not.

import { describe, expect, it } from "vitest"
import { MODES } from "../../format/runMode"
import { forChat, remembered } from "./runMode"

describe("the mode this screen opens on", () => {
  it("is the one that was stored", () => {
    expect(MODES.map((mode) => remembered(mode))).toEqual(["manual", "smart", "decider", "auto"])
  })

  it("is manual when nothing was ever chosen", () => {
    expect(remembered(undefined)).toBe("manual")
  })

  // The string comes from storage, which nothing validates: another build's value, a
  // person editing it by hand, a key some other page happens to share. None of those is
  // a preference, and all of them read the same way — nobody chose.
  it("is manual when what was stored is not one of the four", () => {
    expect(["", "MANUAL", "smartish", "{}"].map((raw) => remembered(raw))).toEqual([
      "manual",
      "manual",
      "manual",
      "manual",
    ])
  })
})

describe("the mode a chat opens in", () => {
  // `auto` would approve the chat's own gate in advance, so it answers once and closes.
  // `decider` stops at every conversation already, so it passes through.
  it("is the remembered one, with auto read as smart", () => {
    expect(MODES.map(forChat)).toEqual(["manual", "smart", "decider", "smart"])
  })
})
