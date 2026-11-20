// What a host or a browser asks of the engine itself: who it is, the push subscriptions, and
// one notification the host has to say. Answers with `@orkestra/shared/dto/host-engine`. The
// routes only a host asks — the runner, the push test and the work nobody owns — are the
// host's to add.

import { Effect, Option } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { HostNotifyDto, PushKeyDto, PushSubscriptionDto } from "@orkestra/shared/dto/host-engine"
import { StoreHealth } from "../../workflow/ports/store-health.js"
import { Push } from "../push.js"
import { pressedBy } from "../guard.js"
import { bundleId } from "../client-bundle.js"
import { health } from "../discovery.js"
import { PROJECT } from "./common.js"

/** `client` is the built client the engine serves, whose build id the answer carries. */
const healthRoute = (client?: string) =>
  Router.get(
    "/api/health",
    Effect.gen(function* () {
      const id = yield* Effect.promise(() => bundleId(client))
      const store = yield* Effect.serviceOption(StoreHealth)
      const status = Option.isSome(store) ? yield* store.value.status : undefined
      return yield* ServerResponse.json(health(PROJECT, id, status))
    }),
  )

/**
 * Push, all on one path: the key a browser subscribes with, keeping the subscription it
 * made, and forgetting one.
 *
 * **None of these reads a trak, and none is free of the guard.** The subscription is a
 * capability to buzz somebody's phone, so it is taken only from a logged-in page — a
 * cookie plus `sec-fetch-site`, exactly as every other write. What a subscription is
 * *sent* is `push.ts`'s business, off the feed; these routes only tend the store.
 *
 * The DELETE takes the endpoint on the query string rather than a body: it is the
 * subscription's own identity, the one thing the caller holds, and a DELETE with a body
 * is the request an intermediary is most likely to mangle.
 */
const pushKeyRoute = Router.get(
  "/api/push",
  Effect.gen(function* () {
    const push = yield* Push
    return yield* ServerResponse.json(PushKeyDto.make({ publicKey: push.publicKey }))
  }),
)

const pushSubscribeRoute = Router.post(
  "/api/push",
  Effect.gen(function* () {
    const subscription = yield* ServerRequest.schemaBodyJson(PushSubscriptionDto)
    // Whose device it is, so a notice meant for one user reaches their devices alone.
    yield* (yield* Push).subscribe(subscription, yield* pressedBy)
    return ServerResponse.empty({ status: 204 })
  }),
)

/**
 * One notification the host has to say — a backup that failed or went stale — sent through
 * this engine's push key to the subscriptions of the users it names. **Refused where the
 * request names who pressed**: on a host with users the proxy names the device's user on
 * everything a browser sends, and a member's page must not be able to buzz an admin's phone
 * with words of its own. On a host with no users the proxy names nobody, so a device reaches
 * this — every device there is an admin. The host calls this itself, with the bearer and no user.
 */
const pushNotifyRoute = Router.post(
  "/api/push/notify",
  Effect.gen(function* () {
    if ((yield* pressedBy) !== undefined) {
      return ServerResponse.text("only the host sends a notification of its own", {
        status: 403,
      })
    }
    const asked = yield* ServerRequest.schemaBodyJson(HostNotifyDto)
    const to = asked.to
    const payload = { title: asked.title, body: asked.body, url: "/", tag: asked.tag }
    yield* (yield* Push).sendTo(payload, (user) =>
      to === undefined ? true : user !== undefined && to.includes(user),
    )
    return ServerResponse.empty({ status: 204 })
  }),
)

const pushUnsubscribeRoute = Router.del(
  "/api/push",
  Effect.gen(function* () {
    const params = yield* ServerRequest.ParsedSearchParams
    const endpoint = params["endpoint"]
    if (typeof endpoint !== "string" || endpoint === "") {
      return ServerResponse.empty({
        status: 400,
        statusText: "endpoint names the subscription to remove",
      })
    }
    yield* (yield* Push).unsubscribe(endpoint)
    return ServerResponse.empty({ status: 204 })
  }),
)

/** `client` is the built client the engine serves; `client/dist` where left out. */
export const hostRoutes = (client?: string) =>
  Router.empty.pipe(
    healthRoute(client),
    pushKeyRoute,
    pushSubscribeRoute,
    pushNotifyRoute,
    pushUnsubscribeRoute,
  )
