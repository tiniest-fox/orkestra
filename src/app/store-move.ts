// Every trak's and goal's log, transcript and views moved from one place to another: the
// first-boot migration's move of the files under `.orkestra/.database/` into the store
// (`store-migrate.ts`).
//
// **A move writes only what the target lacks.** Each log the target already holds the
// same lines of is left alone, and one it holds the start of gets the rest, so a move run
// twice changes nothing. A log the target holds different lines of is refused, as is a
// source log with a line that will not decode, so it never reaches the target:
// `moveLogsLeavingOut` leaves that log out and moves the rest.
//
// **Then every log moved is read back from the target and replayed**, beside the same log
// replayed from the source, and the two states have to agree, as do the counts of lines and
// views.

import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Data, Effect, ParseResult, Schema, type Scope } from "effect"
import { orkestraDir } from "../library/adapters/library-fs.js"
import { openSqliteLines, sqliteStorePath } from "../workflow/adapters/store-sqlite.js"
import { decodeEvent } from "../workflow/domain/event.js"
import { decodeGoalEvent, replayGoal } from "../workflow/domain/goal.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { GoalId, TrakId } from "../workflow/domain/trak.js"
import type { StoreFailed, StoreUndecodable } from "../workflow/ports/store-errors.js"
import { fileSide, type LogFile, type LogOf, type LogSide, sqliteSide } from "./store-sides.js"

/**
 * `value` as JSON with every object's keys in order, so two stores that keep the same
 * value under a different key order — a `jsonb` column does — read as the same.
 */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Map) return Array.from<unknown>(v.entries())
    if (v instanceof Set) return Array.from<unknown>(v)
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v
    return Object.fromEntries(
      Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  })

/** How many of `wanted` the target still lacks after the `held` it has, or why it cannot take them. */
const lacking = (held: readonly unknown[], wanted: readonly unknown[]): number | undefined =>
  held.length <= wanted.length && held.every((line, i) => canonical(line) === canonical(wanted[i]))
    ? wanted.length - held.length
    : undefined

const FILES: readonly LogFile[] = ["log", "transcript"]
const KINDS: readonly LogOf[] = ["trak", "goal"]

/** One log's place in a move: where it is, and how much of it the target lacks. */
interface Planned {
  readonly of: LogOf
  readonly key: string
  readonly lines: number
  readonly views: number
}

type Failure = StoreFailed | StoreUndecodable

/** How long an expected or an actual value may run in a report before it is named instead. */
const SHOWN = 80

const clipped = (text: string): string => (text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text)

/**
 * The one issue a line failed on, as `path: expected …, got …`. A schema's own words for
 * what it expected are the whole union of events, tens of kilobytes for one bad line, so
 * an expectation longer than `SHOWN` is named rather than printed.
 */
const issueOf = (error: ParseResult.ParseError): string => {
  const [issue] = ParseResult.ArrayFormatter.formatErrorSync(error)
  if (issue === undefined) return "does not decode"
  const at = issue.path.map(String).join(".")
  const said = /^Expected (.*), actual (.*)$/s.exec(issue.message)
  const why =
    said === null
      ? clipped(issue.message)
      : `expected ${
          (said[1] ?? "").length <= SHOWN
            ? said[1]
            : at.endsWith("_tag")
              ? "one of the event tags"
              : "an event"
        }, got ${clipped(said[2] ?? "")}`
  return at === "" ? why : `${at}: ${why}`
}

/** A line of a log that will not decode: its number, from 1, and the issue it failed on. */
class LineUndecodable extends Data.TaggedError("LineUndecodable")<{
  readonly line: number
  readonly issue: string
}> {}

const decodedAt =
  <A>(decode: (line: unknown) => Effect.Effect<A, ParseResult.ParseError>) =>
  (line: unknown, i: number) =>
    decode(line).pipe(
      Effect.mapError((e) => new LineUndecodable({ line: i + 1, issue: issueOf(e) })),
    )

/** What `lines` replay to, as text to compare, or the first line that will not decode. */
const replayed = (of: LogOf, key: string, lines: readonly unknown[]) =>
  of === "trak"
    ? Effect.map(
        Effect.forEach(
          lines,
          decodedAt((line) => decodeEvent(line)),
        ),
        (history) => canonical(replayHistory(TrakId.make(key), history)),
      )
    : Effect.map(
        Effect.forEach(
          lines,
          decodedAt((line) => decodeGoalEvent(line)),
        ),
        (history) => canonical(replayGoal(GoalId.make(key), history)),
      )

/** The log `key` compared on both sides: what the target lacks, or why it is refused. */
const planOne = (from: LogSide, to: LogSide, of: LogOf, key: string) =>
  Effect.gen(function* () {
    const refused: string[] = []
    let lines = 0
    let transcript: readonly unknown[] = []
    for (const file of FILES) {
      const wanted = yield* from.lines(of, key, file)
      if (file === "transcript") transcript = wanted
      // Decoded before anything is written: a log the target took and then failed to
      // replay would sit there, and the fixed file would then read as a conflict with it.
      const decoded = file === "log" ? yield* Effect.either(replayed(of, key, wanted)) : undefined
      if (decoded?._tag === "Left")
        refused.push(`${of} ${key} line ${String(decoded.left.line)}: ${decoded.left.issue}`)
      const short = lacking(yield* to.lines(of, key, file), wanted)
      if (short === undefined) refused.push(`${of} ${key}: ${to.name} holds a different ${file}`)
      else lines += short
    }
    let views = 0
    const calls = of === "trak" ? yield* from.views(key, transcript) : []
    for (const call of calls) {
      const there = yield* to.view(key, call)
      if (there === undefined) views += 1
      else if (canonical(there) !== canonical(yield* from.view(key, call)))
        refused.push(`trak ${key}: ${to.name} holds a different view for ${call}`)
    }
    return { planned: { of, key, lines, views }, refused }
  })

/** Write what the target lacks of one planned log. */
const writeOne = (from: LogSide, to: LogSide, { of, key }: Planned) =>
  Effect.gen(function* () {
    let transcript: readonly unknown[] = []
    for (const file of FILES) {
      const wanted = yield* from.lines(of, key, file)
      if (file === "transcript") transcript = wanted
      const held = (yield* to.lines(of, key, file)).length
      yield* to.add(of, key, file, held, wanted.slice(held))
    }
    if (of !== "trak") return
    for (const call of yield* from.views(key, transcript)) {
      if ((yield* to.view(key, call)) === undefined)
        yield* to.saveView(key, call, yield* from.view(key, call))
    }
  })

/** Why the log `key` read back from the target is not the source's, or nothing where it is. */
const checkOne = (from: LogSide, to: LogSide, { of, key }: Planned) =>
  Effect.gen(function* () {
    const reasons: string[] = []
    const source = yield* from.lines(of, key, "log")
    const target = yield* to.lines(of, key, "log")
    const states = yield* Effect.either(
      Effect.all([replayed(of, key, source), replayed(of, key, target)]),
    )
    if (states._tag === "Left")
      reasons.push(`${of} ${key} line ${String(states.left.line)}: ${states.left.issue}`)
    else if (states.right[0] !== states.right[1])
      reasons.push(`${of} ${key}: replays to a different state from ${to.name}`)
    const sourceTranscript = yield* from.lines(of, key, "transcript")
    const counts: readonly (readonly [string, number, number])[] = [
      ["events", source.length, target.length],
      [
        "transcript lines",
        sourceTranscript.length,
        (yield* to.lines(of, key, "transcript")).length,
      ],
    ]
    for (const [what, a, b] of counts)
      if (a !== b)
        reasons.push(`${of} ${key}: ${String(a)} ${what}, and ${to.name} holds ${String(b)}`)
    if (of !== "trak") return reasons
    for (const call of yield* from.views(key, sourceTranscript)) {
      const there = yield* to.view(key, call)
      if (there === undefined || canonical(there) !== canonical(yield* from.view(key, call)))
        reasons.push(`trak ${key}: the view for ${call} did not arrive`)
    }
    return reasons
  })

/** What a move did: the logs it covered, what it wrote, and every reason it refused or failed. */
export interface Moved {
  readonly logs: number
  readonly lines: number
  readonly views: number
  /** Logs the target holds differently, or that will not decode. Non-empty means nothing was written. */
  readonly refused: readonly string[]
  /** Logs that did not read back as they went in. */
  readonly failed: readonly string[]
}

/** One log's plan, and every reason the target cannot take it. */
interface PlanOf {
  readonly planned: Planned
  readonly refused: readonly string[]
}

/** Every trak and goal `from` holds, planned against `to`. */
const planAll = (from: LogSide, to: LogSide, progress: Progress) =>
  Effect.gen(function* () {
    const keys: { of: LogOf; key: string }[] = []
    for (const of of KINDS) for (const key of yield* from.list(of)) keys.push({ of, key })
    const plans: PlanOf[] = []
    for (const { of, key } of keys) {
      plans.push(yield* planOne(from, to, of, key))
      progress("planning", plans.length, keys.length)
    }
    return plans
  })

/** `plans` written where the target lacks anything, then each read back: why any did not. */
const writeChecked = (from: LogSide, to: LogSide, plans: readonly Planned[], progress: Progress) =>
  Effect.gen(function* () {
    for (const [i, plan] of plans.entries()) {
      if (plan.lines + plan.views > 0) yield* writeOne(from, to, plan)
      progress("writing", i + 1, plans.length)
    }
    const failed: string[] = []
    for (const [i, plan] of plans.entries()) {
      failed.push(...(yield* checkOne(from, to, plan)))
      progress("reading back", i + 1, plans.length)
    }
    return failed
  })

const counted = (plans: readonly Planned[]) => ({
  lines: plans.reduce((n, p) => n + p.lines, 0),
  views: plans.reduce((n, p) => n + p.views, 0),
})

/** A log a move left out, and why the target could not take it. */
export interface LeftOut {
  readonly of: LogOf
  readonly key: string
  readonly reasons: readonly string[]
}

/**
 * Every trak and goal `from` holds, moved into `to` and checked there. A log the target holds
 * differently, or one that will not decode, is left out rather than refusing the rest: nothing
 * of it is written, and it is named in `left`. The target's copy is then the one that stands.
 * `progress` hears of each log as each phase finishes with it.
 */
export const moveLogsLeavingOut = (
  from: LogSide,
  to: LogSide,
  progress: Progress,
): Effect.Effect<{ readonly moved: Moved; readonly left: readonly LeftOut[] }, Failure> =>
  Effect.gen(function* () {
    const plans = yield* planAll(from, to, progress)
    const taken = plans.filter((p) => p.refused.length === 0).map((p) => p.planned)
    const left = plans.flatMap(({ planned, refused }) =>
      refused.length === 0 ? [] : [{ of: planned.of, key: planned.key, reasons: refused }],
    )
    const failed = yield* writeChecked(from, to, taken, progress)
    return { moved: { logs: taken.length, ...counted(taken), refused: [], failed }, left }
  })

/** A move's report, as the lines a command prints. */
export const movedLines = (verb: string, moved: Moved): readonly string[] => {
  if (moved.refused.length > 0)
    return [
      `${verb} refused, and nothing was written — a log the target holds differently, or one that will not decode:`,
      ...moved.refused.map((r) => `  ${r}`),
    ]
  const wrote =
    moved.lines + moved.views === 0
      ? "nothing new to write"
      : `${String(moved.lines)} lines and ${String(moved.views)} views written`
  const head = `${String(moved.logs)} trak and goal logs: ${wrote}`
  return moved.failed.length === 0
    ? [head, `every log replays to the same state on both sides`]
    : [
        head,
        `${String(moved.failed.length)} did not read back the same:`,
        ...moved.failed.map((r) => `  ${r}`),
      ]
}

/** The project's `.database/`. */
export const databaseOf = (root: string): Effect.Effect<string, Error> =>
  Effect.map(orkestraDir(root).pipe(Effect.mapError((e) => new Error(e.message))), (dir) =>
    join(dir, ".database"),
  )

/**
 * Opens the store a move writes into, in the caller's scope — a host's entry point's, in place
 * of the SQLite file.
 */
export type OpenStoreSide = (root: string) => Effect.Effect<LogSide, Error, Scope.Scope>

/**
 * The project's `.database/` files and its store, in the caller's scope: the store `open`
 * opens, or the SQLite file beside the files where there is none.
 */
export const storeSides = (root: string, open: OpenStoreSide | undefined) =>
  Effect.gen(function* () {
    const database = yield* databaseOf(root)
    const files = fileSide(database)
    if (open !== undefined) return { database, files, store: yield* open(root) }
    const path = sqliteStorePath(
      yield* Effect.mapError(orkestraDir(root), (e) => new Error(e.message)),
    )
    const db = yield* Effect.mapError(openSqliteLines(path), (e) => new Error(e.reason))
    return { database, files, store: sqliteSide(db, path) }
  })

/** What of a trak's or goal's directory is its log: never its `run.json`, which stays put. */
const LOG_FILES: readonly string[] = ["log.jsonl", "transcript.jsonl", "views"]

/**
 * Each file of a log under `database` a move covers, relative to it — a trak's or goal's
 * log, transcript and views. A trak's `run.json` sits beside them and is never one: it names
 * an agent running on this machine, which the boot after a move still reattaches by it.
 */
export const heldUnder = (database: string): readonly string[] =>
  ["traks", "goals"].flatMap((kind) => {
    const dir = join(database, kind)
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap((key) =>
      LOG_FILES.filter((file) => existsSync(join(dir, key, file))).map((file) =>
        join(kind, key, file),
      ),
    )
  })

/**
 * How far a long piece of a move has got: `done` of `total` in `phase`. Called after each
 * one, so a caller can print progress; nothing here paces it.
 */
export type Progress = (phase: string, done: number, total: number) => void

/** One file to set aside: its place under `.database/`, and its place under the aside directory. */
interface AsideMove {
  readonly from: string
  readonly to: string
}

/** A set-aside under way: the aside directory's name under `.database/`, and every move it makes. */
export interface AsidePlan {
  readonly aside: string
  readonly moves: readonly AsideMove[]
}

const AsidePlanJson = Schema.parseJson(
  Schema.Struct({
    aside: Schema.String,
    moves: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  }),
)

/**
 * The file in `.database/` that holds the `AsidePlan` of a set-aside under way, from before
 * its first rename until after its last. In `.database/` rather than in the aside directory,
 * and written whole by a rename, so a boot killed at any point either finds the whole plan or
 * finds that nothing was moved — never an aside directory it cannot tell is unfinished.
 */
const ASIDE_MARKER = "setting-aside.json"

/** The set-aside a boot was stopped partway through under `database`, or `undefined`. */
export const unfinishedAside = (database: string): Effect.Effect<AsidePlan | undefined, Error> =>
  Effect.gen(function* () {
    const marker = join(database, ASIDE_MARKER)
    if (!existsSync(marker)) return undefined
    const text = yield* Effect.tryPromise({
      try: () => readFile(marker, "utf8"),
      catch: (e) => new Error(`could not read ${marker}: ${String(e)}`),
    })
    return yield* Schema.decodeUnknown(AsidePlanJson)(text).pipe(
      Effect.mapError((e) => new Error(`${marker} does not hold a set-aside: ${e.message}`)),
    )
  })

/**
 * Every move of `plan` whose file is still under `database`, one after the other, then the
 * marker removed. A move already made is passed over, so a set-aside a kill stopped finishes
 * into the same directory. A rename that fails leaves the marker and the moves before it, and
 * fails: the boot does not go on with some logs in one place and the rest in another, and the
 * next boot finishes the move. Nothing is put back, because a kill could never put it back.
 */
export const finishAside = async (
  database: string,
  plan: AsidePlan,
  progress: Progress,
): Promise<void> => {
  const aside = join(database, plan.aside)
  for (const [i, { from, to }] of plan.moves.entries()) {
    const source = join(database, from)
    if (existsSync(source)) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- one at a time, so a failure knows which went before it
        await mkdir(dirname(join(aside, to)), { recursive: true })
        // oxlint-disable-next-line no-await-in-loop -- as above
        await rename(source, join(aside, to))
      } catch (e) {
        throw new Error(
          `could not move ${source} aside into ${aside}, so the engine does not boot; the next boot finishes the move: ${String(e)}`,
          { cause: e },
        )
      }
    }
    progress("setting the files aside", i + 1, plan.moves.length)
  }
  await rm(join(database, ASIDE_MARKER))
}

/** `plan` begun: its marker written whole, then every move made as `finishAside` makes them. */
export const setAside = async (
  database: string,
  plan: AsidePlan,
  progress: Progress,
): Promise<void> => {
  const marker = join(database, ASIDE_MARKER)
  await writeFile(`${marker}.tmp`, JSON.stringify(plan))
  await rename(`${marker}.tmp`, marker)
  await finishAside(database, plan, progress)
}

/** The name under `.database/` of the directory the files imported at `now` are moved aside to. */
export const asideAt = (now: number): string =>
  `imported-${new Date(now).toISOString().replaceAll(":", "-")}`
