import { describe, expect, it } from "vitest"
import { plainText } from "./markdown"

describe("plainText", () => {
  it("leaves the words of an emphasised heading and takes the punctuation", () => {
    expect(plainText("**What exists**")).toBe("What exists")
  })

  it("takes the leader off a bullet, a heading and a quote", () => {
    expect(plainText("- a read-only client")).toBe("a read-only client")
    expect(plainText("## The plan")).toBe("The plan")
    expect(plainText("> what they said")).toBe("what they said")
    expect(plainText("1. first")).toBe("first")
  })

  it("flattens a table to its cells, which is the whole point of the helper", () => {
    // The shape that made a one-line summary unreadable: a row of pipes says nothing
    // about what is in it.
    expect(plainText("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("a b - - 1 2")
  })

  it("keeps a link's text and drops its target", () => {
    expect(plainText("see [the notes](guide/TODO.md)")).toBe("see the notes")
  })

  it("drops a fenced block rather than showing its first line as prose", () => {
    expect(plainText("before\n```ts\nconst x = 1\n```\nafter")).toBe("before after")
  })

  it("collapses every run of whitespace, because the summary is one line", () => {
    expect(plainText("two\n\nparagraphs   apart")).toBe("two paragraphs apart")
  })

  it("leaves prose that has no markers in it exactly as written", () => {
    expect(plainText("the composer used no tools")).toBe("the composer used no tools")
  })
})
