// Tier 1: the words a goal's state is drawn in, on the banner and the goal's head.

import { describe, expect, it } from "vitest"
import type { GoalStateDto } from "../api/types"
import { goalAsk, goalEnding, goalWords, pastWhen } from "./goal"

const trak = (status: "live" | "landed" | "dropped") =>
  ({ id: "t", title: "t", mode: "smart", status }) as const

/** A goal in `state`, not paused and with no traks — all `goalAsk` reads beside the state. */
const goalIn = (state: GoalStateDto) => ({ state, paused: false, traks: [] })

const watchingWith = (paused: boolean, traks: ReturnType<typeof trak>[]) =>
  goalAsk({ state: { _tag: "Watching" }, paused, traks })

const watching = (traks: ReturnType<typeof trak>[]) =>
  goalWords({ state: { _tag: "Watching" }, paused: false, traks })

describe("goalWords", () => {
  it("lets a pause speak for a goal that is not at a gate", () => {
    expect(goalWords({ state: { _tag: "Watching" }, paused: true, traks: [] }).label).toBe("Paused")
    expect(goalWords({ state: { _tag: "Composing" }, paused: true, traks: [] }).label).toBe(
      "Paused",
    )
  })

  it("keeps a gate's words while paused, since the gate is still owed", () => {
    const words = goalWords({
      state: { _tag: "AtGate", gate: "escalation" },
      paused: true,
      traks: [],
    })
    expect(words).toEqual({ label: "Needs you", ink: "waiting" })
  })

  it("gives a composer turn the composer's ink, even with traks open", () => {
    const words = goalWords({
      state: { _tag: "Composing" },
      paused: false,
      file: "search",
      traks: [trak("live"), trak("live")],
    })
    expect(words).toEqual({ label: "Composing", ink: "composer" })
  })

  it("names the traks while the goal waits on them, and counts the open ones", () => {
    // A trak parked at a gate is still `live`, so it counts like any other open trak.
    expect(watching([trak("live"), trak("live"), trak("landed")])).toEqual({
      label: "2 traks running",
      ink: "working",
    })
    expect(watching([trak("live"), trak("dropped")]).label).toBe("1 trak running")
  })

  it("calls a goal idle when it watches with no trak open and no pause", () => {
    expect(watching([trak("landed")])).toEqual({ label: "Idle", ink: "waiting" })
    expect(watching([])).toEqual({ label: "Idle", ink: "waiting" })
  })
})

describe("goalAsk", () => {
  it("asks at every gate and after a failed turn, and nowhere else", () => {
    expect(goalAsk(goalIn({ _tag: "AtGate", gate: "plan" }))).toBe("Approve the plan")
    expect(goalAsk(goalIn({ _tag: "Failed", reason: "lost" }))).toBeDefined()
    expect(goalAsk(goalIn({ _tag: "Composing" }))).toBeUndefined()
    expect(goalAsk(goalIn({ _tag: "Done" }))).toBeUndefined()
  })

  it("asks of an idle goal, and not of one paused or with a trak running", () => {
    expect(watchingWith(false, [trak("landed")])).toBe(
      "Nothing is running. Tell the composer what next",
    )
    expect(watchingWith(true, [])).toBeUndefined()
    expect(watchingWith(false, [trak("live")])).toBeUndefined()
  })
})

describe("a goal with no file yet", () => {
  it("is drafting while it composes, and asks for the file at its first gate", () => {
    expect(goalWords({ state: { _tag: "Composing" }, paused: false, traks: [] }).label).toBe(
      "Drafting",
    )
    expect(
      goalWords({ state: { _tag: "Composing" }, paused: false, file: "search", traks: [] }).label,
    ).toBe("Composing")
    expect(goalAsk(goalIn({ _tag: "AtGate", gate: "file" }))).toBe("Approve the goal file")
  })
})

describe("a goal at rest", () => {
  it("says how it ended, and nothing for a goal still going", () => {
    expect(goalEnding({ state: { _tag: "Done" }, done: "All landed.", traks: [] })).toBe(
      "All landed.",
    )
    const live = { id: "t", title: "t", mode: "smart", status: "live" } as const
    expect(goalEnding({ state: { _tag: "Dropped", reason: "enough" }, traks: [live] })).toContain(
      "1 of its traks still run",
    )
    expect(goalEnding({ state: { _tag: "Watching" }, traks: [] })).toBeUndefined()
  })

  it("names a time this week by weekday, and an older one by date", () => {
    const at = new Date(2026, 9, 20, 14, 2).getTime()
    expect(pastWhen(at, at + 1000)).toBe("Tue 14:02")
    expect(pastWhen(at, at + 10 * 86_400_000)).toBe("20 Oct")
  })
})
