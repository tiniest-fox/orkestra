/**
 * Tier 1 (`testing-tiers`): what the Changes surface works out before it draws.
 *
 * **`sidesOf` is what this file is really about.** It is the mapping a highlighter needs to
 * put a token stream back onto rows, and every way of getting it wrong is invisible: colour
 * lands on the wrong line, or a removed line is coloured from the text that replaced it.
 * Nothing on screen says so — it just looks like a diff with odd colours.
 */

import { describe, expect, it } from "vitest"
import type { ChangeHunkDto, ChangeLineDto } from "../../../api/types"
import { makeFileChange } from "../../../fixtures"
import {
  capHunks,
  NO_NEWLINE,
  counts,
  initiallyFolded,
  languageOf,
  omittedWords,
  sidesOf,
  splitPath,
  total,
} from "./changes"

const hunk = (lines: ChangeHunkDto["lines"]): ChangeHunkDto => ({
  oldStart: 1,
  oldCount: lines.length,
  newStart: 1,
  newCount: lines.length,
  heading: "",
  lines,
})

describe("sidesOf", () => {
  it("puts each row on the side its text actually came from", () => {
    const sides = sidesOf(
      hunk([
        { kind: "context", text: "const a = 1", oldLine: 1, newLine: 1 },
        { kind: "del", text: "const b = 2", oldLine: 2 },
        { kind: "add", text: "const b = 3", newLine: 2 },
      ]),
    )

    expect(sides.old).toBe("const a = 1\nconst b = 2")
    expect(sides.new).toBe("const a = 1\nconst b = 3")
    expect(sides.placed).toEqual([
      { side: "new", row: 0 },
      { side: "old", row: 1 },
      { side: "new", row: 1 },
    ])
  })

  it("places no source behind the no-newline marker, which is not a line of the file", () => {
    const sides = sidesOf(
      hunk([
        { kind: "add", text: "last", newLine: 1 },
        { kind: "context", text: NO_NEWLINE },
      ]),
    )

    expect(sides.new).toBe("last")
    expect(sides.placed[1]).toBeUndefined()
  })
})

describe("total", () => {
  it("adds the counts across the slice and singularises one file", () => {
    expect(total([makeFileChange({ additions: 5, deletions: 2 })])).toBe("1 file +5 −2")
    expect(
      total([
        makeFileChange({ additions: 5, deletions: 2 }),
        makeFileChange({ path: "b.ts", additions: 1, deletions: 0 }),
      ]),
    ).toBe("2 files +6 −2")
  })
})

describe("counts", () => {
  it("draws a binary file's counts, which are the half of it that is worth seeing", () => {
    expect(counts(makeFileChange({ binary: true, hunks: [], additions: 0, deletions: 0 }))).toBe(
      "+0 −0",
    )
  })
})

describe("initiallyFolded", () => {
  it("folds what has nothing to read: a deletion, a binary, a file over the cap", () => {
    const folded = initiallyFolded([
      makeFileChange({ path: "kept.ts" }),
      makeFileChange({ path: "gone.ts", change: "deleted" }),
      makeFileChange({ path: "shot.png", binary: true, omitted: "binary", hunks: [] }),
      makeFileChange({ path: "lock.yaml", omitted: "too-large", hunks: [] }),
    ])

    expect([...folded].toSorted()).toEqual(["gone.ts", "lock.yaml", "shot.png"])
  })
})

describe("omittedWords", () => {
  it("says why rather than drawing an empty card", () => {
    expect(omittedWords(makeFileChange({ omitted: "binary", hunks: [] }))).toContain("Binary")
    expect(
      omittedWords(makeFileChange({ omitted: "too-large", hunks: [], additions: 9, deletions: 1 })),
    ).toContain("10 lines")
    // A pure rename: real, counted at zero, and with nothing to show.
    expect(omittedWords(makeFileChange({ change: "renamed", hunks: [] }))).toBeDefined()
    expect(omittedWords(makeFileChange())).toBeUndefined()
  })
})

describe("splitPath", () => {
  it("keeps the directory on the path so two index.ts are two rows", () => {
    expect(splitPath("client/src/api/types.ts")).toEqual({
      dir: "client/src/api/",
      name: "types.ts",
    })
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" })
  })
})

describe("languageOf", () => {
  it("maps the extensions this build ships a grammar for", () => {
    expect(languageOf("src/app/server.ts")).toBe("typescript")
    expect(languageOf("client/src/App.tsx")).toBe("tsx")
  })

  it("answers nothing for a file with no extension or no grammar, which draws plain", () => {
    expect(languageOf("Makefile")).toBeUndefined()
    expect(languageOf(".gitignore")).toBeUndefined()
    expect(languageOf("notes/thing.wat")).toBeUndefined()
  })
})

/** A hunk of `n` added lines, each reading its own index. */
const run = (n: number): ChangeHunkDto => ({
  oldStart: 1,
  oldCount: n,
  newStart: 1,
  newCount: n,
  heading: "",
  lines: Array.from(
    { length: n },
    (_, i): ChangeLineDto => ({ kind: "add", text: String(i), newLine: i + 1 }),
  ),
})

describe("capHunks", () => {
  it("keeps every hunk whole when they fit, and says nothing is hidden", () => {
    const { shown, hidden } = capHunks([run(20), run(28)], 48)
    expect(shown.map((h) => h.lines.length)).toEqual([20, 28])
    expect(hidden).toBe(0)
  })

  it("cuts the hunk that crosses the cap from its end, drops the rest, and counts them", () => {
    const { shown, hidden } = capHunks([run(40), run(30), run(5)], 48)
    expect(shown.map((h) => h.lines.length)).toEqual([40, 8])
    // Row `i` of a cut hunk is still row `i` of the hunk, which the colouring relies on.
    expect(shown[1]?.lines[0]?.text).toBe("0")
    expect(hidden).toBe(27)
  })
})
