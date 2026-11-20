// port: the project's runner — the script that puts a trak's work in a sandbox on another
// machine — and the backup file read beside it.
//
// **Optional, and absent is public.** With no `Runners` provided there is no runner and no
// backup file: every checkout is a linked worktree on this machine, nothing is withheld for
// either script, and no snapshot is taken. Only a hosted engine provides one, reading the
// project's `.orkestra/runner.sh` and `backup.sh` and the runner its host hands it. Every
// reader takes it with `Effect.serviceOption`, through `runnersNow` or `runnerFilesNow`.
//
// Read with the library and swapped with it on a reload, so a reader never holds a runner
// from one read beside a library from another.

import { Context, Effect, Option } from "effect"
import type { Backup } from "../../library/types/backup.js"
import type { Runner, RunnerFrom } from "../../library/types/runner.js"

/** What the project's runner and backup files say, as one read. */
export interface RunnerFiles {
  /** The runner a sandboxed trak's work runs through; `undefined` where there is none. */
  readonly runner: Runner | undefined
  /** Which file `runner` is. `undefined` exactly where there is no runner. */
  readonly runnerFrom: RunnerFrom | undefined
  /**
   * How long work keeps reaching for `runner`'s sandbox through an outage before it fails,
   * in milliseconds; `0` with no runner.
   */
  readonly reattachMs: number
  /**
   * The `secret:` of the runner a host handed this engine, whether or not it is the one in
   * use. Every engine the host starts holds it among the host's named secrets, so where a
   * project's own runner shadows the host's it is withheld from every spawn, that runner's
   * script included — unless that runner's `secret:` names the same variable, which makes it
   * that runner's key, handed to its script alone.
   */
  readonly hostSecret: string | undefined
  /**
   * `.orkestra/backup.sh` — the script that snapshots the engine's state and sessions, its
   * `secrets:` withheld from every spawn. Run on its interval by whatever
   * provides `Runners`.
   */
  readonly backup: Backup | undefined
}

/** No runner and no backup file: what every reader answers where no `Runners` is provided. */
export const NO_RUNNER_FILES: RunnerFiles = {
  runner: undefined,
  runnerFrom: undefined,
  reattachMs: 0,
  hostSecret: undefined,
  backup: undefined,
}

export interface RunnersShape {
  /** The files read with the library held now. */
  readonly current: Effect.Effect<RunnerFiles>
}

export class Runners extends Context.Tag("vcs/Runners")<Runners, RunnersShape>() {}

/**
 * How a reader built once reads the files on each use: the held ones, or none where no
 * `Runners` is provided. Taken at build, so the reading needs nothing after.
 */
export const runnersNow: Effect.Effect<Effect.Effect<RunnerFiles>> = Effect.map(
  Effect.serviceOption(Runners),
  Option.match({
    onNone: () => Effect.succeed(NO_RUNNER_FILES),
    onSome: (runners) => runners.current,
  }),
)

/** The files held now, or none where no `Runners` is provided. */
export const runnerFilesNow: Effect.Effect<RunnerFiles> = Effect.flatten(runnersNow)
