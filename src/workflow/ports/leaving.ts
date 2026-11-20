import { Context, type Effect } from "effect"

/**
 * Whether the engine is shutting down, which the drives' own release says before it
 * interrupts every drive — or, under an external store, whether this copy is letting go of one
 * trak because another copy took its lease.
 *
 * **A detached turn is the one thing a leaving treats differently from a stop.** Both
 * interrupt the drive and close the turn's scope, and a stop has to end the command in the
 * sandbox. A shutdown is a redeploy as often as not, and a lost lease is a copy that has
 * already rejoined the command, so both leave it running and its record standing, for
 * `reap` or the new holder to rejoin. Read where a scope closes: by the runner's Process
 * layer, and by `Runs` clearing a record. A layer set with no such service never leaves,
 * and ends every detached command as it ends an attached one.
 */
export interface LeavingShape {
  /**
   * Whether the engine has begun to shut down. Never goes back to `false`. What keeps
   * `run.json`, which only this machine's next boot reads.
   */
  readonly now: Effect.Effect<boolean>
  /** Whether a turn of `trak` ending now leaves its command running: `now`, or letting go of it. */
  readonly leaves: (trak: string) => Effect.Effect<boolean>
  /** Say the engine is shutting down. Never undone. */
  readonly leave: Effect.Effect<void>
  /**
   * Leave the detached command `execId` running past its scope's close, and its turn on
   * the run record, while the engine stays: its turn ran out of time reaching the sandbox
   * with the command perhaps still running there, and the trak's Resume rejoins it.
   */
  readonly keep: (execId: string) => Effect.Effect<void>
  /** A turn rejoins `execId`, so its close ends it as any other's again. */
  readonly rejoined: (execId: string) => Effect.Effect<void>
  /** Whether a close leaves the detached command `execId` running: the engine is leaving, or `keep` said so. */
  readonly keeps: (execId: string | undefined) => Effect.Effect<boolean>
  /** Say this copy is letting go of `trak`, until `regain`. */
  readonly letGo: (trak: string) => Effect.Effect<void>
  readonly regain: (trak: string) => Effect.Effect<void>
}

export class Leaving extends Context.Tag("workflow/Leaving")<Leaving, LeavingShape>() {}
