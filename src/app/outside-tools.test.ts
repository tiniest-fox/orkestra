import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { OUTSIDE_TOOLS, readOutsideTools } from "./outside-tools.js"
import { TEMPLATES } from "./packaged.js"

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("readOutsideTools", () => {
  it("reads a non-empty description for every outside tool from the shipped templates", () => {
    const tools = readOutsideTools()
    expect([...tools.keys()]).toEqual([...OUTSIDE_TOOLS])
    for (const name of OUTSIDE_TOOLS) expect(tools.get(name)).toMatch(/\S/)
  })

  it("fails, naming the file, when a directory is missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "outside-tools-"))
    made.push(dir)
    cpSync(join(TEMPLATES, "outside"), join(dir, "outside"), { recursive: true })
    rmSync(join(dir, "outside", "tool-retry_trak.md"))
    expect(() => readOutsideTools(dir)).toThrow(/tool-retry_trak\.md/)
  })
})
