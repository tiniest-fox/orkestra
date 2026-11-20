// The Store and GoalStore in one SQLite file, `.orkestra/.database/store.sqlite`, over
// Node's built-in `node:sqlite`: the store an engine with no external store keeps, one file
// per checkout. Every value is the JSON the file store writes as a line, so a log moved
// between the two reads back the same.
//
// **`after` is checked inside the write transaction.** `BEGIN IMMEDIATE` takes the file's
// write lock before the count is read, so the count and the insert are one step against
// every connection — a second process on the checkout included — and a stale append is
// refused as `StoreConflict` with nothing written. `fence` is ignored: SQLite holds no
// lease. The adapter is deployed beside `MemoryLocksLayer`'s permits and `FileRunsLayer`,
// as the file store is, and a second engine on one file is refused at boot rather than
// fenced.
//
// The file is opened in WAL mode with a busy timeout, so a reader beside the engine reads
// while it writes and a writer waits out another's transaction rather than failing.
// `node:sqlite` is synchronous: each call holds the event loop for one statement or one
// transaction, which on a local file is microseconds.
//
// `kept` holds the engine's own values beside the logs, by key — its push record
// (`src/app/push.ts`). `openSqliteLines` reads and writes the stored text whole, for the
// first-boot migration, which copies values rather than appending through the ports.
//
// A value that will not parse or decode is `StoreUndecodable`, naming the trak or goal; a
// statement SQLite refuses is `StoreFailed`, for the reason the file store keeps the two
// apart.

import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Clock, Context, Effect, Layer, Schema, type Scope } from "effect"
import { decodeTranscriptEntry, encodeTranscriptEntry } from "../../agent/types/transcript-entry.js"
import { McpView } from "../../agent/types/mcp.js"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { decodeEvent, encodeEvent, stamped } from "../domain/event.js"
import { decodeGoalEvent, encodeGoalEvent, stampedGoal } from "../domain/goal.js"
import { GoalId, TrakId } from "../domain/trak.js"
import { GoalStore, type GoalStoreShape } from "../ports/goal-store.js"
import { Store, type StoreShape } from "../ports/store.js"
import { StoreConflict, StoreFailed, StoreUndecodable } from "../ports/store-errors.js"

/** The two kinds of log one file holds, keyed apart. */
type LogKind = "trak" | "goal"

/** How long a write waits for another connection's transaction before it fails. */
const BUSY_MS = 5_000

// `versions` counts the writes to each trak's log and transcript, a remove counting as one
// to both, so a trak removed and made again never reads as unchanged. Its row outlives the
// remove for that reason.
const SCHEMA = `
  create table if not exists log (of text not null, key text not null, line text not null);
  create index if not exists log_by_key on log (of, key);
  create table if not exists transcript (of text not null, key text not null, line text not null);
  create index if not exists transcript_by_key on transcript (of, key);
  create table if not exists views (
    key text not null, call text not null, view text not null, primary key (key, call)
  );
  create table if not exists versions (
    key text primary key, log integer not null default 0, transcript integer not null default 0
  );
  create table if not exists kept (key text primary key, value text not null);
`

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const encodeView = Schema.encode(Schema.parseJson(McpView))
const decodeView = Schema.decodeUnknown(Schema.parseJson(McpView))

const encodeFailed = (e: { readonly message: string }) =>
  new StoreFailed({ reason: `encode failed: ${e.message}` })

/** One open file. */
interface Db {
  /** `body` against the file, its throw a `StoreFailed` naming `what`. */
  readonly run: <A>(what: string, body: (db: DatabaseSync) => A) => Effect.Effect<A, StoreFailed>
}

const dbOver = (db: DatabaseSync, path: string): Db => ({
  run: (what, body) =>
    Effect.try({
      try: () => body(db),
      catch: (cause) => new StoreFailed({ reason: `${path}: could not ${what}: ${why(cause)}` }),
    }),
})

/** `body` in one write transaction, rolled back where it throws. */
const inTransaction = <A>(db: DatabaseSync, body: () => A): A => {
  db.exec("begin immediate")
  try {
    const done = body()
    db.exec("commit")
    return done
  } catch (cause) {
    db.exec("rollback")
    throw cause
  }
}

const countOf = (db: DatabaseSync, of: LogKind, key: string): number => {
  const row = db.prepare("select count(*) as n from log where of = ? and key = ?").get(of, key)
  const n = row?.["n"]
  return typeof n === "number" ? n : 0
}

const bump = (db: DatabaseSync, key: string, file: "log" | "transcript"): void => {
  db.prepare(
    `insert into versions (key, ${file}) values (?, 1)
     on conflict (key) do update set ${file} = ${file} + 1`,
  ).run(key)
}

/**
 * Append `lines` to `of`'s log `key` where it still holds `after`, in the transaction that
 * counted it. Answers the count found where it does not, and writes nothing.
 */
const appendChecked = (
  db: Db,
  of: LogKind,
  key: string,
  after: number,
  lines: readonly string[],
): Effect.Effect<number | undefined, StoreFailed> =>
  db.run(`append to ${of} ${key}`, (sql) =>
    inTransaction(sql, () => {
      const found = countOf(sql, of, key)
      if (found !== after) return found
      if (lines.length === 0) return undefined
      const insert = sql.prepare("insert into log (of, key, line) values (?, ?, ?)")
      for (const line of lines) insert.run(of, key, line)
      if (of === "trak") bump(sql, key, "log")
      return undefined
    }),
  )

const linesOf = (
  db: Db,
  table: "log" | "transcript",
  of: LogKind,
  key: string,
): Effect.Effect<readonly string[], StoreFailed> =>
  db.run(`read ${of} ${key}'s ${table}`, (sql) =>
    sql
      .prepare(`select line from ${table} where of = ? and key = ? order by rowid`)
      .all(of, key)
      .map((row) => String(row["line"])),
  )

/** Each stored value parsed and decoded, a failure naming `label` and the line's place. */
const decodedLines = <A>(
  lines: readonly string[],
  label: string,
  decode: (value: unknown) => Effect.Effect<A, { readonly message: string }>,
): Effect.Effect<readonly A[], StoreUndecodable> =>
  Effect.forEach(lines, (line, i) =>
    Effect.try({
      try: (): unknown => JSON.parse(line),
      catch: (cause) => new StoreUndecodable({ reason: `${label}:${i + 1}: ${why(cause)}` }),
    }).pipe(
      Effect.flatMap((parsed) =>
        Effect.mapError(
          decode(parsed),
          (e) => new StoreUndecodable({ reason: `${label}:${i + 1}: ${e.message}` }),
        ),
      ),
    ),
  )

const keysOf = (db: Db, of: LogKind): Effect.Effect<readonly string[], StoreFailed> =>
  db.run(`list every ${of}`, (sql) =>
    sql
      .prepare("select key from log where of = ? group by key order by min(rowid)")
      .all(of)
      .map((row) => String(row["key"])),
  )

const addTranscriptLine = (db: Db, of: LogKind, key: string, line: string) =>
  db.run(`append to ${of} ${key}'s transcript`, (sql) =>
    inTransaction(sql, () => {
      sql.prepare("insert into transcript (of, key, line) values (?, ?, ?)").run(of, key, line)
      if (of === "trak") bump(sql, key, "transcript")
    }),
  )

const conflictOr = (id: string, after: number) => (found: number | undefined) =>
  found === undefined ? Effect.void : Effect.fail(new StoreConflict({ id, after, found }))

const versionsOf =
  (db: Db): StoreShape["versions"] =>
  (id) =>
    db.run(`read ${id}'s versions`, (sql) => {
      const row = sql.prepare("select log, transcript from versions where key = ?").get(id)
      return { log: String(row?.["log"] ?? 0), transcript: String(row?.["transcript"] ?? 0) }
    })

const viewsOf = (db: Db): Pick<StoreShape, "saveView" | "view"> => ({
  saveView: (id, call, kept) =>
    Effect.flatMap(Effect.mapError(encodeView(kept), encodeFailed), (text) =>
      db.run(`save ${id}'s view ${call}`, (sql) => {
        sql
          .prepare(
            `insert into views (key, call, view) values (?, ?, ?)
             on conflict (key, call) do update set view = excluded.view`,
          )
          .run(id, call, text)
      }),
    ),
  view: (id, call) =>
    Effect.gen(function* () {
      const text = yield* db.run(`read ${id}'s view ${call}`, (sql) => {
        const found = sql.prepare("select view from views where key = ? and call = ?").get(id, call)
        return found === undefined ? undefined : String(found["view"])
      })
      if (text === undefined) return undefined
      return yield* Effect.mapError(
        decodeView(text),
        (e) => new StoreUndecodable({ reason: `trak ${id}: bad view ${call}: ${e.message}` }),
      )
    }),
})

const removeOf =
  (db: Db): StoreShape["remove"] =>
  (id) =>
    db.run(`remove trak ${id}`, (sql) =>
      inTransaction(sql, () => {
        sql.prepare("delete from log where of = 'trak' and key = ?").run(id)
        sql.prepare("delete from transcript where of = 'trak' and key = ?").run(id)
        sql.prepare("delete from views where key = ?").run(id)
        bump(sql, id, "log")
        bump(sql, id, "transcript")
      }),
    )

const trakStoreOver = (db: Db): StoreShape => ({
  append: (id, events, { after }) =>
    Effect.gen(function* () {
      // One reading for the batch, because a batch is one write — see `stamped`.
      const now = yield* Clock.currentTimeMillis
      const encoded = yield* Effect.mapError(
        Effect.forEach(events, (e) => encodeEvent(stamped(e, now))),
        encodeFailed,
      )
      const lines = encoded.map((e) => JSON.stringify(e))
      yield* Effect.flatMap(appendChecked(db, "trak", id, after, lines), conflictOr(id, after))
    }),
  versions: versionsOf(db),
  events: (id) =>
    Effect.flatMap(linesOf(db, "log", "trak", id), (lines) =>
      decodedLines(lines, `trak ${id}: log`, (u) => decodeEvent(u)),
    ),
  list: () => Effect.map(keysOf(db, "trak"), (keys) => keys.map((key) => TrakId.make(key))),
  appendTranscript: (id, entry) =>
    Effect.flatMap(Effect.mapError(encodeTranscriptEntry(entry), encodeFailed), (encoded) =>
      addTranscriptLine(db, "trak", id, JSON.stringify(encoded)),
    ),
  transcript: (id) =>
    Effect.flatMap(linesOf(db, "transcript", "trak", id), (lines) =>
      decodedLines(lines, `trak ${id}: transcript`, (u) => decodeTranscriptEntry(u)),
    ),
  ...viewsOf(db),
  remove: removeOf(db),
})

const goalStoreOver = (db: Db): GoalStoreShape => ({
  append: (id, events, { after }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const encoded = yield* Effect.mapError(
        Effect.forEach(events, (e) => encodeGoalEvent(stampedGoal(e, now))),
        encodeFailed,
      )
      const lines = encoded.map((e) => JSON.stringify(e))
      yield* Effect.flatMap(appendChecked(db, "goal", id, after, lines), conflictOr(id, after))
    }),
  events: (id) =>
    Effect.flatMap(linesOf(db, "log", "goal", id), (lines) =>
      decodedLines(lines, `goal ${id}: log`, (u) => decodeGoalEvent(u)),
    ),
  list: () => Effect.map(keysOf(db, "goal"), (keys) => keys.map((key) => GoalId.make(key))),
  appendTranscript: (id, entry) =>
    Effect.flatMap(Effect.mapError(encodeTranscriptEntry(entry), encodeFailed), (encoded) =>
      addTranscriptLine(db, "goal", id, JSON.stringify(encoded)),
    ),
  transcript: (id) =>
    Effect.flatMap(linesOf(db, "transcript", "goal", id), (lines) =>
      decodedLines(lines, `goal ${id}: transcript`, (u) => decodeTranscriptEntry(u)),
    ),
})

/** The SQLite file of the checkout whose `.orkestra/` holds `root`. */
export const sqliteStorePath = (root: string): string => join(root, ".database", "store.sqlite")

/** Open `path`, made with its directory where it is missing, and closed with the scope. */
const opened = (path: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true })
        const db = new DatabaseSync(path)
        db.exec(`pragma journal_mode = wal; pragma busy_timeout = ${String(BUSY_MS)};`)
        db.exec(SCHEMA)
        return db
      },
      catch: (cause) => new StoreFailed({ reason: `could not open ${path}: ${why(cause)}` }),
    }),
    (db) => Effect.sync(() => db.close()),
  )

/**
 * `startDir` rather than the root, for `FileStoreLayer`'s reason: `orkestraDir` is the one
 * walk-up every reader of the project shares, so a worktree's store is its own.
 */
export const SqliteStoresLayer = (startDir: string): Layer.Layer<Store | GoalStore, StoreFailed> =>
  Layer.scopedContext(
    Effect.gen(function* () {
      const root = yield* Effect.mapError(
        orkestraDir(startDir),
        (e) => new StoreFailed({ reason: `${e.path}: ${e.reason}` }),
      )
      const path = sqliteStorePath(root)
      const db = dbOver(yield* opened(path), path)
      return Context.make(Store, trakStoreOver(db)).pipe(Context.add(GoalStore, goalStoreOver(db)))
    }),
  )

/** One file's logs as the stored text, each line whole, and its kept values. */
export interface SqliteLines {
  readonly keys: (of: LogKind) => Effect.Effect<readonly string[], StoreFailed>
  readonly lines: (
    of: LogKind,
    key: string,
    file: "log" | "transcript",
  ) => Effect.Effect<readonly string[], StoreFailed>
  /**
   * `lines` added to a log where it still holds `after`, answering the count found where it
   * does not, or to a transcript whatever it holds — each one transaction.
   */
  readonly add: (
    of: LogKind,
    key: string,
    file: "log" | "transcript",
    after: number,
    lines: readonly string[],
  ) => Effect.Effect<number | undefined, StoreFailed>
  readonly views: (key: string) => Effect.Effect<readonly string[], StoreFailed>
  readonly view: (key: string, call: string) => Effect.Effect<string | undefined, StoreFailed>
  readonly saveView: (key: string, call: string, text: string) => Effect.Effect<void, StoreFailed>
  readonly kept: (key: string) => Effect.Effect<string | undefined, StoreFailed>
  readonly keep: (key: string, value: string) => Effect.Effect<void, StoreFailed>
}

/** The file at `path`, opened in the caller's scope for a reader beside the engine's own. */
export const openSqliteLines = (
  path: string,
): Effect.Effect<SqliteLines, StoreFailed, Scope.Scope> =>
  Effect.map(opened(path), (sql) => {
    const db = dbOver(sql, path)
    return {
      keys: (of) => keysOf(db, of),
      lines: (of, key, file) => linesOf(db, file, of, key),
      add: (of, key, file, after, lines) =>
        file === "log"
          ? appendChecked(db, of, key, after, lines)
          : db.run(`append to ${of} ${key}'s transcript`, (s) =>
              inTransaction(s, () => {
                const insert = s.prepare("insert into transcript (of, key, line) values (?, ?, ?)")
                for (const line of lines) insert.run(of, key, line)
                if (of === "trak" && lines.length > 0) bump(s, key, "transcript")
                return undefined
              }),
            ),
      views: (key) =>
        db.run(`list ${key}'s views`, (s) =>
          s
            .prepare("select call from views where key = ? order by call")
            .all(key)
            .map((row) => String(row["call"])),
        ),
      view: (key, call) =>
        db.run(`read ${key}'s view ${call}`, (s) => {
          const found = s
            .prepare("select view from views where key = ? and call = ?")
            .get(key, call)
          return found === undefined ? undefined : String(found["view"])
        }),
      saveView: (key, call, text) =>
        db.run(`save ${key}'s view ${call}`, (s) => {
          s.prepare(
            `insert into views (key, call, view) values (?, ?, ?)
             on conflict (key, call) do update set view = excluded.view`,
          ).run(key, call, text)
        }),
      kept: (key) =>
        db.run(`read ${key}`, (s) => {
          const found = s.prepare("select value from kept where key = ?").get(key)
          return found === undefined ? undefined : String(found["value"])
        }),
      keep: (key, value) =>
        db.run(`write ${key}`, (s) => {
          s.prepare(
            `insert into kept (key, value) values (?, ?)
             on conflict (key) do update set value = excluded.value`,
          ).run(key, value)
        }),
    }
  })
