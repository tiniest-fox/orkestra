import { describe, expect, it } from "vitest"
import { factsOf, isMarkdown } from "./fileFacts"

describe("factsOf", () => {
  it("counts a text file's lines and names its language", () => {
    expect(factsOf({ _tag: "Text", path: "src/a.ts", text: "", lines: 1284 })).toBe(
      "1,284 lines · ts",
    )
    expect(factsOf({ _tag: "Text", path: "Makefile", text: "", lines: 1 })).toBe("1 line")
  })

  it("gives the size of a file it does not draw", () => {
    expect(factsOf({ _tag: "Binary", path: "logo.png", bytes: 2048 })).toBe("2.0 KB")
  })
})

describe("isMarkdown", () => {
  it("counts .md, .markdown and .mdx in any case, and nothing else", () => {
    expect(["README.md", "docs/a.markdown", "b.mdx", "NOTES.MD"].map(isMarkdown)).toStrictEqual([
      true,
      true,
      true,
      true,
    ])
    expect(["a.ts", "md", ".md", "a.md.txt"].map(isMarkdown)).toStrictEqual([
      false,
      false,
      false,
      false,
    ])
  })
})
