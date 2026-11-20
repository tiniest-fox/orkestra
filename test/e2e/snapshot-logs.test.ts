// `snapshot_logs` over memory stores holding traks and goals of two owners, on a host with
// two users: which traks and goals it writes, the window and the filters, the redaction,
// the size bound, and the one `place` it makes through a runner. Each snapshot is written
// into a checkout the test made, never the live `.orkestra/`. The route, and the note the
// answer carries when it redacted something, are `engine-tools.test.ts`'s.

import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { Effect, Layer, Ref, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { NoteEntry } from "../../src/agent/types/transcript-entry.js"
import { People, type PeopleShape, PublicPeopleLayer } from "../../src/app/people.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { redactor } from "../../src/app/redact.js"
import { SNAPSHOTS, snapshotLogs } from "../../src/app/snapshot-logs.js"
import { BranchName, CommitSha, WorktreePath } from "../../src/vcs/index.js"
import type { CheckoutPlace } from "../../src/vcs/logic/paths.js"
import { Sandboxes, type SandboxesShape } from "../../src/vcs/ports/sandboxes.js"
import { MemoryGoalStoreLayer } from "../../src/workflow/adapters/goal-store-memory.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { GoalEvents } from "../../src/workflow/domain/goal.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { GoalId, TrakId, UserId } from "../../src/workflow/domain/trak.js"
import { EngineLog, type EngineLogLine } from "../../src/workflow/ports/engine-log.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { Store } from "../../src/workflow/ports/store.js"
import { settableClock } from "../support/clock.js"

const ANN = UserId.make("gh:1")
const BEN = UserId.make("gh:2")
const HOUR = 3_600_000
/** When each snapshot is taken. */
const NOW = Date.parse("2026-10-01T12:00:00.000Z")
const SECRET = "deploy-token-0123456789"
/** The size of the one large transcript entry. */
const LARGE = 20_000

const CALLER = TrakId.make("ann-caller")
const RECENT = TrakId.make("ann-recent")
const OLD = TrakId.make("ann-old")
const ARCHIVED = TrakId.make("ann-archived")
const BENS = TrakId.make("ben-trak")
const ANN_GOAL = GoalId.make("ann-goal")
const BEN_GOAL = GoalId.make("ben-goal")

const checkoutOf = (): string => mkdtempSync(join(tmpdir(), "orkestra-snapshot-"))

/** The engine log's lines: one about a trak the caller reads, one also naming Ben's, one about Ben's alone. */
const ENGINE: readonly EngineLogLine[] = [
  { at: NOW - HOUR, level: "WARN", message: `sandbox for ${RECENT} printed ${SECRET}` },
  { at: NOW - HOUR, level: "WARN", message: `${RECENT} waited on ${BENS}` },
  { at: NOW - HOUR, level: "ERROR", message: `${BENS} failed` },
]

/** Each trak's events, appended at the hours ago each names. */
const TRAKS: readonly {
  readonly id: TrakId
  readonly owner: UserId
  readonly events: readonly (readonly [number, Event])[]
}[] = [
  { id: CALLER, owner: ANN, events: [[100, Events.trakCreated("the caller")]] },
  {
    id: RECENT,
    owner: ANN,
    events: [
      [48, Events.trakCreated("Index the logs", undefined, "manual", false, ANN)],
      [1, Events.mergeFailed(`a conflict near ${SECRET}`)],
    ],
  },
  { id: OLD, owner: ANN, events: [[72, Events.trakCreated("long ago")]] },
  {
    id: ARCHIVED,
    owner: ANN,
    events: [
      [3, Events.trakCreated("put away")],
      [2, Events.abandoned("not wanted")],
    ],
  },
  { id: BENS, owner: BEN, events: [[1, Events.trakCreated("Ben's work")]] },
]

const seed = Effect.gen(function* () {
  const store = yield* Store
  const goals = yield* GoalStore
  const clock = settableClock(0)
  const at = (hoursAgo: number) => {
    clock.advance(NOW - hoursAgo * HOUR - clock.clock.unsafeCurrentTimeMillis())
  }
  for (const trak of TRAKS) {
    for (const [hoursAgo, event] of trak.events) {
      at(hoursAgo)
      const owned =
        event._tag === "TrakCreated"
          ? Events.trakCreated(event.description, undefined, "manual", false, trak.owner)
          : event
      const after = (yield* store.events(trak.id).pipe(Effect.orDie)).length
      yield* store.append(trak.id, [owned], { after }).pipe(Effect.withClock(clock.clock))
    }
  }
  yield* store.appendTranscript(RECENT, NoteEntry.make({ text: `printed ${SECRET}` }))
  // Far larger than every log together, so a bound can hold the logs and not this.
  yield* store.appendTranscript(RECENT, NoteEntry.make({ text: "x".repeat(LARGE) }))
  yield* store.appendTranscript(ARCHIVED, NoteEntry.make({ text: "a short session" }))
  for (const [goal, owner] of [
    [ANN_GOAL, ANN],
    [BEN_GOAL, BEN],
  ] as const) {
    at(3)
    yield* goals
      .append(goal, [GoalEvents.asked(`a goal of ${owner}`, ["manual"], undefined, owner)], {
        after: 0,
      })
      .pipe(Effect.withClock(clock.clock))
  }
})

/** Ann's reads where Ben shares the project: one person's `People`, with Ben's work unreadable. */
const annReads = Layer.effect(
  People,
  Effect.map(
    People,
    (people): PeopleShape => ({
      ...people,
      readable: () =>
        Effect.succeed({
          trak: (id) => !id.startsWith("ben-"),
          goal: (id) => !id.startsWith("ben-"),
          readsOnly: { seenBy: "@ann" },
        }),
    }),
  ),
).pipe(Layer.provide(PublicPeopleLayer))

/** A runner that holds every checkout, and keeps each `place` it was asked to make. */
const sandboxed = (
  placed: Ref.Ref<readonly ReadonlyMap<string, string | Uint8Array>[]>,
): SandboxesShape => {
  const unreached = Effect.die("a snapshot reaches no sandbox method but placeOf and place")
  return {
    inUse: Effect.succeed(true),
    holds: () => Effect.succeed(true),
    placeOf: (path) => Effect.succeed({ trak: CALLER, path }),
    project: Effect.succeed(undefined),
    place: (_at: CheckoutPlace, files) => Ref.update(placed, (p) => [...p, files]),
    shell: () => unreached,
    create: () => unreached,
    status: () => unreached,
    idOf: () => Effect.succeed(undefined),
    list: unreached,
    expose: () => unreached,
    reach: () => unreached,
    healthThrough: () => unreached,
    release: () => unreached,
    kill: () => unreached,
    transfer: () => unreached,
    retried: () => unreached,
    write: () => unreached,
    collect: () => unreached,
    moveOut: () => unreached,
    readInside: () => unreached,
    stats: () => unreached,
    copyHomeBack: () => unreached,
    copyHomeIn: () => unreached,
    awake: () => unreached,
    lost: () => unreached,
    resuming: () => Effect.succeed(false),
    remakeWith: () => unreached,
    stopIdleUnder: () => unreached,
    waitingBy: () => unreached,
    rebuild: () => unreached,
    rebuildOf: () => unreached,
    leftBehindTo: () => Effect.void,
    asWork: (work) => work,
  }
}

/**
 * One snapshot by Ann's caller, its checkout at `checkout`, on a host with two users, with
 * `SECRET` held: the answer, how many secrets the redactor found, and the files on disk.
 */
const snapshot = (
  checkout: string,
  args: Parameters<typeof snapshotLogs>[1],
  runner?: SandboxesShape,
  reads: TrakId[] = [],
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* seed
      const events = yield* (yield* Store).events(CALLER)
      const caller = {
        ...replayHistory(CALLER, events),
        worktree: {
          path: WorktreePath.make(checkout),
          branch: BranchName.make("trak/ann-caller"),
          base: CommitSha.make("base000"),
        },
      }
      const hiding = redactor([SECRET])
      const readable = yield* (yield* People).readable({ trak: caller.id })
      const taken = snapshotLogs(caller, args, readable, hiding.hide).pipe(
        Effect.withClock(settableClock(NOW).clock),
        // Every transcript the snapshot asks the store for, in order.
        Effect.provideServiceEffect(
          Store,
          Effect.map(Store, (store) => ({
            ...store,
            transcript: (id: TrakId) =>
              Effect.suspend(() => {
                reads.push(id)
                return store.transcript(id)
              }),
          })),
        ),
      )
      const answer = yield* runner === undefined
        ? taken
        : Effect.provideService(taken, Sandboxes, runner)
      return { answer, found: hiding.found() }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(annReads, Layer.succeed(EngineLog, { lines: Effect.succeed(ENGINE) })).pipe(
          Layer.provideMerge(
            Layer.mergeAll(MemoryStoreLayer, MemoryGoalStoreLayer, PubSubFeedLayer),
          ),
        ),
      ),
      Effect.scoped,
      Effect.orDie,
    ),
  )

/** The one snapshot directory in `checkout`, every file under it by its relative path. */
const written = (checkout: string): ReadonlyMap<string, string> => {
  const root = join(checkout, SNAPSHOTS)
  const [stamp, ...others] = readdirSync(root)
  expect(others).toEqual([])
  const dir = join(root, stamp ?? "")
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((p) =>
    statSync(join(dir, p)).isFile(),
  )
  return new Map(
    files.map((p) => [relative(dir, join(dir, p)), readFileSync(join(dir, p), "utf8")]),
  )
}

const lines = (text: string | undefined): readonly unknown[] =>
  (text ?? "")
    .trimEnd()
    .split("\n")
    .map((l): unknown => JSON.parse(l))

const Index = Schema.Struct({
  files: Schema.Array(Schema.Struct({ path: Schema.String, bytes: Schema.Number })),
  omitted: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      bytes: Schema.optional(Schema.Number),
      reason: Schema.String,
      unread: Schema.optional(Schema.Literal(true)),
    }),
  ),
  notReadable: Schema.optional(Schema.Unknown),
})

const indexIn = (files: ReadonlyMap<string, string>) =>
  Schema.decodeUnknownSync(Schema.parseJson(Index))(files.get("index.json") ?? "{}")

const dirsIn = (files: ReadonlyMap<string, string>): readonly string[] =>
  [
    ...new Set(
      [...files.keys()].flatMap((p) =>
        p.includes("/") ? [p.split("/").slice(0, 2).join("/")] : [],
      ),
    ),
  ].toSorted()

describe("what a snapshot holds", () => {
  it("every trak and goal of the caller's owner with an event in the window, archived ones too, and none of another owner's, saying why", async () => {
    const checkout = checkoutOf()
    const { answer } = await snapshot(checkout, {})
    const files = written(checkout)
    expect(dirsIn(files)).toEqual(["goals/ann-goal", "traks/ann-archived", "traks/ann-recent"])
    expect(indexIn(files).notReadable).toEqual({
      traks: 1,
      goals: 1,
      readsOnly: { seenBy: "@ann" },
    })
    expect(answer.refused).toBe(false)
    expect(answer.said).toMatchObject({
      snapshotTraks: "2",
      snapshotGoals: "1",
      readsOnly: { seenBy: "@ann" },
    })
    expect(answer.said["snapshotAt"]).toMatch(
      /^\.orkestra\/\.snapshots\/2026-10-01T12-00-00\.000Z\/$/u,
    )
    // The engine log's lines about it, less the one that also names Ben's trak.
    expect(lines(files.get("traks/ann-recent/engine.jsonl"))).toEqual([
      {
        at: new Date(NOW - HOUR).toISOString(),
        level: "WARN",
        message: "sandbox for ann-recent printed [redacted]",
      },
    ])
    for (const text of files.values()) expect(text).not.toContain("ben-")
  })

  it("writes a selected trak's whole log, the events before the window too", async () => {
    const checkout = checkoutOf()
    await snapshot(checkout, {})
    const log = lines(written(checkout).get("traks/ann-recent/log.jsonl"))
    expect(log).toMatchObject([
      { _tag: "TrakCreated", at: NOW - 48 * HOUR },
      { _tag: "MergeFailed", at: NOW - HOUR },
    ])
  })
})

describe("the window and the filters", () => {
  const selected = async (args: Parameters<typeof snapshotLogs>[1]) => {
    const checkout = checkoutOf()
    await snapshot(checkout, args)
    return dirsIn(written(checkout))
  }

  it("narrow by time, by state and by name, and write a transcript only when asked", async () => {
    expect(await selected({ hours: 80 })).toEqual([
      "goals/ann-goal",
      "traks/ann-archived",
      "traks/ann-old",
      "traks/ann-recent",
    ])
    expect(
      await selected({ since: new Date(NOW - 80 * HOUR), until: new Date(NOW - 50 * HOUR) }),
    ).toEqual(["traks/ann-old"])
    const archived = replayHistory(ARCHIVED, [Events.trakCreated("x"), Events.abandoned("y")]).state
      ._tag
    expect(await selected({ states: [archived.toLowerCase()] })).toEqual(["traks/ann-archived"])
    expect(await selected({ name: "INDEX" })).toEqual(["traks/ann-recent"])
    expect(await selected({ name: "ann-goal" })).toEqual(["goals/ann-goal"])

    const without = checkoutOf()
    await snapshot(without, {})
    expect(written(without).has("traks/ann-recent/transcript.jsonl")).toBe(false)
    const withTranscripts = checkoutOf()
    await snapshot(withTranscripts, { transcripts: true })
    expect(lines(written(withTranscripts).get("traks/ann-recent/transcript.jsonl"))).toMatchObject([
      { _tag: "Note" },
      { _tag: "Note" },
    ])
  })

  it("refuses `since` and `hours` together, writing nothing", async () => {
    const checkout = checkoutOf()
    const { answer } = await snapshot(checkout, { since: new Date(NOW), hours: 1 })
    expect(answer.refused).toBe(true)
    expect(existsSync(join(checkout, SNAPSHOTS))).toBe(false)
  })
})

describe("the redaction", () => {
  it("takes every held secret out of an event, a transcript entry and an engine-log line, and counts it", async () => {
    const checkout = checkoutOf()
    const { found } = await snapshot(checkout, { transcripts: true })
    const files = written(checkout)
    expect(files.get("traks/ann-recent/log.jsonl")).toContain("a conflict near [redacted]")
    expect(files.get("traks/ann-recent/transcript.jsonl")).toContain("printed [redacted]")
    expect(files.get("traks/ann-recent/engine.jsonl")).toContain("printed [redacted]")
    for (const text of files.values()) expect(text).not.toContain(SECRET)
    expect(found).toBe(1)
  })
})

/** Every file of the snapshot in `checkout`, in bytes together. */
const bytesOf = (files: ReadonlyMap<string, string>): number =>
  [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0)

describe("the size bound", () => {
  it("at every bound, stays under it and leaves out whole files: transcripts first, then the oldest traks and goals", async () => {
    const full = checkoutOf()
    await snapshot(full, { transcripts: true })
    const whole = written(full)
    const transcripts = [...whole.keys()].filter((p) => p.endsWith("transcript.jsonl"))
    // Newest last event first: the recent trak, the archived one, then the goal.
    const newestFirst = ["traks/ann-recent", "traks/ann-archived", "goals/ann-goal"]
    const seen = new Set<string>()
    for (let maxBytes = 1000; maxBytes <= bytesOf(whole) + 1000; maxBytes += 250) {
      const checkout = checkoutOf()
      // oxlint-disable-next-line no-await-in-loop -- one bound at a time, each over fresh stores
      await snapshot(checkout, { transcripts: true, maxBytes })
      const files = written(checkout)
      const { files: listed, omitted } = indexIn(files)
      expect(bytesOf(files)).toBeLessThanOrEqual(maxBytes)
      // Whole files only, and every file of the full snapshot either written or listed.
      for (const [path, text] of files)
        if (path !== "index.json") expect(text).toBe(whole.get(path))
      expect(listed.map((f) => f.path).toSorted()).toEqual(
        [...files.keys()].filter((p) => p !== "index.json").toSorted(),
      )
      // A transcript listed unread may hold nothing — the goal's does — so the unread ones
      // are the full snapshot's files that are neither written nor listed with a size.
      const accounted = new Set([...listed, ...omitted].map((f) => f.path))
      for (const path of whole.keys()) if (path !== "index.json") expect(accounted).toContain(path)
      for (const o of omitted) if (o.unread !== true) expect(whole.has(o.path)).toBe(true)
      for (const o of omitted) {
        expect(o.reason).toBe("size-bound")
        expect(o.bytes ?? Buffer.byteLength(whole.get(o.path) ?? "")).toBe(
          Buffer.byteLength(whole.get(o.path) ?? ""),
        )
      }
      const logsOut = omitted.some((o) => !o.path.endsWith("transcript.jsonl"))
      if (logsOut) for (const t of transcripts) expect(files.has(t)).toBe(false)
      const kept = dirsIn(files)
      expect(newestFirst.filter((d) => kept.includes(d))).toEqual(newestFirst.slice(0, kept.length))
      seen.add(`${String(kept.length)} kept, ${logsOut ? "logs out" : "logs in"}`)
    }
    // The sweep reached each way the bound can fall.
    expect([...seen].toSorted()).toEqual(
      ["0 kept, logs out", "1 kept, logs out", "2 kept, logs out", "3 kept, logs in"].toSorted(),
    )
  })

  it("never reads a transcript the bound has already left out", async () => {
    const logsOnly = checkoutOf()
    await snapshot(logsOnly, {})
    const logs = written(logsOnly)
    const all = checkoutOf()
    await snapshot(all, { transcripts: true })
    const full = written(all)
    // Room for every log and the small transcript, and not for the large one.
    const maxBytes = bytesOf(logs) + 2000
    const checkout = checkoutOf()
    const reads: TrakId[] = []
    const { answer } = await snapshot(checkout, { transcripts: true, maxBytes }, undefined, reads)
    const files = written(checkout)
    expect(dirsIn(files)).toEqual(["goals/ann-goal", "traks/ann-archived", "traks/ann-recent"])
    // The newest trak's transcript was read and did not fit; the archived trak's would have,
    // and was never asked for.
    expect(reads).toEqual([RECENT])
    expect(indexIn(files).omitted).toEqual([
      {
        path: "traks/ann-recent/transcript.jsonl",
        bytes: Buffer.byteLength(full.get("traks/ann-recent/transcript.jsonl") ?? ""),
        reason: "size-bound",
      },
      { path: "traks/ann-archived/transcript.jsonl", reason: "size-bound", unread: true },
      // The goal holds no transcript, and since it is never read the index cannot know that.
      { path: "goals/ann-goal/transcript.jsonl", reason: "size-bound", unread: true },
    ])
    expect(answer.said["snapshotOmitted"]).toMatchObject([
      { path: "traks/ann-recent/transcript.jsonl", sizeBound: true, unread: false },
      {
        path: "traks/ann-archived/transcript.jsonl",
        sizeBound: true,
        unread: true,
        bytes: undefined,
      },
      { path: "goals/ann-goal/transcript.jsonl", sizeBound: true, unread: true },
    ])

    // At the smallest bound that holds any trak, it holds only the newest, and no transcript
    // of a trak left out is read.
    const recentLog = Buffer.byteLength(logs.get("traks/ann-recent/log.jsonl") ?? "")
    for (let bound = recentLog; bound < maxBytes; bound += 25) {
      const tight = checkoutOf()
      const fewer: TrakId[] = []
      // oxlint-disable-next-line no-await-in-loop -- one bound at a time, each over fresh stores
      await snapshot(tight, { transcripts: true, maxBytes: bound }, undefined, fewer)
      const kept = dirsIn(written(tight))
      if (kept.length === 0) continue
      expect(kept).toEqual(["traks/ann-recent"])
      expect(fewer).toEqual([RECENT])
      return
    }
    expect.unreachable("no bound held a trak")
  })
})

describe("where it is written", () => {
  it("is one `place` through a runner, holding every file, and nothing on this machine's disk", async () => {
    const checkout = checkoutOf()
    const placed = Ref.unsafeMake<readonly ReadonlyMap<string, string | Uint8Array>[]>([])
    await snapshot(checkout, { transcripts: true }, sandboxed(placed))
    const [only, ...more] = Ref.get(placed).pipe(Effect.runSync)
    expect(more).toEqual([])
    expect([...(only?.keys() ?? [])].toSorted()).toEqual([
      "goals/ann-goal/log.jsonl",
      "index.json",
      "traks/ann-archived/log.jsonl",
      "traks/ann-archived/transcript.jsonl",
      "traks/ann-recent/engine.jsonl",
      "traks/ann-recent/log.jsonl",
      "traks/ann-recent/transcript.jsonl",
    ])
    expect(existsSync(join(checkout, SNAPSHOTS))).toBe(false)
  })
})
