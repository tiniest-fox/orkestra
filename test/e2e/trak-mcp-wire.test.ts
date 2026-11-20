// The trak's MCP route as a sandboxed CLI reaches it: one keep-alive socket, reused.
//
// **This tier exists because the one below it cannot express the failing case.** A
// `Request` handed to the router has no socket, and Node's own `fetch` reads
// `Keep-Alive: timeout=5` and drops the pooled socket before the server does. Claude
// Code's client (Bun, inside `claude.exe`) does not: it keeps the socket in its pool, and
// the next MCP call after more than about 6 s of idle goes out on a socket the engine
// has already closed — `keepAliveTimeout` 5000 ms plus Node's 1000 ms buffer — and fails
// at once with `ECONNRESET`. That call never reaches the engine.
//
// So this writes bytes on one socket, as that client does: a `ping`, an idle a little
// past the close, and a second `ping` on the same socket. The route passes when the
// first answer tells the client not to reuse the socket, or when the second request is
// answered. It fails when the socket was left open for reuse and then lost the request.
//
// It waits 6.5 s on the real clock, which is over the 2 s per-test target: the close it
// is about is Node's own timer on a plain `createServer()`, as `src/serve.ts` builds it,
// and there is no settable clock under that timer.

import { createServer } from "node:http"
import { connect, type Socket } from "node:net"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import type * as HttpApp from "@effect/platform/HttpApp"
import * as HttpServer from "@effect/platform/HttpServer"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import { trakMcpRoutes } from "../../src/app/trak-mcp.js"
import { runFlow } from "../support/flow.js"

/** Past `keepAliveTimeout` + `keepAliveTimeoutBuffer` (5000 + 1000 ms), as the dropped calls were. */
const IDLE_MS = 6_500

const loopback = NodeHttpServer.layer(() => createServer(), { port: 0, host: "127.0.0.1" })

const serving = <E, R>(app: HttpApp.Default<E, R>) =>
  Effect.gen(function* () {
    yield* HttpServer.serveEffect()(app)
    const bound = (yield* HttpServer.HttpServer).address
    if (bound._tag !== "TcpAddress") throw new Error("expected a TCP address")
    return bound.port
  })

const ping = (id: number): string => {
  const body = JSON.stringify({ jsonrpc: "2.0", id, method: "ping", params: {} })
  return [
    "POST /api/traks/some-trak/mcp HTTP/1.1",
    "Host: 127.0.0.1",
    "Content-Type: application/json",
    "Accept: application/json, text/event-stream",
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    "",
    body,
  ].join("\r\n")
}

/** One response read off `text`: its status and its `Connection` header, once whole. */
const parsed = (text: string) => {
  const end = text.indexOf("\r\n\r\n")
  if (end < 0) return undefined
  const head = text.slice(0, end)
  const length = Number(/^content-length:\s*(\d+)/im.exec(head)?.[1] ?? "0")
  if (text.length < end + 4 + length) return undefined
  return {
    status: Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1]),
    connection: /^connection:\s*(.+)$/im.exec(head)?.[1]?.trim().toLowerCase(),
  }
}

/**
 * A ping, an idle of `IDLE_MS`, and a second ping on the same socket. The second is
 * `undefined` when the socket ended or errored before an answer to it arrived.
 */
const reuseAfterIdle = (port: number) =>
  Effect.promise(
    () =>
      new Promise<{
        readonly first: ReturnType<typeof parsed>
        readonly second: number | undefined
      }>((resolve) => {
        const socket: Socket = connect(port, "127.0.0.1")
        socket.setEncoding("utf8")
        let text = ""
        let first: ReturnType<typeof parsed>
        let settled = false
        let resent = false
        const settle = (second: number | undefined) => {
          if (settled) return
          settled = true
          socket.destroy()
          resolve({ first, second })
        }
        socket.on("data", (chunk: string) => {
          text += chunk
          const got = parsed(text)
          if (got === undefined) return
          text = ""
          if (first === undefined) {
            first = got
            setTimeout(() => {
              if (socket.destroyed || !socket.writable) return settle(undefined)
              resent = true
              socket.write(ping(2))
            }, IDLE_MS)
            return
          }
          settle(got.status)
        })
        socket.on("error", () => settle(undefined))
        socket.on("close", () => {
          // Before the second write, the idle timer settles it; after, nothing else will.
          if (resent) settle(undefined)
        })
        socket.write(ping(1))
      }),
  )

describe("the trak's MCP route on the wire", () => {
  it("never leaves a keep-alive socket open for reuse and then loses the request sent on it", async () => {
    await runFlow([], () =>
      Effect.gen(function* () {
        const port = yield* serving(trakMcpRoutes)
        const { first, second } = yield* reuseAfterIdle(port)
        expect(first?.status).toBe(200)
        const outcome =
          first?.connection === "close"
            ? "told not to reuse"
            : second === undefined
              ? "reused socket lost the request"
              : `answered ${String(second)}`
        expect(["told not to reuse", "answered 200"]).toContain(outcome)
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(loopback)), Effect.orDie),
    )
  }, 15_000)
})
