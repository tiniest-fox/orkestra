// File store. One directory per trak under `.orkestra/.database/traks/<id>/`,
// an append-only `log.jsonl` beside a `transcript.jsonl` — the same mechanism
// for both, since both are append-only and only ever read back in order.
//
// No engine runs on it: every engine opens SQLite or an external store, and this is the
// first-boot migration's reader of the logs an older engine left (`src/app/store-migrate.ts`),
// and a test's store.
//
// With no migrations, a line written against a variant that has since been
// deleted is a thing that happens — so a line that will not decode is reported
// as `StoreUndecodable`, apart from the `StoreFailed` a read that failed
// raises. The bytes arrived; they are not this protocol. Only a caller can
// decide what to do about one trak's history, and `GET /api/traks` leaves it
// out rather than failing the list.
//
// Every line — in either file — is one value, `JSON.stringify`d whole.
// `JSON.stringify` escapes control characters inside string values (a literal
// `\n` becomes the two characters `\` and `n`), so a transcript entry with an
// embedded newline still occupies exactly one line on disk; the log gets this
// for free because `encodeEvent` never needed it.
//
// Atomicity rests on custody (`Runs.claim`) across processes and on `Locks.withLog`
// inside one, not on the filesystem: this adapter assumes exactly one appender per
// trak at a time, the same assumption `advance` already makes. An append still checks
// its `after` against the log's line count, so one decided from a read another writer
// has since moved past is refused as `StoreConflict` rather than written. The count and
// the write are two steps, so the check does not stand in for the permits. `fence` is
// ignored: one process holds every permit, and there is no lease.

import { mkdirSync } from "node:fs"
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Clock, Effect, Layer, Schema } from "effect"
import { decodeTranscriptEntry, encodeTranscriptEntry } from "../../agent/types/transcript-entry.js"
import { isViewKey } from "../../agent/logic/mcp.js"
import { McpView } from "../../agent/types/mcp.js"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { decodeEvent, encodeEvent, stamped } from "../domain/event.js"
import { TrakId } from "../domain/trak.js"
import { Store, type StoreShape } from "../ports/store.js"
import { StoreConflict, StoreFailed, StoreUndecodable } from "../ports/store-errors.js"

const BASE = ".database"

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException =>
  e instanceof Error && "code" in e

const traksDir = (root: string): string => join(root, BASE, "traks")
const trakDir = (root: string, id: TrakId): string => join(traksDir(root), id)
const logPath = (root: string, id: TrakId): string => join(trakDir(root, id), "log.jsonl")
const transcriptPath = (root: string, id: TrakId): string =>
  join(trakDir(root, id), "transcript.jsonl")

/**
 * Keeping a trak's history out of `git status` is `Vcs.ensureIgnored`'s job, in
 * the repository's `info/exclude`: one mechanism for every runtime directory. A `*`
 * gitignore written beside the log would be an untracked file of its own.
 */
const ensureTrakDir = (root: string, id: TrakId): Effect.Effect<void, StoreFailed> =>
  Effect.try({
    try: () => {
      mkdirSync(traksDir(root), { recursive: true })
      mkdirSync(trakDir(root, id), { recursive: true })
    },
    catch: (cause) =>
      new StoreFailed({ reason: `could not prepare ${trakDir(root, id)}: ${why(cause)}` }),
  })

const appendLines = (path: string, lines: readonly string[]): Effect.Effect<void, StoreFailed> =>
  Effect.tryPromise({
    try: () => appendFile(path, lines.map((l) => `${l}\n`).join("")),
    catch: (cause) => new StoreFailed({ reason: `could not write ${path}: ${why(cause)}` }),
  })

/** Unknown path -> empty, matching the memory store's "unknown trak id -> empty log". */
const readLines = (path: string): Effect.Effect<readonly string[], StoreFailed> =>
  Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: (cause) => cause }).pipe(
    Effect.map((text) => text.split("\n").filter((line) => line.trim() !== "")),
    Effect.catchAll((cause) =>
      isErrnoException(cause) && cause.code === "ENOENT"
        ? Effect.succeed<readonly string[]>([])
        : Effect.fail(new StoreFailed({ reason: `could not read ${path}: ${why(cause)}` })),
    ),
  )

/**
 * A file's version: its mtime and its size, and a fixed word for a file that is not
 * there. Both, because an mtime alone is as coarse as the filesystem's clock, and two
 * appends inside one tick would read as none — the size moves on every append, since
 * both files only ever grow.
 */
const versionOf = (path: string): Effect.Effect<string, StoreFailed> =>
  Effect.tryPromise({ try: () => stat(path), catch: (cause) => cause }).pipe(
    Effect.map((found) => `${found.mtimeMs}:${found.size}`),
    Effect.catchAll((cause) =>
      isErrnoException(cause) && cause.code === "ENOENT"
        ? Effect.succeed("none")
        : Effect.fail(new StoreFailed({ reason: `could not stat ${path}: ${why(cause)}` })),
    ),
  )

const parseJsonLine = (
  id: TrakId,
  file: string,
  line: string,
  i: number,
): Effect.Effect<unknown, StoreUndecodable> =>
  Effect.try({
    try: (): unknown => JSON.parse(line),
    catch: (cause) =>
      new StoreUndecodable({ reason: `trak ${id}: bad JSON at ${file}:${i + 1}: ${why(cause)}` }),
  })

/** One file per view, named for its call — a view is read whole and by that id. */
const viewPath = (root: string, id: TrakId, call: string): string =>
  join(trakDir(root, id), "views", `${call}.json`)

const encodeView = Schema.encode(Schema.parseJson(McpView))
const decodeView = Schema.decodeUnknown(Schema.parseJson(McpView))

// A call id that is not plainly a name is refused on the way in and names nothing
// on the way out: it came off a provider's stream, and it is about to be a path.
const saveViewUnder =
  (root: string): StoreShape["saveView"] =>
  (id, call, view) =>
    Effect.gen(function* () {
      if (!isViewKey(call)) {
        return yield* new StoreFailed({ reason: `trak ${id}: ${call} cannot name a view` })
      }
      const text = yield* encodeView(view).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })),
      )
      const path = viewPath(root, id, call)
      yield* ensureTrakDir(root, id)
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(join(trakDir(root, id), "views"), { recursive: true })
          await writeFile(path, text)
        },
        catch: (cause) => new StoreFailed({ reason: `could not write ${path}: ${why(cause)}` }),
      })
    })

const viewUnder =
  (root: string): StoreShape["view"] =>
  (id, call) =>
    Effect.gen(function* () {
      if (!isViewKey(call)) return undefined
      const path = viewPath(root, id, call)
      const text = yield* Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: (cause) => cause,
      }).pipe(
        Effect.catchAll((cause) =>
          isErrnoException(cause) && cause.code === "ENOENT"
            ? Effect.succeed(undefined)
            : Effect.fail(new StoreFailed({ reason: `could not read ${path}: ${why(cause)}` })),
        ),
      )
      if (text === undefined) return undefined
      return yield* decodeView(text).pipe(
        Effect.mapError(
          (e) => new StoreUndecodable({ reason: `trak ${id}: bad view ${call}: ${e.message}` }),
        ),
      )
    })

const makeFileStore = (root: string): StoreShape => {
  const append: StoreShape["append"] = (id, events, { after }) =>
    Effect.gen(function* () {
      const found = (yield* readLines(logPath(root, id))).length
      if (found !== after) return yield* new StoreConflict({ id, after, found })
      if (events.length === 0) return
      // A time for anything that arrives without one — see `stamped`. One reading
      // for the batch, because a batch is one write.
      const now = yield* Clock.currentTimeMillis
      const encoded = yield* Effect.forEach(events, (e) => encodeEvent(stamped(e, now))).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })),
      )
      yield* ensureTrakDir(root, id)
      yield* appendLines(
        logPath(root, id),
        encoded.map((e) => JSON.stringify(e)),
      )
    })

  const versions: StoreShape["versions"] = (id) =>
    Effect.all({
      log: versionOf(logPath(root, id)),
      transcript: versionOf(transcriptPath(root, id)),
    })

  const events: StoreShape["events"] = (id) =>
    Effect.gen(function* () {
      const lines = yield* readLines(logPath(root, id))
      return yield* Effect.forEach(lines, (line, i) =>
        parseJsonLine(id, "log.jsonl", line, i).pipe(
          Effect.flatMap((parsed) =>
            decodeEvent(parsed).pipe(
              Effect.mapError(
                (e) =>
                  new StoreUndecodable({
                    reason: `trak ${id}: bad event at log.jsonl:${i + 1}: ${e.message}`,
                  }),
              ),
            ),
          ),
        ),
      )
    })

  const list: StoreShape["list"] = () =>
    Effect.tryPromise({
      try: () => readdir(traksDir(root), { withFileTypes: true }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map((entries) =>
        entries.filter((entry) => entry.isDirectory()).map((entry) => TrakId.make(entry.name)),
      ),
      Effect.catchAll((cause) =>
        isErrnoException(cause) && cause.code === "ENOENT"
          ? Effect.succeed<readonly TrakId[]>([])
          : Effect.fail(
              new StoreFailed({ reason: `could not list ${traksDir(root)}: ${why(cause)}` }),
            ),
      ),
    )

  const appendTranscript: StoreShape["appendTranscript"] = (id, entry) =>
    Effect.gen(function* () {
      const encoded = yield* encodeTranscriptEntry(entry).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })),
      )
      yield* ensureTrakDir(root, id)
      yield* appendLines(transcriptPath(root, id), [JSON.stringify(encoded)])
    })

  const transcript: StoreShape["transcript"] = (id) =>
    Effect.gen(function* () {
      const lines = yield* readLines(transcriptPath(root, id))
      return yield* Effect.forEach(lines, (line, i) =>
        parseJsonLine(id, "transcript.jsonl", line, i).pipe(
          Effect.flatMap((parsed) =>
            decodeTranscriptEntry(parsed).pipe(
              Effect.mapError(
                (e) =>
                  new StoreUndecodable({
                    reason: `trak ${id}: bad line at transcript.jsonl:${i + 1}: ${e.message}`,
                  }),
              ),
            ),
          ),
        ),
      )
    })

  const remove: StoreShape["remove"] = (id) =>
    Effect.tryPromise({
      try: () => rm(trakDir(root, id), { recursive: true, force: true }),
      catch: (cause) =>
        new StoreFailed({ reason: `could not remove ${trakDir(root, id)}: ${why(cause)}` }),
    })

  return {
    append,
    versions,
    events,
    list,
    appendTranscript,
    transcript,
    saveView: saveViewUnder(root),
    view: viewUnder(root),
    remove,
  }
}

/**
 * `startDir` rather than the root itself, mirroring `FsLibraryLayer` and
 * `GitCliLayer`: which project's traks we are looking at is runtime input, and
 * `orkestraDir` is the one walk-up every one of them shares, so they cannot
 * disagree about which project a command is running against.
 */
export const FileStoreLayer = (startDir: string): Layer.Layer<Store, StoreFailed> =>
  Layer.effect(
    Store,
    orkestraDir(startDir).pipe(
      Effect.mapError((e) => new StoreFailed({ reason: `${e.path}: ${e.reason}` })),
      Effect.map((root) => makeFileStore(root)),
    ),
  )
