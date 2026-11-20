/**
 * Tier 1 (`testing-tiers`): which rows the picker offers, and which one it shows.
 *
 * The two failures worth pinning are both silent. A third row on a position that committed
 * nothing asks the engine for a slice that does not exist and draws an empty state where
 * there is no news; and a selection that survives the row disappearing leaves the picker
 * with nothing lit above a diff, which reads as the pane having lost its place.
 *
 * **Every row here comes out of `mapRows`, and none is written by hand.** `slicesFor` reads
 * two fields off a `MapRow`, so a table of literals is a table of guesses about what the row
 * builder writes into them — and a guess that is wrong is a case bent to pass inside a suite
 * presented as exhaustive. One plan and one log produce every kind the drawer can stand on,
 * so a row that changes shape fails here rather than being asserted about twice.
 */

import { describe, expect, it } from "vitest"
import type { EventDto, PlanDto, TrakStateDto } from "../../../api/types"
import {
  makeAgentReturned,
  makeAgentStep,
  makeComposerReturned,
  makePlan,
  makeWorkCommitted,
} from "../../../fixtures"
import { type MapRow, mapRows } from "../family/rows"
import {
  ALL,
  UNCOMMITTED,
  drawsChangeMap,
  emptyWords,
  documentSlice,
  showing,
  type Slice,
  slicesFor,
} from "./slices"

const step = (agent: string): PlanDto["steps"][number] =>
  makeAgentStep({ agent, instruction: `do ${agent}` })

/** One spawn entry, one piece per agent named, each piece a plan of one step. */
const spawnOf = (...agents: readonly string[]): PlanDto["steps"][number] => ({
  type: "spawn",
  instruction: "in parallel",
  children: agents.map((agent) => [{ agent, instruction: `do ${agent}` }]),
})

/**
 * One plan holding every position kind the drawer can stand on, and a log where two of
 * them have kept something.
 *
 * The two spawns are the point: they differ only in whether their pieces have joined, which
 * is the whole of what decides the picker at a spawn. Three pieces at the first so that its
 * label separates the position's index from the count.
 */
const PLAN: PlanDto = makePlan({
  steps: [
    { type: "compose" },
    step("builder"),
    spawnOf("build", "test", "docs"),
    spawnOf("probe", "sweep"),
    { type: "compose", why: { _tag: "Replanned", step: 3, reason: "the shape moved" } },
    step("reviewer"),
  ],
})

/**
 * What the engine wrote: the first plan, step 1's turn and its commit, and the commit
 * `ChildrenJoined` keeps at the *spawn's own position* — `decide.ts` sends a join through
 * `keepStep` exactly as it sends a turn, so a joined spawn's sha is written the same way a
 * step's is.
 */
const LOG: readonly EventDto[] = [
  makeComposerReturned({ sessionId: "s-plan" }),
  makeAgentReturned({ step: 1, sessionId: "s-1" }),
  makeWorkCommitted({ step: 1, sha: "a1c0ffe" }),
  makeWorkCommitted({ step: 2, sha: "b2dfeed" }),
  makeComposerReturned({ sessionId: "s-plan-2" }),
]

/** No unattended gates and no library: neither reaches anything `slicesFor` reads. */
const rowsAt = (state: TrakStateDto): readonly MapRow[] =>
  mapRows(state, LOG, PLAN, [], [], [], undefined)

/** Throws rather than answering `undefined`, so a plan that stops producing a row fails
 *  here instead of quietly asserting about nothing. */
const rowKeyed = (rows: readonly MapRow[], key: string): MapRow => {
  const found = rows.find((row) => row.key === key)
  if (found === undefined) throw new Error(`no row keyed ${key}`)
  return found
}

/**
 * One row of the picker at a position, by the `at` it carries. Throws rather than answering
 * `undefined`, so a row that stops being offered fails here instead of quietly asserting
 * about the wording nothing-is-offered falls back to.
 */
const sliceAt = (row: MapRow | undefined, at: string): Slice => {
  const found = slicesFor(row).find((slice) => slice.at === at)
  if (found === undefined) throw new Error(`no slice at ${at}`)
  return found
}

const live = rowsAt({ _tag: "AgentWorking", step: 5 })
const merged = rowsAt({ _tag: "Merged", sha: "9f31c07" })
const held = rowsAt({ _tag: "Finished" })

/**
 * Every kind of row, and whether the picker offers its own slice.
 *
 * A step with no sha is one input however it got there — running, unrun, or run and kept
 * nothing all reach `slicesFor` as the same two fields — so it is one row here rather than
 * three names for it.
 */
const KINDS: readonly { readonly what: string; readonly row: MapRow; readonly offers: boolean }[] =
  [
    { what: "a step that committed", row: rowKeyed(live, "step:1"), offers: true },
    { what: "a spawn whose pieces have joined", row: rowKeyed(live, "step:2"), offers: true },
    { what: "a spawn whose pieces have not joined", row: rowKeyed(live, "step:3"), offers: false },
    { what: "a step with no commit of its own", row: rowKeyed(live, "step:5"), offers: false },
    { what: "the first compose", row: rowKeyed(live, "compose:0"), offers: false },
    { what: "a re-compose", row: rowKeyed(live, "compose:4"), offers: false },
    { what: "the ending of a merged trak", row: rowKeyed(merged, "end"), offers: false },
    { what: "the ending of a trak still held", row: rowKeyed(held, "end"), offers: false },
  ]

describe("the rows this file is written over", () => {
  it("are the map's own, including the two the picker used to get wrong", () => {
    // A spawn is `kind: "step"` and carries a sha once its pieces have joined — a table
    // that wrote `sha: undefined` there was asserting about a row the map never produces.
    expect(rowKeyed(live, "step:2")).toMatchObject({
      kind: "step",
      title: "3 pieces",
      sha: "b2dfeed",
    })
    expect(rowKeyed(live, "step:3")).toMatchObject({
      kind: "step",
      title: "2 pieces",
      sha: undefined,
    })
    // And the ending carries the merge commit in the slot a step's commit takes, at `-1`.
    expect(rowKeyed(merged, "end")).toMatchObject({ kind: "end", at: -1, sha: "9f31c07" })
  })
})

describe("slicesFor", () => {
  it("offers the two fixed rows with no position at all", () => {
    expect(slicesFor(undefined).map((slice) => slice.at)).toEqual([ALL, UNCOMMITTED])
  })

  it("names a step's row by its own index and the agent that ran it", () => {
    expect(slicesFor(rowKeyed(live, "step:1"))[2]).toEqual({
      at: "1",
      label: "1 · builder",
      kind: "step",
    })
  })

  it("names a spawn's row by its position and how many pieces ran there", () => {
    // The index and the count are two different numbers, and the label carries both. The
    // kind is the other half: `at` is a number at both, so it is the only thing that tells
    // a join from one agent's turn.
    expect(slicesFor(rowKeyed(live, "step:2"))[2]).toEqual({
      at: "2",
      label: "2 · 3 pieces",
      kind: "join",
    })
  })

  it.each(KINDS)("offers a third row for $what: $offers", ({ row, offers }) => {
    expect(slicesFor(row)).toHaveLength(offers ? 3 : 2)
  })

  it("never offers a slice the engine cannot resolve", () => {
    // `-1` is not a position, and the sha beside it is a commit on the *host* branch
    // rather than on this trak's.
    for (const { row } of KINDS) expect(slicesFor(row).map((slice) => slice.at)).not.toContain("-1")
  })
})

describe("showing", () => {
  it("keeps a row the picker still offers", () => {
    expect(showing(slicesFor(rowKeyed(live, "step:1")), "1")).toBe("1")
  })

  it("falls back to All changes when the picked row is gone", () => {
    expect(showing(slicesFor(rowKeyed(live, "compose:0")), "1")).toBe(ALL)
  })

  it("falls back with nothing picked", () => {
    expect(showing(slicesFor(rowKeyed(live, "step:1")), undefined)).toBe(ALL)
  })
})

describe("emptyWords", () => {
  const stepSlice = sliceAt(rowKeyed(live, "step:1"), "1")
  const joinSlice = sliceAt(rowKeyed(live, "step:2"), "2")

  it("says something different for each of the four, because they are not the same news", () => {
    const titles = [
      sliceAt(undefined, ALL),
      sliceAt(undefined, UNCOMMITTED),
      stepSlice,
      joinSlice,
    ].map((s) => emptyWords(s).title)

    expect(new Set(titles).size).toBe(4)
    expect(emptyWords(sliceAt(undefined, UNCOMMITTED)).title).toBe("Nothing uncommitted")
  })

  it("does not call a spawn's join one agent's turn", () => {
    // The two rows carry a position index each, so a wording answered from the `at` string
    // gave this one the step's sentence — naming one agent where three ran.
    expect(emptyWords(joinSlice).title).toBe("These pieces changed no files")
  })

  it("words a row the picker is not offering as the slice the picker falls back to", () => {
    expect(emptyWords(undefined)).toEqual(emptyWords(sliceAt(undefined, ALL)))
  })
})

describe("documentSlice", () => {
  it("joins a step's document to the step's own commit once it has one", () => {
    expect(documentSlice(rowKeyed(live, "step:1"))).toEqual({ at: "1", name: "step 1 · builder" })
  })

  it("joins the live step's document to the uncommitted work, before its commit exists", () => {
    // `AgentWorking` at 5 is the live row with no commit of its own.
    expect(documentSlice(rowKeyed(live, "step:5"))).toEqual({
      at: UNCOMMITTED,
      name: "the uncommitted work",
    })
    expect(
      documentSlice(
        rowKeyed(rowsAt({ _tag: "AwaitingHuman", step: 5, kind: "approval" }), "step:5"),
      ),
    ).toMatchObject({ at: UNCOMMITTED })
  })

  it("joins nothing where the uncommitted work would be some later step's", () => {
    // Step 5 is done and kept nothing; the trak has finished past it.
    expect(documentSlice(rowKeyed(held, "step:5"))).toBeUndefined()
  })

  it.each([
    ["a joined spawn", rowKeyed(live, "step:2")],
    ["a compose", rowKeyed(live, "compose:0")],
    ["the ending", rowKeyed(merged, "end")],
    ["no position", undefined],
  ])("joins nothing at %s", (_, row) => {
    expect(documentSlice(row)).toBeUndefined()
  })
})

/** What a position filed, as one document whose Changes section is `text`. */
const filed = (text: string) => [
  makeAgentReturned({ output: { type: "artifact", sections: { Changes: text } } }).output,
]

describe("drawsChangeMap", () => {
  it("is true where a section holds a changes fence", () => {
    expect(drawsChangeMap(filed("Intro.\n\n```changes\n## A\n~ a.ts\n```"))).toBe(true)
  })

  it("is false for a table, a mention of the word, and a document with no artifact", () => {
    expect(drawsChangeMap(filed("```table\nA | B\n```"))).toBe(false)
    expect(drawsChangeMap(filed("the `changes` figure"))).toBe(false)
    expect(drawsChangeMap([{ type: "message", text: "```changes\n```" }])).toBe(false)
  })
})
