import { Context, type Effect } from "effect"

/** One warning or error the engine logged. */
export interface EngineLogLine {
  readonly at: number
  readonly level: string
  readonly message: string
}

/**
 * The engine's warning and error lines, kept across restarts so an agent in a sandbox can
 * read what the engine said about a trak or a goal before the boot it is running under.
 */
export interface EngineLogShape {
  /** Every line kept, oldest first. A file that cannot be read is no lines. */
  readonly lines: Effect.Effect<readonly EngineLogLine[]>
}

export class EngineLog extends Context.Tag("workflow/EngineLog")<EngineLog, EngineLogShape>() {}
