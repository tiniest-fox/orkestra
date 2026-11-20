// The guard as the wire reaches it: raw request lines on a real socket.
//
// **This tier exists because the one below it cannot express the failing case.** Every
// case in `login.test.ts` builds a `Request`, and the `URL` constructor inside it has
// already tidied the target — an absolute-form `http://host/api/x` becomes `/api/x`
// before the guard sees it. The guard shipped admitting `//api/traks` and `/%61pi/traks`
// with no credential, because it compared the raw target while the router matched a
// sanitised one, and no test built from `Request` could have said so.
//
// So this writes bytes. Each spelling below is one the router accepts as the same route
// — collapsed slashes, a percent-escape, absolute form, case, a trailing slash, a `;`
// where a query would go — and the assertion is made twice per spelling: refused 401
// with nothing, and reaching the route with the bearer. The second half is what proves
// the spelling is the router's rather than this file's.
//
// A stub app behind the guard, because what the socket is testing is the guard; the real
// router is behind it in the last two cases, for what only the composition can show —
// `/api/health` open in every spelling, a refusal that reaches no handler, and `/`
// reaching the bundle route with no credential, which is what the login screen is behind.

import { createServer } from "node:http"
import { connect } from "node:net"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import type * as HttpApp from "@effect/platform/HttpApp"
import * as HttpServer from "@effect/platform/HttpServer"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import { apiRouter } from "../../src/app/server.js"
import { type Guard, makeGuard } from "../../src/app/guard.js"
import { runFlow } from "../support/flow.js"
import { freshSessionsFile } from "../support/sessions-file.js"

const PASSPHRASE = "correct horse battery staple"
const TOKEN = "0123456789abcdef0123456789abcdef"

/** An app that says whether it was reached. */
const stub = (): { readonly app: HttpApp.Default; readonly reached: () => number } => {
  let hits = 0
  return {
    app: Effect.sync(() => {
      hits += 1
      return ServerResponse.empty({ status: 200 })
    }),
    reached: () => hits,
  }
}

/**
 * Serve `app` on an ephemeral loopback port for the life of the scope, and say which.
 * Port 0 rather than a derived pair: this has nothing to do with a project.
 */
const serving = <E, R>(app: HttpApp.Default<E, R>) =>
  Effect.gen(function* () {
    yield* HttpServer.serveEffect()(app)
    const server = yield* HttpServer.HttpServer
    const bound = server.address
    if (bound._tag !== "TcpAddress") throw new Error("expected a TCP address")
    return bound.port
  })

const loopback = NodeHttpServer.layer(() => createServer(), { port: 0, host: "127.0.0.1" })

/**
 * One raw request, as bytes, and its status code back. No `URL`, no `Request`: the
 * target goes on the wire exactly as written, which is the whole point of this file.
 */
const raw = (port: number, method: string, target: string, headers: readonly string[] = []) =>
  Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1")
        let text = ""
        socket.setEncoding("utf8")
        socket.on("data", (chunk: string) => {
          text += chunk
        })
        socket.on("end", () => {
          const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1])
          resolve(status)
        })
        socket.on("error", reject)
        socket.write(
          [`${method} ${target} HTTP/1.1`, "Host: localhost", "Connection: close", ...headers]
            .concat(["", ""])
            .join("\r\n"),
        )
      }),
  )

/**
 * The spellings the router accepts as one route, as functions of the canonical path.
 * Each names the normalisation that folds it.
 */
const SPELLINGS: readonly (readonly [string, (path: string) => string])[] = [
  ["canonical", (p) => p],
  ["collapsed slashes", (p) => `/${p}`],
  ["percent-escape", (p) => p.replace("/api/", "/%61pi/")],
  ["absolute form", (p) => `http://localhost${p}`],
  ["upper case", (p) => p.replace("/api/", "/API/")],
  ["trailing slash", (p) => `${p}/`],
  ["semicolon", (p) => `${p};x=1`],
  ["inner slashes", (p) => p.replace("/api/", "/api//")],
]

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
  ["GET", "/api/agents"],
]

const gated = Effect.suspend(() =>
  makeGuard({ passphrase: PASSPHRASE, token: TOKEN, sessions: freshSessionsFile() }),
).pipe(Effect.orDie)

const withServed = <A>(
  make: Effect.Effect<Guard>,
  app: (guard: Guard) => HttpApp.Default,
  body: (port: number) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const guard = yield* make
      const port = yield* serving(app(guard))
      return yield* body(port)
    }).pipe(Effect.scoped, Effect.provide(loopback)),
  )

describe("the guard on the wire", () => {
  it("refuses every action route in every spelling the router accepts, before the route runs", async () => {
    const { app, reached } = stub()
    await withServed(
      gated,
      (guard) => guard(app),
      (port) =>
        Effect.gen(function* () {
          for (const [method, path] of ACTION_ROUTES) {
            for (const [how, spell] of SPELLINGS) {
              const status = yield* raw(port, method, spell(path))
              expect([method, how, spell(path), status]).toEqual([method, how, spell(path), 401])
            }
          }
          expect(reached()).toBe(0)
        }),
    )
  }, 30_000)

  it("admits the bearer in every one of those spellings, which is what proves they are the router's", async () => {
    const { app, reached } = stub()
    await withServed(
      gated,
      (guard) => guard(app),
      (port) =>
        Effect.gen(function* () {
          let sent = 0
          for (const [method, path] of ACTION_ROUTES) {
            for (const [how, spell] of SPELLINGS) {
              sent += 1
              const status = yield* raw(port, method, spell(path), [
                `Authorization: Bearer ${TOKEN}`,
              ])
              expect([method, how, status]).toEqual([method, how, 200])
            }
          }
          expect(reached()).toBe(sent)
        }),
    )
  }, 30_000)

  it("leaves the bundle alone, in spellings that only look like the API", async () => {
    const { app, reached } = stub()
    await withServed(
      gated,
      (guard) => guard(app),
      (port) =>
        Effect.gen(function* () {
          for (const target of ["/", "/traks/abc", "/apis/x", "/api%2Ftraks", "/assets/api/x"]) {
            const status = yield* raw(port, "GET", target)
            expect([target, status]).toEqual([target, 200])
          }
          expect(reached()).toBe(5)
        }),
    )
  })
})

describe("the guard on the wire, over the real router", () => {
  it("keeps /api/health open in every spelling, and a refused spelling reaches no handler", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const guard = yield* gated
        const port = yield* serving(guard(apiRouter()))
        for (const [how, spell] of SPELLINGS) {
          const health = yield* raw(port, "GET", spell("/api/health"))
          expect([how, health]).toEqual([how, 200])
          const refused = yield* raw(port, "GET", spell("/api/traks"))
          expect([how, refused]).toEqual([how, 401])
          // The body decoder would answer 400 if the act handler were reached; 401 is the
          // guard answering first.
          const act = yield* raw(port, "POST", spell("/api/traks/nope/act"))
          expect([how, act]).toEqual([how, 401])
        }
        const listed = yield* raw(port, "GET", "//api/traks", [`Authorization: Bearer ${TOKEN}`])
        expect(listed).toBe(200)
        // `orDie`: a port-0 bind that fails is a bug in the test, not an outcome.
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(loopback)), Effect.orDie),
    )
  }, 30_000)

  it("reaches the bundle at / with no credential, which is what the login screen is behind", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const guard = yield* gated
        const port = yield* serving(guard(apiRouter()))
        for (const target of ["/", "/index.html", "/traks/abc"]) {
          const status = yield* raw(port, "GET", target)
          // 200 with a built bundle, 503 without one — `apiRouter` holds `clientRoute()`
          // over the real `client/dist`, and the engine suite runs before the client is
          // built. Which of the two is the bundle route's business and is asserted where
          // that route is tested. What is asserted here is the seam: the guard did not
          // answer, so a browser with no session reaches the screen that makes one.
          expect([target, status === 200 || status === 503]).toEqual([target, true])
        }
        // Beside it in the same run, so the pass-through is shown to be about the target
        // rather than about the guard being off.
        expect(yield* raw(port, "GET", "/api/traks")).toBe(401)
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(loopback)), Effect.orDie),
    )
  }, 30_000)
})
