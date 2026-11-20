/**
 * What the usage cell, its panel, the phone's tab and its sheet draw, as a function of the
 * engine's reading and the clock.
 *
 * **Pace, not thresholds, colours a window.** Fill is the share used; the tick is the
 * share of the window's time gone. Both are measured at the reading, never at now, so a
 * stale reading's fill and tick describe the same moment — the dimmed cell is what says
 * it is old. Pace is points used minus points of time gone:
 *
 * | Condition | Tone |
 * |---|---|
 * | under pace (below −10) or on pace | `neutral` |
 * | ahead (more than 10), or projected to reach 100% before it resets | `waiting` |
 * | far ahead (more than 25), or used ≥ 95% | `bad` |
 * | reset since the reading | `neutral` |
 *
 * **The five-hour window leads the cell** unless another is a worse tone. A five-hour
 * window that has reset since the reading reads `5h reset`, unless another is `bad`.
 *
 * The window kinds are the provider's grammar, carried on the wire as a closed union, so
 * naming them here is reading the wire rather than knowing a list. A model window's word
 * is the provider's, capitalised. Claude's weekly window says *all models*, because
 * Claude also reports weekly windows for one model; Codex reports none, so its is
 * *Weekly*.
 *
 * **The phone's usage tab holds one row per CLI**, and a stale row dims on its own. When
 * every row is stale the whole tab dims instead — `tabDim` — so no row is dimmed twice.
 */

import type { CliUsageDto, PlanWindowDto, UsageUnavailableDto } from "../../../api/types"
import type { Tone } from "../../../format/tone"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Past this with no turn running, a reading is old enough that the cell dims. */
export const STALE_AFTER = 30 * MINUTE

export type Pace = "under" | "on" | "ahead" | "far"

export const PACE_WORDS: Record<Pace, string> = {
  under: "under pace",
  on: "on pace",
  ahead: "ahead of pace",
  far: "far ahead of pace",
}

/** One window, worked out. Shares are 0–100. */
export interface WindowView {
  readonly key: string
  readonly label: string
  readonly short: string
  readonly used: number
  /** The share of the window's time gone at the reading; absent where no reset was given. */
  readonly gone: number | undefined
  /** The window has reset since the reading, so its numbers say nothing now. */
  readonly reset: boolean
  readonly pace: Pace | undefined
  readonly tone: Tone
  readonly resetsAt: number | undefined
  /** When it reaches 100% at the rate used so far — only where that is before it resets. */
  readonly runsOutAt: number | undefined
}

const lengthOf = (kind: PlanWindowDto["kind"]): number => {
  switch (kind) {
    case "five_hour":
      return 5 * HOUR
    case "seven_day":
      return 7 * DAY
  }
}

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

type Cli = CliUsageDto["cli"]

/** The label of the weekly window every model counts towards. */
const WEEKLY: Record<Cli, string> = { claude: "Weekly, all models", codex: "Weekly" }

const namesOf = (
  w: PlanWindowDto,
  cli: Cli,
): { readonly label: string; readonly short: string } => {
  if (w.model !== undefined)
    return { label: `Weekly, ${capital(w.model)}`, short: capital(w.model) }
  switch (w.kind) {
    case "five_hour":
      return { label: "Five-hour", short: "5h" }
    case "seven_day":
      return { label: WEEKLY[cli], short: "7d" }
  }
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n))

const paceOf = (delta: number): Pace => {
  if (delta > 25) return "far"
  if (delta > 10) return "ahead"
  if (delta < -10) return "under"
  return "on"
}

/** When the window reaches 100% at the rate used up to the reading, if before it resets. */
const runsOutOf = (w: PlanWindowDto, at: number, length: number): number | undefined => {
  if (w.resetsAt === undefined) return undefined
  const spent = length - (w.resetsAt - at)
  if (w.utilization <= 0 || spent <= 0) return undefined
  const out = at + ((100 - w.utilization) * spent) / w.utilization
  return out < w.resetsAt ? out : undefined
}

const toneOf = (used: number, pace: Pace | undefined, runsOut: boolean): Tone => {
  if (used >= 95 || pace === "far") return "bad"
  if (pace === "ahead" || runsOut) return "waiting"
  return "neutral"
}

/** One window of `cli`'s reading taken at `at`, looked at `now`. */
export const windowView = (w: PlanWindowDto, at: number, now: number, cli: Cli): WindowView => {
  const length = lengthOf(w.kind)
  const reset = w.resetsAt !== undefined && w.resetsAt <= now
  const gone =
    w.resetsAt === undefined ? undefined : clamp(((length - (w.resetsAt - at)) / length) * 100)
  const pace = gone === undefined ? undefined : paceOf(w.utilization - gone)
  const runsOutAt = runsOutOf(w, at, length)
  return {
    key: keyOf(w),
    ...namesOf(w, cli),
    used: w.utilization,
    gone,
    reset,
    pace,
    tone: reset ? "neutral" : toneOf(w.utilization, pace, runsOutAt !== undefined),
    resetsAt: w.resetsAt,
    runsOutAt: reset ? undefined : runsOutAt,
  }
}

const RANK: Record<Tone, number> = { neutral: 0, good: 0, working: 0, waiting: 1, bad: 2 }

const keyOf = (w: PlanWindowDto): string => `${w.kind}:${w.model ?? ""}`

/** The five-hour window every model counts towards — the one that leads. */
const isFive = (w: WindowView): boolean => w.key === keyOf({ kind: "five_hour", utilization: 0 })

/** The window the cell names: the five-hour one unless another is a worse tone. */
export const leadOf = (windows: readonly WindowView[]): WindowView | undefined => {
  const live = windows.filter((w) => !w.reset)
  const pool = live.length > 0 ? live : windows
  const worst = pool.toSorted((a, b) => RANK[b.tone] - RANK[a.tone] || b.used - a.used)[0]
  const five = pool.find(isFive)
  if (worst === undefined) return undefined
  return five !== undefined && RANK[worst.tone] <= RANK[five.tone] ? five : worst
}

/** What the cell — and the phone's tab — says at rest. */
export type CellView =
  | {
      readonly _tag: "Meter"
      readonly window: WindowView
      readonly polling: boolean
      /** Dimmed: past `STALE_AFTER` with no turn running. */
      readonly stale: boolean
    }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "NotRead" }

export const cellView = (cli: CliUsageDto, now: number): CellView => {
  const { usage, polling } = cli
  switch (usage._tag) {
    case "NotRead":
      return { _tag: "NotRead" }
    case "Unavailable":
      return { _tag: "Unavailable" }
    case "Read": {
      const windows = usage.windows.map((w) => windowView(w, usage.at, now, cli.cli))
      const led = leadOf(windows)
      if (led === undefined) return { _tag: "Unavailable" }
      const stale = !polling && now - usage.at >= STALE_AFTER
      // A reset five-hour window is the news — a fresh window — unless another is bad,
      // which is worth more than the news. `leadOf` skips a reset window, so it is
      // looked for here.
      const five = windows.find(isFive)
      const window = five !== undefined && five.reset && led.tone !== "bad" ? five : led
      return { _tag: "Meter", window, polling, stale }
    }
  }
}

/** Every window the panel lists, in the order the engine sent them. */
export const windowsOf = (cli: CliUsageDto, now: number): readonly WindowView[] => {
  const { usage } = cli
  return usage._tag === "Read"
    ? usage.windows.map((w) => windowView(w, usage.at, now, cli.cli))
    : []
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`

/** `17:03` on today's date, `Sat 23:00` on any other — local time. */
export const clockWords = (at: number, now: number): string => {
  const d = new Date(at)
  return d.toDateString() === new Date(now).toDateString()
    ? hhmm(d)
    : `${WEEKDAY[d.getDay()] ?? ""} ${hhmm(d)}`
}

/** A window's line under its meter: pace, the reset, and when it runs out where it does. */
export const windowLine = (w: WindowView, now: number): string => {
  if (w.reset && w.resetsAt !== undefined)
    return `reset ${clockWords(w.resetsAt, now)} · not read since`
  const parts = [
    ...(w.pace === undefined ? [] : [PACE_WORDS[w.pace]]),
    ...(w.resetsAt === undefined ? [] : [`resets ${clockWords(w.resetsAt, now)}`]),
    ...(w.runsOutAt === undefined ? [] : [`runs out ${clockWords(w.runsOutAt, now)}`]),
  ]
  return parts.join(" · ")
}

/** How old a reading is, as the panel's header says it. */
export const ageWords = (at: number, now: number): string => {
  const gone = Math.max(0, now - at)
  if (gone < MINUTE) return "just now"
  if (gone < HOUR) return `${String(Math.floor(gone / MINUTE))}m ago`
  if (gone < DAY) {
    const h = Math.floor(gone / HOUR)
    const m = Math.floor((gone % HOUR) / MINUTE)
    return m === 0 ? `${String(h)}h ago` : `${String(h)}h ${String(m)}m ago`
  }
  return `${String(Math.floor(gone / DAY))}d ago`
}

/**
 * The panel's sentence for why there is no reading. `shape` is the only reason: a CLI that
 * reports its rate limit without the windows the cell draws — an older claude, or a codex
 * whose windows are neither five hours nor a week.
 */
export const unavailableWords = (cli: Cli, _why: UsageUnavailableDto): string => {
  switch (cli) {
    case "claude":
      return "This claude reports its rate limit without the usage windows. A newer claude reports them."
    case "codex":
      return "This codex reports its rate limit without a five-hour or a weekly window."
  }
}

/** The CLI's name, for the panel's header and the cell's spoken label. */
const CLI_NAME: Record<Cli, string> = { claude: "Claude", codex: "Codex" }

export const cliName = (cli: Cli): string => CLI_NAME[cli]

/** The phone tab's spoken label: `Claude and Codex usage`. */
export const tabLabel = (clis: readonly CliUsageDto[]): string =>
  `${clis.map((c) => cliName(c.cli)).join(" and ")} usage`

/** The phone tab dims whole only when every CLI's cell is a stale meter. */
export const tabDim = (cells: readonly CellView[]): boolean =>
  cells.length > 0 && cells.every((cell) => cell._tag === "Meter" && cell.stale)
