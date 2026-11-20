// Tier-1: what "shorten an id for display" must not do.

import { describe, expect, it } from "vitest"
import { shortId } from "./ids"

describe("shortId", () => {
  it("takes the first block of a session id", () => {
    // The same eight characters the terminal shows a session as, so a row in the
    // activity feed is greppable against a `claude --resume`.
    expect(shortId("1dd2b03b-a627-457d-a44c-43b1240d0528")).toBe("1dd2b03b")
  })

  it("abbreviates a git sha the way git does", () => {
    expect(shortId("b8c3120eb1b3f4a2c9d7e6f5a4b3c2d1e0f9a8b7")).toBe("b8c3120e")
  })

  it("returns a short input unchanged rather than failing", () => {
    // A display helper that throws turns a surprising id into a blank page. Both of
    // these are wrong-looking input, and neither is worth losing the log row over.
    expect(shortId("abc")).toBe("abc")
    expect(shortId("")).toBe("")
  })

  it("does not round-trip — the full id is what a request takes", () => {
    // The rule this pins is `api/`'s: every path is built from the whole id.
    // If this ever became reversible somebody would be tempted to send the short one.
    const full = "1dd2b03b-a627-457d-a44c-43b1240d0528"
    expect(shortId(full)).not.toBe(full)
  })
})
