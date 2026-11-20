// The guard in front of the API, and the login that gets a browser past it.
//
// Tier 2 by the entry-point row of `testing-tiers`: the guard is a surface a request
// meets before any route, and what it owes is mostly refusals — which request reaches
// the app, and which is turned away before a fiber could be forked. Most cases wrap a
// stub app that records whether it was reached, because *not reaching it* is the
// assertion: a refusal that still ran the route would be the bug wearing a status code.
// Two cases wrap the real router, for the one route that must stay open and the one
// that must not.

import { existsSync, readFileSync, statSync } from "node:fs"
import { Duration, Effect, Fiber, Option, Schema, TestClock, TestContext } from "effect"
import { describe, expect, it } from "vitest"
import * as Cookies from "@effect/platform/Cookies"
import type * as HttpApp from "@effect/platform/HttpApp"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import type { HttpServerResponse } from "@effect/platform/HttpServerResponse"
import { toWeb } from "@effect/platform/HttpServerResponse"
import { TrakListDto } from "@orkestra/shared/dto/trak"
import { apiRouter } from "../../src/app/server.js"
import { goalToken, type Guard, makeGuard, pressedBy, trakToken } from "../../src/app/guard.js"
import { settableClock } from "../support/clock.js"
import { runFlow } from "../support/flow.js"
import { freshSessionsFile } from "../support/sessions-file.js"

const PASSPHRASE = "correct horse battery staple"
const TOKEN = "0123456789abcdef0123456789abcdef"

/** A guard as one boot makes it; `sessions` is the file, shared to write a restart. */
const boot = (
  passphrase: string | undefined,
  sessions: string = freshSessionsFile(),
  token: string = TOKEN,
) => Effect.suspend(() => makeGuard({ passphrase, token, sessions })).pipe(Effect.orDie)

const gated = Effect.suspend(() => boot(PASSPHRASE))
const open = Effect.suspend(() => boot(undefined))

/** An app that says whether it was reached, which is the whole of what the guard decides. */
const stub = (): { readonly app: HttpApp.Default; readonly reached: () => boolean } => {
  let hit = false
  return {
    app: Effect.sync(() => {
      hit = true
      return ServerResponse.empty({ status: 200 })
    }),
    reached: () => hit,
  }
}

/** One request through a guarded app, the way `http-api.test.ts` drives the router. */
const through = <E, R>(app: HttpApp.Default<E, R>, request: Request) =>
  Effect.provideService(app, ServerRequest.HttpServerRequest, ServerRequest.fromWeb(request)).pipe(
    Effect.scoped,
    Effect.orDie,
  )

const login = (passphrase: string, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ passphrase }),
  })

/** The session cookie a login answered with, as a `cookie` header to send it back. */
const cookieOf = (response: HttpServerResponse): string => Cookies.toCookieHeader(response.cookies)

const sessionCookie = (response: HttpServerResponse) => response.cookies.cookies["orkestra_session"]

/** The body as it went out, the way `http-api.test.ts` reads one. */
const textOf = (response: HttpServerResponse): Effect.Effect<string> =>
  Effect.promise(() => toWeb(response).text())

/** Every route that spends money or moves a trak, with the method each one answers. */
const ACTION_ROUTES: readonly (readonly [string, string])[] = [
  ["POST", "/api/traks"],
  ["POST", "/api/traks/t/act"],
  ["POST", "/api/traks/t/resume"],
  ["POST", "/api/traks/t/reenter"],
  ["POST", "/api/traks/t/merge"],
  ["POST", "/api/traks/t/close"],
  ["POST", "/api/traks/t/abandon"],
  ["POST", "/api/traks/t/stop"],
  ["POST", "/api/records"],
  ["DELETE", "/api/traks/t"],
  ["DELETE", "/api/traks"],
  ["GET", "/api/traks"],
  ["GET", "/api/stream"],
  ["GET", "/api/traks/t/image?path=a.png"],
]

const withGuard = <A>(make: Effect.Effect<Guard>, body: (guard: Guard) => Effect.Effect<A>) =>
  Effect.runPromise(Effect.flatMap(make, body))

describe("a request with no credential", () => {
  it("is refused 401 on every action route and on the reads, before the route runs", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        for (const [method, path] of ACTION_ROUTES) {
          const { app, reached } = stub()
          const response = yield* through(
            guard(app),
            new Request(`http://localhost${path}`, { method }),
          )
          expect([method, path, response.status]).toEqual([method, path, 401])
          expect([method, path, reached()]).toEqual([method, path, false])
        }
      }),
    )
  })

  it("still gets /api/health, which is how another project's `pnpm ui` tells whose pair this is", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const { app, reached } = stub()
        const response = yield* through(guard(app), new Request("http://localhost/api/health"))
        expect(response.status).toBe(200)
        expect(reached()).toBe(true)
      }),
    )
  })

  it("still gets anything outside /api/, because the login screen is in the bundle", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        for (const path of ["/", "/traks/abc", "/assets/index.js"]) {
          const { app, reached } = stub()
          const response = yield* through(guard(app), new Request(`http://localhost${path}`))
          expect([path, response.status]).toEqual([path, 200])
          expect([path, reached()]).toEqual([path, true])
        }
      }),
    )
  })

  it("is told so by GET /api/session, which is what the client asks first", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const response = yield* through(
          guard(stub().app),
          new Request("http://localhost/api/session"),
        )
        expect(response.status).toBe(401)
      }),
    )
  })
})

describe("logging in", () => {
  it("exchanges the passphrase for a cookie that then opens every route", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const granted = yield* through(guard(stub().app), login(PASSPHRASE))
        expect(granted.status).toBe(204)
        const cookie = sessionCookie(granted)
        expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" })

        const { app, reached } = stub()
        const response = yield* through(
          guard(app),
          new Request("http://localhost/api/traks", { headers: { cookie: cookieOf(granted) } }),
        )
        expect(response.status).toBe(200)
        expect(reached()).toBe(true)

        const session = yield* through(
          guard(stub().app),
          new Request("http://localhost/api/session", { headers: { cookie: cookieOf(granted) } }),
        )
        expect(session.status).toBe(204)
      }),
    )
  })

  it("refuses a cookie it never issued, however well formed", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const { app, reached } = stub()
        const response = yield* through(
          guard(app),
          new Request("http://localhost/api/traks", {
            headers: { cookie: "orkestra_session=deadbeef" },
          }),
        )
        expect(response.status).toBe(401)
        expect(reached()).toBe(false)
      }),
    )
  })

  it("refuses a body that is not a login with 400, and never compares anything", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const response = yield* through(
          guard(stub().app),
          new Request("http://localhost/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: PASSPHRASE }),
          }),
        )
        expect(response.status).toBe(400)
        expect(Cookies.isEmpty(response.cookies)).toBe(true)
      }),
    )
  })

  it("marks the cookie Secure when the request arrived over HTTPS, and not otherwise", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        // A tunnel terminates TLS and says so. The cookie must carry `Secure` or the
        // tunnel's TLS is wasted.
        const tunnelled = yield* through(
          guard(stub().app),
          login(PASSPHRASE, { "x-forwarded-proto": "https" }),
        )
        expect(tunnelled.status).toBe(204)
        expect(sessionCookie(tunnelled)?.options?.secure).toBe(true)

        // The `--host` LAN path is plain HTTP, and a browser will not send a `Secure`
        // cookie over it — so a login that set one would silently never take.
        const lan = yield* through(guard(stub().app), login(PASSPHRASE))
        expect(lan.status).toBe(204)
        expect(sessionCookie(lan)?.options?.secure).toBe(false)

        // A proxy chain lists every hop; the first is the one the browser spoke to.
        const chained = yield* through(
          guard(stub().app),
          login(PASSPHRASE, { "x-forwarded-proto": "https, http" }),
        )
        expect(sessionCookie(chained)?.options?.secure).toBe(true)
      }),
    )
  })
})

describe("a wrong passphrase", () => {
  it("is answered 401 with no cookie, and only after a second", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* gated
        const attempt = yield* Effect.fork(through(guard(stub().app), login("wrong")))
        yield* TestClock.adjust(Duration.millis(999))
        expect(Option.isNone(yield* Fiber.poll(attempt))).toBe(true)
        yield* TestClock.adjust(Duration.millis(1))
        const response = yield* Fiber.join(attempt)
        expect(response.status).toBe(401)
        expect(Cookies.isEmpty(response.cookies)).toBe(true)
      }).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  it("is answered one at a time, so a flood is throttled rather than answered at full speed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* gated
        const first = yield* Effect.fork(through(guard(stub().app), login("wrong")))
        const second = yield* Effect.fork(through(guard(stub().app), login("also wrong")))
        yield* TestClock.adjust(Duration.seconds(1))
        // One has been answered; the other is still waiting for the permit.
        const done = [yield* Fiber.poll(first), yield* Fiber.poll(second)].filter(Option.isSome)
        expect(done).toHaveLength(1)
        yield* TestClock.adjust(Duration.seconds(1))
        expect((yield* Fiber.join(first)).status).toBe(401)
        expect((yield* Fiber.join(second)).status).toBe(401)
      }).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  it("does not cost the right one the delay, on a permit nothing else is holding", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* gated
        // Only that the right passphrase skips the sleep — not that it is never delayed.
        // It still takes the one permit, so a queue of guesses ahead of it holds it up a
        // second each; see `FAILED_LOGIN_DELAY`.
        //
        // Under the test clock nothing advances on its own, so a login that slept would
        // never return — this finishing is the assertion.
        const response = yield* through(guard(stub().app), login(PASSPHRASE))
        expect(response.status).toBe(204)
      }).pipe(Effect.provide(TestContext.TestContext)),
    )
  })
})

/** A cookie-authenticated POST, with whatever the browser said about where it came from. */
const write = (cookie: string, site: string | undefined): Request =>
  new Request("http://localhost/api/traks/t/act", {
    method: "POST",
    headers: site === undefined ? { cookie } : { cookie, "sec-fetch-site": site },
  })

describe("a write holding a valid session", () => {
  it("is admitted only from the engine's own page: same-origin, or a navigation", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const granted = yield* through(guard(stub().app), login(PASSPHRASE))
        for (const site of ["same-origin", "none"]) {
          const { app, reached } = stub()
          const response = yield* through(guard(app), write(cookieOf(granted), site))
          expect([site, response.status]).toEqual([site, 200])
          expect([site, reached()]).toEqual([site, true])
        }
      }),
    )
  })

  it("is refused 403 from another site, from a sibling origin, and with no header at all", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const granted = yield* through(guard(stub().app), login(PASSPHRASE))
        // `same-site` is the case the cookie's own `SameSite=Lax` lets through, so it is
        // the one this check exists for; absent is a client this engine does not have.
        for (const site of ["cross-site", "same-site", undefined]) {
          const { app, reached } = stub()
          const response = yield* through(guard(app), write(cookieOf(granted), site))
          expect([site, response.status]).toEqual([site, 403])
          expect([site, reached()]).toEqual([site, false])
        }
      }),
    )
  })

  it("leaves a read alone whatever the header says — a read does not act", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const granted = yield* through(guard(stub().app), login(PASSPHRASE))
        const { app, reached } = stub()
        const response = yield* through(
          guard(app),
          new Request("http://localhost/api/traks", {
            headers: { cookie: cookieOf(granted), "sec-fetch-site": "cross-site" },
          }),
        )
        expect(response.status).toBe(200)
        expect(reached()).toBe(true)
      }),
    )
  })

  it("never asks the question of a bearer, which no other origin holds", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const { app, reached } = stub()
        const response = yield* through(
          guard(app),
          new Request("http://localhost/api/traks/t/act", {
            method: "POST",
            headers: { authorization: `Bearer ${TOKEN}`, "sec-fetch-site": "cross-site" },
          }),
        )
        expect(response.status).toBe(200)
        expect(reached()).toBe(true)
      }),
    )
  })
})

describe("the daemon's own token", () => {
  it("opens every route as a bearer, which is how `ork` gets in with nothing typed", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        for (const [method, path] of ACTION_ROUTES) {
          const { app, reached } = stub()
          const response = yield* through(
            guard(app),
            new Request(`http://localhost${path}`, {
              method,
              headers: { authorization: `Bearer ${TOKEN}` },
            }),
          )
          expect([method, path, response.status]).toEqual([method, path, 200])
          expect([method, path, reached()]).toEqual([method, path, true])
        }
      }),
    )
  })

  it("is refused when it is not this boot's", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const { app, reached } = stub()
        const response = yield* through(
          guard(app),
          new Request("http://localhost/api/traks", {
            headers: { authorization: `Bearer ${TOKEN.slice(1)}f` },
          }),
        )
        expect(response.status).toBe(401)
        expect(reached()).toBe(false)
      }),
    )
  })
})

describe("an engine started with no passphrase", () => {
  it("asks nothing of any request, exactly as before the guard existed", async () => {
    await withGuard(open, (guard) =>
      Effect.gen(function* () {
        for (const [method, path] of ACTION_ROUTES) {
          const { app, reached } = stub()
          const response = yield* through(
            guard(app),
            new Request(`http://localhost${path}`, { method }),
          )
          expect([method, path, response.status]).toEqual([method, path, 200])
          expect([method, path, reached()]).toEqual([method, path, true])
        }
        const session = yield* through(
          guard(stub().app),
          new Request("http://localhost/api/session"),
        )
        expect(session.status).toBe(204)
      }),
    )
  })
})

/** A request naming a user, as the host's proxy would, with `headers` beside it. */
const named = (headers: Record<string, string>, path = "/api/traks") =>
  new Request(`http://localhost${path}`, {
    headers: { "x-orkestra-user": "gh:583231", ...headers },
  })

/** An app that answers 200 with the user `pressedBy` read, or nothing for none. */
const heard: HttpApp.Default = Effect.map(pressedBy, (user) =>
  ServerResponse.text(user ?? "", { status: 200 }),
)

describe("who pressed, as the host names them", () => {
  it("is read beside this boot's bearer, with a passphrase set and without one", async () => {
    const bearer = { authorization: `Bearer ${TOKEN}` }
    const heardBy = (make: Effect.Effect<Guard>) =>
      withGuard(make, (guard) => Effect.flatMap(through(guard(heard), named(bearer)), textOf))
    expect(await Promise.all([heardBy(gated), heardBy(open)])).toEqual(["gh:583231", "gh:583231"])
  })

  it("is dropped from every request the bearer did not vouch for", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        const cookie = cookieOf(yield* through(guard(stub().app), login(PASSPHRASE)))
        const tools = "/api/traks/t/tools/list_traks"
        const scoped = { authorization: `Bearer ${trakToken(TOKEN, "t")}` }
        for (const request of [named({ cookie }), named(scoped, tools)]) {
          const response = yield* through(guard(heard), request)
          expect([request.url, response.status, yield* textOf(response)]).toEqual([
            request.url,
            200,
            "",
          ])
        }
      }),
    )
    await withGuard(open, (guard) =>
      Effect.gen(function* () {
        expect(yield* textOf(yield* through(guard(heard), named({})))).toBe("")
      }),
    )
  })
})

describe("over the real router", () => {
  it("lets /api/health through with nothing, and the list only with a session", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const guard = yield* gated
        const app = guard(apiRouter())

        const health = yield* through(app, new Request("http://localhost/api/health"))
        expect(health.status).toBe(200)

        const refused = yield* through(app, new Request("http://localhost/api/traks"))
        expect(refused.status).toBe(401)

        const granted = yield* through(app, login(PASSPHRASE))
        const listed = yield* through(
          app,
          new Request("http://localhost/api/traks", { headers: { cookie: cookieOf(granted) } }),
        )
        expect(listed.status).toBe(200)
        const body: unknown = JSON.parse(yield* textOf(listed))
        expect(Schema.decodeUnknownSync(TrakListDto)(body)).toEqual({ traks: [], archived: 0 })
      }),
    )
  })
})

describe("a turn's own token", () => {
  const bearer = (trak: string) => ({ authorization: `Bearer ${trakToken(TOKEN, trak)}` })

  it("reaches its own trak's tool routes, and the MCP and GitHub token routes a session in a sandbox dials", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        for (const [method, path] of [
          ["GET", "/api/traks/t/tools"],
          ["POST", "/api/traks/t/tools/restart_process"],
          ["POST", "/api/traks/t/mcp"],
          ["POST", "/api/traks/t/mcp/linear"],
          ["GET", "/api/traks/t/mcp/linear"],
          ["POST", "/api/traks/t/github"],
        ] as const) {
          const { app, reached } = stub()
          const response = yield* through(
            guard(app),
            new Request(`http://localhost${path}`, { method, headers: bearer("t") }),
          )
          expect([path, response.status, reached()]).toEqual([path, 200, true])
        }
      }),
    )
  })

  it("is refused on another trak's tools, every process route, and every other route, before the route runs", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        for (const [method, path] of [
          ["POST", "/api/traks/u/tools/start_process"],
          ["POST", "/api/traks/u/mcp"],
          ["POST", "/api/traks/u/mcp/linear"],
          ["POST", "/api/traks/u/github"],
          ["GET", "/api/traks/t/processes"],
          ["POST", "/api/traks/t/processes/dev/restart"],
          ["GET", "/api/traks/t/processes/dev/logs"],
          ["GET", "/api/processes"],
          ["POST", "/api/processes/dev/start"],
          ...ACTION_ROUTES,
        ] as const) {
          const { app, reached } = stub()
          const response = yield* through(
            guard(app),
            new Request(`http://localhost${path}`, { method, headers: bearer("t") }),
          )
          expect([path, response.status, reached()]).toEqual([path, 401, false])
        }
      }),
    )
  })

  it("stops working when the engine restarts, because the boot's token is what it is made from", async () => {
    await withGuard(boot(PASSPHRASE, freshSessionsFile(), "another boot"), (guard) =>
      Effect.gen(function* () {
        const { app, reached } = stub()
        const response = yield* through(
          guard(app),
          new Request("http://localhost/api/traks/t/tools", { headers: bearer("t") }),
        )
        expect([response.status, reached()]).toEqual([401, false])
      }),
    )
  })
})

describe("a goal composer's token", () => {
  const bearer = (goal: string) => ({ authorization: `Bearer ${goalToken(TOKEN, goal)}` })

  it("reaches its own goal's tool routes and nothing else", async () => {
    await withGuard(gated, (guard) =>
      Effect.gen(function* () {
        for (const [method, path, status] of [
          ["GET", "/api/goals/g/tools", 200],
          ["POST", "/api/goals/g/tools/open_trak", 200],
          ["POST", "/api/goals/h/tools/open_trak", 401],
          ["POST", "/api/goals/g/mcp", 200],
          ["POST", "/api/goals/h/mcp", 401],
          ["POST", "/api/goals/g/act", 401],
          ["GET", "/api/traks/g/tools", 401],
        ] as const) {
          const { app, reached } = stub()
          const response = yield* through(
            guard(app),
            new Request(`http://localhost${path}`, { method, headers: bearer("g") }),
          )
          expect([path, response.status, reached()]).toEqual([path, status, status === 200])
        }
      }),
    )
  })
})

/** A read holding `cookie`, through `guard`: whether the session still opens the API. */
const admits = (guard: Guard, cookie: string) =>
  Effect.map(
    through(guard(stub().app), new Request("http://localhost/api/traks", { headers: { cookie } })),
    (response) => response.status,
  )

const revokeAll = (headers: Record<string, string>) =>
  new Request("http://localhost/api/session", { method: "DELETE", headers })

const DAY = 24 * 60 * 60 * 1000

describe("a session across restarts", () => {
  it("still opens the API on a fresh guard over the same file, and the file holds no token", async () => {
    const file = freshSessionsFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* boot(PASSPHRASE, file)
        const granted = yield* through(first(stub().app), login(PASSPHRASE))
        // A new boot mints a new bearer; the session is not made from it.
        const second = yield* boot(PASSPHRASE, file, "the next boot")
        expect(yield* admits(second, cookieOf(granted))).toBe(200)

        const value = sessionCookie(granted)?.value ?? ""
        expect(value).not.toBe("")
        expect(readFileSync(file, "utf8")).not.toContain(value)
        expect(readFileSync(file, "utf8")).not.toContain(PASSPHRASE)
        expect(statSync(file).mode & 0o777).toBe(0o600)
      }),
    )
  })

  it("expires thirty days after its login, on the cookie and in the engine alike", async () => {
    const file = freshSessionsFile()
    const { clock, advance } = settableClock(Date.UTC(2026, 0, 1))
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* boot(PASSPHRASE, file)
        const granted = yield* through(guard(stub().app), login(PASSPHRASE))
        const maxAge = sessionCookie(granted)?.options?.maxAge
        expect(maxAge === undefined ? undefined : Duration.toMillis(maxAge)).toBe(30 * DAY)

        advance(30 * DAY - 1)
        expect(yield* admits(guard, cookieOf(granted))).toBe(200)
        expect(yield* admits(yield* boot(PASSPHRASE, file), cookieOf(granted))).toBe(200)
        advance(1)
        expect(yield* admits(guard, cookieOf(granted))).toBe(401)
        expect(yield* admits(yield* boot(PASSPHRASE, file), cookieOf(granted))).toBe(401)
      }).pipe(Effect.withClock(clock)),
    )
  })

  it("is revoked with every other by DELETE /api/session, here and on the next boot", async () => {
    const file = freshSessionsFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const guard = yield* boot(PASSPHRASE, file)
        const phone = yield* through(guard(stub().app), login(PASSPHRASE))
        const laptop = yield* through(guard(stub().app), login(PASSPHRASE))

        // Refused with nothing, and from another site, and neither revokes anything.
        expect((yield* through(guard(stub().app), revokeAll({}))).status).toBe(401)
        const borrowed = revokeAll({ cookie: cookieOf(phone), "sec-fetch-site": "cross-site" })
        expect((yield* through(guard(stub().app), borrowed)).status).toBe(403)
        expect(yield* admits(guard, cookieOf(phone))).toBe(200)

        // `pnpm ork revoke-sessions` sends the bearer.
        const revoked = yield* through(
          guard(stub().app),
          revokeAll({ authorization: `Bearer ${TOKEN}` }),
        )
        expect(revoked.status).toBe(204)
        expect(yield* admits(guard, cookieOf(phone))).toBe(401)
        expect(yield* admits(guard, cookieOf(laptop))).toBe(401)
        expect(yield* admits(yield* boot(PASSPHRASE, file), cookieOf(laptop))).toBe(401)
      }),
    )
  })

  it("is discarded by a boot under another passphrase, and stays gone if the old one returns", async () => {
    const file = freshSessionsFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* boot(PASSPHRASE, file)
        const granted = yield* through(before(stub().app), login(PASSPHRASE))

        const changed = yield* boot("a new passphrase", file)
        expect(yield* admits(changed, cookieOf(granted))).toBe(401)
        expect(yield* admits(yield* boot(PASSPHRASE, file), cookieOf(granted))).toBe(401)
      }),
    )
  })

  it("is forgotten on disk by a revoke against an open engine, so a gated boot does not revive it", async () => {
    const file = freshSessionsFile()
    await Effect.runPromise(
      Effect.gen(function* () {
        const gatedBoot = yield* boot(PASSPHRASE, file)
        const granted = yield* through(gatedBoot(stub().app), login(PASSPHRASE))
        const openBoot = yield* boot(undefined, file)
        expect((yield* through(openBoot(stub().app), revokeAll({}))).status).toBe(204)
        expect(existsSync(file)).toBe(false)
        expect(yield* admits(yield* boot(PASSPHRASE, file), cookieOf(granted))).toBe(401)
      }),
    )
  })
})
