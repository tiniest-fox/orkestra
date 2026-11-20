// Tier 1: the New Goal drawer's mode set.

import { describe, expect, it } from "vitest"
import { toggleMode } from "./modes"

describe("toggleMode", () => {
  it("turns a mode on in the offered order, and off again", () => {
    expect(toggleMode(["auto"], "manual")).toEqual(["manual", "auto"])
    expect(toggleMode(["smart", "auto"], "smart")).toEqual(["auto"])
  })

  it("never leaves the set empty", () => {
    expect(toggleMode(["smart"], "smart")).toEqual(["smart"])
  })
})
