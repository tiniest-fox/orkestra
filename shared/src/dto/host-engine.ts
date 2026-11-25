// What an engine answers anybody, hosted or not: the login, who it is, the push key and the
// subscriptions a browser hands it, and the one notification a host may ask it to send. Every
// other shape an engine and its host send each other is the host's to define.
// Part of the wire contract; `common.ts` says how the slices fit together.

import { Schema } from "effect"

/**
 * `POST /api/session` — the passphrase the engine was started with, exchanged for a
 * session cookie. The whole body; there is no username, because there is one person.
 */
export const LoginRequestDto = Schema.Struct({ passphrase: Schema.String })
export type LoginRequestDto = Schema.Schema.Type<typeof LoginRequestDto>

/**
 * `GET /api/health` — who this engine is, and which client build it serves now.
 *
 * `client` is the id the build wrote into `build.json` beside the bundle in `client/dist`,
 * read on each request so a rebuild under a running engine shows on the next ask. **Absent where no bundle or
 * no id is there**, which is also how an engine from before the field answers — a page
 * reads either as *could not tell*, never as a newer build.
 *
 * `store` is whether the project's store process answers, with why not where it does not.
 * **Absent where the engine has no external store.**
 *
 * `config` is the `.orkestra/` the engine serves, which under an external store is read out of
 * the commit `origin`'s default branch names, again each time the engine sees that branch
 * move. **Absent where the engine has no external store**, since it then reads its own
 * checkout.
 *
 * - `commit` is the commit served. Absent where none is: `origin` names no default branch,
 *   or the commit the engine booted on would not load, and the shipped agents serve alone.
 * - `refused` is the last commit whose `.orkestra/` would not load, with the loader's line
 *   and when, epoch milliseconds. The files held before it go on serving. **Cleared by the
 *   next read that loads**, so its presence is the whole of *something is wrong*.
 */
export const HealthDto = Schema.Struct({
  cwd: Schema.String,
  version: Schema.String,
  client: Schema.optional(Schema.String),
  store: Schema.optional(
    Schema.Struct({ up: Schema.Boolean, reason: Schema.optional(Schema.String) }),
  ),
  config: Schema.optional(
    Schema.Struct({
      commit: Schema.optional(Schema.String),
      refused: Schema.optional(
        Schema.Struct({ commit: Schema.String, reason: Schema.String, at: Schema.Number }),
      ),
    }),
  ),
})
export type HealthDto = Schema.Schema.Type<typeof HealthDto>

/**
 * `GET /api/push` — the engine's VAPID public key, which a browser hands to
 * `PushManager.subscribe` so the push service will only accept sends signed by this
 * engine. Free to read: it is not a secret, and the private half never crosses the wire.
 */
export const PushKeyDto = Schema.Struct({ publicKey: Schema.String })
export type PushKeyDto = Schema.Schema.Type<typeof PushKeyDto>

/**
 * `POST /api/push` — one browser's push subscription, exactly the fields
 * `PushSubscription.toJSON()` carries that a sender needs. The engine stores it whole
 * and asks nothing about it: the endpoint is the push service's URL and the keys are
 * what `web-push` encrypts each payload with.
 *
 * `endpoint` is also the identity — `DELETE /api/push?endpoint=…` removes by it, and a
 * re-subscribe from the same browser replaces rather than duplicates.
 */
export const PushSubscriptionDto = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
})
export type PushSubscriptionDto = Schema.Schema.Type<typeof PushSubscriptionDto>

/**
 * A subscription as the engine keeps it: what the browser sent, and the host user whose
 * device sent it, from the host's `x-orkestra-user`. Absent where nobody was named — every
 * subscription kept before the field existed, and every one on an engine with no host —
 * which belongs to the host's first user.
 */
export const KeptPushSubscriptionDto = Schema.Struct({
  ...PushSubscriptionDto.fields,
  user: Schema.optional(Schema.String),
})
export type KeptPushSubscriptionDto = Schema.Schema.Type<typeof KeptPushSubscriptionDto>

/**
 * `POST /api/push/notify`, sent by the host to each engine it runs with that engine's bearer:
 * one notification the host has to say, through the engine's own push key. `to` is the host
 * users whose phones it goes to; absent, every subscription. An engine refuses one that a
 * device made through the host's proxy, which names who pressed.
 */
export const HostNotifyDto = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  tag: Schema.String,
  to: Schema.optional(Schema.Array(Schema.String)),
})
export type HostNotifyDto = Schema.Schema.Type<typeof HostNotifyDto>
