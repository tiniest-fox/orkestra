import { Context, type Effect } from "effect"
import type { TrakId } from "../domain/trak.js"
import type { CheckOutcome } from "./checks.js"

/**
 * The project's setup script running in the background, per trak, in this engine's memory.
 *
 * A run outlives the drive that started it — the composer can park at its gate while setup
 * goes on — and the log says only that it started and how it ended. So a trak whose log
 * says setup is running and whose run is not here is one whose run was stopped, or one an
 * engine was running it for when it went, and the next work in the checkout starts it again.
 *
 * **A run belongs to the copy that drives the trak.** It is stopped when this copy lets go
 * of the trak or sees another copy take its lease, when a press takes the trak's drive
 * over, and before the checkout is removed — so two runs never share a checkout, and a run
 * that was stopped never answers for the one that replaced it.
 */
export interface SetupsShape {
  /**
   * Fork `run` for this trak, outliving the caller, in place of a run here that has
   * settled. Nothing where one here has not: two never run at once. `run` reports its
   * outcome through `settle`.
   */
  readonly start: (id: TrakId, run: Effect.Effect<void>) => Effect.Effect<void>
  /** Whether a run was started here for this trak, settled or not. */
  readonly started: (id: TrakId) => Effect.Effect<boolean>
  /**
   * Hand the run's outcome to everything waiting on it, and say whether any waiter
   * `reports` — a waiter that turns a failure into the trak's `SetupFailed`, which the run
   * then leaves to it.
   */
  readonly settle: (id: TrakId, outcome: CheckOutcome) => Effect.Effect<boolean>
  /**
   * Wait for the trak's run here, and its outcome: at once where it has settled,
   * `undefined` where none was started here. See `settle` for `reports`.
   */
  readonly outcome: (id: TrakId, reports: boolean) => Effect.Effect<CheckOutcome | undefined>
  /**
   * End this engine's run for the trak, if it has one, and forget it: the script is killed
   * and nothing after it runs, so a stopped run writes nothing more — to the status file or
   * to the log. Returns once the run has ended. Anything still waiting on its outcome is
   * interrupted rather than answered, since there is no outcome to hand it. The next work in
   * the checkout finds no run here and starts one, where the log still owes it.
   */
  readonly stop: (id: TrakId) => Effect.Effect<void>
}

export class Setups extends Context.Tag("workflow/Setups")<Setups, SetupsShape>() {}
