// types: the shape of `.orkestra/runner.sh` — the one script that puts a trak's work on
// another machine. The engine runs it on its own host with a verb and the trak id, and
// the script speaks to whatever holds the sandbox. Which provider that is lives in the
// script and its `settings:`, never in the engine.

export interface Runner {
  /** Shown where the project's runner is named. */
  readonly description: string
  /**
   * The name of the variable holding the provider's key. The script is handed it and no
   * other spawn is, so a `pass:` naming it is refused at load — that would copy the key
   * into the sandbox it is meant to stay out of. Absent for a runner that needs no key.
   */
  readonly secret: string | undefined
  /** Engine-host variables copied into the sandbox for each `exec`, by name. */
  readonly pass: readonly string[]
  /**
   * Named secrets the script reads on the engine host, which no sandbox inherits — a token
   * only `create` needs, say. A `pass:` naming one is refused at load. Absent for none.
   */
  readonly keep?: readonly string[]
  /**
   * How long a sandbox runs with no `exec` in flight before the engine stops it. Absent
   * means the engine never stops one for being idle.
   */
  readonly idleMinutes: number | undefined
  /**
   * How long instead while the trak waits on a person — at a gate, or `Failed`. Never less
   * than `idleMinutes`, and only set beside it. Absent means `idleMinutes` throughout.
   */
  readonly idleMinutesWaiting?: number
  /**
   * How long the engine keeps trying to reach a sandbox it lost under a detached turn —
   * the turn's own command, the session copied back after it and the branch fetched —
   * before the turn fails. Counted from the first failure of an outage. Absent means
   * `REATTACH_MINUTES`.
   */
  readonly reattachMinutes?: number
  /**
   * The script's own configuration, each value reaching it as `ORKESTRA_RUNNER_<KEY>`
   * with the key upper-cased. The engine reads none of them: a provider's words — a
   * size, a region, a timer — live here so no engine code holds one.
   */
  readonly settings: Readonly<Record<string, string>>
  /**
   * The script runs an agent turn detached — `exec --detached` and `attach` — so the turn
   * survives an engine restart. Absent or false, every command it runs is attached, and a
   * restart ends a turn as it always did.
   */
  readonly detached?: boolean
  /**
   * The tool files the script runs, by name: each installed on its first call on the
   * machine that runs the script, from `.orkestra/tools/<name>.sh` for a project's file and
   * `tools/<name>.sh` beside a host's. Absent for none.
   */
  readonly tools?: readonly string[]
  /**
   * The runner's own seed version, which a change to what its `create` puts in a sandbox
   * moves. A sandbox stamped with another is made again, as for the engine's. Absent, the
   * stamp is the engine's alone.
   */
  readonly seed?: string
  /** Absolute, because the engine spawns it. Supplied by the adapter. */
  readonly path: string
}

/**
 * Where the runner in use came from, highest first: the project's `.orkestra/.local/runner.sh`,
 * its `.orkestra/runner.sh`, then the `runner.sh` a host hands every engine it starts. The
 * first that exists is used whole; with none, every spawn stays on the engine's machine.
 */
export type RunnerFrom = "local" | "project" | "host"
