// Goal store on disk: one directory per goal under `.orkestra/.database/goals/<id>/`, a
// `log.jsonl` beside a `transcript.jsonl`, each line one value. The trak store's layout
// and its two failures, in a directory of its own, so no listing of traks ever meets a
// goal. One appender per goal is `Locks.withGoal`'s to hold, as one per trak is `withLog`'s,
// and an append checks its `after` against the log's line count and ignores `fence`, as
// the trak store does.

import { appendFile, mkdir, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Clock, Effect, Layer } from "effect"
import { decodeTranscriptEntry, encodeTranscriptEntry } from "../../agent/types/transcript-entry.js"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { decodeGoalEvent, encodeGoalEvent, stampedGoal } from "../domain/goal.js"
import { GoalId } from "../domain/trak.js"
import { GoalStore, type GoalStoreShape } from "../ports/goal-store.js"
import { StoreConflict, StoreFailed, StoreUndecodable } from "../ports/store-errors.js"

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException =>
  e instanceof Error && "code" in e

const goalsDir = (root: string): string => join(root, ".database", "goals")
const goalDir = (root: string, id: GoalId): string => join(goalsDir(root), id)

const appendLines = (
  dir: string,
  file: string,
  lines: readonly string[],
): Effect.Effect<void, StoreFailed> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dir, { recursive: true })
      await appendFile(join(dir, file), lines.map((l) => `${l}\n`).join(""))
    },
    catch: (cause) =>
      new StoreFailed({ reason: `could not write ${join(dir, file)}: ${why(cause)}` }),
  })

/** The file's non-blank lines; a missing file has none. */
const readLines = (path: string): Effect.Effect<readonly string[], StoreFailed> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (c) => c,
  }).pipe(
    Effect.map((text) => text.split("\n").filter((line) => line.trim() !== "")),
    Effect.catchAll((cause) =>
      isErrnoException(cause) && cause.code === "ENOENT"
        ? Effect.succeed<readonly string[]>([])
        : Effect.fail(new StoreFailed({ reason: `could not read ${path}: ${why(cause)}` })),
    ),
  )

/** Each line parsed and decoded; a missing file is an empty one. */
const readDecoded = <A>(
  path: string,
  label: string,
  decode: (value: unknown) => Effect.Effect<A, { readonly message: string }>,
): Effect.Effect<readonly A[], StoreFailed | StoreUndecodable> =>
  Effect.gen(function* () {
    const lines = yield* readLines(path)
    return yield* Effect.forEach(lines, (line, i) =>
      Effect.try({
        try: (): unknown => JSON.parse(line),
        catch: (cause) => new StoreUndecodable({ reason: `${label}:${i + 1}: ${why(cause)}` }),
      }).pipe(
        Effect.flatMap((parsed) =>
          decode(parsed).pipe(
            Effect.mapError(
              (e) => new StoreUndecodable({ reason: `${label}:${i + 1}: ${e.message}` }),
            ),
          ),
        ),
      ),
    )
  })

const makeFileGoalStore = (root: string): GoalStoreShape => ({
  append: (id, events, { after }) =>
    Effect.gen(function* () {
      const found = (yield* readLines(join(goalDir(root, id), "log.jsonl"))).length
      if (found !== after) return yield* new StoreConflict({ id, after, found })
      if (events.length === 0) return
      const now = yield* Clock.currentTimeMillis
      const encoded = yield* Effect.forEach(events, (e) =>
        encodeGoalEvent(stampedGoal(e, now)),
      ).pipe(Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })))
      yield* appendLines(
        goalDir(root, id),
        "log.jsonl",
        encoded.map((e) => JSON.stringify(e)),
      )
    }),
  events: (id) =>
    readDecoded(join(goalDir(root, id), "log.jsonl"), `goal ${id}: log.jsonl`, decodeGoalEvent),
  list: () =>
    Effect.tryPromise({
      try: () => readdir(goalsDir(root), { withFileTypes: true }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map((entries) =>
        entries.filter((entry) => entry.isDirectory()).map((entry) => GoalId.make(entry.name)),
      ),
      Effect.catchAll((cause) =>
        isErrnoException(cause) && cause.code === "ENOENT"
          ? Effect.succeed<readonly GoalId[]>([])
          : Effect.fail(
              new StoreFailed({ reason: `could not list ${goalsDir(root)}: ${why(cause)}` }),
            ),
      ),
    ),
  appendTranscript: (id, entry) =>
    Effect.gen(function* () {
      const encoded = yield* encodeTranscriptEntry(entry).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })),
      )
      yield* appendLines(goalDir(root, id), "transcript.jsonl", [JSON.stringify(encoded)])
    }),
  transcript: (id) =>
    readDecoded(
      join(goalDir(root, id), "transcript.jsonl"),
      `goal ${id}: transcript.jsonl`,
      decodeTranscriptEntry,
    ),
})

/** `startDir` rather than the root, for `FileStoreLayer`'s reason. */
export const FileGoalStoreLayer = (startDir: string): Layer.Layer<GoalStore, StoreFailed> =>
  Layer.effect(
    GoalStore,
    orkestraDir(startDir).pipe(
      Effect.mapError((e) => new StoreFailed({ reason: `${e.path}: ${e.reason}` })),
      Effect.map(makeFileGoalStore),
    ),
  )
