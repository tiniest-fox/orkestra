/**
 * The times a host's settings write — a device's pairing and last request, a token's set
 * time, a pairing code's expiry — in the short forms *Settings Where They Belong* drew:
 * `2 Oct`, `20 Oct, 11:05`, `14 min ago`, `until 23:14`. No seconds anywhere, and a year
 * only where it is not the current one. Each takes `now` rather than reading the clock, so
 * it is a function of its arguments.
 */

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** `23:14`, on the 24-hour clock. */
export const clockOf = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** `2 Oct`, or `2 Oct 2025` outside the current year. */
export const dayOf = (at: number, now: number): string => {
  const d = new Date(at)
  const day = `${String(d.getDate())} ${MONTH[d.getMonth()] ?? ""}`
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${String(d.getFullYear())}`
}

/** `20 Oct, 11:05`. */
export const dayClockOf = (at: number, now: number): string => `${dayOf(at, now)}, ${clockOf(at)}`

const plural = (n: number, unit: string): string => `${String(n)} ${unit}${n === 1 ? "" : "s"} ago`

/**
 * How long ago, for a moment that is usually recent: `now` within the minute, then `14 min
 * ago`, `3 hours ago`, `2 days ago`, `3 weeks ago`, and the day itself past a month.
 */
export const agoOf = (at: number, now: number): string => {
  const gone = Math.max(0, now - at)
  if (gone < MINUTE) return "now"
  if (gone < HOUR) return `${String(Math.floor(gone / MINUTE))} min ago`
  if (gone < DAY) return plural(Math.floor(gone / HOUR), "hour")
  if (gone < WEEK) return plural(Math.floor(gone / DAY), "day")
  if (gone < 5 * WEEK) return plural(Math.floor(gone / WEEK), "week")
  return dayOf(at, now)
}
