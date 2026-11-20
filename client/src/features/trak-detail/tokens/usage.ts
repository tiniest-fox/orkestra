/**
 * What the turns spent, folded off the log the drawer already holds — per turn, per
 * position, per session, per trak, and a parent's own against its pieces'.
 *
 * **Every figure here is a sum of the `usage` an ending carries**, and nothing else is
 * counted. A turn is metered once, by the event that ends it — `AgentReturned`,
 * `ComposerReturned`, `TurnFailed`, `Stopped`, or the `FilingAsked` that killed a running
 * turn — so summing endings across a session or a trak double-counts nothing: a turn that resumes a conversation is billed for its own
 * tokens and not for the turns before it. An ending with no `usage` is *unmeasured*, which
 * is a different fact from *free* and is left out rather than counted as zero.
 *
 * **The k-th ending at a position is the k-th turn's**, which is the arithmetic `filed.ts`
 * does for documents and causes, asked a fourth time. Reading it the same way is what keeps
 * a stamp on the turn that earned it rather than one below.
 *
 * **Occupancy is not spend, and the difference is the whole trap.** A step's spend is every
 * turn added up, and each turn re-reads the conversation at every model call, so one turn's
 * four counts already come to several windows' worth for a window that never filled. What
 * is in the window is a reading the engine took at the turn's last model call — its input,
 * cache included, plus that call's output — carried on the ending as `usage.context`, and
 * nothing here derives it from the counts. A turn with no reading has an unmeasured window,
 * which is a different fact from an empty one, and the meter draws none.
 *
 * **A piece's spend is never part of its parent's.** A child runs in its own checkout under
 * its own session and is metered in its own log; `piecesSpend` reads those logs and keeps
 * the answer apart, so the parent's bar is the parent's and the pieces are a sentence
 * under it.
 *
 * Kind `pure`: `api/types`, sibling pure modules, and the Tailwind classes a segment is
 * drawn in — whole literal names, because a class assembled at runtime is never generated
 * and the segment renders with no fill at all, which reads as a pale treatment rather than
 * a fault.
 */

import type { EventDto, TrakDetailDto, TurnInFlightDto } from "../../../api/types"
import { childIds } from "../family/family"
import { atStep, inRun, turnEndings } from "../filed"
import type { MapRow } from "../family/rows"

/** The four counts a turn is metered into — `UsageDto` without the cost and the tools. */
export interface Spend {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

export const NOTHING: Spend = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const plus = (a: Spend, b: Spend): Spend => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
})

export const sum = (all: readonly Spend[]): Spend => all.reduce(plus, NOTHING)

/**
 * Everything the model read, cache included.
 *
 * `inputTokens` alone is the *uncached* remainder — around twenty on a real turn, because
 * the two cache counters are where the input actually is — so a figure headed *input*
 * carrying it would be accurate and read as a bug. Codex reports cache reads too; only
 * its cache writes are always zero.
 */
export const inputAll = (s: Spend): number => s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens

/** The one figure drawn where one is drawn: everything in and everything out. */
export const total = (s: Spend): number => inputAll(s) + s.outputTokens

/**
 * A count written for a glance — `428k`, `1.0m`, `512`. Rounded rather than exact because
 * every place it is drawn is a comparison, and the words beside it say what it counts,
 * so the string carries no unit.
 */
export const tokens = (n: number): string => {
  const k = Math.round(n / 1000)
  if (k >= 1000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${String(k)}k`
  return String(Math.round(n))
}

/**
 * What the window held at a turn's last model call, and how big the window is where the
 * turn's own provider said — `undefined` on a turn that reported no size, in which case
 * the meter falls back to the step's `window` off the project's table.
 *
 * `held.outputTokens` is short by the rest of the last reply where the provider counts a
 * call as it starts, which Claude does; the input side is whole either way.
 */
export interface Context {
  readonly held: Spend
  readonly window: number | undefined
}

/**
 * One turn's spend, its context reading where the engine took one, and how a person cut
 * the turn short where they did — `undefined` on a turn that ran to its own ending.
 *
 * Two cuts, because the two presses are different asks and the stamp says which: a stop
 * ends the turn and nothing follows; a filing kills the turn so the step can be re-entered
 * at once and told to file what it has. Both leave a turn whose spend nothing else on the
 * screen accounts for.
 *
 * A recompose pressed mid-turn and an archive kill a turn too, and their endings carry
 * its spend — every total here folds it — but neither is a cut yet: no stamp has been
 * worded for them, so the figure is in the chat bar's spend row and not on the turn.
 */
export interface TurnSpend {
  readonly spend: Spend
  readonly context: Context | undefined
  readonly cut: "stopped" | "filing" | undefined
}

const cutBy = (e: EventDto): TurnSpend["cut"] =>
  e._tag === "StopRequested" || e._tag === "Stopped"
    ? "stopped"
    : e._tag === "FilingAsked"
      ? "filing"
      : undefined

/** The four counts off an ending, its reading beside them, and never the cost or the tools. */
const measured = (e: EventDto): TurnSpend | undefined =>
  "usage" in e && e.usage !== undefined
    ? {
        spend: {
          inputTokens: e.usage.inputTokens,
          outputTokens: e.usage.outputTokens,
          cacheReadTokens: e.usage.cacheReadTokens,
          cacheWriteTokens: e.usage.cacheWriteTokens,
        },
        context:
          e.usage.context === undefined
            ? undefined
            : { held: { ...e.usage.context }, window: e.usage.contextWindow },
        cut: cutBy(e),
      }
    : undefined

/** What each ending `mine` picks out spent, padded to `turns` — `filed.ts`'s arithmetic. */
const spentByEnding = (
  log: readonly EventDto[],
  mine: (e: EventDto) => boolean,
  turns: number,
): readonly (TurnSpend | undefined)[] => {
  const ended = turnEndings(log, mine).map((i) => {
    const e = log[i]
    return e === undefined ? undefined : measured(e)
  })
  return Array.from({ length: Math.max(turns, ended.length) }, (_, i) => ended[i])
}

/**
 * What each turn at a position spent, in turn order — `undefined` for a turn still
 * running, one that died unmeasured, and one a log written before the engine metered
 * the ending it has.
 *
 * Keyed exactly as `TurnsView` keys the endings it draws: a step by its position, a run of
 * the composer by its newest session, because `ComposerReturned` carries no position. The
 * ending row is nobody's turn and spends nothing.
 */
export const turnSpends = (
  log: readonly EventDto[],
  row: Pick<MapRow, "kind" | "at" | "turns">,
): readonly (TurnSpend | undefined)[] => {
  switch (row.kind) {
    case "step":
      return spentByEnding(log, atStep(row.at), row.turns.length)
    case "compose":
    case "recompose":
      return spentByEnding(log, inRun(row.turns.at(-1)?.session), row.turns.length)
    case "end":
      return []
  }
}

/**
 * The turn in flight as one more turn of `row`, or `undefined` where it is not this
 * row's — which is every row but the one whose position the record names and whose
 * status is `running`.
 *
 * **Both facts, for the reason a duration needs both.** The step says which position the
 * record's turn is at, so a composer's reading — no step — never lands on a step's meter
 * and a piece's never lands on its parent's; the status says the row is the live one, so
 * the moment an `Appended` moves the state the overlay stops. That is what keeps the
 * fold from counting a turn twice in the gap between its ending landing on the log and
 * the release frame clearing the record. A compose row is the composer's turn wherever
 * the plan has put it; the ending row is nobody's.
 *
 * The spend is the provider's four counters plus the estimate of everything read since
 * its last report — the estimate is never a context reading, and the reading is never
 * spend, which is the trap the file's header names.
 */
/** Whether the turn in flight is this row's: a running step at its position, or the composer's run. */
export const inFlightAt = (
  inFlight: TurnInFlightDto,
  row: Pick<MapRow, "kind" | "at" | "status">,
): boolean => {
  if (row.status !== "running") return false
  return row.kind === "step"
    ? inFlight.step === row.at
    : row.kind === "end"
      ? false
      : inFlight.step === undefined
}

export const liveSpend = (
  inFlight: TurnInFlightDto | undefined,
  row: Pick<MapRow, "kind" | "at" | "status">,
): TurnSpend | undefined => {
  if (inFlight === undefined || !inFlightAt(inFlight, row)) return undefined
  const u = inFlight.usage
  if (u === undefined) return undefined
  return {
    spend: plus(
      {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
      },
      inFlight.estimate ?? NOTHING,
    ),
    context:
      u.context === undefined ? undefined : { held: { ...u.context }, window: u.contextWindow },
    cut: undefined,
  }
}

/** Everything the turns spent, unmeasured ones excluded. */
export const burned = (spends: readonly (TurnSpend | undefined)[]): Spend =>
  sum(spends.flatMap((s) => (s === undefined ? [] : [s.spend])))

/**
 * What is sitting in the context window now: the last reading any turn here carries.
 * `undefined` where no turn was read — a log written before the engine kept readings, or
 * a turn cut short before its provider's log could be opened — and a meter with nothing
 * in it is not drawn. A turn measured for spend and not for its window skips back to the
 * reading before it, which is what the window still held when that turn started.
 */
export const occupancy = (spends: readonly (TurnSpend | undefined)[]): Context | undefined =>
  spends.findLast((s) => s?.context !== undefined)?.context

/** Every measured ending a session wrote, wherever it ran. */
const sessionEndings = (log: readonly EventDto[], session: string): readonly EventDto[] =>
  log.filter((e) => "sessionId" in e && e.sessionId === session && measured(e) !== undefined)

/**
 * What the conversation a row joined had already spent before the row's own turns — the
 * session's measured endings at every position but this one.
 *
 * Only where the row actually joined it (`continues.to`): a key that named nothing that had
 * run started fresh and inherited nothing. `undefined` where nothing was measured there,
 * so the head draws no figure rather than *carried in 0*.
 */
export const carriedIn = (
  log: readonly EventDto[],
  row: Pick<MapRow, "at" | "turns" | "continues">,
): Spend | undefined => {
  if (row.continues?.to === undefined) return undefined
  const session = row.turns[0]?.session
  if (session === undefined) return undefined
  const own = atStep(row.at)
  const before = sessionEndings(log, session).filter((e) => !own(e))
  return before.length === 0 ? undefined : burned(before.map(measured))
}

/** The trak's own spend: every measured ending in its log, and no piece's. */
export const ownSpend = (log: readonly EventDto[]): Spend => burned(log.map(measured))

/** One position's share of the trak bar. */
export interface PositionSpend {
  readonly key: string
  readonly title: string
  readonly spend: Spend
}

/** What its pieces spent between them, kept apart from the parent's own. */
export interface PiecesSpend {
  /** How many pieces the log names. */
  readonly pieces: number
  /** How many of them have answered, which is how many `spend` is a sum of. */
  readonly read: number
  readonly spend: Spend
}

/** Everything the trak view draws about spend, in one value. */
export interface TrakUsage {
  readonly own: Spend
  /** The positions that spent anything, in plan order — the bar's segments. */
  readonly positions: readonly PositionSpend[]
  /** `undefined` on a trak with no pieces, which is most of them. */
  readonly pieces: PiecesSpend | undefined
}

/**
 * The trak's spend, its positions' shares of it, and its pieces' spend beside it.
 *
 * `children` is what `useFamily` has fetched — a piece's whole detail, read through the
 * ordinary route — so a piece's total is its own log folded by the same rule as the
 * parent's. A piece that has not answered yet is counted in `pieces` and not in `read`.
 * **A piece's own pieces are not in its log**, so a spawn two levels deep is summed to
 * the first level and no further — the same depth the family map draws.
 */
export const trakUsage = (
  log: readonly EventDto[],
  rows: readonly MapRow[],
  children: ReadonlyMap<string, TrakDetailDto>,
): TrakUsage => {
  const positions = rows.flatMap((row) => {
    const spend = burned(turnSpends(log, row))
    return total(spend) === 0 ? [] : [{ key: row.key, title: row.title, spend }]
  })
  const ids = childIds(log)
  const read = ids.flatMap((id) => {
    const child = children.get(id)
    return child === undefined ? [] : [ownSpend(child.log)]
  })
  return {
    own: ownSpend(log),
    positions,
    pieces:
      ids.length === 0 ? undefined : { pieces: ids.length, read: read.length, spend: sum(read) },
  }
}

/** One slice of a bar: what it is, how much, and the whole literal class it is filled in. */
export interface Segment {
  readonly name: string
  readonly n: number
  readonly fill: string
}

/*
 * The three input kinds are variants of one thing — tokens the model read — so they are
 * one hue at descending strength, and output is the one distinction that carries meaning,
 * so it is the one with a colour of its own. `source-human` and `source-machine` are the
 * app's only two non-status colours: a tone here would say a segment had failed or was
 * waiting.
 */
const READ = ["bg-source-human/85", "bg-source-human/55", "bg-source-human/30"] as const
const WRITTEN = "bg-source-machine"

/** The four counts, in the order they fill a window. */
export const segmentsOf = (s: Spend): readonly Segment[] => [
  { name: "cache read", n: s.cacheReadTokens, fill: READ[0] },
  { name: "cache write", n: s.cacheWriteTokens, fill: READ[1] },
  { name: "uncached in", n: s.inputTokens, fill: READ[2] },
  { name: "output", n: s.outputTokens, fill: WRITTEN },
]

/** The trak bar's per-position ramp — one hue descending, so a slice carries no status. */
const RAMP = [
  "bg-source-human/85",
  "bg-source-human/70",
  "bg-source-human/55",
  "bg-source-human/45",
  "bg-source-human/35",
  "bg-source-human/25",
  "bg-source-human/15",
] as const

/** One slice per position, each a step down the ramp; past its end, the ramp repeats. */
export const rampSegments = (positions: readonly PositionSpend[]): readonly Segment[] =>
  positions.map((p, i) => ({
    name: p.title,
    n: total(p.spend),
    fill: RAMP[i % RAMP.length] ?? RAMP[0],
  }))

/**
 * What the chat bar's footer draws about one position: everything its turns have spent,
 * the turn in flight included, and the last reading of its window.
 *
 * The two readings keep the rules above: the spend grows with the live estimate, and the
 * reading is the last one taken, never one computed from the counts. `undefined` where
 * nothing has been measured, so the footer draws neither rather than a zero.
 */
export interface StepUsage {
  readonly spent: number
  /** `undefined` where no turn here was read — the row draws with no `%` and no line. */
  readonly context:
    | {
        readonly held: Spend
        readonly used: number
        /** The turn's own reported window, else the project's table, else unknown. */
        readonly ceiling: number | undefined
      }
    | undefined
}

export const stepUsage = (
  row: MapRow,
  log: readonly EventDto[],
  inFlight: TurnInFlightDto | undefined,
): StepUsage | undefined => {
  const live = liveSpend(inFlight, row)
  const spends = [...turnSpends(log, row), ...(live === undefined ? [] : [live])]
  const spent = total(burned(spends))
  const last = occupancy(spends)
  if (last === undefined && spent === 0) return undefined
  return {
    spent,
    context:
      last === undefined
        ? undefined
        : {
            held: last.held,
            used: inputAll(last.held) + last.held.outputTokens,
            ceiling: last.window ?? row.window,
          },
  }
}
