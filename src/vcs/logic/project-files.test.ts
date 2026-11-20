import { describe, expect, it } from "vitest"
import { filesListed, grepRow } from "./project-files.js"

describe("filesListed", () => {
  it("drops a tracked file deleted on disk, and keeps git's order", () => {
    expect(filesListed("a.ts\0b/c.ts\0gone.md\0new.txt\0", "gone.md\0")).toStrictEqual([
      "a.ts",
      "b/c.ts",
      "new.txt",
    ])
  })

  it("keeps a name with a space or a newline whole", () => {
    expect(filesListed("with space.md\0two\nlines.txt\0", "")).toStrictEqual([
      "with space.md",
      "two\nlines.txt",
    ])
  })

  it("answers nothing for an empty listing", () => {
    expect(filesListed("", "")).toStrictEqual([])
  })
})

describe("grepRow", () => {
  it("reads path, line and text off a match", () => {
    expect(grepRow("lib/a.ts\x0012\x00  const decide = 1")).toStrictEqual({
      path: "lib/a.ts",
      line: 12,
      text: "  const decide = 1",
    })
  })

  it("drops a row that does not split into a match", () => {
    expect(grepRow("half of a name")).toBeUndefined()
    expect(grepRow("")).toBeUndefined()
    expect(grepRow("a\x00x\x00text")).toBeUndefined()
  })

  it("cuts a long line's text", () => {
    expect(grepRow(`a\x001\x00${"x".repeat(1000)}`)?.text).toHaveLength(400)
  })
})
