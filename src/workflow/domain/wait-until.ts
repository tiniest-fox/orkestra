// A plan entry's time wait: the two spellings of `wait_until`, and the instant they
// resolve to.
//
// The composer writes one of two forms on an agent step, told apart by the leading
// `P`: an hour-granular naked local instant, `2026-09-16T06`, or an ISO-8601 duration,
// `PT90M`. **Both resolve against the moment the plan was composed** — the `at` on the
// log event that carried the proposal, folded onto the trak as `planAt` — so a duration
// and an instant collapse into one number that is known before anyone approves the
// plan and never moves afterwards. It is derived wherever it is needed rather than
// stored a second time: two writers of one number drift.
//
// Local time throughout, because *06:00 tomorrow* is said on the clock the person
// reads and the engine runs on their machine. `Date`'s calendar arithmetic is what
// carries a day across a clock change — `P1D` from 06:00 lands on 06:00 — where adding
// eighty-six million milliseconds would land an hour off twice a year.

import { Schema } from "effect"

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/
const DURATION =
  /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

/** A captured group as a number, and zero for one the spelling left out. */
const groupAt = (m: RegExpExecArray, i: number): number => Number(m[i] ?? "0")

/**
 * The naked instant as epoch milliseconds, or nothing where the text is not one. A
 * calendar that rolls over — month thirteen, the thirty-first of April, hour twenty-five
 * — is refused rather than normalised into some other day the composer did not name.
 */
const localInstant = (text: string): number | undefined => {
  const m = INSTANT.exec(text)
  if (m === null) return undefined
  const [year, month, day, hour] = [groupAt(m, 1), groupAt(m, 2), groupAt(m, 3), groupAt(m, 4)]
  if (hour > 23) return undefined
  const date = new Date(year, month - 1, day, hour)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime()
    : undefined
}

/** The anchor moved on by the duration, or nothing where the text is not one. */
const afterDuration = (text: string, anchor: number): number | undefined => {
  const m = DURATION.exec(text)
  if (m === null) return undefined
  const date = new Date(anchor)
  date.setFullYear(
    date.getFullYear() + groupAt(m, 1),
    date.getMonth() + groupAt(m, 2),
    date.getDate() + groupAt(m, 3) * 7 + groupAt(m, 4),
  )
  const seconds = groupAt(m, 5) * 3600 + groupAt(m, 6) * 60 + groupAt(m, 7)
  return date.getTime() + seconds * 1000
}

/**
 * What `wait_until` may hold, refused at decode so `elicit` re-prompts with the reason
 * rather than the plan landing with a time nothing can read. An instant carrying
 * minutes is the refusal worth naming: the hour is the grain, and `T06:30` is the
 * spelling a model reaches for.
 */
export const WaitUntil = Schema.String.pipe(
  Schema.filter((text) =>
    localInstant(text) !== undefined || DURATION.test(text)
      ? undefined
      : "`wait_until` is a local instant to the hour, `2026-09-16T06` — nothing finer — or an ISO-8601 duration, `PT90M`",
  ),
)

/**
 * The instant a `wait_until` names, epoch milliseconds: the instant as written, or
 * the duration counted from `anchor`. Nothing for a duration with no anchor — a log
 * written before events were stamped — which reads as no wait at all rather than a
 * wait from nowhere, on `due`'s rule that unmeasured is due.
 */
export const resolveWaitUntil = (text: string, anchor: number | undefined): number | undefined => {
  const instant = localInstant(text)
  if (instant !== undefined) return instant
  return anchor === undefined ? undefined : afterDuration(text, anchor)
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const two = (n: number): string => String(n).padStart(2, "0")

/**
 * An instant on the local clock, as a person reads one — `Wednesday 2026-09-16 06:00
 * (UTC+02:00)`. The weekday because *tomorrow* and *Monday* are how a request names a
 * time; the offset because a naked instant means nothing without the zone it was
 * written in. Spelled by hand rather than by locale, so two machines agree on it.
 */
export const spellLocal = (ms: number): string => {
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset < 0 ? "-" : "+"
  const zone = `UTC${sign}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
  return `${DAYS[d.getDay()] ?? ""} ${day} ${two(d.getHours())}:${two(d.getMinutes())} (${zone})`
}
