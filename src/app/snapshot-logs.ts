// `snapshot_logs`, the read tool for bulk questions: every trak and goal the caller may read
// whose log has an event in a time window, written as JSON-lines files into the caller's own
// checkout, so an agent answers "where did recent traks spend their time" with `jq` rather
// than one `read_events` call per trak. The other read tools answer about one trak or goal
// at a time and the newest entries only; this one writes whole logs.
//
// **Every line is redacted before anything is measured**, so the size bound counts what is
// written. Over the bound whole files are left out, never part of one — transcripts first,
// then the traks and goals whose last event is oldest — and `index.json` lists each with
// why, and its size where it was read, so `jq` never reads a partial log.
//
// **The bound is spent as the files are made, not after**: the logs first, then the
// transcripts one at a time, so a wide window holds at most one transcript beyond what is
// written, and a transcript past the first that does not fit is never read. A transcript is
// a whole agent session, and this runs in the engine every other trak runs in.
//
// **The snapshot lands under `.orkestra/.snapshots/`, not `.orkestra/.trak/`**: the
// projection clears `.trak/` before every turn, and a later step may query the same
// snapshot. Under a runner it is one `tar -x` through `Sandboxes.place`; with none, this
// machine's disk. Writing into the checkout is work, so a stopped sandbox is started.

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Clock, Effect, Either, Option, Schema } from "effect"
import { TranscriptEntry } from "../agent/types/transcript-entry.js"
import { Sandboxes } from "../vcs/ports/sandboxes.js"
import { Event } from "../workflow/domain/event.js"
import { GoalEvent, goalName, replayGoal } from "../workflow/domain/goal.js"
import { replayHistory } from "../workflow/domain/replay.js"
import type { GoalId, Trak, TrakId } from "../workflow/domain/trak.js"
import { type EngineLogLine, EngineLog } from "../workflow/ports/engine-log.js"
import { GoalStore } from "../workflow/ports/goal-store.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed, StoreUndecodable } from "../workflow/ports/store-errors.js"
import { workdir } from "./drive.js"
import type { Readable } from "./people.js"
import { did, refused } from "./tool-answer.js"

/** Where in a checkout every snapshot goes, one directory per call. */
export const SNAPSHOTS = ".orkestra/.snapshots"

/** The bound where a call names none, and the largest one a call may name. */
const BYTES_DEFAULT = 25_000_000
const BYTES_MOST = 100_000_000
/** The window where a call names no `since` and no `hours`. */
const HOURS_DEFAULT = 24

export const SNAPSHOT_ARGS = Schema.Struct({
  since: Schema.optional(Schema.Date),
  hours: Schema.optional(Schema.Number.pipe(Schema.positive())),
  until: Schema.optional(Schema.Date),
  states: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
  name: Schema.optional(Schema.NonEmptyTrimmedString),
  transcripts: Schema.optional(Schema.Boolean),
  maxBytes: Schema.optional(Schema.Int.pipe(Schema.between(1000, BYTES_MOST))),
})

type SnapshotArgs = typeof SNAPSHOT_ARGS.Type

type Hide = (text: string) => string

/** A transcript's read, made only where the call asks for transcripts. */
type Read = Effect.Effect<readonly TranscriptEntry[], StoreFailed | StoreUndecodable>

/** Why a file is not in the snapshot. */
type Reason = "size-bound" | "undecodable"

/** One file of the snapshot, its text redacted, so its size is what is written. */
interface Planned {
  readonly path: string
  readonly text: string
  readonly bytes: number
}

/**
 * One trak or goal the window selected: its log and engine files, and its transcript's read,
 * made only once the logs are placed and only while the bound has room.
 */
interface Candidate {
  readonly kind: "trak" | "goal"
  readonly id: string
  readonly dir: string
  readonly title: string
  readonly state: string
  readonly first: number
  readonly last: number
  readonly files: readonly Planned[]
  readonly transcript: Read | undefined
}

interface Omitted {
  readonly path: string
  readonly bytes?: number
  readonly reason: Reason
  /** A transcript the bound left out before it was read, so its size is not known. */
  readonly unread?: true
}

/** A trak or goal the window selected, or a log that would not decode. */
type Found = { readonly candidate: Candidate } | { readonly unread: Omitted }

const iso = (at: number): string => new Date(at).toISOString()

/** The window and the filters, as one call decided them. */
interface Selecting {
  readonly since: number
  readonly until: number | undefined
  readonly states: readonly string[] | undefined
  readonly name: string | undefined
  readonly transcripts: boolean
}

const inWindow = (at: number | undefined, s: Selecting): boolean =>
  at !== undefined && at >= s.since && (s.until === undefined || at <= s.until)

const passes = (s: Selecting, id: string, title: string, state: string): boolean =>
  (s.states === undefined || s.states.some((w) => w.toLowerCase() === state.toLowerCase())) &&
  (s.name === undefined || `${id}\n${title}`.toLowerCase().includes(s.name.toLowerCase()))

/** One file of JSON lines, each redacted before it is joined, so the size is what is written. */
const planned = (path: string, lines: readonly string[], hide: Hide): Planned => {
  const text = lines.map((line) => `${hide(line)}\n`).join("")
  return { path, text, bytes: Buffer.byteLength(text) }
}

/** A record as the store encodes it, or its tag where it will not encode. */
const encoded = <A>(value: Either.Either<A, unknown>, tag: string): string =>
  Either.isRight(value) ? JSON.stringify(value.right) : JSON.stringify({ _tag: tag })

const eventLines = (events: readonly Event[]) =>
  events.map((e) => encoded(Schema.encodeEither(Event)(e), e._tag))

const goalEventLines = (events: readonly GoalEvent[]) =>
  events.map((e) => encoded(Schema.encodeEither(GoalEvent)(e), e._tag))

const transcriptLines = (entries: readonly TranscriptEntry[]) =>
  entries.map((e) => encoded(Schema.encodeEither(TranscriptEntry)(e), e._tag))

const times = (events: readonly { readonly at?: number | undefined }[]) =>
  events.flatMap((e) => (e.at === undefined ? [] : [e.at]))

/** The engine log's lines naming `id` and no trak or goal the caller may not read. */
const linesAbout = (lines: readonly EngineLogLine[], id: string, hidden: readonly string[]) =>
  lines
    .filter((l) => l.message.includes(id) && !hidden.some((h) => l.message.includes(h)))
    .map((l) => JSON.stringify({ at: iso(l.at), level: l.level, message: l.message }))

/** What every trak's and goal's files are built from beside its own log. */
interface Sources {
  readonly selecting: Selecting
  readonly hide: Hide
  readonly engine: readonly EngineLogLine[]
  readonly hidden: readonly string[]
}

/** One trak or goal whose log is read, or nothing where the window or a filter leaves it out. */
const selectOne = (
  head: {
    readonly kind: "trak" | "goal"
    readonly id: string
    readonly title: string
    readonly state: string
  },
  log: { readonly lines: readonly string[]; readonly at: readonly number[] },
  transcript: Read,
  src: Sources,
): readonly Found[] => {
  if (!log.at.some((at) => inWindow(at, src.selecting))) return []
  if (!passes(src.selecting, head.id, head.title, head.state)) return []
  const dir = `${head.kind}s/${head.id}`
  const engine = linesAbout(src.engine, head.id, src.hidden)
  const candidate: Candidate = {
    ...head,
    dir,
    first: Math.min(...log.at),
    last: Math.max(...log.at),
    files: [
      planned(`${dir}/log.jsonl`, log.lines, src.hide),
      ...(engine.length === 0 ? [] : [planned(`${dir}/engine.jsonl`, engine, src.hide)]),
    ],
    transcript: src.selecting.transcripts ? transcript : undefined,
  }
  return [{ candidate }]
}

/** A log that will not decode is listed as left out, whatever the window. */
const undecodable = (kind: "trak" | "goal", id: string): readonly Found[] => [
  { unread: { path: `${kind}s/${id}/log.jsonl`, reason: "undecodable" } },
]

const selectTraks = (ids: readonly TrakId[], src: Sources) =>
  Effect.flatMap(Store, (store) =>
    Effect.forEach(ids, (id) =>
      store.events(id).pipe(
        Effect.map((events) => {
          const trak = replayHistory(id, events)
          const head = {
            kind: "trak" as const,
            id,
            title: trak.plan?.title ?? trak.description,
            state: trak.state._tag,
          }
          return selectOne(
            head,
            { lines: eventLines(events), at: times(events) },
            store.transcript(id),
            src,
          )
        }),
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undecodable("trak", id))),
      ),
    ),
  )

const selectGoals = (ids: readonly GoalId[], src: Sources) =>
  Effect.flatMap(GoalStore, (store) =>
    Effect.forEach(ids, (id) =>
      store.events(id).pipe(
        Effect.map((events) => {
          const goal = replayGoal(id, events)
          if (goal === undefined) return []
          const head = { kind: "goal" as const, id, title: goalName(goal), state: goal.state._tag }
          return selectOne(
            head,
            { lines: goalEventLines(events), at: times(events) },
            store.transcript(id),
            src,
          )
        }),
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undecodable("goal", id))),
      ),
    ),
  )

/**
 * `index.json` in pieces, each entry's JSON redacted on its own, so what an entry adds to
 * the index is known as it is added: its bytes and a comma. The index is compact JSON for
 * that reason — indentation would make an entry's cost depend on its neighbors.
 */
interface IndexParts {
  readonly meta: string
  readonly selected: string[]
  readonly files: string[]
  readonly omitted: string[]
}

const renderIndex = (p: IndexParts): string =>
  `${p.meta.slice(0, -1)},"selected":[${p.selected.join(",")}],"files":[${p.files.join(",")}],"omitted":[${p.omitted.join(",")}]}\n`

/** What one entry adds to the index, at most: its bytes, and the comma before it. */
const costOf = (piece: string): number => Buffer.byteLength(piece) + 1

const selectedEntry = (c: Candidate) =>
  JSON.stringify({
    kind: c.kind,
    id: c.id,
    title: c.title,
    state: c.state,
    first: iso(c.first),
    last: iso(c.last),
  })

const fileEntry = (f: Planned) => JSON.stringify({ path: f.path, bytes: f.bytes })

const sizeBound = (f: Planned): Omitted => ({ path: f.path, bytes: f.bytes, reason: "size-bound" })

const unreadTranscript = (c: Candidate): Omitted => ({
  path: `${c.dir}/transcript.jsonl`,
  reason: "size-bound",
  unread: true,
})

/**
 * A transcript's omission as the index may carry it — read and too large, with its size —
 * at the widest that size can be written, so the room kept for it is never short.
 */
const WIDEST_BYTES = Number.MAX_SAFE_INTEGER

/**
 * The bound, spent as the files are made. Room is kept first for every omission the index
 * could have to list. Then each trak's or goal's log and engine files are kept, newest last
 * event first, until one does not fit — it and every older one are left out whole. Then the
 * kept ones' transcripts are read one at a time, newest first, until one does not fit; it is
 * listed with its size, and every transcript after it is listed unread, never read at all.
 * So transcripts go before any log, and the oldest traks and goals before newer ones.
 */
const spend = (
  candidates: readonly Candidate[],
  unread: readonly Omitted[],
  meta: string,
  maxBytes: number,
  hide: Hide,
) =>
  Effect.gen(function* () {
    const entry = (json: string) => hide(json)
    const index: IndexParts = { meta: entry(meta), selected: [], files: [], omitted: [] }
    const files: Planned[] = []
    const omitted: Omitted[] = [...unread]
    const newestFirst = candidates.toSorted((a, b) => b.last - a.last)
    const reserved = newestFirst.flatMap((c) => [
      ...c.files.map(sizeBound),
      ...(c.transcript === undefined
        ? []
        : [{ path: `${c.dir}/transcript.jsonl`, bytes: WIDEST_BYTES, reason: "size-bound" }]),
    ])
    let left =
      maxBytes -
      Buffer.byteLength(renderIndex(index)) -
      [...unread, ...reserved].reduce((sum, o) => sum + costOf(entry(JSON.stringify(o))), 0)

    const kept: Candidate[] = []
    let fitting = true
    for (const c of newestFirst) {
      const pieces = c.files.map((f) => entry(fileEntry(f)))
      const head = entry(selectedEntry(c))
      const cost =
        c.files.reduce((sum, f) => sum + f.bytes, 0) +
        pieces.reduce((sum, p) => sum + costOf(p), costOf(head))
      fitting = fitting && cost <= left
      if (fitting) {
        kept.push(c)
        files.push(...c.files)
        index.selected.push(head)
        index.files.push(...pieces)
        left -= cost
      } else {
        omitted.push(...c.files.map(sizeBound))
        if (c.transcript !== undefined) omitted.push(unreadTranscript(c))
      }
    }

    let reading = true
    for (const c of kept) {
      if (c.transcript === undefined) continue
      if (!reading) {
        omitted.push(unreadTranscript(c))
        continue
      }
      const read = yield* Effect.either(
        Effect.catchTag(c.transcript, "StoreUndecodable", () => Effect.succeed(undefined)),
      )
      if (Either.isLeft(read)) return yield* Effect.fail(read.left)
      const path = `${c.dir}/transcript.jsonl`
      if (read.right === undefined) {
        omitted.push({ path, reason: "undecodable" })
        continue
      }
      if (read.right.length === 0) continue
      const f = planned(path, transcriptLines(read.right), hide)
      const piece = entry(fileEntry(f))
      const cost = f.bytes + costOf(piece)
      if (cost <= left) {
        files.push(f)
        index.files.push(piece)
        left -= cost
      } else {
        reading = false
        omitted.push(sizeBound(f))
      }
    }
    index.omitted.push(...omitted.map((o) => entry(JSON.stringify(o))))
    return { files, omitted, index, kept }
  })

/** Write `files` under `dir` in the caller's checkout: one `tar -x` in its sandbox, or this machine's disk. */
const writeOut = (dir: string, files: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    const place = sandboxes === undefined ? undefined : yield* sandboxes.placeOf(dir)
    if (sandboxes !== undefined && place !== undefined)
      return yield* Effect.mapError(sandboxes.place(place, files, true), (e) => e.reason)
    return yield* Effect.try({
      try: () => {
        rmSync(dir, { recursive: true, force: true })
        for (const [name, text] of files) {
          mkdirSync(dirname(join(dir, name)), { recursive: true })
          writeFileSync(join(dir, name), text)
        }
      },
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    })
  })

/** The window the call names: `since`, else `hours` back from now, else the default hours. */
const selectingOf = (a: SnapshotArgs, now: number): Selecting => ({
  since: a.since?.getTime() ?? now - (a.hours ?? HOURS_DEFAULT) * 3_600_000,
  until: a.until?.getTime(),
  states: a.states,
  name: a.name,
  transcripts: a.transcripts ?? false,
})

/**
 * One snapshot by `caller`, of what `readable` lets it read. `hide` is the call's redactor,
 * so a secret found in any file is counted in the note the answer carries.
 */
export const snapshotLogs = (caller: Trak, a: SnapshotArgs, readable: Readable, hide: Hide) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const selecting = selectingOf(a, now)
    if (a.since !== undefined && a.hours !== undefined)
      return refused({ badArguments: "Name `since` or `hours`, not both." })
    const traks = yield* (yield* Store).list()
    const goals = yield* (yield* GoalStore).list()
    const readTraks = traks.filter((id) => readable.trak(id))
    const readGoals = goals.filter((id) => readable.goal(id))
    const hidden = [
      ...traks.filter((id) => !readable.trak(id)),
      ...goals.filter((id) => !readable.goal(id)),
    ]
    const src: Sources = { selecting, hide, engine: yield* (yield* EngineLog).lines, hidden }
    const found = [
      ...(yield* selectTraks(readTraks, src)).flat(),
      ...(yield* selectGoals(readGoals, src)).flat(),
    ]
    const candidates = found.flatMap((f) => ("candidate" in f ? [f.candidate] : []))
    const unread = found.flatMap((f) => ("unread" in f ? [f.unread] : []))
    const maxBytes = a.maxBytes ?? BYTES_DEFAULT
    const meta = JSON.stringify({
      takenAt: iso(now),
      window: {
        since: iso(selecting.since),
        ...(selecting.until === undefined ? {} : { until: iso(selecting.until) }),
      },
      filters: {
        states: selecting.states,
        name: selecting.name,
        transcripts: selecting.transcripts,
      },
      maxBytes,
      ...(hidden.length === 0
        ? {}
        : {
            notReadable: {
              traks: traks.length - readTraks.length,
              goals: goals.length - readGoals.length,
              readsOnly: readable.readsOnly,
            },
          }),
    })
    const {
      files: kept,
      omitted,
      index,
      kept: shown,
    } = yield* spend(candidates, unread, meta, maxBytes, hide)
    const stamp = iso(now).replaceAll(":", "-")
    const files = new Map([
      ...kept.map((f) => [f.path, f.text] as const),
      ["index.json", renderIndex(index)],
    ])
    const written = yield* Effect.either(
      writeOut(resolve(workdir(caller), SNAPSHOTS, stamp), files),
    )
    if (Either.isLeft(written)) return refused({ snapshotFailed: written.left })
    return did({
      snapshotAt: `${SNAPSHOTS}/${stamp}/`,
      snapshotTraks: String(shown.filter((s) => s.kind === "trak").length),
      snapshotGoals: String(shown.filter((s) => s.kind === "goal").length),
      snapshotFiles: String(kept.length),
      snapshotBytes: String([...files.values()].reduce((sum, t) => sum + Buffer.byteLength(t), 0)),
      snapshotOmitted: omitted.map((o) => ({
        path: o.path,
        sizeBound: o.reason === "size-bound",
        undecodable: o.reason === "undecodable",
        unread: o.unread === true,
        bytes: o.bytes === undefined ? undefined : String(o.bytes),
      })),
      ...(hidden.length === 0 || readable.readsOnly === undefined
        ? {}
        : { readsOnly: readable.readsOnly }),
    })
  })
