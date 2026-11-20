/**
 * Tier 1: what the usage cell says. Pace is measured at the reading — fill and tick
 * describe one moment — and tone follows pace rather than a fixed threshold.
 */

import { describe, expect, it } from "vitest"
import type { PlanWindowDto } from "../../../api/types"
import { makeCliUsage } from "../../../fixtures"
import {
  cellView,
  clockWords,
  tabDim,
  tabLabel,
  unavailableWords,
  windowLine,
  windowView,
} from "./usageView"

const M = 60_000
const H = 60 * M
const D = 24 * H
const NOW = new Date(2026, 9, 30, 14, 0).getTime()

const five = (used: number, resetsIn: number): PlanWindowDto => ({
  kind: "five_hour",
  utilization: used,
  resetsAt: NOW + resetsIn,
})
const week = (used: number, resetsIn: number, model?: string): PlanWindowDto => ({
  kind: "seven_day",
  utilization: used,
  resetsAt: NOW + resetsIn,
  ...(model === undefined ? {} : { model }),
})

const read = (age: number, windows: readonly PlanWindowDto[], polling = false) =>
  makeCliUsage({ polling, usage: { _tag: "Read", at: NOW - age, windows } })

describe("a window's pace and tone", () => {
  it.each([
    ["under pace", 10, 2.5 * H, "under", "neutral"],
    ["on pace", 50, 2.5 * H, "on", "neutral"],
    ["ahead of pace", 55, 3 * H, "ahead", "waiting"],
    ["far ahead", 80, 3 * H, "far", "bad"],
    ["at 95% though on pace", 96, 0.1 * H, "on", "bad"],
  ] as const)("%s", (_, used, resetsIn, pace, tone) => {
    const w = windowView(five(used, resetsIn), NOW, NOW, "claude")
    expect([w.pace, w.tone]).toEqual([pace, tone])
  })

  it("is waiting when on pace yet projected to run out before it resets", () => {
    // 56% used with half the week gone is on pace, and at that rate runs out early.
    const close = windowView(week(56, 3.5 * D), NOW, NOW, "claude")
    expect([close.pace, close.tone, close.runsOutAt !== undefined]).toEqual(["on", "waiting", true])
  })

  it("places the tick at the time gone when the reading was taken, not at now", () => {
    const reading = NOW - 2 * H
    // Reset at 16:00; read at 12:00, when 1h of the five had gone.
    const w = windowView(five(50, 2 * H), reading, NOW, "claude")
    expect(w.gone).toBe(20)
  })

  it("is neutral with no tick once it has reset since the reading", () => {
    const w = windowView(five(81, -40 * M), NOW - 6 * H, NOW, "claude")
    expect([w.reset, w.tone, w.runsOutAt]).toEqual([true, "neutral", undefined])
  })

  it("has no tick and no pace where the CLI gave no reset", () => {
    const w = windowView({ kind: "five_hour", utilization: 0 }, NOW, NOW, "claude")
    expect([w.gone, w.pace, w.tone]).toEqual([undefined, undefined, "neutral"])
  })

  it("names a model window by the provider's own word", () => {
    expect(windowView(week(1, D, "opus"), NOW, NOW, "claude")).toMatchObject({
      label: "Weekly, Opus",
      short: "Opus",
    })
  })
})

describe("what the cell says at rest", () => {
  it("leads with the five-hour window while it is no worse than another", () => {
    const cell = cellView(read(0, [five(46, 2.5 * H), week(40, 3.5 * D)]), NOW)
    expect(cell).toMatchObject({ _tag: "Meter", window: { short: "5h" } })
  })

  it("leads with a window in a worse tone", () => {
    const cell = cellView(read(0, [five(22, 3.5 * H), week(96, D, "sonnet")]), NOW)
    expect(cell).toMatchObject({ window: { short: "Sonnet", tone: "bad" } })
  })

  it("says 5h reset once the five-hour window has reset, unless another is bad", () => {
    const calm = cellView(read(6 * H, [five(81, -40 * M), week(48, 4 * D)]), NOW)
    expect(calm).toMatchObject({ window: { short: "5h", reset: true } })
    const bad = cellView(read(6 * H, [five(81, -40 * M), week(97, 4 * D)]), NOW)
    expect(bad).toMatchObject({ window: { short: "7d" } })
  })

  it("dims past thirty minutes with no turn, and not while one polls", () => {
    const windows = [five(58, 80 * M), week(37, 5 * D)]
    expect(cellView(read(29 * M, windows), NOW)).toMatchObject({ stale: false })
    expect(cellView(read(30 * M, windows), NOW)).toMatchObject({ stale: true })
    expect(cellView(read(3 * H, windows, true), NOW)).toMatchObject({ stale: false, polling: true })
  })

  it("says unavailable or not read, with no meter", () => {
    expect(cellView(makeCliUsage(), NOW)).toEqual({ _tag: "NotRead" })
    const unavailable = makeCliUsage({
      usage: { _tag: "Unavailable", at: NOW, why: { reason: "shape" } },
    })
    expect(cellView(unavailable, NOW)).toEqual({ _tag: "Unavailable" })
  })
})

describe("words", () => {
  it("gives a clock time today and a weekday otherwise", () => {
    expect(clockWords(NOW + 3 * H + 3 * M, NOW)).toBe("17:03")
    expect(clockWords(new Date(2026, 9, 31, 23, 0).getTime(), NOW)).toBe("Sat 23:00")
  })

  it("adds when the window runs out where that is before its reset", () => {
    const w = windowView(five(55, 3 * H), NOW, NOW, "claude")
    expect(windowLine(w, NOW)).toBe("ahead of pace · resets 17:00 · runs out 15:38")
  })

  it("says why there is no reading", () => {
    expect(unavailableWords("claude", { reason: "shape" })).toContain("newer claude")
    expect(unavailableWords("codex", { reason: "shape" })).toContain("five-hour or a weekly")
  })

  it("calls Codex's weekly window Weekly, with no models beside it to tell apart", () => {
    expect(windowView(week(1, D), NOW, NOW, "codex").label).toBe("Weekly")
    expect(windowView(week(1, D), NOW, NOW, "claude").label).toBe("Weekly, all models")
  })

  it("names every CLI in the phone tab's label", () => {
    expect(tabLabel([makeCliUsage(), makeCliUsage({ cli: "codex" })])).toBe(
      "Claude and Codex usage",
    )
  })
})

describe("the phone tab", () => {
  const stale = cellView(read(3 * H, [five(20, 4 * H)]), NOW)
  const fresh = cellView(read(M, [five(20, 4 * H)]), NOW)

  it("dims whole only when every row is stale", () => {
    expect(tabDim([stale, stale])).toBe(true)
    expect(tabDim([stale, fresh])).toBe(false)
    expect(tabDim([stale, cellView(makeCliUsage({ cli: "codex" }), NOW)])).toBe(false)
  })
})
