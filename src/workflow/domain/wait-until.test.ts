// Tier-1: the two spellings of `wait_until` and the instant each resolves to. Every
// expected instant is built with the same local `Date` constructor the code uses, so
// the assertions hold in any zone — what is asserted is the arithmetic, not the zone.

import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { resolveWaitUntil, spellLocal, WaitUntil } from "./wait-until.js"

/** Monday 2026-09-14 15:07, local — a plan composed mid-afternoon. */
const ANCHOR = new Date(2026, 8, 14, 15, 7).getTime()

const accepted = (text: string): boolean =>
  Either.isRight(Schema.decodeUnknownEither(WaitUntil)(text))

/** The anchor moved by whole years, months and days on the calendar, at the same hour. */
const after = (y: number, m: number, d: number): number =>
  new Date(2026 + y, 8 + m, 14 + d, 15, 7).getTime()

describe("an hour on the local clock", () => {
  it("resolves to that hour, and needs no anchor to do it", () => {
    const six = new Date(2026, 8, 16, 6).getTime()
    expect(resolveWaitUntil("2026-09-16T06", ANCHOR)).toBe(six)
    expect(resolveWaitUntil("2026-09-16T06", undefined)).toBe(six)
  })

  it("is refused below the hour — minutes are the spelling a model reaches for", () => {
    expect(accepted("2026-09-16T06")).toBe(true)
    expect(accepted("2026-09-16T06:30")).toBe(false)
    expect(accepted("2026-09-16T06:00:00Z")).toBe(false)
    expect(accepted("2026-09-16")).toBe(false)
  })

  it("is refused where the calendar would roll it onto a day nobody named", () => {
    expect(accepted("2026-13-01T06")).toBe(false)
    expect(accepted("2026-04-31T06")).toBe(false)
    expect(accepted("2026-09-16T25")).toBe(false)
    expect(resolveWaitUntil("2026-04-31T06", ANCHOR)).toBeUndefined()
  })
})

describe("a duration from the anchor", () => {
  it("counts minutes and hours exactly — a resolved duration is the one value that carries minutes", () => {
    expect(resolveWaitUntil("PT90M", ANCHOR)).toBe(ANCHOR + 90 * 60_000)
    expect(resolveWaitUntil("PT8H", ANCHOR)).toBe(ANCHOR + 8 * 3_600_000)
    expect(resolveWaitUntil("PT1H30M15S", ANCHOR)).toBe(ANCHOR + (3600 + 1800 + 15) * 1000)
  })

  it("counts days, weeks and months on the calendar, so a day lands on the same hour", () => {
    expect(resolveWaitUntil("P1D", ANCHOR)).toBe(after(0, 0, 1))
    expect(resolveWaitUntil("P1W", ANCHOR)).toBe(after(0, 0, 7))
    expect(resolveWaitUntil("P1M", ANCHOR)).toBe(after(0, 1, 0))
    expect(resolveWaitUntil("P1Y2M3DT4H", ANCHOR)).toBe(after(1, 2, 3) + 4 * 3_600_000)
  })

  it("is nothing where there is no anchor to count from", () => {
    // A log written before events were stamped: unmeasured reads as no wait, on the
    // sweep's own rule that unmeasured is due.
    expect(resolveWaitUntil("PT8H", undefined)).toBeUndefined()
  })

  it("is refused where it names no length, or is not a duration at all", () => {
    expect(accepted("PT90M")).toBe(true)
    expect(accepted("P1D")).toBe(true)
    expect(accepted("P")).toBe(false)
    expect(accepted("PT")).toBe(false)
    expect(accepted("P1DT")).toBe(false)
    expect(accepted("tomorrow")).toBe(false)
    expect(accepted("90m")).toBe(false)
  })

  it("re-prompts with both spellings, and names the hour as the grain", () => {
    const refused = Schema.decodeUnknownEither(WaitUntil)("2026-09-16T06:30")
    const message = Either.isLeft(refused) ? refused.left.message : ""
    expect(message).toContain("2026-09-16T06")
    expect(message).toContain("PT90M")
    expect(message).toContain("nothing finer")
  })
})

describe("an instant as a person reads one", () => {
  it("spells the weekday, the date, the hour and minute, and the zone", () => {
    const d = new Date(ANCHOR)
    const offset = -d.getTimezoneOffset()
    const sign = offset < 0 ? "-" : "+"
    const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")
    const mm = String(Math.abs(offset) % 60).padStart(2, "0")
    expect(spellLocal(ANCHOR)).toBe(`Monday 2026-09-14 15:07 (UTC${sign}${hh}:${mm})`)
  })
})
