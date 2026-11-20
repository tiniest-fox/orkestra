import { describe, expect, it } from "vitest"
import type { FileChange } from "../types/changes.js"
import { collapseGenerated, generatedIn } from "./generated.js"

const file = (path: string): FileChange => ({
  path,
  change: "modified",
  additions: 2,
  deletions: 1,
  binary: false,
  hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 2, heading: "", lines: [] }],
})

describe("which files carry `linguist-generated`", () => {
  it("reads `set` and `true` as generated, and every other value as not", () => {
    const values: readonly (readonly [string, string])[] = [
      [".atelier/a.tsx", "set"],
      ["dist/b.js", "true"],
      ["lib/c.ts", "unspecified"],
      ["vendor/d.js", "false"],
      ["lib/e.js", "unset"],
    ]
    const out = values.map(([path, value]) => `${path}\0linguist-generated\0${value}`).join("\0")

    expect([...generatedIn(`${out}\0`)]).toEqual([".atelier/a.tsx", "dist/b.js"])
  })

  it("reads no output as nothing generated", () => {
    expect(generatedIn("").size).toBe(0)
  })
})

describe("a slice with its generated files collapsed", () => {
  it("keeps the counts and drops the hunks of a generated file, and leaves the rest", () => {
    const collapsed = collapseGenerated(
      { files: [file(".atelier/a.tsx"), file("lib/c.ts")], omittedFiles: 3 },
      new Set([".atelier/a.tsx"]),
    )

    expect(collapsed).toEqual({
      files: [{ ...file(".atelier/a.tsx"), omitted: "generated", hunks: [] }, file("lib/c.ts")],
      omittedFiles: 3,
    })
  })
})
