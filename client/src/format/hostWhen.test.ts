import { describe, expect, it } from "vitest"
import { agoOf, clockOf, dayClockOf, dayOf } from "./hostWhen"

const NOW = new Date(2026, 9, 24, 1, 45, 57).getTime()
const at = (...parts: [number, number, number, number?, number?, number?]): number =>
  new Date(...parts).getTime()

describe("the host's short times", () => {
  it("writes a day as day and month, with the year only outside this one", () => {
    expect(dayOf(at(2026, 9, 2, 10), NOW)).toBe("2 Oct")
    expect(dayOf(at(2025, 11, 31, 23), NOW)).toBe("31 Dec 2025")
  })

  it("writes a set time as day, month and a 24-hour clock with no seconds", () => {
    expect(dayClockOf(at(2026, 9, 20, 11, 5, 42), NOW)).toBe("20 Oct, 11:05")
    expect(clockOf(at(2026, 9, 24, 9, 4, 59))).toBe("09:04")
    expect(clockOf(at(2026, 9, 24, 23, 14))).toBe("23:14")
  })

  it("writes last seen relatively, falling back to the day past a month", () => {
    expect(agoOf(NOW - 20_000, NOW)).toBe("now")
    expect(agoOf(NOW + 5_000, NOW)).toBe("now")
    expect(agoOf(NOW - 14 * 60_000, NOW)).toBe("14 min ago")
    expect(agoOf(NOW - 60 * 60_000, NOW)).toBe("1 hour ago")
    expect(agoOf(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago")
    expect(agoOf(NOW - 2 * 86_400_000, NOW)).toBe("2 days ago")
    expect(agoOf(NOW - 21 * 86_400_000, NOW)).toBe("3 weeks ago")
    expect(agoOf(at(2026, 7, 1, 12), NOW)).toBe("1 Aug")
  })
})
