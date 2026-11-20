// Push: a slow or silent push service must not cost a later gate its buzz.
//
// The feed the drain reads is a sliding PubSub of 256 frames, so a drain that waited on
// a send would lose the oldest frames while it waited, and a send that never returned
// would stop it for good. These tests hold a send open and check the next gate is still
// sent.
//
// The burst below is what a host running several sandboxed traks publishes on its own:
// another trak's running turn reporting its spend (`InFlight`) once per reading.

import { Deferred, Duration, Effect, Layer, Option, Queue, Ref } from "effect"
import { describe, expect, it } from "vitest"
import { composer, runFlow, step } from "../support/flow.js"
import { act, create, human } from "../support/scenario.js"
import { memoryPush } from "../support/push-memory.js"
import { reply } from "../support/scripted-agent.js"
import { forwardToPush, Push, type PushPayload } from "../../src/app/push.js"
import { Feed, Frame } from "../../src/workflow/ports/feed.js"
import { TrakId } from "../../src/workflow/domain/trak.js"

const bodyOf = (payload: PushPayload): string => payload.body

/** The next payload's body, or `None` where none arrives within two seconds. */
const nextBody = (sent: Queue.Queue<PushPayload>) =>
  Queue.take(sent).pipe(
    Effect.timeout(Duration.seconds(2)),
    Effect.option,
    Effect.map(Option.map(bodyOf)),
  )

/** More than the feed holds for one subscriber. */
const BURST = 300

/**
 * A sender whose first send does not return until `release` — a push service that is
 * slow to answer. Every payload, the held one included, lands on `sent` once it returns.
 */
const slowFirstSend = Effect.gen(function* () {
  const base = yield* memoryPush
  const release = yield* Deferred.make<void>()
  const started = yield* Deferred.make<PushPayload>()
  const first = yield* Ref.make(true)
  const layer = Layer.effect(
    Push,
    Effect.map(Push, (inner) => ({
      ...inner,
      sendTo: (payload: PushPayload, whose: (user: string | undefined) => boolean) =>
        Effect.gen(function* () {
          if (yield* Ref.getAndSet(first, false)) {
            yield* Deferred.succeed(started, payload)
            yield* Deferred.await(release)
          }
          yield* inner.sendTo(payload, whose)
        }),
    })),
  ).pipe(Layer.provide(base.layer))
  return { layer, sent: base.sent, release, started }
})

describe("the feed subscriber while a send is outstanding", () => {
  it("still buzzes a gate reached while the last send was in flight", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* slowFirstSend
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

          // The plan gate's buzz goes out and the push service is slow to answer it.
          yield* create(id, "Add a --json flag")
          expect((yield* Deferred.await(push.started)).body).toBe(
            "Add a --json flag is waiting on you",
          )

          // Meanwhile the trak is approved and parks at its step's gate, and another
          // sandboxed trak's turn keeps reporting its spend.
          yield* act(id, 0, human.approve())
          const other = TrakId.make("busy-sandboxed-trak")
          for (let i = 0; i < BURST; i++) {
            yield* feed.publish(Frame.InFlight({ id: other, turn: undefined }))
          }

          // The push service answers. Both gates are owed a buzz.
          yield* Deferred.succeed(push.release, undefined)
          expect((yield* Queue.take(push.sent)).body).toBe("Add a --json flag is waiting on you")
          expect(yield* nextBody(push.sent)).toEqual(
            Option.some("Add a --json flag is waiting on you"),
          )
        }),
      ),
    )
  })

  it("still buzzes the next gate when one send never returns", async () => {
    await runFlow([composer("work"), step(1, "work", reply.artifact("Added --json"))], (id) =>
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* slowFirstSend
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          yield* Effect.forkScoped(Effect.provide(forwardToPush(replay.frames), push.layer))

          // A push service that never answers the first send.
          yield* create(id, "Add a --json flag")
          yield* Deferred.await(push.started)

          yield* act(id, 0, human.approve())
          expect(yield* nextBody(push.sent)).toEqual(
            Option.some("Add a --json flag is waiting on you"),
          )
        }),
      ),
    )
  })
})
