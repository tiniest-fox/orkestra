// The `Engine` port over HTTP, and how a command finds the daemon to talk to.
//
// **Discovery is a derivation, then a confirmation.** The port comes from the project's
// path, so nothing has to be configured and a worktree reaches its own engine — but a
// derived number is a guess: a daemon whose pair was taken steps to another, and a
// worktree of the same repository can be sitting on the one we computed. So every
// candidate is confirmed with `GET /api/health` and accepted only if it reports *this*
// project. Without that check one worktree's `ork` drives another's traks, which is a
// failure nothing downstream could detect.
//
// It does not start a daemon. A command that silently spawned a server would make
// "nothing is running" invisible exactly when it matters.
//
// **Every request carries the daemon's bearer token, read off `daemon.json`.** A gated
// engine — one started with `ORKESTRA_PASSPHRASE` — refuses anything without a credential,
// and the token is how a command line has one with nothing typed. An open engine ignores
// it. The record is the only place the token is written, so a command that cannot read
// it is refused by a gated engine and says why.

import { request as httpRequest } from "node:http"
import { Effect, Layer, Option, Stream } from "effect"
import { Schema } from "effect"
import type { ActRequestDto } from "@orkestra/shared/dto/actions"
import type { McpToolCallDto } from "@orkestra/shared/dto/goals"
import {
  CreatedDto,
  MergePreviewDto,
  RecordsWrittenDto,
  ResumePreviewDto,
} from "@orkestra/shared/dto/actions"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { McpToolListDto, McpToolResultDto } from "@orkestra/shared/dto/goals"
import { EngineFrameDto } from "@orkestra/shared/dto/stream"
import { TrakDetailDto, TrakListDto } from "@orkestra/shared/dto/trak"
import {
  answeringFor,
  basePort,
  nextPair,
  PAIR_ATTEMPTS,
  readDaemonRecord,
} from "../app/discovery.js"
import { Engine, EngineFailed, type EngineShape, NoEngine, Refused } from "./engine.js"

/** Whether the daemon on `port` is this project's, answered without side effects. */
const isOurs = (port: number, project: string): Effect.Effect<boolean> =>
  Effect.map(
    Effect.promise(() => answeringFor(port)),
    (reported) => reported === project,
  )

/** Where this project's daemon is, and what it accepts in place of a login. */
export interface Found {
  readonly port: number
  /**
   * Absent when `daemon.json` is missing, unreadable, written by an older build, or
   * names another port than the one that answered — in every case the record is not
   * this daemon's, and a token off it would be refused anyway.
   */
  readonly token: string | undefined
}

/**
 * The port this project's daemon is on.
 *
 * `$ORKESTRA_API_PORT` first, because something that was told a number was told it on
 * purpose; then the derived pair and its neighbours, which is where `pnpm ui` would
 * have landed; then 3001, which is what a bare `pnpm serve` used to bind.
 *
 * The token comes from the record and nowhere else, and only when the record names the
 * port that answered: a record a dead daemon left beside a live one on the derived pair
 * would otherwise hand over a token the live one never issued.
 */
export const findEngine = (project: string): Effect.Effect<Found, NoEngine> =>
  Effect.gen(function* () {
    const named = process.env["ORKESTRA_API_PORT"]
    const derived = basePort(project)
    const candidates: number[] = []
    if (named !== undefined && named !== "") candidates.push(Number(named))
    let port = derived
    for (let i = 0; i < PAIR_ATTEMPTS; i += 1) {
      candidates.push(port)
      port = nextPair(port)
    }
    candidates.push(3001)

    for (const candidate of candidates) {
      if (yield* isOurs(candidate, project)) {
        const record = yield* readDaemonRecord(project).pipe(Effect.orElseSucceed(() => undefined))
        const token = record?.port === candidate ? record.token : undefined
        return { port: candidate, token }
      }
    }
    return yield* new NoEngine({ project, tried: candidates })
  })

/**
 * The engine a goal composer's tool server forwards to, its credential and its goal —
 * put in the server's environment by the MCP configuration its session was handed.
 */
export const handedGoal = (
  env: Readonly<Record<string, string | undefined>>,
): (Found & { readonly goal: string }) | undefined => {
  const engine = env["ORK_GOAL_ENGINE"]
  const token = env["ORK_GOAL_TOKEN"]
  const goal = env["ORK_GOAL_ID"]
  if (engine === undefined || token === undefined || goal === undefined) return undefined
  const port = Number(/:(\d+)\/?$/.exec(engine)?.[1])
  return Number.isInteger(port) && port > 0 ? { port, token, goal } : undefined
}

/**
 * The engine a step turn's tool server forwards to, its credential for that trak's tool
 * routes, and its trak, put in the server's environment by the MCP configuration its
 * session was handed.
 */
export const handedTrak = (
  env: Readonly<Record<string, string | undefined>>,
): (Found & { readonly trak: string }) | undefined => {
  const engine = env["ORK_TRAK_ENGINE"]
  const token = env["ORK_TRAK_TOKEN"]
  const trak = env["ORK_TRAK_ID"]
  if (engine === undefined || token === undefined || trak === undefined) return undefined
  const port = Number(/:(\d+)\/?$/.exec(engine)?.[1])
  return Number.isInteger(port) && port > 0 ? { port, token, trak } : undefined
}

/** What to print when nothing is listening. It names the two ways to fix it. */
export const noEngineMessage = (e: NoEngine): string =>
  [
    `no engine is listening for ${e.project}.`,
    ``,
    `start one:  pnpm ui      (engine + browser UI)`,
    `            pnpm serve   (engine only)`,
    ``,
    `add \`--dir ${e.project}\` to that command if you are starting it from elsewhere.`,
  ].join("\n")

const decodeRefusal = Schema.decodeUnknownEither(RefusalDto)

/** One trak's path. Outside the factory: it captures nothing from it. */
const trak = (id: string): string => `/api/traks/${encodeURIComponent(id)}`

/** One goal's path. */
const goalPath = (id: string): string => `/api/goals/${encodeURIComponent(id)}`

/**
 * What a request here says about itself. Narrower than `RequestInit` so the headers are
 * a record the credential can be merged into — the platform type also allows a list of
 * pairs, which a spread would turn into indices.
 */
interface Init {
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
}

/** A response read whole: what `postUnbounded` answers with. */
interface Answered {
  readonly status: number
  readonly statusText: string
  readonly body: string
}

/**
 * One POST answered whenever the engine is done, however long that is.
 *
 * Over `node:http` rather than `fetch`, which gives up on a response whose headers have
 * not arrived in five minutes — and a tool call that waits on a check sends none until
 * the check has run. This request sets no timeout and the agent sets none on its socket.
 */
const postUnbounded = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<Answered> =>
  new Promise((resolve, reject) => {
    const sent = httpRequest(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("error", reject)
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
      },
    )
    sent.on("error", reject)
    sent.end(body)
  })

export const EngineHttpLayer = (found: Found): Layer.Layer<Engine> =>
  Layer.succeed(Engine, makeHttpEngine(found))

/**
 * A gated engine turned the token away, or there was none to send. One sentence, because
 * the status alone reads as a bug in the command rather than as a file to look at.
 */
const REFUSED_TOKEN =
  "the engine is gated and this command's token was refused. It is read off " +
  "`.orkestra/.database/daemon.json`, which is missing, stale, or from an older " +
  "engine — restart the engine and try again."

/** One tool call, answered once the engine has finished it — see `postUnbounded`. */
const unboundedToolCall = (
  url: string,
  credential: Readonly<Record<string, string>>,
  call: McpToolCallDto,
): Effect.Effect<McpToolResultDto, EngineFailed> =>
  Effect.tryPromise({
    try: async (): Promise<McpToolResultDto> => {
      const answered = await postUnbounded(url, credential, JSON.stringify(call))
      if (answered.status === 401) throw new EngineFailed({ reason: REFUSED_TOKEN })
      if (answered.status < 200 || answered.status >= 300)
        throw new EngineFailed({
          reason: `${url} — ${String(answered.status)} ${answered.statusText}`,
        })
      return Schema.decodeUnknownSync(McpToolResultDto)(JSON.parse(answered.body))
    },
    catch: (cause) =>
      cause instanceof EngineFailed
        ? cause
        : new EngineFailed({ reason: `${url} — ${String(cause)}` }),
  })

const makeHttpEngine = ({ port, token }: Found): EngineShape => {
  const at = (path: string): string => `http://127.0.0.1:${String(port)}${path}`

  /**
   * The bearer, on every request. Sent whether or not the engine is gated: an open one
   * ignores it, and a command cannot tell which it is talking to without asking.
   */
  const credential: Record<string, string> =
    token === undefined ? {} : { authorization: `Bearer ${token}` }

  /** Every non-2xx, as the one of two failures it actually is. */
  const failed = async (response: Response, path: string): Promise<never> => {
    if (response.status === 401) throw new EngineFailed({ reason: REFUSED_TOKEN })
    const refusal = decodeRefusal(await response.json().catch(() => undefined))
    if (refusal._tag === "Right") throw new Refused({ refusal: refusal.right })
    throw new EngineFailed({
      reason: `${path} — ${String(response.status)} ${response.statusText}`,
    })
  }

  const request = <A>(
    path: string,
    init: Init,
    read: (response: Response) => Promise<A>,
  ): Effect.Effect<A, EngineFailed | Refused> =>
    Effect.tryPromise({
      try: async (): Promise<A> => {
        const response = await fetch(at(path), {
          ...init,
          headers: { ...credential, ...init.headers },
        })
        if (!response.ok) return await failed(response, path)
        return await read(response)
      },
      catch: (cause) =>
        cause instanceof Refused || cause instanceof EngineFailed
          ? cause
          : new EngineFailed({ reason: `${path} — ${String(cause)}` }),
    })

  const json = <A, I>(path: string, schema: Schema.Schema<A, I>) =>
    request(path, {}, async (response) => Schema.decodeUnknownSync(schema)(await response.json()))

  const send = (path: string, body?: unknown): Effect.Effect<void, EngineFailed | Refused> =>
    request(
      path,
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            // Load-bearing: `schemaBodyJson` refuses a body without it, and that comes
            // back as a 400 nothing here could explain.
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
      () => Promise.resolve(undefined),
    )

  /** A body sent, and the answer read as `schema`. */
  const posted = <A, I>(path: string, body: unknown, schema: Schema.Schema<A, I>) =>
    request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      async (response) => Schema.decodeUnknownSync(schema)(await response.json()),
    )

  return {
    list: () => json("/api/traks", TrakListDto),
    detail: (id) => json(trak(id), TrakDetailDto),
    record: (id) => request(`${trak(id)}/record`, {}, (response) => response.text()),
    records: () =>
      request("/api/records", { method: "POST" }, async (response) =>
        Schema.decodeUnknownSync(RecordsWrittenDto)(await response.json()),
      ).pipe(Effect.map((written) => written.folders)),
    resumePreview: (id) => json(`${trak(id)}/resume`, ResumePreviewDto),
    mergePreview: (id) => json(`${trak(id)}/merge`, MergePreviewDto),

    start: (description) => posted("/api/traks", { description }, CreatedDto),
    act: (id, req: ActRequestDto) => send(`${trak(id)}/act`, req),
    resume: (id, sessionId) =>
      send(`${trak(id)}/resume`, sessionId === undefined ? {} : { sessionId }),
    merge: (id) => send(`${trak(id)}/merge`),
    archive: (id) => send(`${trak(id)}/close`),
    archiveUnfinished: (id, reason) => send(`${trak(id)}/abandon`, { reason }),
    reenter: (id, what) => send(`${trak(id)}/reenter`, { what }),
    wipe: (id) =>
      request(id === undefined ? "/api/traks" : trak(id), { method: "DELETE" }, () =>
        Promise.resolve(undefined),
      ),
    revokeSessions: () =>
      request("/api/session", { method: "DELETE" }, () => Promise.resolve(undefined)),

    trakTools: (id) => json(`${trak(id)}/tools`, McpToolListDto),
    trakToolCall: (id, name, call) =>
      unboundedToolCall(at(`${trak(id)}/tools/${encodeURIComponent(name)}`), credential, call),
    goalTools: (goal) => json(`${goalPath(goal)}/tools`, McpToolListDto),
    goalToolCall: (goal, name, call) =>
      posted(`${goalPath(goal)}/tools/${encodeURIComponent(name)}`, call, McpToolResultDto),

    watch: () => watchStream(at("/api/stream"), credential),
  }
}

/**
 * The SSE stream, as frames.
 *
 * Hand-parsed rather than through an `EventSource`. Node has one, but it reconnects by
 * itself — and a command watching one trak does not want a silent reconnect starting a
 * replay underneath it. Here the connection's lifetime is the stream's, which is the
 * caller's.
 *
 * A frame this build cannot read is dropped rather than fatal: the commentary is not
 * the control flow, and a command that died because a *newer daemon* sent it something
 * unfamiliar would be worse than one that prints a little less.
 */
const watchStream = (
  url: string,
  credential: Record<string, string>,
): Stream.Stream<EngineFrameDto, EngineFailed> =>
  Stream.unwrap(
    Effect.tryPromise({
      try: async (): Promise<Stream.Stream<Uint8Array, EngineFailed>> => {
        const response = await fetch(url, {
          headers: { ...credential, accept: "text/event-stream" },
        })
        if (response.status === 401) throw new Error(REFUSED_TOKEN)
        const body: ReadableStream<Uint8Array> | null = response.body
        if (body === null) throw new Error("the engine answered the stream with no body")
        return Stream.fromReadableStream({
          evaluate: () => body,
          onError: (cause) => new EngineFailed({ reason: `the stream ended: ${String(cause)}` }),
        })
      },
      catch: (cause) => new EngineFailed({ reason: `could not open the stream: ${String(cause)}` }),
    }),
  ).pipe(
    Stream.decodeText(),
    // SSE separates frames with a blank line and prefixes the payload with `data: `,
    // so splitting on lines and keeping those is the protocol rather than a guess.
    Stream.splitLines,
    Stream.filter((line) => line.startsWith("data: ")),
    Stream.filterMap((line) => {
      const frame = Schema.decodeUnknownEither(EngineFrameDto)(JSON.parse(line.slice(6)))
      return frame._tag === "Right" ? Option.some(frame.right) : Option.none()
    }),
  )
