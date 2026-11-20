import { describe, expect, it } from "vitest"
import { browseRows, foldersOf } from "./browseTree"

const PATHS = ["README.md", "src/app/server.ts", "src/app/dto.ts", "src/vcs/git.ts", "package.json"]

describe("browseRows", () => {
  it("shows the top level only while every folder is shut, folders first", () => {
    expect(browseRows(PATHS, new Set()).map((r) => r.label)).toStrictEqual([
      "src",
      "README.md",
      "package.json",
    ])
  })

  it("walks into an open folder, and stops at a shut one inside it", () => {
    expect(
      browseRows(PATHS, new Set(["src", "src/app"])).map((r) => [r.label, r.depth]),
    ).toStrictEqual([
      ["src", 0],
      ["app", 1],
      ["server.ts", 2],
      ["dto.ts", 2],
      ["vcs", 1],
      ["README.md", 0],
      ["package.json", 0],
    ])
  })

  it("names a folded chain of lone folders by its whole path", () => {
    expect(browseRows(["a/b/c.ts"], new Set(["a/b"]))).toStrictEqual([
      { kind: "dir", path: "a/b", label: "a/b", depth: 0, open: true },
      { kind: "file", path: "a/b/c.ts", label: "c.ts", depth: 1 },
    ])
  })
})

describe("foldersOf", () => {
  it("lists every folder above a file, outermost first", () => {
    expect(foldersOf("src/app/server.ts")).toStrictEqual(["src", "src/app"])
    expect(foldersOf("README.md")).toStrictEqual([])
  })
})
