// A clock a test moves by hand, for the one thing in the engine that reads the time
// to decide anything: whether a resting trak's condition is due to be asked again.
//
// Not Effect's `TestClock`, and the reason is scope. Building `TestContext` sets the
// clock for the whole fiber that built it, for as long as its scope stands — which is
// the flow body, and the flow body waits on forked drives with `idle`, whose sleep
// would then never come due. This one is provided around a single call with
// `Effect.withClock`, and everything around it keeps the live clock.
//
// `sleep` is the live clock's: nothing this stands in for sleeps, and a fake that
// hung a sleep would be a hang nothing could explain.

import { Clock, type Duration, Effect } from "effect"

export interface SettableClock {
  readonly clock: Clock.Clock
  /** Move the time forward. Milliseconds, like everything else the engine holds. */
  readonly advance: (ms: number) => void
}

export const settableClock = (start: number): SettableClock => {
  let now = start
  const live = Clock.make()
  const clock: Clock.Clock = {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    unsafeCurrentTimeMillis: () => now,
    currentTimeMillis: Effect.sync(() => now),
    unsafeCurrentTimeNanos: () => BigInt(now) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    sleep: (duration: Duration.Duration) => live.sleep(duration),
  }
  return {
    clock,
    advance: (ms) => {
      now += ms
    },
  }
}

/**
 * The live clock with every sleep over at once — for a retry's backoff, which a test that
 * is about what is retried should not wait out. Provided around one call with
 * `Effect.withClock`, for `settableClock`'s reason.
 */
export const instantClock: Clock.Clock = (() => {
  const live = Clock.make()
  return {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    unsafeCurrentTimeMillis: () => live.unsafeCurrentTimeMillis(),
    currentTimeMillis: live.currentTimeMillis,
    unsafeCurrentTimeNanos: () => live.unsafeCurrentTimeNanos(),
    currentTimeNanos: live.currentTimeNanos,
    sleep: () => Effect.void,
  }
})()
