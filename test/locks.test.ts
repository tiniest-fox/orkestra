// The permit that replaced custody as the thing keeping two drives off one trak.
//
// Beside `domain.test.ts` at the root rather than under `e2e/`: it is not a flow, it is
// the one mechanism the whole single-writer design rests on. `advance` reads a trak's
// log, applies an event and appends, with nothing guarding the gap — so two of those
// running at once for one id both decide against the same state, and the second writes
// an event the first has already made wrong. Custody used to make that impossible
// across processes and could never see it inside one.
//
// Both halves are asserted, and the second is the one an over-eager fix breaks: a
// single global lock would also pass the first test, and would serialise a spawn's four
// children down to one.

import { Effect, Fiber, Ref } from "effect"
import { describe, expect, it } from "vitest"
import { MemoryLocksLayer } from "../src/workflow/adapters/locks-memory.js"
import { Locks } from "../src/workflow/ports/locks.js"
import { TrakId } from "../src/workflow/domain/trak.js"

const A = TrakId.make("trak-a")
const B = TrakId.make("trak-b")

/**
 * Run two effects at once under the permits they name, recording what each one did as
 * it happened.
 *
 * The trace is the assertion: `enter`/`leave` interleaved says they overlapped, and
 * nested says one waited. Each holds a `yield` inside the permit so a scheduler that
 * could interleave them would.
 */
const trace = (first: TrakId, second: TrakId): Promise<readonly string[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const locks = yield* Locks
      const log = yield* Ref.make<readonly string[]>([])
      const note = (what: string): Effect.Effect<void> =>
        Ref.update(log, (entries) => [...entries, what])

      const body = (label: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* note(`enter ${label}`)
          yield* Effect.yieldNow()
          yield* Effect.sleep("5 millis")
          yield* note(`leave ${label}`)
        })

      const one = yield* Effect.fork(locks.withDrive(first)(body("one")))
      const two = yield* Effect.fork(locks.withDrive(second)(body("two")))
      yield* Fiber.join(one)
      yield* Fiber.join(two)
      return yield* Ref.get(log)
    }).pipe(Effect.provide(MemoryLocksLayer)),
  )

describe("per-trak permits", () => {
  it("runs two effects for one trak one at a time", async () => {
    const entries = await trace(A, A)
    // Nested, never interleaved. `enter two` before `leave one` would be the lost
    // update: two drives deciding from the same log.
    expect(entries).toStrictEqual(["enter one", "leave one", "enter two", "leave two"])
  })

  it("does not make one trak wait for another", async () => {
    const entries = await trace(A, B)
    // Overlapped, and the assertion is the *shape* rather than the order: which of the
    // two finishes first is the scheduler's business, but neither may have waited.
    expect(entries.slice(0, 2)).toStrictEqual(["enter one", "enter two"])
  })

  it("hands the same trak the same permit every time", async () => {
    // A registry that made a new semaphore per call would pass nothing above by
    // accident — every caller would hold its own lock and the first test would
    // interleave. This says the lookup is what makes them one lock.
    const same = await Effect.runPromise(
      Effect.gen(function* () {
        const locks = yield* Locks
        const held = yield* Ref.make(false)
        const outer = locks.withDrive(A)(
          Effect.gen(function* () {
            // Trying to take it again from another fiber must wait, so a short race
            // against a timeout is the observable form of "still held".
            const inner = yield* Effect.fork(locks.withDrive(A)(Ref.set(held, true)))
            yield* Effect.sleep("20 millis")
            const during = yield* Ref.get(held)
            yield* Fiber.interrupt(inner)
            return during
          }),
        )
        return yield* outer
      }).pipe(Effect.provide(MemoryLocksLayer)),
    )
    expect(same).toBe(false)
  })
})
