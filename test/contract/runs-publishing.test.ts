// The publishing decorator over `Runs`, held to the same two promises as the store's:
// the whole `Runs` contract still holds through it, and on top of that a turn's spend
// reaches the feed — coalesced, and released when the turn ends.

import { Effect, Fiber, Layer, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { noEstimate, noUsage } from "../../src/agent/types/usage.js"
import { SessionId } from "../../src/agent/types/session.js"
import { MemoryOutagesLayer } from "../../src/workflow/adapters/outages-memory.js"
import { MemoryRunsLayer } from "../../src/workflow/adapters/runs-memory.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { publishingRuns } from "../../src/workflow/adapters/runs-publishing.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Feed, type Frame } from "../../src/workflow/ports/feed.js"
import { Outages } from "../../src/workflow/ports/outages.js"
import { Runs } from "../../src/workflow/ports/runs.js"
import { runsContract } from "./runs.js"

const watched = publishingRuns(MemoryRunsLayer).pipe(
  Layer.provideMerge(PubSubFeedLayer),
  Layer.provideMerge(MemoryOutagesLayer),
)

runsContract({ label: "publishing (memory)", layer: () => watched })

const ID = TrakId.make("trak-1")
const sid = SessionId.make("00000000-0000-4000-8000-000000000042")

/** Subscribe, run `body`, and collect the frames it caused. */
const framesOf = <A>(
  body: Effect.Effect<A, unknown, Runs | Outages>,
  count: number,
): Promise<readonly Frame[]> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const feed = yield* Feed
        const replay = yield* feed.since(0)
        const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, count)))
        yield* body
        const framed = yield* Fiber.join(taking).pipe(Effect.timeout("5 seconds"))
        return [...framed].map((f) => f.frame)
      }),
    ).pipe(Effect.provide(watched), Effect.orDie),
  )

/** Long enough for the decorator's window to have flushed what is pending. */
const settled = Effect.sleep("300 millis")

const spentOf = (frames: readonly Frame[]): readonly unknown[] =>
  frames.map((f) =>
    f._tag === "InFlight"
      ? f.turn === undefined
        ? "released"
        : f.turn.usage.outputTokens
      : f._tag,
  )

describe("publishing runs", () => {
  it("publishes the latest report per window, skips a repeat, and releases as the turn ends", async () => {
    // Two writes of the first report inside one window are one frame; the second
    // report is another; the scope closing is the release, after the inner record has
    // cleared, so a re-read on it finds nothing in flight.
    const first = { ...noUsage, outputTokens: 120 }
    const second = { ...noUsage, outputTokens: 900 }
    const frames = await framesOf(
      Effect.scoped(
        Effect.gen(function* () {
          const runs = yield* Runs
          yield* runs.turn(ID, {
            step: 2,
            sessionId: sid,
            agentPid: undefined,
            agentStart: undefined,
            usage: undefined,
            estimate: undefined,
          })
          yield* runs.spent(ID, first, noEstimate)
          yield* runs.spent(ID, first, noEstimate)
          yield* settled
          yield* runs.spent(ID, first, noEstimate)
          yield* settled
          yield* runs.spent(ID, second, { ...noEstimate, cacheReadTokens: 10 })
          yield* settled
        }),
      ),
      3,
    )
    expect(spentOf(frames)).toEqual([120, 900, "released"])
    expect(frames[0]).toMatchObject({ _tag: "InFlight", turn: { step: 2, estimate: noEstimate } })
  })

  it("publishes nothing for a report with no turn in flight, as the record keeps nothing", async () => {
    const frames = await framesOf(
      Effect.gen(function* () {
        const runs = yield* Runs
        yield* runs.spent(ID, noUsage, noEstimate)
        yield* settled
        yield* Effect.scoped(
          runs.turn(ID, {
            step: undefined,
            sessionId: sid,
            agentPid: undefined,
            agentStart: undefined,
            usage: undefined,
            estimate: undefined,
          }),
        )
      }),
      1,
    )
    expect(spentOf(frames)).toEqual(["released"])
  })

  it("tells of an outage on the turn in flight, and that it ended, before any report", async () => {
    const lost = {
      kind: "unreachable" as const,
      said: "the API did not answer",
      file: "runner.sh",
      verb: "attach",
      stderr: "",
    }
    const frames = await framesOf(
      Effect.scoped(
        Effect.gen(function* () {
          const outages = yield* Outages
          yield* (yield* Runs).turn(ID, {
            step: 3,
            sessionId: sid,
            agentPid: undefined,
            agentStart: undefined,
            usage: undefined,
            estimate: undefined,
          })
          yield* outages.failed(ID, lost)
          yield* settled
          yield* outages.ended(ID)
          yield* settled
        }),
      ),
      3,
    )
    expect(frames[0]).toMatchObject({
      _tag: "InFlight",
      turn: undefined,
      reattaching: { step: 3, kind: "unreachable", said: "the API did not answer" },
    })
    expect(frames[1]).toMatchObject({ _tag: "InFlight", turn: undefined })
    expect(frames[1]).not.toHaveProperty("reattaching")
    expect(spentOf(frames)).toEqual(["released", "released", "released"])
  })
})
