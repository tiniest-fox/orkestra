import { describe, expect, it } from "vitest"
import type { TrakStateDto, TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { makeParent, makeTrak } from "../../fixtures"
import { asTree, stillOut } from "./tree"

/** Positional because every case here is about who descends from whom, not about a trak. */
const trak = (
  id: string,
  parent?: TrakSummaryDto["parent"],
  state: TrakStateDto = { _tag: "AgentWorking", step: 0 },
): TrakSummaryDto =>
  makeTrak({ id, description: id, state, ...(parent === undefined ? {} : { parent }) })

const from = (id: string, child: number): TrakSummaryDto["parent"] => makeParent({ id, child })

/** Ids in render order, each row's band in brackets — the whole of what this decides. */
const rendered = (traks: readonly TrakSummaryDto[]): readonly string[] =>
  asTree(traks).map((row) =>
    row.band.length === 0 ? row.trak.id : `${row.trak.id} [${row.band.map((k) => k.id).join(" ")}]`,
  )

describe("asTree", () => {
  it("puts each child on its parent's band, in plan order rather than arrival order", () => {
    // As the store hands them over: by directory, so a child can arrive first and
    // the second child of the spawn before the first.
    expect(rendered([trak("b", from("p", 1)), trak("p"), trak("a", from("p", 0))])).toEqual([
      "p [a b]",
    ])
  })

  it("leaves a list with no children exactly as it arrived", () => {
    expect(rendered([trak("one"), trak("two")])).toEqual(["one", "two"])
  })

  it("shows a child whose parent is not in the list rather than dropping it", () => {
    // A wiped parent. The alternative is a trak that exists and is listed nowhere.
    expect(rendered([trak("orphan", from("gone", 0))])).toEqual(["orphan"])
  })

  it("keeps a failed and a finished piece on the band, and takes a merged one off", () => {
    // The three kinds the band's predicate exists to tell apart: one still owed to a
    // person, one that stopped, one that went in. Only the last leaves.
    expect(
      rendered([
        trak("p"),
        trak("failed", from("p", 0), { _tag: "Failed", kind: "provider", error: "exit 1" }),
        trak("finished", from("p", 1), { _tag: "Finished" }),
        trak("merged", from("p", 2), { _tag: "Merged", sha: "a91c04e" }),
      ]),
    ).toEqual(["p [failed finished]"])
  })

  it("leaves a spawn whose pieces have all landed with no band at all", () => {
    expect(
      rendered([trak("p"), trak("gone", from("p", 0), { _tag: "Merged", sha: "a91c04e" })]),
    ).toEqual(["p"])
  })

  it("keeps a piece on the band whatever section its own state would name", () => {
    // The whole of what running over the list rather than over one section buys: the
    // parent is parked, one piece is at a gate and one has finished, and none of the
    // three is a row of its own.
    expect(
      rendered([
        trak("p", undefined, { _tag: "AwaitingChildren", step: 0 }),
        trak("gated", from("p", 0), { _tag: "AwaitingHuman", step: 0, kind: "approval" }),
        trak("done", from("p", 1), { _tag: "Finished" }),
      ]),
    ).toEqual(["p [gated done]"])
  })
})

describe("stillOut", () => {
  it("is false for the three states that mean the piece went in, and true otherwise", () => {
    expect(stillOut({ _tag: "Merged", sha: "a91c04e" })).toBe(false)
    expect(stillOut({ _tag: "Closed" })).toBe(false)
    expect(stillOut({ _tag: "Abandoned", reason: "not worth it" })).toBe(false)
    // `Finished` is the one worth asserting: it reads like an ending and is a piece
    // waiting for a human to land it.
    expect(stillOut({ _tag: "Finished" })).toBe(true)
    expect(stillOut({ _tag: "Failed", kind: "provider", error: "exit 1" })).toBe(true)
    expect(stillOut({ _tag: "AwaitingHuman", step: 1, kind: "approval" })).toBe(true)
  })
})
