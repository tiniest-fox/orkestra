import { describe, expect, it } from "vitest"
import type { GoalDetailDto } from "../../api/types"
import { ownersView } from "./ownership"

const detail = (over: Partial<GoalDetailDto["goal"]>): GoalDetailDto => ({
  goal: {
    id: "g",
    limits: {},
    state: { _tag: "AtGate", gate: "done" },
    paused: false,
    running: false,
    offers: ["Confirm", "Chat", "Retry"],
    plan: [],
    subgoalPlan: [],
    traks: [],
    subgoals: [],
    landed: 0,
    planned: 0,
    messages: [],
    dismissed: false,
    ...over,
  },
  log: [],
  transcript: [],
  settled: [],
  subgoals: [],
})

describe("a goal as its viewer sees it", () => {
  it("offers its owner every press the engine offers", () => {
    expect(ownersView(detail({})).goal.offers).toEqual(["Confirm", "Chat", "Retry"])
  })

  it("offers anyone else only the press that starts no turn", () => {
    expect(ownersView(detail({ ownership: { owner: "alice" } })).goal.offers).toEqual(["Confirm"])
  })
})
