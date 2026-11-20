// Tier 1: the mark inside the goal banner's ring, off the goal's state.

import { describe, expect, it } from "vitest"
import { ringMark } from "./ringMark"

const trak = (status: "live" | "landed" | "dropped") =>
  ({ id: "t", title: "t", mode: "smart", status }) as const

describe("ringMark", () => {
  it("turns for a composer turn, even with traks open, and stops for a pause", () => {
    expect(ringMark({ state: { _tag: "Composing" }, paused: false, traks: [] })).toBe("spin")
    expect(ringMark({ state: { _tag: "Composing" }, paused: false, traks: [trak("live")] })).toBe(
      "spin",
    )
    expect(ringMark({ state: { _tag: "Watching" }, paused: true, traks: [] })).toBe("pause")
  })

  it("holds still around the open-trak count while the goal waits on its traks", () => {
    const traks = [trak("live"), trak("live"), trak("landed"), trak("dropped")]
    expect(ringMark({ state: { _tag: "Watching" }, paused: false, traks })).toEqual({ open: 2 })
    expect(ringMark({ state: { _tag: "Watching" }, paused: false, traks: [] })).toEqual({
      open: 0,
    })
  })

  it("keeps the eye at a gate while paused, since the gate is still owed", () => {
    expect(ringMark({ state: { _tag: "AtGate", gate: "plan" }, paused: true, traks: [] })).toBe(
      "eye",
    )
  })

  it("says how a goal ended, or that its turn failed", () => {
    expect(ringMark({ state: { _tag: "Done" }, paused: false, traks: [] })).toBe("done")
    expect(
      ringMark({
        state: { _tag: "Dropped", reason: "no longer wanted" },
        paused: false,
        traks: [],
      }),
    ).toBe("dropped")
    expect(ringMark({ state: { _tag: "Failed", reason: "lost" }, paused: false, traks: [] })).toBe(
      "fail",
    )
  })
})
