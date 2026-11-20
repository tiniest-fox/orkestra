// The agent's pid onto the run record once the provider reports it, against the memory
// `Runs` with a `spawned` that refuses before it writes: a refusal is tried again until the
// pid is on the record, and a write that keeps failing is logged — a record without the pid
// reads, after a restart, as a command nobody is attached to.

import { Effect, Logger } from "effect"
import { describe, expect, it } from "vitest"
import { SessionId } from "../../src/agent/types/session.js"
import { MemoryRunsLayer } from "../../src/workflow/adapters/runs-memory.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Runs, type RunsShape } from "../../src/workflow/ports/runs.js"
import { StoreFailed } from "../../src/workflow/ports/store-errors.js"
import { recordSpawned } from "../../src/workflow/runtime.js"
import { instantClock } from "../support/clock.js"

const id = TrakId.make("spawned-trak")
const PID = 4242

/** The memory record, with `spawned` refusing `refusals` times before it writes, counting each try. */
const refusing = (runs: RunsShape, refusals: number) => {
  const tries = { count: 0 }
  const shape: RunsShape = {
    ...runs,
    spawned: (...args) =>
      Effect.suspend(() => {
        tries.count += 1
        return tries.count <= refusals
          ? Effect.fail(new StoreFailed({ reason: "the store is down" }))
          : runs.spawned(...args)
      }),
  }
  return { tries, shape }
}

/** A turn in flight, its spawn recorded through a `spawned` that refuses `refusals` times. */
const spawnedThrough = (refusals: number) => {
  const logs: string[] = []
  const logger = Logger.make(({ message }) => {
    logs.push(JSON.stringify(message))
  })
  return Effect.gen(function* () {
    const runs = yield* Runs
    const { tries, shape } = refusing(runs, refusals)
    yield* runs.turn(id, {
      step: 0,
      sessionId: SessionId.make("s"),
      agentPid: undefined,
      agentStart: undefined,
      usage: undefined,
      estimate: undefined,
    })
    yield* recordSpawned(shape, id, { pid: PID })
    const turn = yield* runs.inFlight(id)
    return { tries: tries.count, agentPid: turn?.agentPid, logs: logs.join("\n") }
  }).pipe(
    Effect.scoped,
    Effect.provide(MemoryRunsLayer),
    Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
    Effect.withClock(instantClock),
    Effect.runPromise,
  )
}

describe("the agent's pid on the run record", () => {
  it("is written again after a refusal, and nothing is logged once it lands", async () => {
    const { tries, agentPid, logs } = await spawnedThrough(2)
    expect({ tries, agentPid }).toStrictEqual({ tries: 3, agentPid: PID })
    expect(logs).not.toContain("is not on the run record")
  })

  it("is logged when every try is refused, and the turn goes on", async () => {
    const { tries, agentPid, logs } = await spawnedThrough(Number.POSITIVE_INFINITY)
    // The first try and three more.
    expect({ tries, agentPid }).toStrictEqual({ tries: 4, agentPid: undefined })
    expect(logs).toContain(
      `trak spawned-trak: agent pid ${String(PID)} is not on the run record, so a restart may stop it as nobody's: the store is down`,
    )
  })
})
