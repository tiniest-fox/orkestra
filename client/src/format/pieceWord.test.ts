import { describe, expect, it } from "vitest"
import { pieceWord } from "./pieceWord"

describe("pieceWord", () => {
  it("picks the first article-led word no sibling uses, with its article", () => {
    expect(
      pieceWord("Serve the built client from the engine and put a gate on its API", [
        "Build the client bundle and keep the built output checked in",
        "Write the guard that fronts the API",
      ]),
    ).toBe("the engine")
  })

  it("prefers an article-led word over an earlier unique verb", () => {
    // "Port" is unique among the siblings, but names nothing; the article is what
    // biases the pick toward a noun.
    expect(pieceWord("Port the routes to the new adapter", ["Build the client and the API"])).toBe(
      "the routes",
    )
  })

  it("keeps whichever article the instruction used", () => {
    expect(pieceWord("Add a manifest and an icon", ["Add the service worker"])).toBe("a manifest")
  })

  it("falls back to any unique word where no article introduces one", () => {
    expect(pieceWord("Rewrite push delivery", ["Rewrite push subscription"])).toBe("delivery")
  })

  it("is undefined where nothing distinguishes", () => {
    expect(pieceWord("Build the shell", ["Build the shell"])).toBeUndefined()
  })

  it("compares case-insensitively and keeps the word's own casing", () => {
    expect(pieceWord("Teach the Engine to serve it", ["Teach the client to ask"])).toBe(
      "the Engine",
    )
  })

  it("never returns a bare article", () => {
    // Every word but the articles is shared; the articles alone must not qualify.
    expect(pieceWord("the a an shell", ["shell"])).toBeUndefined()
  })

  it("with no siblings, shortens to the first article-led word", () => {
    expect(pieceWord("Build the phone shell for Orkestra", [])).toBe("the phone")
  })
})
