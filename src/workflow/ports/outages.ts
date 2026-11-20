import { Clock, Context, Duration, Effect, FiberRef } from "effect"
import type { RunnerFailure } from "../../agent/types/runner-failure.js"

/** The first wait between tries, which doubles on each try after it. */
const FIRST_WAIT_MS = 2000

/** The longest wait between tries, so a provider back from an outage is found within a minute. */
const LONGEST_WAIT_MS = 60_000

/**
 * The wait before try `attempt + 1` — the first retry is `attempt` 1 — with `leftMs` of
 * the window to go: two seconds, doubling to a minute, and never past the window's end.
 * `undefined` once the window has run out, which is the caller giving up.
 */
export const reattachDelay = (attempt: number, leftMs: number): number | undefined => {
  if (leftMs <= 0) return undefined
  const wait = Math.min(FIRST_WAIT_MS * 2 ** Math.max(0, attempt - 1), LONGEST_WAIT_MS)
  return Math.min(wait, leftMs)
}

/**
 * A trak's sandbox the engine could not reach, as the runner said last: `unreachable` where
 * the provider's own API did not answer, `lost` where the sandbox did not. `since` is the
 * outage's first failure, in epoch milliseconds, which the reattach window counts from;
 * `spent` says a caller already waited the whole window out.
 */
export interface Outage {
  readonly kind: "lost" | "unreachable"
  readonly said: string
  readonly since: number
  readonly spent: boolean
}

/**
 * The outage each trak's sandbox is in, kept in memory by the calls that wait one out — a
 * detached turn reattaching, the session copied back after it and the branch fetched — so
 * all three share one window, and a screen can say why a running turn is quiet.
 *
 * **One window per outage, not per caller.** A turn that waited it out fails, and the
 * copy-back and fetch after it then try once each rather than a window apiece; without
 * that, an outage the turn gave up on held the trak three windows before it failed. A
 * new turn in the sandbox starts the count again, so a Resume gets a window of its own.
 */
export interface OutagesShape {
  readonly of: (trak: string) => Effect.Effect<Outage | undefined>
  /** One failure to reach `trak`'s sandbox: the outage it opens, or the one it continues. */
  readonly failed: (
    trak: string,
    failure: RunnerFailure & { readonly kind: Outage["kind"] },
  ) => Effect.Effect<Outage>
  /** A caller waited the whole window out. */
  readonly spend: (trak: string) => Effect.Effect<void>
  /** The sandbox answered, or a turn starts in it afresh: no outage stands. */
  readonly ended: (trak: string) => Effect.Effect<void>
}

export class Outages extends Context.Tag("workflow/Outages")<Outages, OutagesShape>() {}

/**
 * Whether a sandbox transfer, or a call put through `Sandboxes.retried`, made inside waits
 * an outage out on the reattach window rather than three tries. Off but for the fetch after
 * a turn and a merge — see `waitingOutOutages` — so an archive, a remake or a restore of a
 * sandbox that is gone fails in seconds, as it did.
 */
export const outageWaited = FiberRef.unsafeMake(false)

/** `work` with every sandbox transfer and retried call it makes waiting an outage out — see `outageWaited`. */
export const waitingOutOutages = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.locally(work, outageWaited, true)

/**
 * The wait before the next try after `failure`, the `attempt`th of this outage, with the
 * window `windowMs` long — or `undefined` where the window is spent, which this marks.
 */
export const outageWait = (
  outages: OutagesShape,
  trak: string,
  windowMs: number,
  failure: RunnerFailure & { readonly kind: Outage["kind"] },
  attempt: number,
): Effect.Effect<number | undefined> =>
  Effect.gen(function* () {
    const outage = yield* outages.failed(trak, failure)
    if (outage.spent) return undefined
    const wait = reattachDelay(attempt, outage.since + windowMs - (yield* Clock.currentTimeMillis))
    if (wait === undefined) yield* outages.spend(trak)
    return wait
  })

/** `failure` where it is a sandbox not reached — the kinds an outage is made of. */
export const outageKind = (
  failure: RunnerFailure | undefined,
): (RunnerFailure & { readonly kind: Outage["kind"] }) | undefined =>
  failure?.kind === "lost" || failure?.kind === "unreachable"
    ? { ...failure, kind: failure.kind }
    : undefined

/**
 * `call` again while it fails as a sandbox not reached, on `outageWait`'s schedule, until
 * `trak`'s outage has lasted `windowMs`; any answer ends the outage. `unreached` reads the
 * runner's failure off the error, and `retrying` says each retry before its wait. **Only
 * for a call that leaves the same whether it runs once or twice**: `lost` says nothing of
 * whether it ran.
 */
export const throughOutage =
  <E>(
    outages: OutagesShape,
    trak: string,
    windowMs: number,
    unreached: (e: E) => RunnerFailure | undefined,
    retrying: (e: E, attempt: number, waitMs: number) => Effect.Effect<void>,
  ) =>
  <A>(call: Effect.Effect<A, E>): Effect.Effect<A, E> => {
    const attempt = (n: number): Effect.Effect<A, E> =>
      Effect.matchEffect(call, {
        onSuccess: (a) => Effect.as(outages.ended(trak), a),
        onFailure: (e) =>
          Effect.gen(function* () {
            const failure = outageKind(unreached(e))
            if (failure === undefined) return yield* Effect.fail(e)
            const wait = yield* outageWait(outages, trak, windowMs, failure, n)
            if (wait === undefined) return yield* Effect.fail(e)
            yield* retrying(e, n, wait)
            yield* Effect.sleep(Duration.millis(wait))
            return yield* attempt(n + 1)
          }),
      })
    return attempt(1)
  }
