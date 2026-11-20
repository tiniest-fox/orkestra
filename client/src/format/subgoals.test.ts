// Tier 1: a parent's sub-goals in reading order, and its progress counting them.

import { describe, expect, it } from "vitest"
import { makeGoal } from "../fixtures"
import { familyProgress, liveSubgoals, pendingSubgoals } from "./subgoals"

const plan = (title: string) => ({ title, line: "", finished: "" })

describe("liveSubgoals", () => {
  it("puts a stuck sub-goal first, then one asking, then one running, and leaves out the ended", () => {
    const running = makeGoal({
      id: "r",
      state: { _tag: "Watching" },
      traks: [{ id: "t", title: "T", mode: "smart", status: "live" }],
    })
    const asking = makeGoal({ id: "a", state: { _tag: "AtGate", gate: "plan" } })
    const stuck = makeGoal({ id: "s", state: { _tag: "Failed", reason: "lost" } })
    const parent = makeGoal({
      subgoals: [
        { id: "r", title: "R", status: "live" },
        { id: "a", title: "A", status: "live" },
        { id: "s", title: "S", status: "live" },
        { id: "d", title: "D", status: "done" },
      ],
    })
    const ids = liveSubgoals(parent, [running, asking, stuck]).map((g) => g.id)
    expect(ids).toEqual(["s", "a", "r"])
  })
})

describe("pendingSubgoals and familyProgress", () => {
  it("counts a sub-goal of the plan as a segment, filled once it is done", () => {
    const parent = makeGoal({
      landed: 1,
      planned: 3,
      subgoalPlan: [plan("A"), plan("B"), plan("C")],
      subgoals: [
        { id: "a", title: "A", status: "done" },
        { id: "b", title: "B", status: "live" },
      ],
    })
    expect(pendingSubgoals(parent).map((p) => p.title)).toEqual(["C"])
    expect(familyProgress(parent)).toEqual({ landed: 2, planned: 6 })
  })
})
