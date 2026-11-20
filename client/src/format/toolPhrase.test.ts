/** Tier 1: how a run of calls names itself. */

import { describe, expect, it } from "vitest"
import type { ToolEntryDto } from "../api/types"
import { makeTool } from "../fixtures"
import { labelsCalls, phraseForRun } from "./toolPhrase"

const KINDS: readonly ToolEntryDto["kind"][] = [
  "Bash",
  "Read",
  "Edit",
  "Write",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  "Todo",
  "Task",
  "Mcp",
  "Other",
]

/** `n` calls of one kind, which is what a run of them arrives as. */
const run = (kind: ToolEntryDto["kind"], n: number): readonly ToolEntryDto["kind"][] =>
  Array.from({ length: n }, () => kind)

describe("phraseForRun", () => {
  it("names a run of reads by what was read, not by the tool", () => {
    expect(phraseForRun(run("Read", 5))).toBe("Read 5 files")
  })

  it("counts commands rather than files, because a Bash call is not a file", () => {
    expect(phraseForRun(run("Bash", 3))).toBe("Ran 3 commands")
  })

  it("has a phrase for every kind the wire can send", () => {
    // The wire's `kind` is a closed literal union, so a new member is a compile error in
    // `PHRASE` — this asserts none of them is an empty string somebody stubbed.
    for (const kind of KINDS) expect(phraseForRun(run(kind, 2))).toMatch(/^\S.* 2 \S+$/)
  })

  // A run of one is the common case, not the edge one: a pause on either side of a call
  // leaves it alone in its run, so `1` is the count most rows carry.
  it("counts one of something in the singular", () => {
    expect(phraseForRun(["Read"])).toBe("Read 1 file")
    expect(phraseForRun(["Bash"])).toBe("Ran 1 command")
  })

  it("has a singular for every kind, and never the plural with a 1 in front of it", () => {
    for (const kind of KINDS) {
      expect(phraseForRun(run(kind, 1))).toMatch(/^\S.* 1 \S+$/)
      // What a row pasted from the column beside it would read as.
      expect(phraseForRun(run(kind, 1))).not.toBe(phraseForRun(run(kind, 2)).replace(" 2 ", " 1 "))
    }
  })

  it("joins two kinds into one sentence, lowering the second so it reads as one", () => {
    expect(phraseForRun([...run("Read", 4), "Bash"])).toBe("Read 4 files, and ran 1 command")
  })

  it("counts each kind wherever its calls fell, and orders them by first reach", () => {
    // Interleaved, which is what an agent actually does — the row says what happened in
    // the stretch, not what order the counting was easiest in.
    expect(phraseForRun(["Bash", "Read", "Bash", "Edit", "Read"])).toBe(
      "Ran 2 commands, read 2 files, and edited 1 file",
    )
  })

  it("counts an MCP call with the unclassified ones, so `called` is said once", () => {
    expect(phraseForRun(["Read", "Mcp", "Other", "Mcp"])).toBe("Read 1 file, and called 3 times")
  })

  it("says nothing about a run with no calls in it", () => {
    expect(phraseForRun([])).toBe("")
  })
})

const call = (name: string, kind: ToolEntryDto["kind"]): ToolEntryDto => makeTool({ name, kind })

describe("labelsCalls", () => {
  it("leaves the names out where the head has already said which tool it was", () => {
    expect(labelsCalls([call("Read", "Read"), call("Read", "Read")])).toBe(false)
  })

  it("labels a run of two tools", () => {
    expect(labelsCalls([call("Read", "Read"), call("Bash", "Bash")])).toBe(true)
  })

  it("reads names rather than kinds, which is what separates two tools nothing classifies", () => {
    // `Skill` and `TaskStop` are both `Other`. A kind-based answer would draw two bare
    // arguments with nothing saying which tool made either.
    expect(labelsCalls([call("Skill", "Other"), call("TaskStop", "Other")])).toBe(true)
    // And it separates two of the same kind that are not the same tool.
    expect(labelsCalls([call("Edit", "Edit"), call("MultiEdit", "Edit")])).toBe(true)
  })

  it("labels a run of one tool when its phrase names nothing", () => {
    // `Called 3 times` is the one phrase with no tool in it, because `Other` is the
    // escape hatch rather than a word in the vocabulary.
    expect(labelsCalls([call("Skill", "Other"), call("Skill", "Other")])).toBe(true)
  })

  it("asks it of the built-in calls alone, since an MCP call carries its own mark", () => {
    const mcp = call("mcp_tool_call", "Mcp")
    expect(labelsCalls([call("Read", "Read"), call("Read", "Read"), mcp])).toBe(false)
    expect(labelsCalls([call("Read", "Read"), call("Bash", "Bash"), mcp, mcp])).toBe(true)
  })

  it("says nothing about a run with no calls in it", () => {
    expect(labelsCalls([])).toBe(false)
  })
})
