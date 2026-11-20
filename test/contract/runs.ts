// The Runs port's contract, written once and run against every implementation.
//
// What both implementations can promise identically: a record stands while a scope is
// open, clears itself once it closes however it closes, and is readable by `holder`
// without being taken. Recovering a dead holder's interrupted turn depends on a real
// liveness check, which only the file adapter has a `Process` to perform — see
// `runs-file.test.ts` for that half, and for the proof that `holder` writes nothing,
// both seeded by hand the same way `store.ts`'s `corrupt` capability is.
//
// **What is deliberately not here is a refusal.** `adopt` used to fail `TrakHeld` when
// another live process held the trak, and that was the only thing keeping two engines
// off one log. One daemon does all the writing now and keeps its own drives apart with
// a permit, so there is nobody to refuse — the case below pins that, because a refusal
// quietly coming back would be a lock nothing else knows about.

import { Effect, Exit, Scope, type Layer } from "effect"
import { describe, expect, it } from "vitest"
import { noEstimate, noUsage } from "../../src/agent/types/usage.js"
import { SessionId } from "../../src/agent/types/session.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { type InFlightTurn, Runs, type RunsShape } from "../../src/workflow/ports/runs.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"

export interface RunsUnderTest {
  readonly label: string
  readonly layer: () => Layer.Layer<Runs, StoreFailed>
}

const freshId = (label: string): TrakId =>
  TrakId.make(`${label}-${Math.random().toString(36).slice(2)}`)

/** A turn as the runtime records it before the spawn: no pid, no start yet. */
const unspawned = (step: number, sessionId: SessionId): InFlightTurn => ({
  step,
  sessionId,
  agentPid: undefined,
  agentStart: undefined,
  usage: undefined,
  estimate: undefined,
})

type WithRuns = <A>(effect: Effect.Effect<A, unknown, Runs>) => Promise<A>

/** The spend a stop reads off the record — its own cases, so the suite stays readable. */
const spendCases = (withRuns: WithRuns): void => {
  it("keeps the turn's latest spend on the record, where a stop reads it before the kill", async () => {
    // The whole total each time rather than an increment: the third write is what
    // stands, not the sum of the three. Before any report the field is absent, and
    // a write with no turn in flight lands nowhere rather than failing.
    const id = freshId("spent")
    const sessionId = SessionId.make("00000000-0000-4000-8000-000000000097")
    const first = { ...noUsage, outputTokens: 120, costUsd: 0.1 }
    const second = { ...noUsage, outputTokens: 900, costUsd: 0.4, tools: { Read: 3 } }
    // The estimate rides beside the report and is replaced with it — the second write
    // says the provider has reported and nothing has been read since.
    const guessed = { ...noEstimate, cacheReadTokens: 40_000 }
    const result = await withRuns(
      Effect.gen(function* () {
        const runs: RunsShape = yield* Runs
        yield* runs.spent(id, first, guessed)
        const nothing = yield* runs.inFlight(id)
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* runs.turn(id, unspawned(1, sessionId))
            const before = yield* runs.inFlight(id)
            yield* runs.spent(id, first, guessed)
            yield* runs.spent(id, second, noEstimate)
            return { nothing, before, after: yield* runs.inFlight(id) }
          }),
        )
      }),
    )
    expect(result.nothing).toBeUndefined()
    expect(result.before?.usage).toBeUndefined()
    expect(result.after).toEqual({
      ...unspawned(1, sessionId),
      usage: second,
      estimate: noEstimate,
    })
  })
}

/** The session a provider announced, which a stop or a restart reads off the record. */
const announcedCases = (withRuns: WithRuns): void => {
  it("replaces the minted session with the one the provider announced, and keeps the minted one", async () => {
    const id = freshId("announced")
    const minted = SessionId.make("00000000-0000-4000-8000-000000000096")
    const thread = SessionId.make("01a1170a-0000-7000-8000-000000000001")
    const result = await withRuns(
      Effect.gen(function* () {
        const runs: RunsShape = yield* Runs
        yield* runs.announced(id, thread)
        const nothing = yield* runs.inFlight(id)
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* runs.turn(id, unspawned(1, minted))
            yield* runs.announced(id, thread)
            return { nothing, after: yield* runs.inFlight(id) }
          }),
        )
      }),
    )
    expect(result.nothing).toBeUndefined()
    expect(result.after).toEqual({ ...unspawned(1, thread), minted })
  })
}

export const runsContract = (c: RunsUnderTest): void => {
  const withRuns: WithRuns = (effect) => Effect.runPromise(effect.pipe(Effect.provide(c.layer())))

  describe(`Runs contract: ${c.label}`, () => {
    it("reports no interrupted turn for a trak nobody has driven", async () => {
      const id = freshId("adopt")
      const interrupted = await withRuns(
        Effect.scoped(Effect.flatMap(Runs, (runs) => runs.adopt(id))),
      )
      expect(interrupted).toBeUndefined()
    })

    it("does not refuse a second adopt while the first is still open", async () => {
      // The behaviour that replaced `TrakHeld`. Two of these cannot happen inside the
      // one process that writes — a permit is what stops that — so the port has no
      // reason to carry a refusal, and re-adding one would be a second lock with a
      // different idea of who is driving.
      const id = freshId("second")
      const interrupted = await withRuns(
        Effect.gen(function* () {
          const runs = yield* Runs
          const scope = yield* Scope.make()
          yield* Scope.extend(runs.adopt(id), scope)
          const second = yield* Effect.scoped(runs.adopt(id))
          yield* Scope.close(scope, Exit.void)
          return second
        }),
      )
      expect(interrupted).toBeUndefined()
    })

    it("reports nobody holding a trak that has never been claimed", async () => {
      const id = freshId("unheld")
      const held = await withRuns(Effect.flatMap(Runs, (runs) => runs.holder(id)))
      expect(held).toBeUndefined()
    })

    it("reports the holding process while a scope is open, and takes nothing", async () => {
      const id = freshId("holder")
      const result = await withRuns(
        Effect.gen(function* () {
          const runs = yield* Runs
          const scope = yield* Scope.make()
          yield* Scope.extend(runs.adopt(id), scope)
          // Twice, on purpose: reading who holds a trak must not be a way of
          // taking it, so the second answer has to be the first.
          const first = yield* runs.holder(id)
          const second = yield* runs.holder(id)
          yield* Scope.close(scope, Exit.void)
          return { first, second }
        }),
      )
      // `toMatchObject` on the pid and a separate check on `startedAt`: the file
      // adapter reads a clock and the memory one cannot, so the value is an
      // implementation's to choose and only its presence is the port's promise.
      expect(result.first).toMatchObject({ pid: process.pid })
      expect(result.second).toMatchObject({ pid: process.pid })
      expect(typeof result.first?.startedAt).toBe("number")
    })

    it("reports nobody again once the holder's scope has closed", async () => {
      const id = freshId("released")
      const held = await withRuns(
        Effect.gen(function* () {
          const runs = yield* Runs
          yield* Effect.scoped(runs.adopt(id))
          return yield* runs.holder(id)
        }),
      )
      expect(held).toBeUndefined()
    })

    it("reports the turn a dead process left, to a reader that takes nothing", async () => {
      // What `advance` stamps a `Restarted` from, and the reason it is a read rather
      // than `adopt`'s answer threaded through: a turn nobody ended has to be
      // readable at the append, by a caller that took custody somewhere else
      // entirely. Twice, because a read that took anything would make the second
      // answer differ from the first.
      const id = freshId("in-flight")
      const sessionId = SessionId.make("00000000-0000-4000-8000-000000000098")
      const result = await withRuns(
        Effect.gen(function* () {
          const runs: RunsShape = yield* Runs
          const scope = yield* Scope.make()
          yield* Scope.extend(runs.turn(id, unspawned(2, sessionId)), scope)
          // Custody taken after the turn was recorded, which is what a pick-up
          // does: `adopt` rewrites the holder and must leave the turn standing.
          const first = yield* Effect.scoped(Effect.andThen(runs.adopt(id), runs.inFlight(id)))
          const second = yield* runs.inFlight(id)
          yield* Scope.close(scope, Exit.void)
          return { first, second, after: yield* runs.inFlight(id) }
        }),
      )
      expect(result.first).toEqual(unspawned(2, sessionId))
      expect(result.second).toEqual(unspawned(2, sessionId))
      // Released with the scope, like every other record here: a turn that ended
      // has nothing for the next restart to name.
      expect(result.after).toBeUndefined()
    })

    spendCases(withRuns)
    announcedCases(withRuns)

    it("clears a turn once its own scope closes, leaving nothing for a later adopt to find", async () => {
      const id = freshId("turn")
      const sessionId = SessionId.make("00000000-0000-4000-8000-000000000099")
      const result = await withRuns(
        Effect.gen(function* () {
          const runs: RunsShape = yield* Runs
          const first = yield* Effect.scoped(
            Effect.gen(function* () {
              const interrupted = yield* runs.adopt(id)
              yield* Effect.scoped(runs.turn(id, unspawned(0, sessionId)))
              yield* runs.spawned(id, 12345)
              return interrupted
            }),
          )
          // Both the turn and the holder above have released by now — a fresh
          // adopt sees a trak nobody left mid-flight.
          const later = yield* Effect.scoped(runs.adopt(id))
          return { first, later }
        }),
      )
      expect(result.first).toBeUndefined()
      expect(result.later).toBeUndefined()
    })
  })
}
