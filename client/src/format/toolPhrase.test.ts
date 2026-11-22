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

const tools = (kinds: readonly ToolEntryDto["kind"][]): readonly ToolEntryDto[] =>
  kinds.map((kind) => makeTool({ name: kind, kind }))

/** A Claude shell call: the command in `command` when the agent described it. */
const claude = (command: string): ToolEntryDto =>
  makeTool({ name: "Bash", kind: "Bash", detail: "Look around", command })

/** A Codex shell call: the wrapped command in `detail`. */
const codex = (command: string): ToolEntryDto =>
  makeTool({ name: "commandExecution", kind: "Bash", detail: `/bin/zsh -lc '${command}'` })

describe("phraseForRun", () => {
  it("names a run of shell calls by what they did, in the order the agent first did it", () => {
    const calls = [
      claude("cat src/a.ts"),
      codex("rg -n x src"),
      claude("sed -n 1,40p src/b.ts"),
      codex('sed -i "" s/a/b/ src/a.ts'),
    ]
    expect(phraseForRun(calls)).toBe("Read, searched, and edited")
  })

  it("names every effect of a call that did several things", () => {
    expect(phraseForRun([claude("git mv a.ts b.ts && rm c.ts")])).toBe("Moved, and deleted")
    expect(phraseForRun([codex("mv a.ts b.ts; some-cli run")])).toBe("Moved, and ran commands")
    expect(phraseForRun([claude("sed -i '' s/a/b/ f.ts && grep -n b f.ts")])).toBe("Edited")
    expect(phraseForRun([codex("grep x f | head")])).toBe("Searched")
  })

  it("classifies the run's shell calls together, so scratch and undone edits drop", () => {
    const probe = [
      claude("cat > spec/zz_probe_spec.rb <<EOF\nit {}\nEOF"),
      makeTool({ name: "Read", kind: "Read", detail: "spec/zz_probe_spec.rb" }),
      codex("bundle exec rspec spec/zz_probe_spec.rb"),
      claude("rm spec/zz_probe_spec.rb"),
    ]
    expect(phraseForRun(probe)).toBe("Ran commands, read, and tested")
    const undone = [
      claude("sed -i '' s/a/b/ src/a.ts"),
      claude("pnpm test"),
      codex("git checkout -- src/a.ts"),
    ]
    expect(phraseForRun(undone)).toBe("Ran commands, and tested")
  })

  it("says an agent that only slept waited", () => {
    expect(phraseForRun([claude("sleep 200"), codex("until test -f done; do sleep 5; done")])).toBe(
      "Waited",
    )
  })

  it("reads a Claude call with no description from its detail", () => {
    expect(phraseForRun([makeTool({ name: "Bash", kind: "Bash", detail: "ls -la" })])).toBe(
      "Listed",
    )
  })

  it("falls back to `ran commands` for a shell call it cannot name", () => {
    expect(phraseForRun([claude("widgetctl render x"), codex("git fetch")])).toBe("Ran commands")
  })

  it("merges a shell verb with the dedicated tool that does the same thing", () => {
    expect(phraseForRun([claude("cat a.ts"), ...tools(["Read"])])).toBe("Read")
    expect(phraseForRun([...tools(["Grep", "Glob"]), codex("rg x")])).toBe("Searched")
  })

  it("never puts a number in the sentence, for any kind", () => {
    for (const kind of KINDS) expect(phraseForRun(tools(run(kind, 3)))).not.toMatch(/\d/)
    expect(phraseForRun([claude("cat a b c"), claude("pnpm test 2>&1 | tail -3")])).toBe(
      "Read, and tested",
    )
  })

  it("has a phrase for every kind the wire can send", () => {
    for (const kind of KINDS) expect(phraseForRun(tools([kind]))).toMatch(/^[A-Z][a-z ]+$/)
  })

  it("joins two phrases into one sentence, lowering the second so it reads as one", () => {
    expect(phraseForRun(tools(["Read", "Read", "Bash"]))).toBe("Read, and ran commands")
  })

  it("says each phrase once, wherever its calls fell", () => {
    expect(phraseForRun(tools(["Bash", "Read", "Bash", "Edit", "Read"]))).toBe(
      "Ran commands, read, and edited",
    )
  })

  it("says `called tools` once for MCP calls and unclassified ones together", () => {
    expect(phraseForRun(tools(["Read", "Mcp", "Other", "Mcp"]))).toBe("Read, and called tools")
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
