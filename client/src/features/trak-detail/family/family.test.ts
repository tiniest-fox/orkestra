/**
 * Tier 1: the family map, with no React and no fetch.
 *
 * Two things are worth pinning here and neither can be read off a render: that the walk
 * visits exactly what the map draws, in the order the arrows are supposed to move — the
 * plan, and at a spawn each piece's steps in turn — and that a position is a key rather
 * than a place in that walk, because a map that can select outside the walk once dropped
 * a reader into a stranger's conversation.
 */

import { describe, expect, it } from "vitest"
import type { PlanDto, TrakDetailDto, TrakStateDto } from "../../../api/types"
import {
  makeAgentReturned,
  makeAgentStep,
  makeChildrenSpawned,
  makeComposerReturned,
  makeDetail,
  makeSession,
  makeSpawned,
  makeTool,
  makeTrakCreated,
  makeWaiting,
  makeWorkCommitted,
} from "../../../fixtures"
import {
  type Band,
  childIds,
  familyBands,
  familyFocus,
  parentId,
  resolveSpot,
  restingFor,
  walk,
} from "./family"

const TITLE = "Add a read-only client"

/** No clock among these waits, so any instant does. */
const NOW = 0

const step = (agent: string, instruction: string): PlanDto["steps"][number] =>
  makeAgentStep({ agent, instruction })

/** compose · a step · a spawn of two · a step. The shape the whole file is about. */
const parent = (over: Partial<TrakDetailDto> = {}): TrakDetailDto =>
  makeDetail({
    id: "p",
    description: TITLE,
    state: { _tag: "AwaitingChildren", step: 2 },
    plan: {
      title: TITLE,
      steps: [
        { type: "compose" },
        step("planner", "sketch the routes"),
        {
          type: "spawn",
          instruction: "build both halves",
          children: [
            [{ agent: "builder", instruction: "the band in the list" }],
            [{ agent: "builder", instruction: "the family detail" }],
          ],
        },
        step("reviewer", "read the diff"),
      ],
    },
    log: [
      makeTrakCreated({ description: TITLE }),
      makeComposerReturned({
        sessionId: "s-plan",
        output: { type: "proposal", title: TITLE, steps: [] },
      }),
      makeAgentReturned({ step: 1, sessionId: "s-1" }),
      makeChildrenSpawned({ step: 2, ids: ["c1", "c2"] }),
    ],
    ...over,
  })

/** A piece, born holding the plan its parent's composer wrote — so no compose entry. */
const piece = (id: string, first: string, second: string, state?: TrakStateDto): TrakDetailDto =>
  makeDetail({
    id,
    description: TITLE,
    state: state ?? { _tag: "Finished" },
    plan: { title: id, steps: [step("builder", first), step("builder", second)] },
    log: [
      makeTrakCreated({ description: id }),
      makeAgentReturned({ step: 0, sessionId: `${id}-0` }),
      // A piece that built half a feature kept something, which is what makes its ending
      // row read *Ready to merge* — the caption every case here is written against.
      makeWorkCommitted({ step: 0, sha: `${id}-sha` }),
    ],
    transcript: [
      makeSpawned({ pid: 1, position: 0 }),
      makeSession({ id: `${id}-0`, position: 0 }),
      makeTool({ detail: `${id}-read.ts`, position: 0 }),
    ],
  })

const both = new Map([
  ["c1", piece("c1", "the band", "its tests")],
  ["c2", piece("c2", "the detail", "its tests")],
])

const none = new Map<string, TrakDetailDto>()

/** One position of the family map by key, for the cases that are about a particular row. */
const at = (bands: readonly Band[], key: string) => walk(bands).find((spot) => spot.key === key)

describe("childIds", () => {
  it("names every piece the log put out, and nothing on a trak that spawned none", () => {
    expect(childIds(parent().log)).toEqual(["c1", "c2"])
    expect(childIds([makeTrakCreated({ description: "x" })])).toEqual([])
  })
})

describe("familyBands", () => {
  it("gathers a spawn's pieces onto its entry and leaves every other entry a row", () => {
    const bands = familyBands(parent(), both, [], NOW)

    expect(bands.map((b) => b.spot.key)).toEqual(["compose:0", "step:1", "step:2", "step:3"])
    expect(bands.map((b) => b.columns.length)).toEqual([0, 0, 2, 0])
  })

  it("gives a column that piece's own steps, and no composer row above them", () => {
    // A piece is born holding its plan, so a compose row on a column would say it was
    // still working out what to do.
    const columns = familyBands(parent(), both, [], NOW)[2]?.columns ?? []

    expect(columns[0]?.spots.map((s) => s.row.caption)).toEqual([
      "the band",
      "its tests",
      "Ready to merge",
    ])
    expect(columns.flatMap((c) => c.spots).some((s) => s.row.kind === "compose")).toBe(false)
  })

  it("qualifies a piece's continues target exactly as it qualifies the spot's own key", () => {
    // Left bare, `step:0` is a key on the *parent's* walk, so the notice's press would
    // step a reader out of the piece and onto the parent's row of the same number.
    const talking = piece("c1", "the band", "its tests")
    const joined: TrakDetailDto = {
      ...talking,
      plan: {
        title: "c1",
        steps: [
          step("builder", "the band"),
          makeAgentStep({ agent: "builder", instruction: "its tests", continues: "0-builder" }),
        ],
      },
      transcript: [
        ...talking.transcript,
        // The same session at the second position — the splice a `--resume` writes.
        makeSpawned({ pid: 2, position: 1 }),
        makeSession({ id: "c1-0", position: 1 }),
      ],
    }
    const bands = familyBands(parent(), new Map([...both, ["c1", joined]]), [], NOW)

    expect(at(bands, "c1:step:1")?.row.continues).toEqual({
      key: "0-builder",
      to: "c1:step:0",
      fresh: false,
    })
  })

  it("gives a finished piece its ending row, which is where it is merged from", () => {
    // Dropped from a column while a piece was landed on its own page, and back with that
    // page: the pane's ending is built from the trak owning the position now, so a piece's
    // last row is the only place its Merge can be.
    const columns = familyBands(parent(), both, [], NOW)[2]?.columns ?? []

    expect(columns[0]?.spots.at(-1)?.key).toBe("c1:end")
    expect(columns[0]?.spots.at(-1)?.trak.id).toBe("c1")
  })

  it("gives a piece still working no ending row, because its plan has not run out", () => {
    const working = new Map([
      ["c1", piece("c1", "the band", "its tests", { _tag: "AgentWorking", step: 1 })],
      ["c2", piece("c2", "the detail", "its tests", { _tag: "AgentWorking", step: 1 })],
    ])
    const columns = familyBands(parent(), working, [], NOW)[2]?.columns ?? []

    expect(columns.flatMap((c) => c.spots).some((s) => s.row.kind === "end")).toBe(false)
  })

  it("answers a piece's step out of that piece's own log, never the parent's", () => {
    const spot = familyBands(parent(), both, [], NOW)[2]?.columns[1]?.spots[0]

    expect(spot?.trak.id).toBe("c2")
    // Its own transcript, cut into its own turns — the parent has none of these lines.
    expect(spot?.row.turns.flatMap((t) => t.entries).some((e) => "detail" in e)).toBe(true)
  })

  it("draws every piece whatever it became, merged ones included", () => {
    // The columns *are* the plan entry, so a spawn past the join still has them. Hiding
    // the ones that have landed is the list's rule, where the band is a window.
    const landed = new Map([
      ["c1", piece("c1", "the band", "its tests", { _tag: "Merged", sha: "abc1234" })],
      ["c2", piece("c2", "the detail", "its tests", { _tag: "Closed" })],
    ])
    expect(
      familyBands(parent({ state: { _tag: "Finished" } }), landed, [], NOW)[2]?.columns,
    ).toHaveLength(2)
  })

  it("moves a held piece's ending inside its column, and leaves the parent's at its foot", () => {
    // Each piece owns its ending. The held one stands before the entry the wait holds;
    // the parent, which waits on nothing, ends where it always did.
    const held = new Map([
      ["c1", piece("c1", "the band", "its tests")],
      [
        "c2",
        {
          ...piece("c2", "the detail", "its tests"),
          waiting: makeWaiting({ step: 1, name: "deployed" }),
        },
      ],
    ])
    const bands = familyBands(parent({ state: { _tag: "Finished" } }), held, [], NOW)
    const columns = bands[2]?.columns ?? []
    // `piece` ran its first step only, so its second stands unrun above the ending.
    expect(columns[0]?.spots.map((s) => s.key)).toEqual(["c1:step:0", "c1:step:1", "c1:end"])
    expect(columns[1]?.spots.map((s) => s.key)).toEqual(["c2:step:0", "c2:end", "c2:step:1"])
    expect(walk(bands).at(-1)?.key).toBe("end")
  })

  it("keeps the spawn's own row while nothing has answered for its pieces", () => {
    // The position stays on the map and on the walk rather than vanishing until the
    // fetches land, and this is also what a piece that cannot be reached falls back to.
    const bands = familyBands(parent(), none, [], NOW)

    expect(bands[2]?.columns).toEqual([])
    expect(bands[2]?.spot.row.title).toBe("2 pieces")
  })
})

describe("walk", () => {
  it("goes depth first: the plan in order, and at the spawn each piece in turn", () => {
    // Both pieces are `Finished`, so each column ends on its own ending row — the position
    // its Merge lives at, and one the arrows have to reach like any other.
    expect(walk(familyBands(parent(), both, [], NOW)).map((s) => s.key)).toEqual([
      "compose:0",
      "step:1",
      "c1:step:0",
      "c1:step:1",
      "c1:end",
      "c2:step:0",
      "c2:step:1",
      "c2:end",
      "step:3",
    ])
  })
})

describe("familyFocus", () => {
  const bands = familyBands(parent(), both, [], NOW)

  it("opens at the first step of the first piece where the parent is standing at a spawn", () => {
    // `AwaitingChildren{step: 2}`. A spawn has no position of its own to stand at.
    expect(familyFocus(bands, parent().state, undefined).spot?.key).toBe("c1:step:0")
  })

  it("steps into a spawn and out the other side, forward and back", () => {
    expect(familyFocus(bands, parent().state, "step:1").next).toBe("c1:step:0")
    // Through each piece's own ending on the way, which is a position like any other.
    expect(familyFocus(bands, parent().state, "c1:step:1").next).toBe("c1:end")
    expect(familyFocus(bands, parent().state, "c1:end").next).toBe("c2:step:0")
    expect(familyFocus(bands, parent().state, "c2:end").next).toBe("step:3")
    expect(familyFocus(bands, parent().state, "step:3").prev).toBe("c2:end")
    expect(familyFocus(bands, parent().state, "c2:step:0").prev).toBe("c1:end")
  })

  it("has nothing either side at the ends of the walk", () => {
    expect(familyFocus(bands, parent().state, "compose:0").prev).toBeUndefined()
    expect(familyFocus(bands, parent().state, "step:3").next).toBeUndefined()
  })

  it("walks onto the ending, and off the last plan entry to reach it", () => {
    // The ending is a band like any other, which is the whole reason the walk needs no
    // case for it — but it is the one row with no plan entry behind it, so nothing else
    // here would notice if it fell out of the arrows.
    const finished = familyBands(parent({ state: { _tag: "Finished" } }), both, [], NOW)
    const state: TrakStateDto = { _tag: "Finished" }
    expect(familyFocus(finished, state, undefined).spot?.key).toBe("end")
    expect(familyFocus(finished, state, "step:3").next).toBe("end")
    expect(familyFocus(finished, state, "end").prev).toBe("step:3")
    expect(familyFocus(finished, state, "end").next).toBeUndefined()
  })

  it("rests on a piece where the trak stopped at a spawn, which has no row of its own", () => {
    // The shape a merge-time `WorktreeFailed` lands in, and `.orkestra/.database` holds it
    // twice: the failure blames no entry, so `opensAt` falls through to the last plan
    // entry — and where that is the spawn, the band's spots belong to its pieces. So
    // `resting` is a key this trak does not own, which is not a gap in the walk: it is
    // what `DrawerPane` places the failure notice by.
    const endsInSpawn = parent({
      state: { _tag: "Failed", error: "fatal: worktree already exists", kind: "worktree" },
      plan: {
        title: TITLE,
        steps: [
          { type: "compose" },
          step("planner", "sketch the routes"),
          {
            type: "spawn",
            instruction: "build both halves",
            children: [
              [{ agent: "builder", instruction: "the band in the list" }],
              [{ agent: "builder", instruction: "the family detail" }],
            ],
          },
        ],
      },
    })
    const { resting, spot } = familyFocus(
      familyBands(endsInSpawn, both, [], NOW),
      endsInSpawn.state,
      undefined,
    )

    expect(resting).toBe("c1:step:0")
    expect(spot?.trak.id).toBe("c1")
  })

  it("holds a pick on a piece across a poll, and falls back when it goes away", () => {
    // A key, never an index: the map may point anywhere, and the walk is only what the
    // arrows follow. A revision replaces the plan's unrun tail, which is ordinary.
    expect(familyFocus(bands, parent().state, "c2:step:1").spot?.trak.id).toBe("c2")
    expect(familyFocus(bands, parent().state, "c9:step:4").spot?.key).toBe("c1:step:0")
  })
})

/**
 * Which row of a trak a notice saying *this stopped* belongs on, asked about whichever trak
 * owns the position on screen. It is what gives a piece of a spawn its own sentence and its
 * own press, in the parent's drawer and without a page of its own.
 */
describe("restingFor", () => {
  it("answers with the piece's own position at a piece's row, whatever the parent is doing", () => {
    // Both pieces are `Finished`, so each rests on its own ending row — and the parent's
    // answer, handed in, is a plan entry of its own further down.
    const bands = familyBands(parent(), both, [], NOW)

    expect(restingFor(bands, at(bands, "c1:step:0"), "step:3")).toBe("c1:end")
  })

  it("gives each piece its own, so one stopped piece's notice is not drawn on another", () => {
    const mid = new Map([
      ["c1", piece("c1", "the band", "its tests", { _tag: "AgentWorking", step: 1 })],
      ["c2", piece("c2", "the detail", "its tests", { _tag: "AgentWorking", step: 0 })],
    ])
    const bands = familyBands(parent(), mid, [], NOW)

    expect(restingFor(bands, at(bands, "c1:step:0"), undefined)).toBe("c1:step:1")
    expect(restingFor(bands, at(bands, "c2:step:1"), undefined)).toBe("c2:step:0")
  })

  it("hands the page trak's own answer back at a row of the parent's", () => {
    // `familyFocus` computes that one over the whole walk, which at a spawn is a key the
    // parent does not own — so it cannot be re-derived from a column and is not tried.
    const bands = familyBands(parent(), both, [], NOW)

    expect(restingFor(bands, at(bands, "step:1"), "step:3")).toBe("step:3")
    expect(restingFor(bands, undefined, "step:3")).toBe("step:3")
  })
})

/**
 * What a `?spot=` in the URL names, and it is the whole of why the param takes two forms:
 * the list can only contribute a child's trak id, and only the parent can turn one into a
 * position. Nothing parses a key back apart — a bare id is *matched* against the columns.
 */
describe("resolveSpot", () => {
  const bands = familyBands(parent(), both, [], NOW)

  it("hands a position key straight back, which is what the rail and the map contribute", () => {
    expect(resolveSpot(bands, "c2:step:1")).toBe("c2:step:1")
    expect(resolveSpot(bands, "step:3")).toBe("step:3")
  })

  it("turns a bare child id into where that piece is standing", () => {
    // Both pieces are `Finished`, so each opens on its own ending — the position with
    // something to do at it, which is the same question its own drawer used to answer.
    expect(resolveSpot(bands, "c1")).toBe("c1:end")
  })

  it("takes a working piece to the step it is at, not to its first", () => {
    const mid = new Map([
      ["c1", piece("c1", "the band", "its tests", { _tag: "AgentWorking", step: 1 })],
      ["c2", piece("c2", "the detail", "its tests", { _tag: "AgentWorking", step: 1 })],
    ])
    expect(resolveSpot(familyBands(parent(), mid, [], NOW), "c1")).toBe("c1:step:1")
  })

  it("answers nothing for a piece nothing has answered for yet, and for a stale key", () => {
    // Ordinary, both of them: the first is every frame before `useFamily` lands, and the
    // second is a key from a plan tail a revision replaced. The caller falls back to
    // wherever the trak is rather than treating either as an error.
    expect(resolveSpot(familyBands(parent(), none, [], NOW), "c1")).toBeUndefined()
    expect(resolveSpot(bands, "c9:step:4")).toBeUndefined()
  })
})

/**
 * Whether the trak in the drawer is itself a piece of another, and whose. Read off
 * `TrakCreated` rather than off a field on the wire, because `TrakDetailDto` deliberately
 * has none — the summary carries the relationship, since the list is the surface that draws
 * it.
 */
describe("parentId", () => {
  it("names the trak a piece was spawned by, and nothing for one somebody started", () => {
    expect(
      parentId([
        makeTrakCreated({
          description: "wire the band",
          parent: { id: "p", step: 2, child: 0, depth: 1 },
        }),
      ]),
    ).toBe("p")
    expect(parentId([makeTrakCreated({ description: "add a client" })])).toBeUndefined()
    expect(parentId([])).toBeUndefined()
  })
})
