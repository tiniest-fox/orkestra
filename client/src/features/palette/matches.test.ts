import { describe, expect, it } from "vitest"
import { makeTrak } from "../../fixtures"
import {
  badgeOf,
  folderOf,
  linesByFile,
  marked,
  nameOf,
  pathsMatching,
  traksMatching,
} from "./matches"

describe("traksMatching", () => {
  it("matches a title, a request or an id, ignoring case", () => {
    const titled = makeTrak({ id: "bold-amber-lynx", title: "Let decide retry once" })
    const untitled = makeTrak({ id: "quiet-teal-heron", description: "Host decide errors" })
    const other = makeTrak({ id: "wise-coral-finch", description: "Nothing here" })
    expect(traksMatching([titled, untitled, other], "DECIDE")).toStrictEqual([titled, untitled])
    expect(traksMatching([titled, untitled, other], "coral")).toStrictEqual([other])
  })
})

describe("pathsMatching", () => {
  it("puts a path whose file name holds the query before one whose folder does", () => {
    const paths = ["src/decide/index.ts", "README.md", "src/app/decide.ts"]
    expect(pathsMatching(paths, "decide")).toStrictEqual({
      paths: ["src/app/decide.ts", "src/decide/index.ts"],
      cut: false,
    })
  })

  it("draws at most fifty and says it cut", () => {
    const paths = Array.from({ length: 51 }, (_, at) => `f${String(at)}.ts`)
    const found = pathsMatching(paths, "f")
    expect(found.paths).toHaveLength(50)
    expect(found.cut).toBe(true)
  })
})

describe("linesByFile", () => {
  it("groups the engine's matches by file, keeping their order", () => {
    const a1 = { path: "a.ts", line: 1, text: "x" }
    const b1 = { path: "b.ts", line: 4, text: "x" }
    const a2 = { path: "a.ts", line: 9, text: "x" }
    expect(linesByFile([a1, b1, a2])).toStrictEqual([
      { path: "a.ts", lines: [a1, a2] },
      { path: "b.ts", lines: [b1] },
    ])
  })
})

describe("paths", () => {
  it("splits a path into its folder and its name", () => {
    expect([folderOf("src/app/dto.ts"), nameOf("src/app/dto.ts")]).toStrictEqual([
      "src/app/",
      "dto.ts",
    ])
    expect([folderOf("README.md"), nameOf("README.md")]).toStrictEqual(["", "README.md"])
  })

  it("badges a file by its extension, and a file with none or a dotfile with dots", () => {
    expect(badgeOf("src/a.tsx")).toBe("TSX")
    expect(badgeOf("Makefile")).toBe("··")
    expect(badgeOf(".gitignore")).toBe("··")
  })
})

describe("marked", () => {
  it("cuts every occurrence out, ignoring case", () => {
    expect(marked("Decide and decide", "DECIDE")).toStrictEqual([
      { text: "Decide", hit: true },
      { text: " and ", hit: false },
      { text: "decide", hit: true },
    ])
  })

  it("is one plain run for an empty query", () => {
    expect(marked("text", "")).toStrictEqual([{ text: "text", hit: false }])
  })
})
