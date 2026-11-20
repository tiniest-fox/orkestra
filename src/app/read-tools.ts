// The engine's read tools, offered to every agent's turn on the `orkestra-trak` server and,
// but for `snapshot_logs`, to a goal's composer: what an agent reads to investigate a trak or
// a goal, since none of the engine host's files are on a sandbox's disk. Each reads through `Store`, `GoalStore`, `TurnTools`
// and `EngineLog`, answers the newest entries rather than a whole log, and asks
// `People.readable` first which traks and goals the caller may name. A refusal or a list that
// leaves one out says why, in `readsOnly`. Nothing here acts.
//
// The answer's secrets are taken out where every tool's are, in `trakToolCall` and in the
// goal's tool route.

import { Effect, Either, Schema } from "effect"
import { TranscriptEntry } from "../agent/types/transcript-entry.js"
import { Event } from "../workflow/domain/event.js"
import { type Goal, GoalEvent, goalOffers, replayGoal } from "../workflow/domain/goal.js"
import { artifactKey } from "../workflow/domain/outputs/proposal.js"
import { projection } from "../workflow/domain/projection.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { GoalId, type Trak, TrakId } from "../workflow/domain/trak.js"
import { Archive } from "../workflow/ports/archive.js"
import type { Idle } from "../workflow/ports/idle.js"
import { EngineLog } from "../workflow/ports/engine-log.js"
import { GoalStore } from "../workflow/ports/goal-store.js"
import type { Locks } from "../workflow/ports/locks.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import { type LiveTurn, TurnTools } from "../workflow/ports/turn-tools.js"
import { liveTrak } from "./archive.js"
import { GoalDrives } from "./goal-drives.js"
import { type Item, People, type Readable } from "./people.js"
import { SNAPSHOT_ARGS, snapshotLogs } from "./snapshot-logs.js"
import { type Answer, did, refused, withArgs } from "./tool-answer.js"

/** How many entries a read answers with where the call names no `newest`, and at most. */
const NEWEST_DEFAULT = 30
const NEWEST_MOST = 200
/** One entry's JSON past this many characters is cut, so one artifact cannot fill a reply. */
const ENTRY_CHARS = 2000
/** The most archived traks one `list_traks` answers, as the web list's archived search caps. */
const ARCHIVED_MOST = 50

const NEWEST = Schema.optional(Schema.Int.pipe(Schema.between(1, NEWEST_MOST)))
const TRAK_OR_GOAL = Schema.Struct({
  trak: Schema.optional(Schema.NonEmptyTrimmedString),
  goal: Schema.optional(Schema.NonEmptyTrimmedString),
  newest: NEWEST,
})

/**
 * Each read tool's arguments, in the order they are listed. The description is the template
 * `trak/tool-<name>`, as every engine tool's is.
 */
export const READ_TOOLS = {
  turn_status: Schema.Struct({}),
  list_traks: Schema.Struct({
    archived: Schema.optional(Schema.Boolean),
    matching: Schema.optional(Schema.String),
  }),
  read_trak: Schema.Struct({ trak: Schema.NonEmptyTrimmedString }),
  read_artifact: Schema.Struct({
    trak: Schema.NonEmptyTrimmedString,
    name: Schema.NonEmptyTrimmedString,
  }),
  list_goals: Schema.Struct({}),
  read_goal: Schema.Struct({ goal: Schema.NonEmptyTrimmedString, newest: NEWEST }),
  read_transcript: TRAK_OR_GOAL,
  read_events: TRAK_OR_GOAL,
  engine_log: Schema.Struct({
    about: Schema.optional(Schema.NonEmptyTrimmedString),
    newest: NEWEST,
  }),
  snapshot_logs: SNAPSHOT_ARGS,
} as const

export type ReadTool = keyof typeof READ_TOOLS

export const isReadTool = (name: string): name is ReadTool => Object.hasOwn(READ_TOOLS, name)

export const readToolNames = (): readonly ReadTool[] => Object.keys(READ_TOOLS).filter(isReadTool)

/** The read tools a goal's composer is offered: all but `snapshot_logs`, which writes into a checkout a goal has none of. */
export const goalReadToolNames = (): readonly ReadTool[] =>
  readToolNames().filter((name) => name !== "snapshot_logs")

/** Who makes a read call: a step's turn on its trak, or a goal's composer. */
export type Reader =
  | { readonly kind: "trak"; readonly trak: Trak }
  | { readonly kind: "goal"; readonly goal: Goal }

const iso = (at: number | undefined): string | undefined =>
  at === undefined ? undefined : new Date(at).toISOString()

/** Takes every secret out of a text before anything here shortens it. */
type Hide = (text: string) => string

const cut = (text: string): string =>
  text.length <= ENTRY_CHARS ? text : `${text.slice(0, ENTRY_CHARS)} … (cut)`

/** A refusal of a trak or goal the caller may not read, with why. */
const unreadable = (kind: "trak" | "goal", id: string, readable: Readable): Answer =>
  refused({ notReadable: `${kind} \`${id}\``, readsOnly: readable.readsOnly })

/** Why, where `left` says a list left out something the caller may not read. */
const leftOut = (readable: Readable, left: boolean) =>
  left && readable.readsOnly !== undefined ? { readsOnly: readable.readsOnly } : {}

/** A failed or unreadable store, as the call's refusal rather than the route's error. */
const orUnread = <A, R>(
  read: Effect.Effect<
    A,
    { readonly _tag: "StoreFailed" | "StoreUndecodable"; readonly reason: string },
    R
  >,
) => Effect.catchAll(read, (e) => Effect.succeed(refused({ storeFailed: e.reason })))

/** Where a trak stands, as a row of `list_traks` and the head of `read_trak` give it. */
const standing = (trak: Trak) => {
  const at = "step" in trak.state ? trak.state.step : undefined
  const entry = at === undefined ? undefined : trak.plan?.steps[at]
  return {
    id: trak.id,
    title: trak.plan?.title ?? trak.description,
    state: trak.state._tag,
    ...(at === undefined || entry === undefined ? {} : { step: artifactKey(entry, at) }),
    ...(trak.goal === undefined ? {} : { goal: trak.goal }),
  }
}

/** Every live trak the caller may read but its own, where it has one. An undecodable log is left out, as the list leaves it. */
const listTraks = (caller: TrakId | undefined, readable: Readable) =>
  Effect.gen(function* () {
    const others = (yield* (yield* Store).list()).filter((id) => id !== caller)
    const ids = others.filter((id) => readable.trak(id))
    const rows = yield* Effect.forEach(ids, (id) =>
      liveTrak(id).pipe(
        Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)),
        Effect.map((live) => (live === undefined ? [] : [standing(live.trak)])),
      ),
    )
    const traks = rows.flat()
    return did({
      ...(traks.length === 0 ? { noTraks: true } : { traks }),
      ...leftOut(readable, ids.length < others.length),
    })
  })

/**
 * The archived traks the caller may read whose title or id holds `text` — out of the set
 * `Archive` keeps, so no log is opened and a row is its id and title alone.
 *
 * **Every match is asked for, and the cap applies after the readability filter.** Capping
 * first lets traks the caller may not read fill the 50 places, and a member whose own sort
 * after them is told nothing matches. The set is in memory, so the whole match is cheap.
 */
const listArchived = (caller: TrakId | undefined, readable: Readable, text: string) =>
  Effect.gen(function* () {
    const found = yield* (yield* Archive).matching(text, Number.POSITIVE_INFINITY)
    const others = found.filter((t) => t.id !== caller)
    const readableOnes = others.filter((t) => readable.trak(t.id))
    const traks = readableOnes.slice(0, ARCHIVED_MOST)
    return did({
      ...(traks.length === 0 ? { noArchived: true } : { archivedTraks: traks }),
      ...(readableOnes.length > ARCHIVED_MOST ? { archivedCut: ARCHIVED_MOST } : {}),
      ...leftOut(readable, readableOnes.length < others.length),
    })
  })

/** The trak a call names, archived or not, or its refusal. */
const namedTrak = (named: string, readable: Readable) =>
  Effect.gen(function* () {
    const id = TrakId.make(named)
    if (!readable.trak(id)) return unreadable("trak", named, readable)
    if (!(yield* listed({ kind: "trak", id }, readable))) return refused({ noTrak: named })
    const events = yield* (yield* Store).events(id)
    if (events.length === 0) return refused({ noTrak: named })
    return replayHistory(id, events)
  })

/**
 * One trak's standing and the name of each document it has filed — what its own steps read
 * as their files — but none of their text, which `read_artifact` answers one at a time.
 */
const readTrak = (named: string, readable: Readable) =>
  Effect.map(namedTrak(named, readable), (trak) =>
    "said" in trak
      ? trak
      : did({
          read: standing(trak),
          artifacts: [...projection(trak, undefined).keys()].map((name) => ({ name })),
        }),
  )

/**
 * One document of a trak in full, by the name `read_trak` lists, with or without its `.md`.
 * Not cut to length: one document is what the caller asked for.
 */
const readArtifact = (named: string, artifact: string, readable: Readable) =>
  Effect.map(namedTrak(named, readable), (trak) => {
    if ("said" in trak) return trak
    const files = projection(trak, undefined)
    const name = files.has(artifact) ? artifact : `${artifact}.md`
    const text = files.get(name)
    return text === undefined
      ? refused({ noArtifact: artifact, ofTrak: named })
      : did({ artifactOf: named, artifactName: name, artifactText: text })
  })

/** Where a trak's turn stands on its plan: the step's key, or the composer. */
const positionOf = (id: TrakId, position: number | "composer") =>
  Effect.gen(function* () {
    if (position === "composer") return "the composer"
    const events = yield* (yield* Store).events(id).pipe(Effect.orElseSucceed(() => []))
    const entry = replayHistory(id, events).plan?.steps[position]
    return entry === undefined ? `step ${String(position)}` : `\`${artifactKey(entry, position)}\``
  })

const turnRow = (turn: LiveTurn) =>
  Effect.gen(function* () {
    const owner = turn.owner
    return {
      trak: owner.kind === "trak" ? owner.id : undefined,
      goal: owner.kind === "goal" ? owner.id : undefined,
      position: owner.kind === "trak" ? yield* positionOf(owner.id, owner.position) : undefined,
      started: iso(turn.startedAt),
      lastEvent: iso(turn.lastEventAt),
      pid: turn.pid === undefined ? undefined : String(turn.pid),
      // A sandbox is the trak's own, found by its id.
      sandbox: turn.execId !== undefined && owner.kind === "trak" ? owner.id : undefined,
      execId: turn.execId,
    }
  })

/** Every turn the engine holds live that the caller may read: a trak's step or composer, or a goal's. */
const turnStatus = (readable: Readable) =>
  Effect.gen(function* () {
    const all = yield* (yield* TurnTools).lives
    const lives = all.filter((t) =>
      t.owner.kind === "trak" ? readable.trak(t.owner.id) : readable.goal(t.owner.id),
    )
    const why = leftOut(readable, lives.length < all.length)
    if (lives.length === 0) return did({ noTurns: true, ...why })
    return did({ turns: yield* Effect.forEach(lives, turnRow), ...why })
  })

/** A goal's title: its spec's, its draft's, or the sentence it was asked with. */
const goalTitle = (goal: Goal): string =>
  goal.spec?.title ?? goal.draft?.title ?? goal.asked ?? "(untitled)"

const goalRow = (goal: Goal) =>
  Effect.gen(function* () {
    const running = yield* (yield* GoalDrives).running(goal.id)
    const live = goal.traks.filter((t) => t.status === "live").length
    return {
      id: goal.id,
      title: goalTitle(goal),
      state: goal.state._tag === "AtGate" ? `AtGate (${goal.state.gate})` : goal.state._tag,
      running: running ? "a composer turn is running" : "no composer turn is running",
      paused: goal.paused ? "paused" : undefined,
      owed: goal.owed?._tag,
      offers: goalOffers(goal.state)
        .filter((a) => !(running && a === "Retry"))
        .join(", "),
      trakCount: `${String(goal.traks.length)} traks, ${String(live)} live`,
    }
  })

const goalsReadable = (readable: Readable) =>
  Effect.gen(function* () {
    const store = yield* GoalStore
    const every = yield* store.list()
    const ids = every.filter((id) => readable.goal(id))
    const goals = yield* Effect.forEach(ids, (id) =>
      store.events(id).pipe(
        Effect.map((log) => [replayGoal(id, log)]),
        Effect.catchTag("StoreUndecodable", () => Effect.succeed([])),
      ),
    )
    return {
      goals: goals.flat().flatMap((g) => (g === undefined ? [] : [g])),
      left: ids.length < every.length,
    }
  })

/** Every goal the caller may read, with where each stands. */
const listGoals = (readable: Readable) =>
  Effect.gen(function* () {
    const { goals, left } = yield* goalsReadable(readable)
    const why = leftOut(readable, left)
    if (goals.length === 0) return did({ noGoals: true, ...why })
    return did({ goals: yield* Effect.forEach(goals, goalRow), ...why })
  })

/** One entry of a log as the raw value the store keeps — encoded as the store writes it — with its time. */
const entryRow = <A>(
  hide: Hide,
  at: number | undefined,
  encoded: Either.Either<A, unknown>,
  tag: string,
) => ({
  at: iso(at) ?? "(no time)",
  raw: cut(hide(Either.isRight(encoded) ? JSON.stringify(encoded.right) : `{"_tag":"${tag}"}`)),
})

const eventRows = (events: readonly Event[], newest: number, hide: Hide) =>
  events.slice(-newest).map((e) => entryRow(hide, e.at, Schema.encodeEither(Event)(e), e._tag))

const goalEventRows = (events: readonly GoalEvent[], newest: number, hide: Hide) =>
  events.slice(-newest).map((e) => entryRow(hide, e.at, Schema.encodeEither(GoalEvent)(e), e._tag))

const transcriptRows = (entries: readonly TranscriptEntry[], newest: number, hide: Hide) =>
  entries
    .slice(-newest)
    .map((e) => entryRow(hide, e.at, Schema.encodeEither(TranscriptEntry)(e), e._tag))

/** One goal: where it stands, its traks, and its newest events. */
const readGoal = (named: string, newest: number, readable: Readable, hide: Hide) =>
  Effect.gen(function* () {
    const id = GoalId.make(named)
    if (!readable.goal(id)) return unreadable("goal", named, readable)
    if (!(yield* listed({ kind: "goal", id }, readable))) return refused({ noGoal: named })
    const events = yield* (yield* GoalStore).events(id)
    const goal = events.length === 0 ? undefined : replayGoal(id, events)
    if (goal === undefined) return refused({ noGoal: named })
    return did({
      goalRead: yield* goalRow(goal),
      goalTraks: goal.traks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      entriesOf: `goal \`${named}\``,
      newestEvents: String(Math.min(newest, events.length)),
      entries: goalEventRows(events, newest, hide),
    })
  })

type Named =
  | { readonly kind: "trak"; readonly id: TrakId }
  | { readonly kind: "goal"; readonly id: GoalId }

/** The one trak or goal a call names, or its refusal. */
const namedIn = (
  a: { readonly trak?: string | undefined; readonly goal?: string | undefined },
  readable: Readable,
): Named | Answer => {
  if ((a.trak === undefined) === (a.goal === undefined)) return refused({ oneOf: true })
  if (a.trak !== undefined) {
    const id = TrakId.make(a.trak)
    return readable.trak(id) ? { kind: "trak", id } : unreadable("trak", a.trak, readable)
  }
  const id = GoalId.make(a.goal ?? "")
  return readable.goal(id) ? { kind: "goal", id } : unreadable("goal", id, readable)
}

const isAnswer = (named: Named | Answer): named is Answer => "said" in named

/**
 * Whether the caller may read `named` and the store lists it. An id is the agent's string
 * and may hold a `/`, so it is checked against the listing before it reaches a path.
 */
const listed = (
  named: Named,
  readable: Readable,
): Effect.Effect<boolean, StoreFailed, Store | GoalStore> =>
  named.kind === "trak"
    ? Effect.map(
        Effect.flatMap(Store, (store) => store.list()),
        (ids) => readable.trak(named.id) && ids.includes(named.id),
      )
    : Effect.map(
        Effect.flatMap(GoalStore, (store) => store.list()),
        (ids) => readable.goal(named.id) && ids.includes(named.id),
      )

/** The newest entries of a trak's or a goal's transcript, each with its position on a trak. */
const readTranscript = (named: Named, newest: number, hide: Hide) =>
  Effect.gen(function* () {
    const entries =
      named.kind === "trak"
        ? yield* (yield* Store).transcript(named.id)
        : yield* (yield* GoalStore).transcript(named.id)
    if (entries.length === 0) return did({ emptyLog: `${named.kind} \`${named.id}\`` })
    return did({
      entriesOf: `${named.kind} \`${named.id}\`'s transcript`,
      newestEvents: String(Math.min(newest, entries.length)),
      entries: transcriptRows(entries, newest, hide),
    })
  })

/** The newest events of a trak's or a goal's log, as the store keeps them. */
const readEvents = (named: Named, newest: number, hide: Hide) =>
  Effect.gen(function* () {
    const rows =
      named.kind === "trak"
        ? eventRows(yield* (yield* Store).events(named.id), newest, hide)
        : goalEventRows(yield* (yield* GoalStore).events(named.id), newest, hide)
    if (rows.length === 0)
      return refused(named.kind === "trak" ? { noTrak: named.id } : { noGoal: named.id })
    return did({
      entriesOf: `${named.kind} \`${named.id}\`'s event log`,
      newestEvents: String(rows.length),
      entries: rows,
    })
  })

/**
 * The newest warning and error lines the engine logged, those naming `about` where it is
 * given — a line matches the trak or goal whose id it contains. A line naming a trak or
 * goal the caller may not read is left out.
 */
const engineLog = (about: string | undefined, newest: number, readable: Readable, hide: Hide) =>
  Effect.gen(function* () {
    if (
      about !== undefined &&
      !readable.trak(TrakId.make(about)) &&
      !readable.goal(GoalId.make(about))
    )
      return unreadable("trak", about, readable)
    const hidden = [
      ...(yield* (yield* Store).list()).filter((id) => !readable.trak(id)),
      ...(yield* (yield* GoalStore).list()).filter((id) => !readable.goal(id)),
    ]
    const matching = (yield* (yield* EngineLog).lines).filter(
      (l) => about === undefined || l.message.includes(about),
    )
    const lines = matching.filter((l) => !hidden.some((id) => l.message.includes(id)))
    const why = leftOut(readable, lines.length < matching.length)
    if (lines.length === 0) return did({ noLogLines: true, ...why })
    return did({
      ...why,
      logLines: lines.slice(-newest).map((l) => ({
        at: iso(l.at),
        level: l.level,
        message: cut(hide(l.message)),
      })),
    })
  })

const callerOf = (reader: Reader): Item =>
  reader.kind === "trak" ? { trak: reader.trak.id } : { goal: reader.goal.id }

/**
 * One call on a read tool, by a trak's turn or a goal's composer. `hide` takes the secrets
 * out of each entry before the entry is cut to length, so a cut cannot keep part of one.
 */
export const readCall = (reader: Reader, name: ReadTool, args: unknown, hide: Hide) =>
  Effect.flatMap(
    Effect.flatMap(People, (people) => people.readable(callerOf(reader))),
    (readable) => readMove(reader, name, args, readable, hide),
  )

/** What a read tool reads through. */
type ReadDeps = Store | GoalStore | GoalDrives | TurnTools | EngineLog | Archive | Idle | Locks

const readMove = (
  reader: Reader,
  name: ReadTool,
  args: unknown,
  readable: Readable,
  hide: Hide,
): Effect.Effect<Answer, StoreFailed, ReadDeps> => {
  const own = reader.kind === "trak" ? reader.trak.id : undefined
  switch (name) {
    case "turn_status":
      return withArgs(READ_TOOLS.turn_status, args, () => turnStatus(readable))
    case "list_traks":
      return withArgs(READ_TOOLS.list_traks, args, (a) =>
        a.archived === true
          ? listArchived(own, readable, a.matching ?? "")
          : a.matching === undefined
            ? listTraks(own, readable)
            : Effect.succeed(refused({ matchingAlone: true })),
      )
    case "read_trak":
      return withArgs(READ_TOOLS.read_trak, args, (a) => orUnread(readTrak(a.trak, readable)))
    case "read_artifact":
      return withArgs(READ_TOOLS.read_artifact, args, (a) =>
        orUnread(readArtifact(a.trak, a.name, readable)),
      )
    case "list_goals":
      return withArgs(READ_TOOLS.list_goals, args, () => orUnread(listGoals(readable)))
    case "read_goal":
      return withArgs(READ_TOOLS.read_goal, args, (a) =>
        orUnread(readGoal(a.goal, a.newest ?? NEWEST_DEFAULT, readable, hide)),
      )
    case "read_transcript":
    case "read_events":
      return withArgs(READ_TOOLS[name], args, (a) => {
        const named = namedIn(a, readable)
        if (isAnswer(named)) return Effect.succeed(named)
        const newest = a.newest ?? NEWEST_DEFAULT
        const read = Effect.flatMap(listed(named, readable), (known) =>
          !known
            ? Effect.succeed(
                refused(named.kind === "trak" ? { noTrak: named.id } : { noGoal: named.id }),
              )
            : name === "read_events"
              ? readEvents(named, newest, hide)
              : readTranscript(named, newest, hide),
        )
        return orUnread(read)
      })
    case "engine_log":
      return withArgs(READ_TOOLS.engine_log, args, (a) =>
        orUnread(engineLog(a.about, a.newest ?? NEWEST_DEFAULT, readable, hide)),
      )
    case "snapshot_logs":
      // A goal is never offered it: it has no checkout to write into.
      return reader.kind === "goal"
        ? Effect.succeed(refused({ toolNotOffered: name }))
        : withArgs(READ_TOOLS.snapshot_logs, args, (a) =>
            orUnread(snapshotLogs(reader.trak, a, readable, hide)),
          )
  }
}
