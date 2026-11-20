// A trak's MCP servers as streamable-HTTP endpoints on the engine, for a session whose CLI
// runs in the trak's sandbox — and a goal's tools, for a goal composer in the project's
// sandbox: there, the `orkestra` shim's command and the proxy's are not, and the engine's
// port is reached through the tunnel a turn holds open.
//
//   POST /api/traks/:id/mcp          the trak's tools — the same list and the same calls
//                                    `trak-tools.ts` serves the shim, answered in-process
//   *    /api/traks/:id/mcp/:server  an `mcp.yaml` server with `connection:`, forwarded to
//                                    its `url` with the host's token for it, as the stdio
//                                    proxy forwards on this machine
//   POST /api/goals/:id/mcp          the goal's tools, as `goals.ts` serves the shim
//
// Each is reached with its trak's or goal's own token, which the guard checks against `:id`.
//
// **The tools endpoint keeps no session.** Every call is decided by the turn in flight, as
// the shim's are, so it issues no `Mcp-Session-Id`, opens no stream of its own — a `GET`
// answers 405, which the protocol reads as no stream offered — and answers every request
// with one JSON body. A check holds that body until it has run.
//
// **Every answer here says `Connection: close`.** The CLI reaches these routes through the
// sandbox's tunnel, and Claude Code's client keeps a socket in its pool past the
// `Keep-Alive: timeout=5` it is told: Node closes an idle socket about 6 s after its last
// answer, and the next call written on it is lost before the engine reads a byte, as an
// `ECONNRESET` with nothing in the log. A socket the engine never offers for reuse is
// one no client can reuse. Raising `keepAliveTimeout` would only move the race.
//
// **A request carrying `orkestra-resent` runs nothing.** The relay a runner's `reach` keeps
// in the sandbox holds the CLI's connections while the engine is down, and resends a
// request whose connection dropped before any answer came back, once, with that header:
// the engine that served it may have run it before it died. A marked `tools/call` is
// answered with `trak/lost-to-restart` — for `run_check`, that calling it again is safe —
// and a marked request to a `connection:` server is never forwarded, since a third party's
// tool is not known to be safe to run twice. Nothing replays a cut call.
//
// **An unmarked call waits for its turn to open.** At a reattach the relay's held calls
// can arrive while the new engine is still rejoining the turn, and a forward the old
// engine left running carries them before `reach` is even asked. Refused there, the call
// would read as a turn that ended.

import { Effect, Either, Schedule, Stream } from "effect"
import * as Headers from "@effect/platform/Headers"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import {
  INTERNAL,
  initialized,
  NO_METHOD,
  readMessage,
  result,
  rpcError,
  toolResult,
  type Incoming,
  type RpcId,
} from "../cli/logic/mcp-server.js"
import { connectionsOf } from "../library/logic/mcp-resolve.js"
import { Lib } from "../library/ports/library.js"
import { render } from "../prompts/index.js"
import { Prompts } from "../prompts/ports/prompts.js"
import { GoalId, TrakId } from "../workflow/domain/trak.js"
import { Environment } from "../workflow/ports/environment.js"
import { TurnTools } from "../workflow/ports/turn-tools.js"
import { RUN_CHECK, TRAK_TOOLS } from "./drive.js"
import { goalGate, goalToolCall, goalToolList } from "./goals.js"
import { version } from "./packaged.js"
import { trakToolCall, trakToolList } from "./trak-tools.js"

/** `-32602`: a call naming no tool of the engine's. */
const INVALID_PARAMS = -32602

const pathTrak = Effect.gen(function* () {
  const raw = (yield* Router.params)["id"]
  if (raw === undefined) return yield* Effect.fail(ServerResponse.empty({ status: 400 }))
  return TrakId.make(raw)
})

/** `handler` with every answer — its success and a response it fails with — closing its socket. */
const closing = <E, R>(handler: Effect.Effect<ServerResponse.HttpServerResponse, E, R>) =>
  handler.pipe(
    Effect.map(ServerResponse.setHeader("connection", "close")),
    Effect.mapError((e) =>
      ServerResponse.isServerResponse(e) ? ServerResponse.setHeader(e, "connection", "close") : e,
    ),
  )

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The header the sandbox's relay adds to a request it resends after an engine restart. */
const RESENT = "orkestra-resent"

const isResent = Effect.map(
  ServerRequest.HttpServerRequest,
  (request) => request.headers[RESENT] !== undefined,
)

/** What a resent call answers in place of running: `tool` is `undefined` off the engine's tools. */
const lostToRestart = (tool: string | undefined) =>
  Effect.map(Prompts, (prompts) =>
    render(prompts, "trak/lost-to-restart", { check: tool === RUN_CHECK }),
  )

/** How long an unmarked call waits for this trak's turn to open before it is answered. */
const TURN_WAIT = "60 seconds"

const turnOpened = (id: TrakId) =>
  Effect.flatMap(TurnTools, (tools) =>
    tools.current(id).pipe(
      Effect.repeat({
        until: (turn) => turn !== undefined,
        schedule: Schedule.spaced("250 millis").pipe(Schedule.upTo(TURN_WAIT)),
      }),
    ),
  )

/** A resent `tools/call`, answered as lost; `tool` is `undefined` off the engine's tools. */
const lostCall = (id: RpcId, tool: string | undefined) =>
  Effect.map(lostToRestart(tool), (text) => result(id, toolResult(text, true)))

/**
 * A resent message to a `connection:` server: a call is answered as lost, and any other
 * that asks for an answer gets the same words as an error, since the server's answer is
 * not this engine's to give.
 */
const connectionResent = (incoming: Incoming) => {
  switch (incoming.kind) {
    case "call":
      return lostCall(incoming.id, undefined)
    case "ignored":
      return Effect.succeed<string | undefined>(undefined)
    case "initialize":
    case "ping":
    case "unknown":
    case "list":
      return Effect.map(lostToRestart(undefined), (text): string | undefined =>
        rpcError(incoming.id, INTERNAL, text),
      )
  }
}

/** The line one message is answered with, or `undefined` for one owed no answer. */
const answer = (id: TrakId, incoming: Incoming) => {
  switch (incoming.kind) {
    case "ignored":
      return Effect.succeed<string | undefined>(undefined)
    case "initialize":
      return Effect.succeed(
        result(incoming.id, initialized(incoming.version, TRAK_TOOLS, version())),
      )
    case "ping":
      return Effect.succeed(result(incoming.id, {}))
    case "unknown":
      return Effect.succeed(rpcError(incoming.id, NO_METHOD, `no ${incoming.method}`))
    case "list":
      return Effect.map(Effect.zipRight(turnOpened(id), trakToolList(id)), (listed) =>
        result(incoming.id, { tools: listed.tools }),
      )
    case "call":
      return Effect.map(
        Effect.zipRight(
          turnOpened(id),
          trakToolCall(id, incoming.name, {
            arguments: incoming.arguments,
            ...(incoming.call === undefined ? {} : { call: incoming.call }),
          }),
        ),
        (answered): string | undefined =>
          answered === undefined
            ? rpcError(incoming.id, INVALID_PARAMS, `no tool ${incoming.name}`)
            : result(incoming.id, toolResult(answered.text, answered.isError)),
      )
  }
}

/**
 * A failure inside the engine is the request's error rather than the route's 500, so the
 * CLI reads why beside the request that asked — as the shim answers an engine it could
 * not reach.
 */
const answered = (id: TrakId, message: unknown, resent: boolean) => {
  const incoming = readMessage(message)
  // Only a call runs anything; the rest are answered as ever.
  const reply =
    resent && incoming.kind === "call" ? lostCall(incoming.id, incoming.name) : answer(id, incoming)
  return reply.pipe(
    Effect.catchAll((e) =>
      Effect.succeed<string | undefined>(
        "id" in incoming ? rpcError(incoming.id, INTERNAL, reasonOf(e)) : undefined,
      ),
    ),
  )
}

/** One JSON-RPC body, or a batch of them, answered a message at a time by `each`. */
const rpcBody = <E, R>(each: (message: unknown) => Effect.Effect<string | undefined, E, R>) =>
  Effect.gen(function* () {
    const body = yield* (yield* ServerRequest.HttpServerRequest).json.pipe(
      Effect.catchTag("RequestError", () => Effect.fail(ServerResponse.empty({ status: 400 }))),
    )
    const batch = Array.isArray(body)
    const messages: readonly unknown[] = batch ? body : [body]
    const lines = yield* Effect.forEach(messages, (m) => each(m), { concurrency: "unbounded" })
    const owed = lines.flatMap((line) => (line === undefined ? [] : [line]))
    // Notifications and the CLI's own answers alone: accepted, with nothing to say.
    if (owed.length === 0) return ServerResponse.empty({ status: 202 })
    return ServerResponse.text(batch ? `[${owed.join(",")}]` : (owed[0] ?? ""), {
      contentType: "application/json",
    })
  })

const toolsRoute = Router.post(
  "/api/traks/:id/mcp",
  closing(
    Effect.gen(function* () {
      const id = yield* pathTrak
      const resent = yield* isResent
      return yield* rpcBody((m) => answered(id, m, resent))
    }),
  ),
)

/**
 * A resent request to a `connection:` server, answered here and never forwarded. One with
 * no body — a stream opened, or a session closed — is a 503 saying why.
 */
const resentToConnection = (method: string) =>
  method === "GET" || method === "HEAD" || method === "DELETE"
    ? Effect.map(lostToRestart(undefined), (text) => ServerResponse.text(text, { status: 503 }))
    : rpcBody((m) => connectionResent(readMessage(m)))

const noStream = Router.get(
  "/api/traks/:id/mcp",
  closing(Effect.succeed(ServerResponse.empty({ status: 405 }))),
)

/** What the CLI sends that the server reads, carried as it came; the bearer is replaced. */
const FORWARDED = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
]

/** What the server answers with that the CLI reads, carried back as it came. */
const RETURNED = ["mcp-session-id", "cache-control"]

const picked = (
  from: { readonly get: (name: string) => string | null | undefined },
  names: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = from.get(name)
      return value === null || value === undefined ? [] : [[name, value]]
    }),
  )

/**
 * One exchange with a `connection:` server: the host's token fetched for it, then the
 * request forwarded and the answer streamed back — a JSON body or a server-sent stream
 * alike, unread. A server the file does not declare with `connection:` is 404; an engine
 * with no key to ask a host with answers 503 and says so, and a host that hands no token, 502.
 */
const connectionRoute = Router.all(
  "/api/traks/:id/mcp/:server",
  closing(
    Effect.gen(function* () {
      yield* pathTrak
      const name = (yield* Router.params)["server"] ?? ""
      const declared = connectionsOf((yield* Lib).mcp).find((s) => s.name === name)
      if (declared === undefined) return ServerResponse.empty({ status: 404 })
      const request = yield* ServerRequest.HttpServerRequest
      if (yield* isResent) return yield* resentToConnection(request.method)
      const method = request.method
      const body =
        method === "GET" || method === "HEAD" || method === "DELETE"
          ? undefined
          : yield* request.text.pipe(
              Effect.catchTag("RequestError", () =>
                Effect.fail(ServerResponse.empty({ status: 400 })),
              ),
            )
      const token = yield* Effect.either(
        (yield* Environment).connection.token(declared.connection, declared.url),
      )
      if (Either.isLeft(token)) {
        const { reason, asked } = token.left
        return ServerResponse.text(reason, { status: asked ? 502 : 503 })
      }
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(declared.url, {
            method,
            headers: {
              ...picked({ get: (n) => request.headers[n] }, FORWARDED),
              authorization: `Bearer ${token.right}`,
            },
            ...(body === undefined ? {} : { body }),
            signal,
          }),
        catch: (e) => reasonOf(e),
      }).pipe(
        Effect.catchAll((reason) => Effect.fail(ServerResponse.text(reason, { status: 502 }))),
      )
      const headers = Headers.fromInput(picked(response.headers, RETURNED))
      const contentType = response.headers.get("content-type") ?? undefined
      if (response.body === null) {
        return ServerResponse.empty({ status: response.status, headers })
      }
      const upstream: ReadableStream<Uint8Array> = response.body
      return ServerResponse.stream(
        Stream.fromReadableStream(
          () => upstream,
          (e) => reasonOf(e),
        ),
        { status: response.status, headers, ...(contentType === undefined ? {} : { contentType }) },
      )
    }),
  ),
)

/**
 * The line one message to a goal's tools is answered with. A goal's call needs no turn to
 * open first: `goals.ts` refuses a call that moves a goal outside its composer's turn.
 */
const goalAnswer = (id: GoalId, incoming: Incoming) => {
  switch (incoming.kind) {
    case "ignored":
      return Effect.succeed<string | undefined>(undefined)
    case "initialize":
      return Effect.succeed(
        result(incoming.id, initialized(incoming.version, GOAL_TOOLS, version())),
      )
    case "ping":
      return Effect.succeed(result(incoming.id, {}))
    case "unknown":
      return Effect.succeed(rpcError(incoming.id, NO_METHOD, `no ${incoming.method}`))
    case "list":
      return Effect.map(goalToolList, (listed) => result(incoming.id, { tools: listed.tools }))
    case "call":
      return Effect.map(
        goalToolCall(id, incoming.name, {
          arguments: incoming.arguments,
          ...(incoming.call === undefined ? {} : { call: incoming.call }),
        }),
        (called): string | undefined =>
          called === undefined
            ? rpcError(incoming.id, INVALID_PARAMS, `no tool ${incoming.name}`)
            : result(incoming.id, toolResult(called.text, called.isError)),
      )
  }
}

/** The server name a goal's tools answer `initialize` with, as the shim's does. */
const GOAL_TOOLS = "orkestra-goal"

/** `answered`, for a goal's tools: a resent call runs nothing, and a failure is the request's error. */
const goalAnswered = (id: GoalId, message: unknown, resent: boolean) => {
  const incoming = readMessage(message)
  const reply =
    resent && incoming.kind === "call" ? lostCall(incoming.id, undefined) : goalAnswer(id, incoming)
  return reply.pipe(
    Effect.catchAll((e) =>
      Effect.succeed<string | undefined>(
        "id" in incoming ? rpcError(incoming.id, INTERNAL, reasonOf(e)) : undefined,
      ),
    ),
  )
}

const goalToolsRoute = Router.post(
  "/api/goals/:id/mcp",
  closing(
    Effect.gen(function* () {
      const raw = (yield* Router.params)["id"]
      if (raw === undefined) return ServerResponse.empty({ status: 400 })
      const resent = yield* isResent
      return yield* rpcBody((m) => goalAnswered(GoalId.make(raw), m, resent))
    }),
  ),
)

const goalNoStream = Router.get(
  "/api/goals/:id/mcp",
  closing(Effect.succeed(ServerResponse.empty({ status: 405 }))),
)

export const trakMcpRoutes = Router.empty
  .pipe(
    toolsRoute,
    noStream,
    connectionRoute,
    goalToolsRoute,
    goalNoStream,
    // The goal routes behind the goal's own check; `server.ts` puts the trak ones behind theirs.
  )
  .pipe(Router.use(goalGate))
