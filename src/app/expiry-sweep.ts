// The expiry sweep: under an external store, every lease another engine copy stopped renewing,
// taken and acted on as a booting engine acts on a dead holder's `run.json`.
//
// **What a lost copy leaves is what a killed engine leaves**, so the answer is the boot's:
// `Runs.reap` kills a command whose `runner.sh` went with the copy and names each detached
// one, and each named trak is driven to rejoin it. A trak with nothing running resumes on
// a person's press, as after a crash.
//
// **It runs with no external store too**, on a fixed interval: the boot's reap skips a holder
// that reads as alive, and one that dies later — a reissued pid the boot could not tell
// from the old engine's — would otherwise stand until the next boot, with its detached
// turn left running and nothing reading it.
//
// Here rather than in `workflow/` for the other sweeps' reason: it appends nothing itself,
// and the drives it starts go through `Drives`.

import { Effect, Schedule } from "effect"
import type { Scope } from "effect"
import { Events } from "../workflow/domain/event.js"
import { heldJob, Locks } from "../workflow/ports/locks.js"
import { type Reaped, Runs } from "../workflow/ports/runs.js"
import { Drives } from "./drive.js"

/**
 * A drive for each trak whose turn `reap` left running detached in its sandbox: the
 * Resume nobody has to press. The restart reads the record `reap` left standing and
 * rejoins the command rather than starting the step again.
 */
export const rejoinTurns = (reaped: readonly Reaped[]) =>
  Effect.gen(function* () {
    const drives = yield* Drives
    for (const r of reaped) {
      if (r._tag !== "Rejoining") continue
      yield* drives.start(r.id, (resuming) => Events.restarted(resuming?.sessionId))
    }
  })

/** One pass: the expired leases reaped, and the turns they left detached rejoined. */
const expiryPass = Effect.gen(function* () {
  const reaped = yield* (yield* Runs).reap()
  for (const r of reaped) {
    if (r._tag === "Rejoining") {
      yield* Effect.logInfo(`${r.id}: its holder is gone; rejoining exec ${r.execId}`)
    }
  }
  yield* rejoinTurns(reaped)
}).pipe(Effect.catchAll((e) => Effect.logWarning(`expiry sweep: a pass failed: ${e.reason}`)))

/** How often the sweep runs where no lease sets the interval. */
const HOLDER_SWEEP_MS = 60_000

/**
 * Fork the sweep, once a lease length, on the one copy holding its job. Where the locks
 * are permits inside one process no lease can expire, and the sweep is the boot's reap
 * again, for the holders it skipped, once a minute.
 */
export const startExpirySweep: Effect.Effect<void, never, Locks | Runs | Drives | Scope.Scope> =
  Effect.gen(function* () {
    const every = (yield* Locks).expiresAfter ?? HOLDER_SWEEP_MS
    yield* Effect.forkScoped(
      heldJob("expiry", Effect.asVoid(Effect.repeat(expiryPass, Schedule.spaced(every)))),
    )
  })
