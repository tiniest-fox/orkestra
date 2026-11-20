import { describe, expect, it } from "vitest"
import { makeGoal } from "../../fixtures"
import { goalOrder } from "./goalOrder"

describe("goalOrder", () => {
  it("puts a goal that owes the person first, then the going oldest first, then the ended newest first", () => {
    const live = { id: "t", title: "t", mode: "smart", status: "live" } as const
    const old = makeGoal({ id: "old", state: { _tag: "Watching" }, traks: [live], startedAt: 1 })
    // Watching with no trak open is idle, which is owed like a gate.
    const idle = makeGoal({ id: "idle", state: { _tag: "Watching" }, startedAt: 8 })
    const young = makeGoal({ id: "young", state: { _tag: "Composing" }, startedAt: 5 })
    const gate = makeGoal({ id: "gate", state: { _tag: "AtGate", gate: "plan" }, startedAt: 9 })
    const failed = makeGoal({
      id: "failed",
      state: { _tag: "Failed", reason: "lost" },
      startedAt: 7,
    })
    const done = makeGoal({ id: "done", state: { _tag: "Done" }, endedAt: 10 })
    const dropped = makeGoal({
      id: "dropped",
      state: { _tag: "Dropped", reason: "no" },
      endedAt: 20,
    })
    const stack = goalOrder([done, young, gate, dropped, old, idle, failed])
    expect(stack.going.map((g) => g.id)).toEqual(["failed", "idle", "gate", "old", "young"])
    expect(stack.rest.map((g) => g.id)).toEqual(["dropped", "done"])
  })
})
