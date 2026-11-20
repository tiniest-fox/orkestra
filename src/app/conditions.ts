// The sweep: every trak resting on a condition, asked again on its own interval.
//
// Here rather than in `workflow/` for `push.ts`'s reason: it drives nothing itself,
// takes no custody and appends nothing. It reads the store, and for each trak whose
// wait is due it asks `Drives` to ask — which runs the script on a fiber holding
// neither the trak's drive key nor custody, so a person's press wins over it, and
// drives only an answer that changed something, re-read under the permit. `runtime.ts`
// never learns that anything polls; what it holds is `askConditions`, the one reading
// of what a script's exit means, and the ask shares it.
//
// **One fiber, one tick, and the set is recomputed from the live logs each time.**
// Nothing is armed per trak and nothing has to be disarmed when a person replans,
// merges or archives: a trak that is no longer at `Finished` holding an unmet entry
// simply stops being found. That is also what re-arms every wait on boot — the first
// sweep finds them, and the interval is read off the log's own record of the last answer.
//
// **The first sweep is also the pass that fills the `Archive`.** Every read goes
// through `liveTrak`, which classifies what it reads and skips what is already
// classified — so at boot every log is opened once, and from the second tick on a
// put-away trak costs nothing. An archived trak is never waiting, so nothing is missed.
// **An idle trak is skipped the same way**, off the `Idle` memory: idle means no wait the
// sweep asks, so its log is not opened until an append makes the memory read it again.
//
// **What is held in memory is only when each trak was last asked**, and a daemon
// restart loses it. The log holds the *first* not-yet and nothing after — polling
// state written per ask would fill every waiting trak's log with *asked, still not*
// lines — so after a restart the interval counts from that first answer, and a trak
// whose wait is older than its interval is asked on the first sweep.
//
// **A wait on the entry's own clock consults none of that.** Its instant is resolved
// off the log — `timeWaitOf` — so it is due when the instant has passed and not
// before, the memory is never read for it, and a restart moves nothing: the wake is
// the instant, plus at most one tick.

import { Clock, Context, Duration, Effect, HashMap, Layer, Option, Ref, Schedule } from "effect"
import type { Scope } from "effect"
import { engineCondition } from "../library/types/check.js"
import type { Library } from "../library/types/library.js"
import type { Event } from "../workflow/domain/event.js"
import {
  timeWaitOf,
  type Trak,
  type TrakId,
  type Wait,
  waitingAt,
} from "../workflow/domain/trak.js"
import type { Archive } from "../workflow/ports/archive.js"
import { Idle } from "../workflow/ports/idle.js"
import { heldJob, type Locks } from "../workflow/ports/locks.js"
import { libraryNow } from "../workflow/ports/project-files.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import { liveTrak } from "./archive.js"
import { Drives } from "./drive.js"

/**
 * How often the sweep runs. The interval a script declares is at least a minute, so
 * this is the most an ask can land late — short enough that a countdown drawn off
 * `nextAsk` does not read as a poll that never came, and every tick is a replay of
 * every live log that is not idle, which one open tab already pays per poll.
 */
export const SWEEP_EVERY = Duration.seconds(10)

export interface ConditionsShape {
  /**
   * One pass over every trak: ask each waiting one whose interval has elapsed.
   *
   * `StoreFailed` is the one failure, and it escapes: a disk that will not list its
   * traks is not a tick to skip quietly. A log this build cannot decode is left out,
   * on `GET /api/traks`'s argument — one trak's problem must not stop every other
   * wait being asked.
   */
  readonly sweep: Effect.Effect<void, StoreFailed>
  /**
   * When this trak's condition is next asked, epoch milliseconds — or nothing: not
   * waiting, the condition has given up, or the script has lost its interval. For a
   * wait on the entry's own clock it is the instant itself, past or not.
   *
   * Takes the trak and its log rather than reading them, because the one caller —
   * the detail route — is already holding both.
   */
  readonly nextAsk: (trak: Trak, events: readonly Event[]) => Effect.Effect<number | undefined>
}

export class Conditions extends Context.Tag("app/Conditions")<Conditions, ConditionsShape>() {}

/**
 * How often the engine asks the forge whether a branch has merged, and `deploy.sh`
 * where its header names no interval of its own. A merge sitting in review moves on
 * the scale of minutes, and one listing call a minute per waiting trak is a fraction
 * of a point against GitHub's hourly budget.
 */
export const ENGINE_ASKED_EVERY = Duration.seconds(60)

/**
 * The interval a condition is asked on, in milliseconds — or nothing where it is no
 * longer one. The two the engine answers have no script to declare one: `merged` is
 * the engine's own, and `deployed` is `deploy.sh`'s where it says, else the engine's.
 */
const intervalOf = (lib: Library, name: string): number | undefined => {
  const engine = engineCondition(name)
  const seconds =
    engine === undefined
      ? lib.checks.get(name)?.askedEverySeconds
      : engine === "merged"
        ? undefined
        : lib.deploy?.askedEverySeconds
  if (engine !== undefined && seconds === undefined) return Duration.toMillis(ENGINE_ASKED_EVERY)
  return seconds === undefined ? undefined : seconds * 1000
}

/**
 * When the condition holding `wait` was last answered, as the log records it: the
 * `ConditionsUnmet` that rested the trak. Absent only on a log written before events
 * were stamped, where *unmeasured* reads as due.
 */
const answeredAt = (events: readonly Event[], wait: Wait): number | undefined =>
  events.findLast((e) => e._tag === "ConditionsUnmet" && e.step === wait.step)?.at

/** When to ask next, from when it was last asked. Exported for the tier-1 test beside it. */
export const nextAskFrom = (asked: number | undefined, interval: number): number | undefined =>
  asked === undefined ? undefined : asked + interval

/** Whether an ask is owed now. Never asked, or unmeasured, is owed. */
export const due = (now: number, asked: number | undefined, interval: number): boolean =>
  asked === undefined || now >= asked + interval

/**
 * A wait the sweep will act on: one asked again on an interval, with when it was last
 * asked; or one on the entry's own clock, with the instant. The clock's carries no
 * memory and no interval, which is what keeps the two from being one shape with a
 * field that means nothing on half of it.
 */
type Found =
  | {
      readonly _tag: "Polled"
      readonly wait: Wait
      readonly asked: number | undefined
      readonly interval: number
    }
  | { readonly _tag: "Timed"; readonly wait: Wait; readonly until: number }

/**
 * What one trak is waiting on — with the memory consulted first and the log second
 * for a polled wait, so a restart counts from the log. Nothing for a trak not
 * resting on a wait, one whose wait has given up, or one whose agent file changed
 * under it and no longer says how often to ask: left alone rather than asked at some
 * rate the engine made up.
 */
const foundWait = (
  lib: Library,
  trak: Trak,
  events: readonly Event[],
  memory: HashMap.HashMap<TrakId, number>,
): Found | undefined => {
  const wait = waitingAt(trak)
  if (wait === undefined || wait.stopped) return undefined
  // Before the interval lookup, not inside it: a time has no script to declare one,
  // and falling through would read as the agent file having lost it — asked no more,
  // with nothing on screen saying so.
  const until = timeWaitOf(trak, wait)
  if (until !== undefined) return { _tag: "Timed", wait, until }
  const interval = intervalOf(lib, wait.name)
  if (interval === undefined) return undefined
  const asked = Option.getOrUndefined(HashMap.get(memory, trak.id)) ?? answeredAt(events, wait)
  return { _tag: "Polled", wait, asked, interval }
}

export const ConditionsLayer = Layer.effect(
  Conditions,
  Effect.gen(function* () {
    const drives = yield* Drives
    // Read on each use: the sweep is forked once at boot, and a reload can change an
    // agent's `conditions:` or a condition's interval under it.
    const library = yield* libraryNow
    /** What `liveTrak` reads with — the store, the set and the permits — taken here so
     *  the sweep is an Effect with nothing left to ask for. */
    const reading = yield* Effect.context<Store | Archive | Idle | Locks>()
    /** When each waiting trak was last asked, by this process. See the module header. */
    const askedAt = yield* Ref.make(HashMap.empty<TrakId, number>())

    const waitOf = (
      id: TrakId,
      memory: HashMap.HashMap<TrakId, number>,
      now: number,
    ): Effect.Effect<Found | undefined, StoreFailed> =>
      Effect.gen(function* () {
        if (!(yield* drives.running(id)) && (yield* Context.get(reading, Idle).idleAt(id, now)))
          return undefined
        const live = yield* Effect.provide(liveTrak(id), reading)
        return live === undefined
          ? undefined
          : foundWait(yield* library, live.trak, live.events, memory)
      }).pipe(
        Effect.catchTag("StoreUndecodable", (e) =>
          Effect.as(Effect.logWarning(`conditions: left out of the sweep: ${e.reason}`), undefined),
        ),
      )

    const sweep = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const memory = yield* Ref.get(askedAt)
      // Rebuilt each tick rather than updated, so a trak that stopped waiting drops
      // out of memory the moment it does.
      const kept = new Map<TrakId, number>()
      for (const id of yield* Context.get(reading, Store).list()) {
        const found = yield* waitOf(id, memory, now)
        if (found === undefined) continue
        if (found._tag === "Timed") {
          // Due once the instant has passed, and asked on every tick after it until
          // the answer moves the trak — a met answer enters the step, and one the
          // agent's own condition then holds back lands under that condition's name,
          // after which this is a polled wait. Nothing is remembered: the instant is
          // the log's own.
          if (now >= found.until) yield* drives.ask(id, found.wait.step)
          continue
        }
        const { wait, asked, interval } = found
        if (!due(now, asked, interval)) {
          if (asked !== undefined) kept.set(id, asked)
          continue
        }
        // `busy` is skip-this-tick: a turn is in flight, or the previous ask is still
        // running — and the next tick asks again. Never a retry loop, and never a
        // take-over, which would kill the turn. The memory keeps what it had, so the
        // ask is owed still. The ask holds no key, so a person's press goes through
        // while the script runs and wins over its answer — see `Drives.ask`.
        if ((yield* drives.ask(id, wait.step)) === "asked") kept.set(id, now)
        else if (asked !== undefined) kept.set(id, asked)
      }
      yield* Ref.set(askedAt, HashMap.fromIterable(kept))
    })

    const nextAsk = (trak: Trak, events: readonly Event[]): Effect.Effect<number | undefined> =>
      Effect.map(Effect.all([Ref.get(askedAt), library]), ([memory, lib]) => {
        const found = foundWait(lib, trak, events, memory)
        if (found === undefined) return undefined
        return found._tag === "Timed" ? found.until : nextAskFrom(found.asked, found.interval)
      })

    return { sweep, nextAsk }
  }),
)

/**
 * Fork the sweep on its tick — the one line `serve.ts` calls. The first pass runs at
 * once, which is what re-arms every wait a restart forgot. Under an external store it runs on
 * the one engine copy holding its job, so a script is never asked twice for one tick.
 *
 * A tick that cannot list the store is logged and the next one tries again: the
 * fiber must outlive one bad read, or every wait stops being asked with nothing on
 * screen to say so.
 */
export const startConditionSweep: Effect.Effect<void, never, Conditions | Locks | Scope.Scope> =
  Effect.gen(function* () {
    const conditions = yield* Conditions
    yield* Effect.forkScoped(
      heldJob(
        "conditions",
        Effect.asVoid(
          Effect.repeat(
            conditions.sweep.pipe(
              Effect.catchAll((e) => Effect.logWarning(`conditions: a sweep failed: ${e.reason}`)),
            ),
            Schedule.spaced(SWEEP_EVERY),
          ),
        ),
      ),
    )
  })
