// Web push: the signing key, the subscriptions, and the sender that watches the feed.
//
// Here rather than in `workflow/` for `records.ts`'s reason: it drives nothing, takes
// no custody and touches no trak's state. It subscribes to `Feed` — the same frames the
// stream route serves — so `runtime.ts` never learns that phones exist, and a frame is
// an append rather than a second account of one (`store-publishing.ts` carries that
// argument).
//
// **The key must survive restarts, and losing it is not recoverable.** A push
// subscription is signed against this engine's VAPID key pair, so a regenerated key
// makes every stored subscription undeliverable with no error anywhere a person looks —
// each device has to turn notifications on again. That is why the pair is created once,
// then only ever re-read: in the engine's SQLite store, as its `push` value. A `push.json`
// an older engine wrote beside `daemon.json` is copied into the store the first time it
// holds none, and left where it is, so the older engine still finds the same key if it is
// put back. An entry point that keeps the record somewhere else hands `pushLayerOver` its
// own `PushRecords`, held to the same rule: only a read that found no record mints.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Option,
  Schema,
  Stream,
  SynchronizedRef,
  type Scope,
} from "effect"
// The default import, not named ones: `web-push` is CommonJS whose exports Node's ESM
// loader cannot enumerate, so a named import boots vitest and crashes `tsx src/serve.ts`.
import webpush from "web-push"
import { KeptPushSubscriptionDto, type PushSubscriptionDto } from "@orkestra/shared/dto/host-engine"
import { orkestraDir } from "../library/adapters/library-fs.js"
import {
  openSqliteLines,
  type SqliteLines,
  sqliteStorePath,
} from "../workflow/adapters/store-sqlite.js"
import type { GoalState } from "../workflow/domain/goal.js"
import { replayHistory } from "../workflow/domain/replay.js"
import {
  asGate,
  type TrakId,
  type Trak,
  type TrakState,
  UserId,
  type Wait,
  waitingAt,
} from "../workflow/domain/trak.js"
import { Feed, type Framed } from "../workflow/ports/feed.js"
import { heldJob, Locks } from "../workflow/ports/locks.js"
import { Store, type StoreShape } from "../workflow/ports/store.js"
import { type Item, People } from "./people.js"

/**
 * What the service worker draws: a title, one sentence, and where a tap goes.
 *
 * `tag` names the item the notification is about — `trak:<id>` or `goal:<id>` — so a
 * newer one for the same item replaces the last on the device, and a page opening that
 * item can find its notifications and close them.
 */
export interface PushPayload {
  readonly title: string
  readonly body: string
  readonly url: string
  readonly tag: string
}

export interface PushShape {
  /** The VAPID public key a browser subscribes with. Not a secret. */
  readonly publicKey: string
  /**
   * Keep a subscription, replacing any earlier one with the same endpoint, as `user`'s —
   * the host user who made it, absent where nobody was named.
   */
  readonly subscribe: (
    subscription: PushSubscriptionDto,
    user?: string,
  ) => Effect.Effect<void, Error>
  /** Forget the subscription with this endpoint. Unknown is a no-op, not an error. */
  readonly unsubscribe: (endpoint: string) => Effect.Effect<void, Error>
  /**
   * One payload to each subscription whose user `whose` admits — handed the stored user,
   * `undefined` for one kept with none. Best effort by design: a push service that refuses
   * is a log line, never a failure — nothing upstream may stall on a phone. A trak's or a
   * goal's goes through `sendToSeers`, so it reaches only the users who see the item.
   */
  readonly sendTo: (
    payload: PushPayload,
    whose: (user: string | undefined) => boolean,
  ) => Effect.Effect<void>
  /** `TEST_PAYLOAD` to every subscription, and what each push service answered. */
  readonly sendTest: Effect.Effect<readonly PushTried[]>
}

/**
 * What one subscription's push service made of one send. `service` is the endpoint's
 * host — enough to tell Apple's from Google's, and never the endpoint itself, whose
 * path is the capability to buzz that device.
 */
export interface PushTried {
  readonly service: string
  readonly accepted: boolean
  readonly said: string
}

/** What the settings page's test press sends. */
export const TEST_PAYLOAD: PushPayload = {
  title: "Orkestra",
  body: "A test notification from this engine",
  url: "/",
  tag: "test",
}

/**
 * The longest one send may take, socket and all. `web-push` sets no timeout of its own,
 * so without one a push service that never answers holds whatever waits on the send —
 * a goal's driver, or the test route — for ever.
 */
const SEND_TIMEOUT = Duration.seconds(15)

/** The one call into `web-push` that reaches the network — a parameter so a test can fake it. */
export type PushTransport = typeof webpush.sendNotification

export class Push extends Context.Tag("app/Push")<Push, PushShape>() {}

/**
 * VAPID requires a contact for the sender, read by the push service and nobody else.
 * A constant, because the engine has no identity of its own to put here — and never a
 * person's real address, which would travel to Apple and Google on every send.
 */
const VAPID_SUBJECT = "mailto:orkestra@example.com"

/** The push services' two ways of saying a subscription is dead: gone, or never here. */
const GONE = new Set([404, 410])

/**
 * What the store's `push` value and `push.json` hold. The private key never leaves the record
 * and this process.
 */
export const PushRecord = Schema.Struct({
  publicKey: Schema.String,
  privateKey: Schema.String,
  subscriptions: Schema.Array(KeptPushSubscriptionDto),
})
export type PushRecord = Schema.Schema.Type<typeof PushRecord>

/** The `push.json` under `orkestra`. */
export const recordPath = (orkestra: string): string => join(orkestra, ".database", "push.json")

/**
 * The stored record, or `undefined` where there is none. A file that will not parse is
 * an error rather than a silent regenerate: new keys orphan every phone (see the module
 * header), so the one wrong answer here is to mint a pair because reading failed.
 */
export const readRecord = (path: string): Effect.Effect<PushRecord | undefined, Error> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: () => new Error(`${path} is not JSON`),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknown(PushRecord)),
        Effect.mapError((e) => new Error(`${path} is not a push record: ${e.message}`)),
      ),
    ),
    Effect.catchIf(
      (error) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT",
      () => Effect.succeed(undefined),
    ),
    Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
  )

/** Where a push record is kept: the engine's SQLite store, or wherever an entry point chooses. */
export interface PushRecords {
  /** The record, or `undefined` where none was ever kept — the one case that mints. */
  readonly read: Effect.Effect<PushRecord | undefined, Error>
  readonly write: (record: PushRecord) => Effect.Effect<void, Error>
}

/** The engine's `push` value in the SQLite file. */
const PUSH_KEY = "push"

/**
 * The SQLite file at `store`. Where it holds no record and `legacy` — the `push.json` an older
 * engine wrote — does, that one is copied in and kept, so moving onto the store never mints a
 * key. One connection a call: the record is read at boot and written on a subscription change.
 */
const sqliteRecords = (store: string, legacy: string): PushRecords => {
  const onFile = <A>(body: (db: SqliteLines) => Effect.Effect<A, Error>) =>
    Effect.scoped(
      Effect.flatMap(
        Effect.mapError(openSqliteLines(store), (e) => new Error(e.reason)),
        body,
      ),
    )
  const write = (record: PushRecord): Effect.Effect<void, Error> =>
    onFile((db) =>
      Effect.mapError(db.keep(PUSH_KEY, JSON.stringify(record)), (e) => new Error(e.reason)),
    )
  const read = Effect.gen(function* () {
    const text = yield* onFile((db) =>
      Effect.mapError(db.kept(PUSH_KEY), (e) => new Error(e.reason)),
    )
    if (text === undefined) {
      const own = yield* readRecord(legacy)
      if (own !== undefined) yield* write(own)
      return own
    }
    return yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: () => new Error(`${store}'s push record is not JSON`),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknown(PushRecord)),
      Effect.mapError(
        (e) => new Error(`${store}'s push record is not a push record: ${e.message}`),
      ),
    )
  })
  return { read, write }
}

/** The engine's own record: its SQLite store, taking an older engine's `push.json` once. */
export const ownRecords = (orkestra: string): PushRecords =>
  sqliteRecords(sqliteStorePath(orkestra), recordPath(orkestra))

/**
 * `Push` over the record `recordsOf` keeps for the project's `.orkestra/`. A key pair is
 * minted only where `read` found no record — a read that fails fails the layer, since a
 * minted key orphans every phone (see the module header).
 */
export const pushLayerOver = (
  root: string,
  recordsOf: (orkestra: string) => PushRecords,
  transport: PushTransport,
): Layer.Layer<Push, Error> =>
  Layer.effect(
    Push,
    Effect.gen(function* () {
      const orkestra = yield* orkestraDir(root).pipe(Effect.mapError((e) => new Error(String(e))))
      const records = recordsOf(orkestra)
      const found = yield* records.read
      const keys = found ?? { ...webpush.generateVAPIDKeys(), subscriptions: [] }
      if (found === undefined) yield* records.write(keys)
      // One `SynchronizedRef`, so two requests changing the list serialize the
      // read-modify-write and the file always matches the last update.
      const held = yield* SynchronizedRef.make(keys.subscriptions)

      const change = (
        update: (
          subscriptions: readonly KeptPushSubscriptionDto[],
        ) => readonly KeptPushSubscriptionDto[],
      ): Effect.Effect<void, Error> =>
        SynchronizedRef.updateEffect(held, (subscriptions) => {
          const next = update(subscriptions)
          return Effect.as(
            records.write({
              publicKey: keys.publicKey,
              privateKey: keys.privateKey,
              subscriptions: next,
            }),
            next,
          )
        })

      const drop = (endpoint: string): Effect.Effect<void, Error> =>
        change((subscriptions) => subscriptions.filter((s) => s.endpoint !== endpoint))

      /**
       * One subscription, one INFO line naming the payload and the outcome — never the
       * endpoint or the keys. A dead endpoint is dropped so the store does not fill with
       * phones that reinstalled; see `refusal`.
       */
      const deliver = (
        subscription: KeptPushSubscriptionDto,
        payload: PushPayload,
        place: string,
      ): Effect.Effect<PushTried> =>
        Effect.tryPromise({
          try: () =>
            transport(
              { endpoint: subscription.endpoint, keys: subscription.keys },
              JSON.stringify(payload),
              {
                vapidDetails: {
                  subject: VAPID_SUBJECT,
                  publicKey: keys.publicKey,
                  privateKey: keys.privateKey,
                },
                timeout: Duration.toMillis(SEND_TIMEOUT),
              },
            ),
          catch: (error) => error,
        }).pipe(
          // The socket timeout above only counts silence; this bounds the whole send.
          Effect.timeoutFail({
            duration: SEND_TIMEOUT,
            onTimeout: () => new Error(`no answer in ${Duration.format(SEND_TIMEOUT)}`),
          }),
          Effect.map((sent) => ({ accepted: true, said: `accepted (${sent.statusCode})` })),
          Effect.catchAll((error) => refusal(error, drop(subscription.endpoint))),
          Effect.map((outcome) => ({ service: serviceOf(subscription.endpoint), ...outcome })),
          Effect.tap((tried) =>
            Effect.logInfo(`push: "${payload.body}" (${payload.tag}) to ${place}: ${tried.said}`),
          ),
        )

      const sendWhere = (
        payload: PushPayload,
        whose: (user: string | undefined) => boolean,
      ): Effect.Effect<readonly PushTried[]> =>
        Effect.gen(function* () {
          const subscriptions = (yield* SynchronizedRef.get(held)).filter((s) => whose(s.user))
          if (subscriptions.length === 0) {
            yield* Effect.logInfo(
              `push: "${payload.body}" (${payload.tag}) has no subscription to go to`,
            )
          }
          return yield* Effect.forEach(subscriptions, (s, i) =>
            deliver(s, payload, `subscription ${i + 1} of ${subscriptions.length}`),
          )
        })

      return {
        publicKey: keys.publicKey,
        subscribe: (subscription, user) =>
          change((subscriptions) => [
            ...subscriptions.filter((s) => s.endpoint !== subscription.endpoint),
            { ...subscription, ...(user === undefined ? {} : { user }) },
          ]),
        unsubscribe: drop,
        sendTo: (payload, whose) => Effect.asVoid(sendWhere(payload, whose)),
        sendTest: sendWhere(TEST_PAYLOAD, () => true),
      }
    }),
  )

/**
 * The layer `pnpm serve` runs on: key pair minted on first boot and kept for ever,
 * subscriptions rewritten on every change so an engine restart forgets nothing, in the
 * engine's own SQLite store.
 */
export const StoredPushLayer = (
  root: string,
  transport: PushTransport = webpush.sendNotification,
): Layer.Layer<Push, Error> => pushLayerOver(root, ownRecords, transport)

/**
 * `payload` to the subscriptions of the users who see `item` — `People.seers`, asked once. A
 * subscription whose user is not a user's id sees nothing. An item whose owner cannot be read
 * is sent to nobody, since nobody can say whose it is.
 */
export const sendToSeers = (payload: PushPayload, item: Item) =>
  Effect.gen(function* () {
    const sees = yield* (yield* People).seers(item)
    yield* (yield* Push).sendTo(payload, (user) =>
      user === undefined
        ? sees(undefined)
        : Option.match(Schema.decodeUnknownOption(UserId)(user), {
            onNone: () => false,
            onSome: sees,
          }),
    )
  }).pipe(
    Effect.catchTag("StoreFailed", (e) =>
      Effect.logWarning(
        `push: "${payload.body}" (${payload.tag}) went to nobody, since who sees it could not be read: ${e.reason}`,
      ),
    ),
  )

/**
 * What a send that threw comes to. A dead endpoint (`GONE`) is dropped by `drop`; anything
 * else is kept, because the next send may land.
 */
const refusal = (
  error: unknown,
  drop: Effect.Effect<void, Error>,
): Effect.Effect<{ readonly accepted: boolean; readonly said: string }> =>
  error instanceof webpush.WebPushError && GONE.has(error.statusCode)
    ? drop.pipe(
        Effect.as({ accepted: false, said: `gone (${error.statusCode}), dropped` }),
        Effect.catchAll((e) =>
          Effect.succeed({
            accepted: false,
            said: `gone (${error.statusCode}), and could not be dropped: ${e.message}`,
          }),
        ),
      )
    : Effect.succeed({
        accepted: false,
        said:
          error instanceof webpush.WebPushError
            ? `refused (${error.statusCode}${clippedBody(error.body)}), kept`
            : `failed (${error instanceof Error ? error.message : String(error)}), kept`,
      })

/** The push service's host, or a placeholder for an endpoint that is not a URL. */
const serviceOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host
  } catch {
    return "an unreadable endpoint"
  }
}

/** A refusal's body, which says why (`BadJwtToken`), cut so a page of HTML cannot flood the log. */
const clippedBody = (body: string): string => {
  const flat = body.replaceAll(/\s+/g, " ").trim()
  return flat === "" ? "" : `: ${flat.slice(0, 200)}`
}

/**
 * The most of the name a body may carry. A lock screen shows the opening of a body and
 * cuts the rest, and the state verb is the suffix — so an unbounded name is a buzz
 * that cannot say waiting, finished or failed, the half it is sent for. Titles and
 * requests are bounded nowhere upstream and requests carry literal newlines. 60 keeps
 * every body under 80 characters but the one naming a condition, which adds the
 * script's own file name and is bounded by that.
 */
const NAME_CAP = 60

/**
 * One short line however the name is written: every whitespace run — newlines
 * included — collapses to a single space, then the cap, with an ellipsis where it cut.
 * Applied once, above the branch in `notificationFor`, so the gate, `Finished`,
 * gave-up and `Failed` bodies cannot drift apart. The list row draws the same
 * `title ?? description` chain inside a CSS `truncate`; this is that clamp for a
 * surface with no CSS.
 */
const clipped = (name: string): string => {
  const flat = name.replaceAll(/\s+/g, " ").trim()
  return flat.length <= NAME_CAP ? flat : `${flat.slice(0, NAME_CAP)}…`
}

/**
 * What the drain compares one frame to the last on: the state's tag, and at `Finished`
 * whether the plan is held and whether the holding condition has given up.
 *
 * The tag alone is the wrong key at exactly one rest. A condition giving up appends a
 * `ConditionsUnmet` that leaves the trak at `Finished`, so read by tag it is a re-park
 * and says nothing — and it is the one thing on a held trak a person has to be told,
 * because nothing will run the step now and the decision is theirs. A held trak reached
 * again by a restart is still one phase, so it still buzzes nothing.
 */
export const phaseOf = (state: TrakState, wait: Wait | undefined): string =>
  wait === undefined ? state._tag : `${state._tag}:${wait.stopped ? "stopped" : "held"}`

/**
 * What a state is worth buzzing a locked phone for, or `undefined` for the rest.
 *
 * The set is read off the domain's own declarations rather than listed again: `asGate`
 * is the three states a human is being stood at, and `Finished` and `Failed` are the
 * two ways a trak stops mattering to watch. Everything in between is the engine
 * working, which is what the phone is *not* being asked to look at.
 *
 * **A `Finished` trak holding a step behind a condition is not finished**, and the
 * phone is not told it is. Nobody owes it anything — the engine runs the step by itself
 * once the condition is met, and the gates and the ending after that buzz as they
 * always did — so the rest is silent, as the engine working is. The one thing worth a
 * buzz on a held trak is the condition giving up: the step never runs now, and what
 * happens to the trak is the person's to decide, so the body names the script that
 * said so — the same script `HeldCard` names under the ending, said in a sentence
 * rather than in that pane's *will not be asked again*.
 *
 * `name` is what the body calls the trak. A locked phone shows the body and nothing
 * else, so an id there could not be acted on without opening it — which is what the
 * notification was sent to spare. The tap's `url` still carries the id, because a
 * route wants the id and nobody reads a URL off a lock screen.
 */
export const notificationFor = (
  id: TrakId,
  state: TrakState,
  name: string,
  /** `waitingAt` on the trak the frame carries — present at the one rest a wait produces. */
  wait: Wait | undefined,
): PushPayload | undefined => {
  const called = clipped(name)
  const line =
    asGate(state) !== undefined
      ? `${called} is waiting on you`
      : state._tag === "Finished"
        ? wait === undefined
          ? `${called} finished`
          : wait.stopped
            ? `${called} gave up waiting on ${wait.name}`
            : undefined
        : state._tag === "Failed"
          ? `${called} failed`
          : undefined
  return line === undefined
    ? undefined
    : { title: "Orkestra", body: line, url: `/traks/${id}`, tag: `trak:${id}` }
}

/**
 * What a goal reaching a state is worth a buzz for: each of its gates, which always
 * wait for a person, and a composer turn the provider lost. Everything else is the goal
 * working, and says nothing.
 */
export const goalNotificationFor = (
  id: string,
  state: GoalState,
  title: string,
): PushPayload | undefined => {
  const called = clipped(title)
  const line =
    state._tag === "AtGate"
      ? state.gate === "file"
        ? `${called}: the drafted goal file is waiting on you`
        : state.gate === "plan"
          ? `${called}: the plan is waiting on you`
          : state.gate === "escalation"
            ? `${called} has a question for you`
            : state.gate === "action"
              ? `${called} needs you to do something`
              : `${called} says it is done`
      : state._tag === "Failed"
        ? `${called}: its composer failed`
        : undefined
  return line === undefined
    ? undefined
    : { title: "Orkestra", body: line, url: `/goals/${id}`, tag: `goal:${id}` }
}

/**
 * The words a person recognises the trak by: the plan's title, or the request while no
 * plan exists — the chain `TrakSummaryDto` documents and every list row draws.
 *
 * Replayed from the store rather than remembered from frames, so the name is there for
 * a trak whose naming events all landed before the last engine restart — the drain's
 * `last` map starts empty, and the replayed frames carry states, not plans. A log that
 * cannot be read falls back to the id: a badly named buzz still reaches the phone, and
 * nothing upstream may stall on one.
 *
 * **`catchTags` rather than `catchAll`**, though both tags take the same answer here:
 * `StoreUndecodable` is a separate tag precisely so nothing absorbs it by accident (see
 * `ports/store-errors.ts`), and naming both is what makes a third read failure a type
 * error instead of a silent id.
 */
const nameOf = (trak: Trak): string => trak.plan?.title ?? trak.description

const trakName = (store: StoreShape, id: TrakId): Effect.Effect<string> => {
  const unnamed = (reason: string): Effect.Effect<string> =>
    Effect.as(Effect.logWarning(`push: could not read ${id} for its name: ${reason}`), id)
  return store.events(id).pipe(
    Effect.map((events) => nameOf(replayHistory(id, events))),
    Effect.catchTags({
      StoreFailed: (e) => unnamed(e.reason),
      StoreUndecodable: (e) => unnamed(e.reason),
    }),
  )
}

/** What the drain remembers between frames. */
interface Drained {
  /** Each trak's last phase — what makes a transition a transition. */
  readonly last: Map<TrakId, string>
  /** Each trak's highest `seq` seen, so a frame older than a re-read is not news. */
  readonly seq: Map<TrakId, number>
  /** The traks that existed as the drain began, whose phase then nobody saw. */
  readonly before: ReadonlySet<TrakId>
  /** The highest frame id read, where a jump past it is frames the ring dropped. */
  highest: number | undefined
}

/**
 * One trak reaching `state`: remember the phase, and fork its buzz where the phase is new
 * and notifiable. Forked so nothing here waits on a send; see `forwardToPush`.
 */
const reached = (
  drained: Drained,
  sends: FiberSet.FiberSet,
  arrival: { readonly id: TrakId; readonly state: TrakState; readonly wait: Wait | undefined },
  name: Effect.Effect<string>,
): Effect.Effect<void, never, Push | People> =>
  Effect.gen(function* () {
    const { id, state, wait } = arrival
    const phase = phaseOf(state, wait)
    const previous = drained.last.get(id)
    drained.last.set(id, phase)
    if (previous === phase) return
    const told = Effect.flatMap(name, (called) => {
      const payload = notificationFor(id, state, called, wait)
      return payload === undefined ? Effect.void : sendToSeers(payload, { trak: id })
    })
    yield* FiberSet.run(
      sends,
      Effect.catchAllCause(told, (cause) =>
        Effect.logError(`push: the send for ${id} died`, cause),
      ),
    )
  })

/**
 * After a jump in frame ids: every trak's state read from its log, and a buzz for each
 * that moved while the drain was not looking. A trak that predates the drain and has sent
 * no frame since is left alone — its phase then is unknown, and guessing would re-buzz
 * every gate already standing at boot.
 */
const caughtUp = (
  drained: Drained,
  sends: FiberSet.FiberSet,
): Effect.Effect<void, never, Push | Store | People> =>
  Effect.gen(function* () {
    const store = yield* Store
    const ids = yield* store
      .list()
      .pipe(
        Effect.catchTag("StoreFailed", (e) =>
          Effect.as(Effect.logWarning(`push: could not list traks to catch up: ${e.reason}`), []),
        ),
      )
    for (const id of ids) {
      if (!drained.last.has(id) && drained.before.has(id)) continue
      const events = yield* store.events(id).pipe(
        Effect.catchTags({
          StoreFailed: () => Effect.succeed(undefined),
          StoreUndecodable: () => Effect.succeed(undefined),
        }),
      )
      if (events === undefined) continue
      const trak = replayHistory(id, events)
      drained.seq.set(id, Math.max(drained.seq.get(id) ?? 0, events.length))
      const arrival = { id, state: trak.state, wait: waitingAt(trak) }
      yield* reached(drained, sends, arrival, Effect.succeed(nameOf(trak)))
    }
  })

/**
 * The subscriber: every `Appended` frame's state, one notification per transition into
 * a notifiable one.
 *
 * **The caller subscribes; this only drains.** `feed.since(0)` is taken by the caller
 * so the subscription exists before the first append it must not miss — a fork
 * establishes nothing by any particular moment.
 *
 * The transition check is what makes a gate exactly one notification: a `Restarted`
 * that re-parks the same gate, or a conversation that returns to it, appends frames
 * whose phase has not changed, and those say nothing a phone has not already heard.
 * `phaseOf` is the key rather than the tag, so a condition giving up on a resting
 * trak counts as the transition it is.
 *
 * **Nothing here waits on a send.** The feed is a sliding ring, so a drain that waits
 * loses the oldest frames while it does — and a send that never returns would stop it
 * for good. Each name read and send is forked. Two sends for one trak can then land out
 * of order; the cost is a stale line on a lock screen, where waiting costs the gate.
 *
 * **A jump in frame ids is frames the ring dropped**, which a burst from other traks
 * can still cause. It is logged, and `caughtUp` re-reads the logs, which is the repair
 * the feed documents for a reader that fell behind. Two traks publishing at once can
 * deliver ids a frame or two out of order; that reads as a small jump and costs a
 * re-read.
 */
export const forwardToPush = (
  frames: Stream.Stream<Framed>,
): Effect.Effect<void, never, Push | Store | People> =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* Store
      const sends = yield* FiberSet.make()
      const before = yield* store.list().pipe(Effect.orElseSucceed(() => []))
      const drained: Drained = {
        last: new Map(),
        seq: new Map(),
        before: new Set(before),
        highest: undefined,
      }
      yield* Stream.runForEach(frames, ({ id, frame }) =>
        Effect.gen(function* () {
          const { highest } = drained
          drained.highest = Math.max(highest ?? id, id)
          if (highest !== undefined && id > highest + 1) {
            yield* Effect.logWarning(
              `push: the drain missed ${id - highest - 1} feed frames before ${id}, and is re-reading every trak`,
            )
            yield* caughtUp(drained, sends)
          }
          if (frame._tag === "Removed") {
            drained.last.delete(frame.id)
            drained.seq.delete(frame.id)
            return
          }
          if (frame._tag !== "Appended") return
          if (frame.seq <= (drained.seq.get(frame.id) ?? 0)) return
          drained.seq.set(frame.id, frame.seq)
          // The store read runs on every phase transition, notifiable or not — a handful
          // per step, each after an agent turn, so a cache would save nothing worth its
          // staleness rules.
          const arrival = { id: frame.id, state: frame.trak.state, wait: waitingAt(frame.trak) }
          yield* reached(drained, sends, arrival, trakName(store, frame.id))
        }),
      )
    }),
  )

/**
 * Run `first`, and `again` each time the drain before it ends: a defect logged, a pause,
 * and a fresh drain. An interruption is the engine shutting down, and ends it. The feed
 * never ends a subscription, so a drain that returns is as wrong as one that died.
 */
export const keepDraining = <R>(
  first: Effect.Effect<void, never, R>,
  again: Effect.Effect<void, never, R>,
  pause: Duration.DurationInput = Duration.seconds(1),
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    let drain = first
    for (;;) {
      const exit = yield* Effect.exit(drain)
      if (Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)) return
      yield* Exit.isFailure(exit)
        ? Effect.logError("push: the drain died, and is restarting", exit.cause)
        : Effect.logError("push: the drain ended, and is restarting")
      yield* Effect.sleep(pause)
      drain = again
    }
  })

/**
 * Subscribe and fork the supervised drain — the one line `serve.ts` calls. Lives here so
 * the subscribe-before-fork order above cannot be got wrong at the call site. A restart
 * subscribes afresh, so it misses only what was published while it paused.
 *
 * **Under an external store it drains on one copy**, the one holding the `push` job: every
 * copy's feed carries every copy's appends, so a drain on each would send each
 * notification once per copy. A copy taking the job over subscribes as it takes it, and
 * misses what was published before.
 */
export const startPushForwarding: Effect.Effect<
  void,
  never,
  Feed | Push | Store | Locks | People | Scope.Scope
> = Effect.gen(function* () {
  const feed = yield* Feed
  const again = Effect.scoped(Effect.flatMap(feed.since(0), (r) => forwardToPush(r.frames)))
  if ((yield* Locks).expiresAfter !== undefined) {
    yield* Effect.forkScoped(heldJob("push", keepDraining(again, again)))
    return
  }
  const replay = yield* feed.since(0)
  yield* Effect.forkScoped(keepDraining(forwardToPush(replay.frames), again))
})
