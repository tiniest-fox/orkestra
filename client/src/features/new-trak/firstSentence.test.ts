// Tier 1: the split a tile's blurb is cut at.
//
// The path case is constructed. No description in `.orkestra/agents/` puts a path in its
// first sentence today — the tiles' two-line clamp keeps those sentences short — but
// `.orkestra/` is a directory a person edits, so the rule still has to hold.

import { describe, expect, it } from "vitest"
import { firstSentence } from "./firstSentence"

describe("the first sentence of a description", () => {
  it("stops at the first period followed by a space", () => {
    expect(firstSentence("Judges work already done. Reads the diff fresh.")).toBe(
      "Judges work already done.",
    )
  })

  it("does not stop inside a path", () => {
    // Splitting on "." alone yields "Produces a throwaway study under `." — one word
    // past useless.
    expect(
      firstSentence(
        "Produces a throwaway study under `.atelier/`, not implementation. Use it early.",
      ),
    ).toBe("Produces a throwaway study under `.atelier/`, not implementation.")
  })

  it("takes the whole thing when nothing ends a sentence", () => {
    expect(firstSentence("  no full stop at all  ")).toBe("no full stop at all")
  })

  it("keeps the mark it stopped at", () => {
    expect(firstSentence("Is this it? Yes.")).toBe("Is this it?")
  })
})
