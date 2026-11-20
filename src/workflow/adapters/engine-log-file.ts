// The engine's warning and error lines on disk: `.orkestra/.database/engine-log.jsonl`, one
// JSON line each, written by a logger added beside the default one — so the host still
// captures every line from stdout, and this file keeps only the ones an agent investigating
// a trak or a goal reads with `engine_log`.
//
// **The size is bounded by one rotation**, as the host's own log is: a line that would take
// the file past `ENGINE_LOG_BYTES` moves it to `engine-log.jsonl.1`, replacing the one
// there, and starts it again. A log, so a backup leaves it out.
//
// **A write that fails is dropped.** The log is a record, and a full disk is no reason to
// fail the work that logged.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"
import { Cause, Effect, Layer, Logger, LogLevel, Schema } from "effect"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { EngineLog, type EngineLogLine } from "../ports/engine-log.js"

/** The size a file reaches before it is rotated. */
const ENGINE_LOG_BYTES = 2 * 1024 * 1024

const LogLine = Schema.parseJson(
  Schema.Struct({ at: Schema.Number, level: Schema.String, message: Schema.String }),
)

const sizeOf = (file: string): number => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

const textOf = (message: unknown): string =>
  (Array.isArray(message) ? message : [message])
    .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
    .join(" ")

const readLines = (file: string): readonly EngineLogLine[] => {
  let text = ""
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return []
  }
  return text.split("\n").flatMap((line) => {
    const decoded = Schema.decodeUnknownEither(LogLine)(line)
    return decoded._tag === "Right" ? [decoded.right] : []
  })
}

const fileLogger = (file: string, maxBytes: number) => {
  let size = sizeOf(file)
  return Logger.make(({ logLevel, message, cause, date }) => {
    if (!LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) return
    const said = textOf(message)
    const why = Cause.isEmpty(cause) ? "" : Cause.pretty(cause)
    const line = `${JSON.stringify({
      at: date.getTime(),
      level: logLevel.label,
      message: why === "" ? said : `${said}\n${why}`,
    })}\n`
    const bytes = Buffer.byteLength(line)
    try {
      mkdirSync(join(file, ".."), { recursive: true })
      if (size > 0 && size + bytes > maxBytes) {
        renameSync(file, `${file}.1`)
        size = 0
      }
      appendFileSync(file, line, { mode: 0o600 })
      size += bytes
    } catch {
      // Dropped: see the header.
    }
  })
}

/**
 * The file's reader, and the logger that writes it, under the `.orkestra/` `startDir` walks
 * up to. The logger is added to the fibers this layer is provided to, so provide it where
 * every drive and sweep inherits it. `maxBytes` is for a test of the rotation.
 */
export const FileEngineLogLayer = (
  startDir: string,
  maxBytes: number = ENGINE_LOG_BYTES,
): Layer.Layer<EngineLog> =>
  Layer.unwrapEffect(
    orkestraDir(startDir).pipe(
      Effect.map((root) => join(root, ".database", "engine-log.jsonl")),
      // No `.orkestra/` is no log rather than no engine: nothing the engine does needs it.
      Effect.orElseSucceed(() => undefined),
      Effect.map((file) =>
        file === undefined
          ? Layer.succeed(EngineLog, { lines: Effect.succeed([]) })
          : Layer.merge(
              Logger.add(fileLogger(file, maxBytes)),
              Layer.succeed(EngineLog, {
                lines: Effect.sync(() => [...readLines(`${file}.1`), ...readLines(file)]),
              }),
            ),
      ),
    ),
  )
