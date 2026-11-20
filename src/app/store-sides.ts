// The places a project's logs can live, as the first-boot migration and the backup export
// see them: the files under `.orkestra/.database/` an older engine wrote, and the SQLite file
// beside them — or a store a host's entry point opens, which answers the same `LogSide`. Each line is the encoded value as it was
// written, read and written whole.
//
// **Never through `Store` or `GoalStore`.** Their `append` stamps a time on an event that
// has none, so a log moved through the ports would come out of the move different from
// how it went in. The move copies values, and the replay check decodes them afterwards.

import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile, appendFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { isViewKey } from "../agent/logic/mcp.js"
import type { SqliteLines } from "../workflow/adapters/store-sqlite.js"
import { StoreFailed, StoreUndecodable } from "../workflow/ports/store-errors.js"

/** The two kinds of log, and the two files each one has. */
export type LogOf = "trak" | "goal"
export type LogFile = "log" | "transcript"

/** One place a project's logs live. Only a trak has views. */
export interface LogSide {
  /** Said in a report: where the lines are. */
  readonly name: string
  readonly list: (of: LogOf) => Effect.Effect<readonly string[], StoreFailed>
  readonly lines: (
    of: LogOf,
    key: string,
    file: LogFile,
  ) => Effect.Effect<readonly unknown[], StoreFailed | StoreUndecodable>
  /** `lines` added after the `after` the side holds. Nothing else writes during a move. */
  readonly add: (
    of: LogOf,
    key: string,
    file: LogFile,
    after: number,
    lines: readonly unknown[],
  ) => Effect.Effect<void, StoreFailed>
  /** The calls a trak keeps a view for, given its transcript. */
  readonly views: (
    key: string,
    transcript: readonly unknown[],
  ) => Effect.Effect<readonly string[], StoreFailed>
  readonly view: (
    key: string,
    call: string,
  ) => Effect.Effect<unknown, StoreFailed | StoreUndecodable>
  readonly saveView: (key: string, call: string, view: unknown) => Effect.Effect<void, StoreFailed>
}

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const isMissing = (e: unknown): boolean => e instanceof Error && "code" in e && e.code === "ENOENT"

/** The text at `path`, or `undefined` where there is no file. */
const textAt = (path: string): Effect.Effect<string | undefined, StoreFailed> =>
  Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: (cause) => cause }).pipe(
    Effect.catchAll((cause) =>
      isMissing(cause)
        ? Effect.succeed(undefined)
        : Effect.fail(new StoreFailed({ reason: `could not read ${path}: ${why(cause)}` })),
    ),
  )

const namesUnder = (dir: string, directories: boolean) =>
  Effect.tryPromise({
    try: () => readdir(dir, { withFileTypes: true }),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((entries) =>
      entries
        .filter((e) => e.isDirectory() === directories)
        .map((e) => e.name)
        .toSorted(),
    ),
    Effect.catchAll((cause) =>
      isMissing(cause)
        ? Effect.succeed<readonly string[]>([])
        : Effect.fail(new StoreFailed({ reason: `could not list ${dir}: ${why(cause)}` })),
    ),
  )

const writing = (path: string, write: () => Promise<void>) =>
  Effect.tryPromise({
    try: write,
    catch: (cause) => new StoreFailed({ reason: `could not write ${path}: ${why(cause)}` }),
  })

/** One line as JSON, or why it is not, naming its file and line. */
const parsedLine = (line: string, at: string): Effect.Effect<unknown, StoreUndecodable> =>
  Effect.try({
    try: (): unknown => JSON.parse(line),
    catch: (cause) => new StoreUndecodable({ reason: `${at}: ${why(cause)}` }),
  })

/** Each line of `text` as JSON, the first that is not naming its file and line. */
const parsedLines = (
  text: string,
  path: string,
): Effect.Effect<readonly unknown[], StoreUndecodable> =>
  Effect.forEach(
    text.split("\n").flatMap((line, i) => (line.trim() === "" ? [] : [{ line, i }])),
    ({ line, i }) => parsedLine(line, `${path}:${String(i + 1)}`),
  )

const LOGGED: readonly LogFile[] = ["log", "transcript"]

/** The files under `database`, a project's `.orkestra/.database/`. */
export const fileSide = (database: string): LogSide => {
  const dirOf = (of: LogOf, key: string) => join(database, of === "trak" ? "traks" : "goals", key)
  const pathOf = (of: LogOf, key: string, file: LogFile) => join(dirOf(of, key), `${file}.jsonl`)
  const viewPath = (key: string, call: string) => join(dirOf("trak", key), "views", `${call}.json`)
  return {
    name: database,
    // Only a directory holding a log or a transcript: a trak's `run.json` is not one.
    list: (of) =>
      Effect.map(namesUnder(join(database, of === "trak" ? "traks" : "goals"), true), (keys) =>
        keys.filter((key) => LOGGED.some((file) => existsSync(pathOf(of, key, file)))),
      ),
    lines: (of, key, file) => {
      const path = pathOf(of, key, file)
      return Effect.flatMap(textAt(path), (text) =>
        text === undefined ? Effect.succeed([]) : parsedLines(text, path),
      )
    },
    add: (of, key, file, _after, lines) => {
      const path = pathOf(of, key, file)
      return writing(path, async () => {
        await mkdir(dirOf(of, key), { recursive: true })
        await appendFile(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(""))
      })
    },
    // The directory, since a file store holds each view as a file of its own.
    views: (key) =>
      Effect.map(namesUnder(join(dirOf("trak", key), "views"), false), (names) =>
        names.flatMap((n) =>
          n.endsWith(".json") && isViewKey(n.slice(0, -5)) ? [n.slice(0, -5)] : [],
        ),
      ),
    view: (key, call) => {
      const path = viewPath(key, call)
      return Effect.flatMap(textAt(path), (text) =>
        text === undefined
          ? Effect.succeed(undefined)
          : Effect.try({
              try: (): unknown => JSON.parse(text),
              catch: (cause) => new StoreUndecodable({ reason: `${path}: ${why(cause)}` }),
            }),
      )
    },
    saveView: (key, call, view) => {
      const path = viewPath(key, call)
      return writing(path, async () => {
        await mkdir(join(dirOf("trak", key), "views"), { recursive: true })
        await writeFile(path, JSON.stringify(view))
      })
    },
  }
}

/** The SQLite file at `name`, over its lines. */
export const sqliteSide = (db: SqliteLines, name: string): LogSide => ({
  name,
  list: (of) => db.keys(of),
  lines: (of, key, file) =>
    Effect.flatMap(db.lines(of, key, file), (lines) =>
      Effect.forEach(lines, (line, i) =>
        parsedLine(line, `${name}: ${of} ${key} ${file}:${String(i + 1)}`),
      ),
    ),
  add: (of, key, file, after, lines) =>
    Effect.flatMap(
      db.add(
        of,
        key,
        file,
        after,
        lines.map((line) => JSON.stringify(line)),
      ),
      (found) =>
        found === undefined
          ? Effect.void
          : Effect.fail(
              new StoreFailed({
                reason: `${of} ${key}: ${name} holds ${String(found)} events, not ${String(after)}`,
              }),
            ),
    ),
  views: (key) => db.views(key),
  view: (key, call) =>
    Effect.flatMap(db.view(key, call), (text) =>
      text === undefined
        ? Effect.succeed(undefined)
        : parsedLine(text, `${name}: trak ${key} view ${call}`),
    ),
  saveView: (key, call, view) => db.saveView(key, call, JSON.stringify(view)),
})
