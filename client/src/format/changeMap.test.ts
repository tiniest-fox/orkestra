import { describe, expect, it } from "vitest"
import type { DiffFile } from "./changeMap"
import { bucketTotals, joinChanges, parseChanges, UNEXPLAINED } from "./changeMap"

const lines = (...xs: readonly string[]): string => xs.join("\n")

/** The grammar's own example, as `figure-changes.md` teaches it to a build turn. */
const EXAMPLE = lines(
  "## The figure key",
  "why: an output section can declare a figure, and the loader refuses a name it does not know",
  "~ app/agents/types.ts",
  "  FIGURES, the names a section may declare",
  "~ app/agents/load.ts",
  "  parses figure: and checks it against FIGURES at load",
  "",
  "## The marked table",
  "why: every table fence draws as one component configured per shape",
  "+ web/format/markedTable.ts",
  "  reads the table fences into one configuration, or refuses so the source draws",
  "> web/components/InlineCode.tsx -> web/components/CodeSpans.tsx",
  "  code spans and bold runs, now shared with the map",
  "- web/components/FenceTable.tsx",
  "  the plain table fences drew before; nothing imports it now",
)

const diffFile = (path: string, over: Partial<DiffFile> = {}): DiffFile => ({
  path,
  change: "modified",
  additions: 3,
  deletions: 1,
  ...over,
})

describe("parseChanges", () => {
  it("reads the grammar's example: buckets, their whys, kinds, a rename and each file's why", () => {
    const buckets = parseChanges(EXAMPLE)

    expect(buckets?.map((b) => [b.name, b.why])).toEqual([
      [
        "The figure key",
        "an output section can declare a figure, and the loader refuses a name it does not know",
      ],
      ["The marked table", "every table fence draws as one component configured per shape"],
    ])
    expect(buckets?.[1]?.entries).toEqual([
      {
        kind: "added",
        path: "web/format/markedTable.ts",
        oldPath: undefined,
        why: "reads the table fences into one configuration, or refuses so the source draws",
      },
      {
        kind: "renamed",
        path: "web/components/CodeSpans.tsx",
        oldPath: "web/components/InlineCode.tsx",
        why: "code spans and bold runs, now shared with the map",
      },
      {
        kind: "deleted",
        path: "web/components/FenceTable.tsx",
        oldPath: undefined,
        why: "the plain table fences drew before; nothing imports it now",
      },
    ])
  })

  it("reads a file with no reason, and a bucket with no why, rather than refusing them", () => {
    const buckets = parseChanges(lines("## Tests", "+ a.test.ts"))
    expect(buckets?.[0]?.why).toBeUndefined()
    expect(buckets?.[0]?.entries[0]?.why).toBeUndefined()
  })

  it.each([
    ["nothing at all", ""],
    ["a file before any bucket", "~ a.ts"],
    ["a bucket with no files", lines("## Empty", "why: nothing")],
    ["an unknown mark", lines("## A", "* a.ts")],
    ["a rename with no arrow", lines("## A", "> a.ts")],
    ["an arrow on a file that is not a rename", lines("## A", "~ a.ts -> b.ts")],
    ["a why after a file", lines("## A", "~ a.ts", "why: late")],
    ["a reason with no file above it", lines("## A", "  floating")],
    ["a bucket named twice", lines("## A", "~ a.ts", "## A", "~ b.ts")],
    ["a path in two buckets", lines("## A", "~ a.ts", "## B", "~ a.ts")],
  ])("refuses %s, so the source draws", (_, source) => {
    expect(parseChanges(source)).toBeUndefined()
  })
})

describe("joinChanges", () => {
  const buckets = parseChanges(EXAMPLE) ?? []

  it("draws what the agent wrote and flags nothing where there is no diff", () => {
    const drawn = joinChanges(buckets, undefined)
    expect(drawn.map((b) => b.name)).toEqual(["The figure key", "The marked table"])
    expect(drawn.flatMap((b) => b.files).every((f) => !f.missing && f.counts === undefined)).toBe(
      true,
    )
  })

  it("counts a file the diff holds, matching a rename on its new path, and warns on one it lacks", () => {
    const drawn = joinChanges(buckets, {
      files: [
        diffFile("app/agents/types.ts", { additions: 27, deletions: 0 }),
        diffFile("web/components/CodeSpans.tsx", {
          change: "renamed",
          oldPath: "web/components/InlineCode.tsx",
        }),
      ],
      complete: true,
    })
    const [key, table] = drawn
    expect(key?.files[0]?.counts).toEqual({ added: 27, deleted: 0 })
    expect(key?.files[1]).toMatchObject({ path: "app/agents/load.ts", missing: true })
    expect(table?.files[1]).toMatchObject({ kind: "renamed", counts: { added: 3, deleted: 1 } })
    expect(table?.files[0]?.missing).toBe(true)
  })

  it("gathers the changed files nobody named into a last Unexplained bucket", () => {
    const drawn = joinChanges(buckets, {
      files: [diffFile("app/agents/types.ts"), diffFile("test/stray.ts", { change: "added" })],
      complete: true,
    })
    expect(drawn.at(-1)).toMatchObject({
      name: UNEXPLAINED,
      unexplained: true,
      why: undefined,
      files: [{ path: "test/stray.ts", kind: "added", why: undefined }],
    })
  })

  it("warns about nothing and adds no Unexplained bucket where the diff was capped", () => {
    const drawn = joinChanges(buckets, {
      files: [diffFile("app/agents/types.ts"), diffFile("test/stray.ts")],
      complete: false,
    })
    expect(drawn.map((b) => b.name)).toEqual(["The figure key", "The marked table"])
    expect(drawn.flatMap((b) => b.files).some((f) => f.missing)).toBe(false)
    // A file the capped list does hold still counts.
    expect(drawn[0]?.files[0]?.counts).toEqual({ added: 3, deleted: 1 })
  })
})

describe("bucketTotals", () => {
  it("counts kinds always, lines only where a file was found, and the missing ones", () => {
    const [key] = joinChanges(parseChanges(EXAMPLE) ?? [], {
      files: [diffFile("app/agents/types.ts", { additions: 5, deletions: 2 })],
      complete: true,
    })
    expect(bucketTotals(key?.files ?? [])).toEqual({
      kinds: { added: 0, modified: 2, deleted: 0, renamed: 0 },
      lines: { added: 5, deleted: 2 },
      missing: 1,
    })
  })
})
