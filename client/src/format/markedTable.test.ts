import { describe, expect, it } from "vitest"
import { markedTableOf } from "./markedTable"

const lines = (...xs: readonly string[]): string => xs.join("\n")

describe("markedTableOf — the presets", () => {
  it("reads a decision: the title line, the fields, a wrapped why, and the flag", () => {
    const table = markedTableOf(
      "decision",
      lines(
        "Source form",
        "chose: One labelled fence per figure",
        "over: A YAML fence",
        "why: The person's pick. It reads cleanly",
        "  as the fallback.",
        "flag: hard to reverse",
        "",
        "Over-marking",
        "chose: No rule and no guard",
      ),
    )

    expect(table?.columns.map((c) => [c.head, c.role])).toEqual([
      ["Decision", "plain"],
      ["Chosen", "good"],
      ["Over", "bad"],
    ])
    expect(table?.rows[0]).toEqual({
      cells: [
        { text: "Source form", mark: undefined },
        { text: "One labelled fence per figure", mark: undefined },
        { text: "A YAML fence", mark: undefined },
      ],
      icon: "flag",
      detail: "The person's pick. It reads cleanly as the fallback.",
      detailLabel: "Why",
      section: undefined,
    })
    expect(table?.rows[1]?.icon).toBeUndefined()
    expect(table?.rows[1]?.cells[2]?.text).toBe("")
    expect(table?.key).toEqual([["flag", "Hard to reverse"]])
  })

  it("puts the decisions under a heading into its section", () => {
    const table = markedTableOf(
      "decision",
      lines(
        "## Hard to reverse",
        "",
        "Source form",
        "chose: A fence",
        "",
        "## The rest",
        "Where",
        "chose: Here",
      ),
    )

    expect(table?.rows.map((r) => r.section)).toEqual(["Hard to reverse", "The rest"])
  })

  it("reads a scope: in and out, with why it is out as the detail", () => {
    const table = markedTableOf(
      "scope",
      lines(
        "in: Marked table",
        "out: Flow figures",
        "why: left out unless pulled in",
        "",
        "in: Fence dispatch",
        "out: Pseudo-code colouring",
      ),
    )

    expect(table?.columns.map((c) => [c.head, c.role, c.lead])).toEqual([
      ["In", "good", false],
      ["Out", "bad", false],
    ])
    expect(table?.rows.map((r) => [r.cells.map((c) => c.text), r.detail])).toEqual([
      [["Marked table", "Flow figures"], "left out unless pulled in"],
      [["Fence dispatch", "Pseudo-code colouring"], undefined],
    ])
  })
})

describe("markedTableOf — criteria and files", () => {
  it("reads criteria, drawing how each is verified as the row's icon and keying only those used", () => {
    const table = markedTableOf(
      "criteria",
      lines(
        "Each grammar parses its source texts.",
        "by: A test per parser",
        "how: test",
        "",
        "The map draws a document's parts.",
        "by: A person looks, through an atelier proof",
        "how: person",
      ),
    )

    expect(table?.rows.map((r) => [r.cells[0]?.text, r.cells[1]?.text, r.icon])).toEqual([
      ["Each grammar parses its source texts.", "A test per parser", "test"],
      ["The map draws a document's parts.", "A person looks, through an atelier proof", "person"],
    ])
    expect(table?.key).toEqual([
      ["test", "A test"],
      ["person", "A person looks"],
    ])
  })

  it("reads met: as a verdict on the Verified by cell, tallied first in the key", () => {
    const table = markedTableOf(
      "criteria",
      lines(
        "The loader refuses an unknown figure.",
        "by: a test on the loader",
        "how: test",
        "met: yes",
        "",
        "The table reads at phone width.",
        "by: a person looks",
        "how: person",
        "met: partly",
        "",
        "Old fences still parse.",
        "by: a test",
        "how: test",
        "met: yes",
      ),
    )

    expect(table?.rows.map((r) => [r.cells[0]?.verdict, r.cells[1]?.verdict])).toEqual([
      [undefined, "good"],
      [undefined, "partly"],
      [undefined, "good"],
    ])
    expect(table?.key).toEqual([
      ["check", "2 met · 1 partly"],
      ["test", "A test"],
      ["person", "A person looks"],
    ])
  })

  it("reads criteria with no met: as before, with no verdict and no tally", () => {
    const table = markedTableOf("criteria", lines("It works.", "by: a test", "how: test"))

    expect(table?.rows[0]?.cells[1]?.verdict).toBeUndefined()
    expect(table?.key).toEqual([["test", "A test"]])
  })

  it("reads files: new, changed and existing paths, notes indented under them, in sections", () => {
    const table = markedTableOf(
      "files",
      lines(
        "## Client",
        "+ client/src/format/markedTable.ts",
        "  The parsers.",
        "~ `client/src/components/Markdown.tsx`",
        "  The dispatch,",
        "  one branch a label.",
        "client/src/components/CodeBlock.tsx",
      ),
    )

    expect(table?.rows.map((r) => [r.cells[0]?.text, r.cells[1]?.text, r.icon, r.section])).toEqual(
      [
        ["client/src/format/markedTable.ts", "The parsers.", "new", "Client"],
        [
          "client/src/components/Markdown.tsx",
          "The dispatch, one branch a label.",
          "changed",
          "Client",
        ],
        ["client/src/components/CodeBlock.tsx", "", undefined, "Client"],
      ],
    )
    expect(table?.columns[0]?.path).toBe(true)
    expect(table?.key).toEqual([
      ["new", "New"],
      ["changed", "Changed"],
    ])
  })
})

describe("markedTableOf — runs", () => {
  it("reads runs: a verdict on what each said, a stopped run said as one, cost and after as notes", () => {
    const table = markedTableOf(
      "runs",
      lines(
        "New case before the fix",
        "result: failed",
        "said: Failed as it should.",
        "",
        "`lint`",
        "result: passed",
        "said: Exit 0.",
        "",
        "GCM against a real credential manager",
        "result: not run",
        "said: No GCM on this machine.",
        "",
        "`test`",
        "result: not run",
        "said: after lint failed",
        "",
        "cost: None.",
        "after: A running server picks this up only after a restart.",
      ),
    )

    expect(table?.columns.map((c) => c.head)).toEqual(["Run", "What it said"])
    expect(
      table?.rows.map((r) => [r.cells[0]?.text, r.cells[1]?.text, r.cells[1]?.verdict]),
    ).toEqual([
      ["New case before the fix", "Failed as it should.", "bad"],
      ["`lint`", "Exit 0.", "good"],
      ["GCM against a real credential manager", "No GCM on this machine.", undefined],
      ["`test`", "Not run, after lint failed", undefined],
    ])
    expect(table?.notes).toEqual([
      ["Cost", "None."],
      ["After", "A running server picks this up only after a restart."],
    ])
  })

  it("reads runs with no after: and no closing lines at all", () => {
    const run = lines("check", "result: passed", "said: Exit 0.")

    expect(markedTableOf("runs", lines(run, "", "cost: None."))?.notes).toEqual([["Cost", "None."]])
    expect(markedTableOf("runs", run)?.notes).toEqual([])
  })
})

describe("markedTableOf — the free table", () => {
  it("reads a free table: roles from the head line, a key, icons, and arrows on cells", () => {
    const table = markedTableOf(
      "table",
      lines(
        "Trak | + Kept | - Lost | Note",
        "key: + Better, - Worse, = Same, check Agreed",
        "[check] `quick-blue-worm`",
        "  + Two turns",
        "  - Four turns",
        "  = Same as before",
        "",
        "Second",
      ),
    )

    expect(table?.columns.map((c) => [c.head, c.role, c.lead])).toEqual([
      ["Trak", "plain", true],
      ["Kept", "good", false],
      ["Lost", "bad", false],
      ["Note", "plain", false],
    ])
    expect(table?.key).toEqual([
      ["better", "Better"],
      ["worse", "Worse"],
      ["same", "Same"],
      ["check", "Agreed"],
    ])
    expect(table?.rows[0]).toEqual({
      cells: [
        { text: "`quick-blue-worm`", mark: undefined },
        { text: "Two turns", mark: "better" },
        { text: "Four turns", mark: "worse" },
        { text: "Same as before", mark: "same" },
      ],
      icon: "check",
      detail: undefined,
      detailLabel: "",
      section: undefined,
    })
    expect(table?.rows[1]?.cells.map((c) => c.text)).toEqual(["Second"])
  })

  it("keeps a fence whose blocks are separated by several blank lines", () => {
    const table = markedTableOf("scope", lines("in: A", "out: B", "", "", "", "in: C", "out: D"))

    expect(table?.rows).toHaveLength(2)
  })
})

describe("markedTableOf — what does not read", () => {
  it.each([
    ["a label that is not a table", "overview", "1. Part | gist"],
    ["an empty fence", "decision", ""],
    ["a misspelt key", "decision", lines("Source form", "chosen: A fence")],
    ["a scope line that is not a field", "scope", lines("in: A", "Something else")],
    ["a criterion verified some unknown way", "criteria", lines("It works", "how: vibes")],
    ["a criterion judged some unknown way", "criteria", lines("It works", "met: mostly")],
    ["a run with an unknown result", "runs", lines("lint", "result: flaky", "said: Exit 1.")],
    ["a run with no result", "runs", lines("lint", "said: Exit 0.")],
    [
      "a run's closing lines with a misspelt key",
      "runs",
      lines("lint", "result: passed", "", "cost: None.", "spent: $0"),
    ],
    ["an indented line with nothing above it", "files", "  a note"],
    ["a free table with five columns", "table", lines("A | B | C | D | E", "x")],
    ["a free table row with more cells than columns", "table", lines("A | B", "x", "  y", "  z")],
    ["a free table row naming an unknown icon", "table", lines("A | B", "[star] x")],
    ["a free table key naming an unknown icon", "table", lines("A | B", "key: star Starred", "x")],
    ["a free table with an empty head", "table", lines("A | | C", "x")],
    ["a free table with no rows", "table", "A | B"],
  ])("does not read %s", (_, label, source) => {
    expect(markedTableOf(label, source)).toBeUndefined()
  })
})
