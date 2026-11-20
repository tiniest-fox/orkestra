// The login, and the one guard in front of the API.
//
// **Everything under `/api/` needs a credential, and `GET /api/health` is the exception.**
// Three credentials exist, and the third reaches one trak's or one goal's tool routes
// alone — see `trakToken`. The other two: the session cookie a browser earns at
// `POST /api/session` by presenting `ORKESTRA_PASSPHRASE`, and the per-boot bearer token
// the daemon writes into `daemon.json` for `ork`. A session outlives the boot that issued
// it — see `SESSION_AGE` and `openSessions` — and the bearer does not. Paths outside
// `/api/` — the client bundle — pass untouched: the login screen is in the bundle, so a
// phone that cannot load it cannot log in.
//
// **Loopback is not a credential, and that is the whole design.** A tunnel client runs on
// this machine and connects to the engine over loopback, so exempting `127.0.0.1` would
// put a money-spending engine on the public internet the moment somebody ran one — with no
// code change and no warning. The token replaces the exemption: `ork` reads it off a file
// only the person can read.
//
// **The guard is off when no passphrase is set.** `pnpm serve` with nothing exported binds
// loopback and answers everything, exactly as it did before any of this existed. The
// boot refuses to bind wider than loopback in that state — `bindPlan` below — so the open
// engine is only ever reachable from the machine it runs on, and from whatever the person
// points at it.
//
// Nothing here knows a tunnel exists. The one forwarded header read is
// `x-forwarded-proto`, because whether the request arrived over TLS is a fact about the
// request, and it decides one thing: whether the cookie may carry `Secure`.
//
// `/api/session` is answered here rather than by `server.ts`, so the router stays exactly
// what it was and this file is the whole of the surface a credential touches.
//
// **Which path a request is for is the router's call, never a string test here.** The
// router normalises a target before matching — collapsed slashes, percent-decoding, an
// absolute-form host stripped, case folded — and a guard that read the raw string would
// admit `//api/traks` as *not the API* while the router routed it there. `app/target.ts`
// asks the router itself, and this file reads only its answer.
//
// **A cookie-authenticated write is admitted only from the engine's own page.** A cookie
// is sent by the browser on a page's behalf, so it is the one credential another origin
// could borrow; `sec-fetch-site` says which page asked, and only `same-origin` and `none`
// (a navigation nobody scripted) are the engine's. Anything else — `cross-site`,
// `same-site`, or no header at all — is refused. The cost is real and small: a client
// carrying the cookie without Fetch Metadata cannot write. `ork` carries the bearer and
// is not affected.

import { createHmac, randomBytes, scryptSync } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { Clock, Duration, Effect, Schema, SynchronizedRef } from "effect"
import type * as HttpApp from "@effect/platform/HttpApp"
import * as Headers from "@effect/platform/Headers"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { LoginRequestDto } from "@orkestra/shared/dto/host-engine"
import {
  bearerOf,
  cookieAttributes,
  EVERY_INTERFACE,
  FAILED_LOGIN_DELAY,
  fromOwnPage,
  hashOf,
  LOOPBACK,
  mintToken,
  reads,
  same,
  USER_HEADER,
  writePrivate,
} from "./access.js"
import { UserId } from "../workflow/domain/trak.js"
import { goalToolsOf, targetOf, trakToolsOf } from "./target.js"

// ============================================================================
// The boot decision — where to bind, and whether that is allowed
// ============================================================================

/** The variable a passphrase arrives in. `ORKESTRA_`-prefixed so `spawnEnv` strips it. */
export const PASSPHRASE_ENV = "ORKESTRA_PASSPHRASE"

const HOST_FLAG = "--host"

export interface BindPlan {
  readonly host: string
  /** `undefined` is open: no login, and loopback only. */
  readonly passphrase: string | undefined
}

export interface BindRefusal {
  readonly refused: string
}

/**
 * Where `pnpm serve` binds, from its arguments and its environment.
 *
 * **`--host` with no passphrase is refused, and the refusal names the variable.** Binding
 * every interface puts endpoints that spawn `claude` on the local network, and an open
 * engine there is the failure the loopback default exists to prevent. An empty passphrase
 * counts as none — `ORKESTRA_PASSPHRASE=` in a shell is a slip, not a choice.
 *
 * `rest` is what `projectDir` hands back after taking `--dir`, so the two flags cannot
 * be confused for each other's value.
 */
export const bindPlan = (
  rest: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): BindPlan | BindRefusal => {
  const raw = env[PASSPHRASE_ENV]
  const passphrase = raw === undefined || raw === "" ? undefined : raw
  const wide = rest.includes(HOST_FLAG)
  if (wide && passphrase === undefined) {
    return {
      refused:
        `${HOST_FLAG} binds every interface, and nothing would stand in front of an engine ` +
        `that spends money. Set ${PASSPHRASE_ENV} first, or drop the flag.`,
    }
  }
  return { host: wide ? EVERY_INTERFACE : LOOPBACK, passphrase }
}

// ============================================================================
// The guard
// ============================================================================

const SESSION_COOKIE = "orkestra_session"

/**
 * How long a session lasts from the login that issued it, and the cookie's `Max-Age` with
 * it: the one place the lifetime is set. The engine keeps each session for this long
 * across restarts, and refuses it after, whatever the browser still holds.
 */
const SESSION_AGE = Duration.days(30)

/**
 * The credential a step's tool server at one trak is handed, derived from the boot's
 * token rather than stored: it admits that trak's tool routes and nothing else, and a new
 * boot's token makes every one handed out before it worthless.
 */
export const trakToken = (token: string, trak: string): string =>
  createHmac("sha256", token).update(trak).digest("hex")

/**
 * The credential a goal composer's tool server is handed, derived as `trakToken` is: it
 * admits that goal's tool routes and nothing else. Keyed under a prefix no trak id can
 * spell, so a goal's token never opens a trak's routes.
 */
export const goalToken = (token: string, goal: string): string => trakToken(token, `goal/${goal}`)

// ============================================================================
// The sessions, on disk
// ============================================================================

/**
 * `sessions.json` under `.orkestra/.database/`, beside `daemon.json` and `push.json`.
 * The engine is the only process that writes it.
 */
export const sessionsFile = (orkestra: string): string =>
  join(orkestra, ".database", "sessions.json")

/**
 * What the file holds. **Never a token**: each session is the SHA-256 of its cookie value,
 * so a copy of the file — a backup, a synced folder — opens nothing. A plain hash is
 * enough for a token, which is 256 random bits; the passphrase is not random, so it is
 * kept as a salted `scrypt` fingerprint a copy cannot be guessed back from cheaply.
 */
const SessionRecord = Schema.Struct({
  fingerprint: Schema.Struct({ salt: Schema.String, hash: Schema.String }),
  sessions: Schema.Array(Schema.Struct({ hash: Schema.String, expires: Schema.Number })),
})
type SessionRecord = Schema.Schema.Type<typeof SessionRecord>
type Session = SessionRecord["sessions"][number]

const live = (sessions: readonly Session[], at: number): readonly Session[] =>
  sessions.filter((session) => session.expires > at)

const fingerprintWith = (passphrase: string, salt: string): string =>
  scryptSync(passphrase, salt, 32).toString("hex")

/**
 * The stored record, or `undefined` where there is none or it will not read. Unlike
 * `push.json`, a file that will not parse is discarded with a warning rather than
 * refused: losing it logs every browser out, which is the safe direction.
 */
const readSessions = (path: string): Effect.Effect<SessionRecord | undefined> =>
  Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: (error) => error }).pipe(
    Effect.flatMap((text) =>
      Effect.try({ try: (): unknown => JSON.parse(text), catch: (error) => error }),
    ),
    Effect.flatMap((parsed) => Schema.decodeUnknown(SessionRecord)(parsed)),
    Effect.catchAll((error: unknown) =>
      isMissing(error)
        ? Effect.succeed(undefined)
        : Effect.as(
            Effect.logWarning(
              `${path} could not be read as sessions, so every session is discarded: ${String(error)}`,
            ),
            undefined,
          ),
    ),
  )

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

const writeSessions = (path: string, record: SessionRecord): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () => writePrivate(path, `${JSON.stringify(record)}\n`),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

interface Sessions {
  readonly holds: (session: string) => Effect.Effect<boolean>
  /** A new session, written to disk before it is handed out. */
  readonly issue: Effect.Effect<string, Error>
  /** Every session, here and on disk. */
  readonly revokeAll: Effect.Effect<void, Error>
}

/**
 * The sessions a gated engine holds, read at boot from `path`.
 *
 * **A record fingerprinted under another passphrase is discarded whole**: changing the
 * passphrase is how a person revokes every session without knowing any other command,
 * so the sessions the old one issued must not survive it, and the file is rewritten at
 * boot to say so. Expired sessions are dropped at boot and on every write, and refused in
 * between.
 */
const openSessions = (path: string, passphrase: string): Effect.Effect<Sessions, Error> =>
  Effect.gen(function* () {
    const found = yield* readSessions(path)
    const kept =
      found !== undefined &&
      same(fingerprintWith(passphrase, found.fingerprint.salt), found.fingerprint.hash)
    const salt = kept ? found.fingerprint.salt : randomBytes(16).toString("hex")
    const fingerprint = kept ? found.fingerprint : { salt, hash: fingerprintWith(passphrase, salt) }
    // Written now rather than at the next login, or a boot under the old passphrase
    // before anyone logged in would find the discarded sessions still on disk.
    if (found !== undefined && !kept) yield* writeSessions(path, { fingerprint, sessions: [] })
    const now = yield* Clock.currentTimeMillis
    // A `SynchronizedRef`, so two logins at once serialize the read-modify-write and the
    // file always matches the last one.
    const held = yield* SynchronizedRef.make<readonly Session[]>(
      kept ? live(found.sessions, now) : [],
    )

    const store = (
      update: (sessions: readonly Session[], at: number) => readonly Session[],
    ): Effect.Effect<readonly Session[], Error> =>
      SynchronizedRef.updateAndGetEffect(held, (sessions) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis
          const next = update(live(sessions, at), at)
          yield* writeSessions(path, { fingerprint, sessions: next })
          return next
        }),
      )

    return {
      holds: (session) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis
          const hash = hashOf(session)
          return (yield* SynchronizedRef.get(held)).some(
            (s) => s.expires > at && same(s.hash, hash),
          )
        }),
      issue: Effect.gen(function* () {
        const session = mintToken()
        yield* store((sessions, at) => [
          ...sessions,
          { hash: hashOf(session), expires: at + Duration.toMillis(SESSION_AGE) },
        ])
        return session
      }),
      revokeAll: Effect.asVoid(store(() => [])),
    }
  })

/**
 * Every session gone, for an engine with no passphrase: it holds none in memory, and the
 * file goes so that a later gated boot under the same passphrase does not bring them back.
 */
const forgetSessions = (path: string): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () => rm(path, { force: true }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

// ============================================================================
// The guard, over the sessions
// ============================================================================

export interface GuardConfig {
  /** `undefined` is open — every request passes, and `/api/session` says so. */
  readonly passphrase: string | undefined
  /** The per-boot bearer `daemon.json` carries for `ork`. */
  readonly token: string
  /** Where the sessions are kept — `sessionsFile` for the engine. */
  readonly sessions: string
}

/** Wraps the whole app: one guard, applied once, over every route the router has. */
export type Guard = <E, R>(app: HttpApp.Default<E, R>) => HttpApp.Default<E, R>

/** A write to the session file failed: the request did not happen, and the log says why. */
const unsaved = (error: Error) =>
  Effect.as(
    Effect.logError(`the session file could not be written: ${error.message}`),
    ServerResponse.empty({ status: 500 }),
  )

/**
 * `app`, with `USER_HEADER` dropped from a request that does not carry this boot's bearer.
 * Only the host holds the bearer, and it alone names who pressed; from anyone else — a
 * browser on the session cookie, a turn's tool server, any caller of an open engine — the
 * header would be a claim nobody vouched for. Applied whether or not a passphrase is set,
 * since the host runs its engines open on loopback.
 */
const vouched = <E, R>(app: HttpApp.Default<E, R>, token: string): HttpApp.Default<E, R> =>
  Effect.flatMap(ServerRequest.HttpServerRequest, (request) => {
    if (request.headers[USER_HEADER] === undefined) return app
    const bearer = bearerOf(request.headers)
    if (bearer !== undefined && same(bearer, token)) return app
    return Effect.provideService(
      app,
      ServerRequest.HttpServerRequest,
      request.modify({ headers: Headers.remove(request.headers, USER_HEADER) }),
    )
  })

/**
 * The guard, with the sessions it holds.
 *
 * An `Effect` rather than a value because the login permit is one and the sessions are
 * read off disk, and the sessions live in the closure rather than in a service: nothing
 * but this function reads them, and a second copy would be a second set of doors.
 */
export const makeGuard = (config: GuardConfig): Effect.Effect<Guard, Error> =>
  Effect.gen(function* () {
    const { passphrase, token } = config
    const sessions =
      passphrase === undefined ? undefined : yield* openSessions(config.sessions, passphrase)
    const loginPermit = yield* Effect.makeSemaphore(1)

    /** The cookie, or the bearer — which one authorised the request, or neither. */
    const credentialOf = (
      request: ServerRequest.HttpServerRequest,
    ): Effect.Effect<"cookie" | "bearer" | undefined> =>
      Effect.gen(function* () {
        const bearer = bearerOf(request.headers)
        if (bearer !== undefined && same(bearer, token)) return "bearer"
        const cookie = request.cookies[SESSION_COOKIE]
        if (cookie !== undefined && sessions !== undefined && (yield* sessions.holds(cookie)))
          return "cookie"
        return undefined
      })

    const issue = (request: ServerRequest.HttpServerRequest, held: Sessions) =>
      Effect.gen(function* () {
        const session = yield* held.issue
        return yield* ServerResponse.setCookie(
          ServerResponse.empty({ status: 204 }),
          SESSION_COOKIE,
          session,
          cookieAttributes(request.headers, SESSION_AGE),
        ).pipe(
          // A hex value on a fixed name cannot fail validation; a failure here is a bug.
          Effect.orDie,
        )
      }).pipe(Effect.catchAll(unsaved))

    /**
     * `POST /api/session`. One at a time, and a wrong answer holds the permit for
     * `FAILED_LOGIN_DELAY` before it is given — see the constant.
     */
    const login = (request: ServerRequest.HttpServerRequest, expected: string, held: Sessions) =>
      loginPermit.withPermits(1)(
        Effect.gen(function* () {
          const body = yield* ServerRequest.schemaBodyJson(LoginRequestDto).pipe(
            Effect.map((decoded) => decoded.passphrase),
            Effect.catchAll(() => Effect.succeed(undefined)),
          )
          if (body === undefined) return ServerResponse.empty({ status: 400 })
          if (!same(body, expected)) {
            yield* Effect.sleep(FAILED_LOGIN_DELAY)
            return ServerResponse.empty({ status: 401 })
          }
          return yield* issue(request, held)
        }),
      )

    /**
     * `DELETE /api/session`: every session this engine holds, gone — `pnpm ork
     * revoke-sessions`. It wants a credential like any other write, under the same
     * own-page rule for a cookie, and the session it was sent with goes with the rest.
     */
    const revoke = (request: ServerRequest.HttpServerRequest, held: Sessions | undefined) =>
      Effect.gen(function* () {
        if (held === undefined) return yield* forgetSessions(config.sessions)
        const credential = yield* credentialOf(request)
        if (credential === undefined) return ServerResponse.empty({ status: 401 })
        if (credential === "cookie" && !fromOwnPage(request.headers))
          return ServerResponse.empty({ status: 403 })
        return yield* held.revokeAll
      }).pipe(
        Effect.map((answer) => answer ?? ServerResponse.empty({ status: 204 })),
        Effect.catchAll(unsaved),
      )

    /**
     * `/api/session`: `GET` says whether this request is in, `POST` is the login, `DELETE`
     * revokes every session. With no passphrase set the first two answer 204 — there is
     * nothing to be out of.
     */
    const sessionRoute = (request: ServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        if (request.method === "GET") {
          const authorised =
            passphrase === undefined || (yield* credentialOf(request)) !== undefined
          return ServerResponse.empty({ status: authorised ? 204 : 401 })
        }
        if (request.method === "DELETE") return yield* revoke(request, sessions)
        if (request.method !== "POST") return ServerResponse.empty({ status: 405 })
        if (passphrase === undefined || sessions === undefined)
          return ServerResponse.empty({ status: 204 })
        return yield* login(request, passphrase, sessions)
      })

    const guard: Guard = (app) =>
      Effect.gen(function* () {
        const request = yield* ServerRequest.HttpServerRequest
        const target = yield* targetOf
        if (target === "session") return yield* sessionRoute(request)
        if (target !== "api") return yield* app
        if (passphrase === undefined) return yield* vouched(app, token)
        const credential = yield* credentialOf(request)
        if (credential === undefined) {
          // A turn's tool server's own credential, good for its trak's tool routes and
          // refused everywhere else — which trak a path names is the router's answer, as
          // whether it is the API at all is. A goal composer's tool server holds the same
          // kind of credential for its goal's tool routes.
          const scoped = bearerOf(request.headers)
          const trak = yield* trakToolsOf
          const goal = yield* goalToolsOf
          const admitted =
            scoped !== undefined &&
            ((trak !== undefined && same(scoped, trakToken(token, trak))) ||
              (goal !== undefined && same(scoped, goalToken(token, goal))))
          return admitted ? yield* vouched(app, token) : ServerResponse.empty({ status: 401 })
        }
        // A cookie is sent by the browser on a page's behalf, so it is the one credential
        // a page on another origin could borrow; a write it authenticates is admitted only
        // from the engine's own page. A bearer is typed into a header by code that holds
        // it, and no other origin holds it.
        if (credential === "cookie" && !reads(request.method) && !fromOwnPage(request.headers))
          return ServerResponse.empty({ status: 403 })
        return yield* vouched(app, token)
      })

    return guard
  })

/**
 * The host user who made this request, as the host named them in `USER_HEADER` and the
 * guard vouched for: `undefined` where nobody was named, which is every request to an engine
 * no host is in front of, and one the guard dropped the header from.
 */
export const pressedBy: Effect.Effect<UserId | undefined, never, ServerRequest.HttpServerRequest> =
  Effect.map(ServerRequest.HttpServerRequest, (request) => {
    const named = request.headers[USER_HEADER]
    if (named === undefined) return undefined
    const decoded = Schema.decodeUnknownEither(UserId)(named)
    return decoded._tag === "Right" ? decoded.right : undefined
  })

/** The methods a drill engine answers: the reads. */
const READS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * The guard a drill engine adds inside the credential one (`pnpm host --drill`): every
 * request that is not a read is refused with `403` and the reason, before any route sees
 * it. A press that moves a trak, a goal or a process, an engine tool a turn calls, a
 * reload, a push subscription — each is a write, so a drill drives nothing and spends
 * nothing whatever a page asks of it, and the restored logs are left as restored.
 */
export const readOnly: Guard = (app) =>
  Effect.flatMap(ServerRequest.HttpServerRequest, (request) =>
    READS.has(request.method)
      ? app
      : Effect.succeed(
          ServerResponse.text("this engine is a drill, and a drill answers only reads", {
            status: 403,
          }),
        ),
  )
