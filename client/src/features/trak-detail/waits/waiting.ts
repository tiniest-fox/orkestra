/**
 * What the finished pane says about the wait a resting trak is held behind.
 *
 * **Every word here is built off *met* and *asked*, and none off a check's.** A check
 * passes or fails and belongs to `checks:`; a condition is asked, is met or is not, and has
 * a third answer — stopped — that no check has. *Has not passed yet* read as a check
 * currently failing, which is the one thing a wait is not. Stopped, the phrase leads with
 * *gave up*: the word every surface uses for a wait that will not be asked again, so the
 * card reads as the row and the map do.
 *
 * **A clock takes none of those three words.** *Name*, *met* and *asked* are all about a
 * question put to something outside the checkout, and nothing is asked of a clock and
 * nothing can give up on one. So where `WaitingDto.until` is set the mono slot takes the
 * instant, the phrase says when the step runs, and an instant already behind us is its own
 * sentence rather than a countdown pretending it still has something to count.
 *
 * **Nothing here reads the state.** `TrakDetailDto.waiting` is present at exactly the one
 * rest a wait produces, so its presence is the whole question — a second reading off the
 * `_tag` would be a copy of `waitingAt` free to disagree with it.
 */

import type { LucideIcon } from "lucide-react"
import { AlarmClock, CircleDashed, CircleMinus } from "lucide-react"
import type { PlanDto, WaitingDto } from "../../../api/types"
import type { Tone } from "../../../format/tone"

/**
 * The wait's own glyph, one per kind and never a fourth: an alarm clock for a clock, a
 * minus for a condition that gave up, and the dashed circle — *nothing has reached this*
 * everywhere else — for one still being asked. One function because the held card's
 * plate and the map's corner badge both wear it, and two copies of a three-way pick is
 * how a surface comes to draw a stopped wait as one still asked.
 */
export const waitGlyph = (waiting: WaitingDto): LucideIcon =>
  waiting.until !== undefined ? AlarmClock : waiting.stopped ? CircleMinus : CircleDashed

/**
 * `working` blue, never amber: `waiting` means a human owes an action, and nobody owes a
 * waiting trak anything, and at the neutral tone the tint measured 1.11:1 against the
 * held card's muted text and did nothing. Stopped goes `bad`, reversing the rule the card
 * first shipped with — that a condition which gave up is not a failure and must not draw
 * like one — because neutral read as nothing owed while the list drew the same trak red.
 * A wait that has stopped asking reads *Gave up* in `bad` everywhere it is drawn, and
 * that includes the map's parked ending row and the badge on the entry it holds, which
 * take this answer rather than one of their own.
 */
export const waitTone = (waiting: WaitingDto): Tone => (waiting.stopped ? "bad" : "working")

/**
 * The head line's second half: the wait is the subject, and this is its state. `past` is
 * whether a clock's instant is behind us — the countdown's answer, so the two agree.
 */
export const waitPhrase = (waiting: WaitingDto, past = false): string =>
  waiting.until !== undefined
    ? past
      ? "has passed — the step runs on the next sweep"
      : "is when the step runs"
    : waiting.stopped
      ? "gave up — will not be asked again"
      : "is not met yet"

/** The head line's mono slot: a condition's script name, or a clock's instant in words. */
export const waitSlot = (waiting: WaitingDto, now: number): string =>
  waiting.until === undefined ? waiting.name : whenWords(waiting.until, now)

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`

const midnight = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole days between `now`'s local midnight and the target's: 0 today, 1 tomorrow. */
const daysOut = (target: number, now: number): number =>
  Math.round((midnight(target) - midnight(now)) / 86_400_000)

/**
 * An instant in words, relative to today: `06:00` today, `06:00 tomorrow`, and a weekday
 * beyond that — `Tue 06:00`. Chosen over a bare weekday and over a date knowing that
 * *tomorrow* goes stale once the day turns; the poll redraws it. A weekday is what a
 * moment more than a day either side gets, which is also what a daemon that was down
 * over a day comes back holding.
 */
export const whenWords = (target: number, now: number): string => {
  const d = new Date(target)
  const days = daysOut(target, now)
  if (days === 0) return hhmm(d)
  if (days === 1) return `${hhmm(d)} tomorrow`
  return `${WEEKDAY[d.getDay()] ?? ""} ${hhmm(d)}`
}

/**
 * The countdown a plan's clock rule carries after the instant: `in 8h 20m`, or `due now`
 * once it has arrived. Past is a state rather than an error — a plan can sit at its gate
 * for as long as nobody presses Approve, so an instant can pass before the step is reached,
 * and the step then starts as soon as it is.
 */
export const dueWords = (left: number): string => (left <= 0 ? "due now" : `in ${spellLeft(left)}`)

/**
 * The mono fact row under the head line, in the move footer's own idiom.
 *
 * **The step is numbered among the plan's agent entries, 1-based, and never by its index.**
 * The index counts the composer's own entries and starts at zero, so *step 0 of 6* read as
 * the zeroth — `TrakRail` dropped the counter for that reason. Counting the entries that
 * are not the composer's is also what the move footer's *N steps* counts (`ending`), so
 * the two numbers on one pane agree.
 *
 * Stopped, the row says what the stop costs — the held step and everything behind it will
 * not run, and archiving drops them — because the head line has already said the asking
 * is over and a countdown is not drawn to say anything else.
 */
const isStep = (entry: PlanDto["steps"][number]): boolean => entry.type !== "compose"

export const waitFacts = (waiting: WaitingDto, plan: PlanDto | undefined): readonly string[] => {
  const entries = plan?.steps ?? []
  const held = entries[waiting.step]
  const ordinal =
    held !== undefined && isStep(held)
      ? entries.slice(0, waiting.step + 1).filter(isStep).length
      : undefined
  const behind = entries.slice(waiting.step + 1).filter(isStep).length
  const at =
    ordinal === undefined
      ? "the held step"
      : `step ${String(ordinal)} of ${String(entries.filter(isStep).length)}`
  const out: string[] = [waiting.stopped ? `${at} will not run` : `holds ${at}`]
  if (held?.type === "agent") out.push(held.agent)
  if (behind > 0) out.push(`${String(behind)} behind it`)
  if (waiting.stopped) out.push(behind > 0 ? "archiving drops them" : "archiving drops it")
  return out
}

/** The composer's own words for the held entry, or nothing where the plan has none. */
export const heldInstruction = (
  waiting: WaitingDto,
  plan: PlanDto | undefined,
): string | undefined => plan?.steps[waiting.step]?.instruction

/**
 * Seconds until the daemon next asks, floored at zero — or nothing where nothing is
 * scheduled.
 *
 * `nextAsk` is daemon memory and is absent between a restart and the first sweep, and
 * wherever the condition has given up: nothing is counted down to there, so the caller
 * draws no countdown rather than a blank one. Zero is *now*: the sweep runs on its own
 * tick and appends nothing for an ask that is still not met, so the number stays at the
 * ask for as long as the poll takes to bring the next one.
 */
export const secondsUntil = (nextAsk: number | undefined, now: number): number | undefined =>
  nextAsk === undefined ? undefined : Math.max(0, Math.ceil((nextAsk - now) / 1000))

/**
 * `3m 41s`, `41s`, `1h 02m` — the coarsest form that is still exact at the scale a
 * person reads it, and *now* at zero rather than a number frozen there.
 */
export const spellLeft = (seconds: number): string => {
  if (seconds <= 0) return "now"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`
  if (minutes > 0) return `${String(minutes)}m ${String(rest).padStart(2, "0")}s`
  return `${String(rest)}s`
}
