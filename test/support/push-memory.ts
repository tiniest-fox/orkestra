// The push store in memory, for every flow test that is not about push: the routes
// need a `Push` in scope, and a flow that never subscribes pays for an empty list.
//
// `sent` is what the push theme asserts on — a `Queue`, so a test *waits* for a
// notification rather than sleeping and hoping the sender's fiber has run. Taking from
// it is the assertion; a payload that never arrives fails by timeout with the queue's
// contents as the story. It holds every payload sent, whoever it reached; `sentTo` says
// whose subscriptions each one reached.

import { Context, Effect, Layer, Queue, Ref } from "effect"
import type { KeptPushSubscriptionDto } from "@orkestra/shared/dto/host-engine"
import { Push, TEST_PAYLOAD, type PushPayload } from "../../src/app/push.js"

/**
 * `sent`, for a flow body whose `Push` was built into a layer it cannot reach — the
 * goal drivers take theirs when the scenario is built.
 */
export class PushSent extends Context.Tag("test/PushSent")<PushSent, Queue.Queue<PushPayload>>() {}

/** A payload `sendTo` sent, with the users whose subscriptions it reached. */
export interface SentTo {
  readonly payload: PushPayload
  readonly reached: readonly (string | undefined)[]
}

/** `sentTo`, for the same body `PushSent` is for. */
export class PushSentTo extends Context.Tag("test/PushSentTo")<
  PushSentTo,
  Effect.Effect<readonly SentTo[]>
>() {}

export interface MemoryPush {
  readonly layer: Layer.Layer<Push | PushSent | PushSentTo>
  readonly sent: Queue.Queue<PushPayload>
  readonly subscriptions: Effect.Effect<readonly KeptPushSubscriptionDto[]>
  /** What `sendTo` sent, in order, with whose subscriptions each reached. */
  readonly sentTo: Effect.Effect<readonly SentTo[]>
}

export const memoryPush: Effect.Effect<MemoryPush> = Effect.gen(function* () {
  const sent = yield* Queue.unbounded<PushPayload>()
  const held = yield* Ref.make<readonly KeptPushSubscriptionDto[]>([])
  const targeted = yield* Ref.make<readonly SentTo[]>([])
  const pushLayer = Layer.succeed(Push, {
    publicKey: "test-vapid-public-key",
    subscribe: (subscription, user) =>
      Ref.update(held, (subscriptions) => [
        ...subscriptions.filter((s) => s.endpoint !== subscription.endpoint),
        { ...subscription, ...(user === undefined ? {} : { user }) },
      ]),
    unsubscribe: (endpoint) =>
      Ref.update(held, (subscriptions) => subscriptions.filter((s) => s.endpoint !== endpoint)),
    sendTo: (payload, whose) =>
      Effect.flatMap(Ref.get(held), (subscriptions) =>
        Effect.zipRight(
          Ref.update(targeted, (all) => [
            ...all,
            { payload, reached: subscriptions.filter((s) => whose(s.user)).map((s) => s.user) },
          ]),
          Queue.offer(sent, payload),
        ),
      ),
    // Every push service accepts, as every send above lands.
    sendTest: Effect.flatMap(Queue.offer(sent, TEST_PAYLOAD), () =>
      Effect.map(Ref.get(held), (subscriptions) =>
        subscriptions.map((s) => ({
          service: new URL(s.endpoint).host,
          accepted: true,
          said: "accepted (201)",
        })),
      ),
    ),
  })
  const layer = Layer.mergeAll(
    pushLayer,
    Layer.succeed(PushSent, sent),
    Layer.succeed(PushSentTo, Ref.get(targeted)),
  )
  return { layer, sent, subscriptions: Ref.get(held), sentTo: Ref.get(targeted) }
})
