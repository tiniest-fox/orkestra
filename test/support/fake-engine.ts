// A stand-in for `dist/serve.js`, run as a child by `startEngine` in the host's tests.
//
// It looks like an engine from outside and nothing more: it binds the port
// `ORKESTRA_API_PORT` names, answers `/api/health` for the root `--dir` names, and writes
// `daemon.json` with a fresh bearer — the three things `startEngine` waits on. The rest is
// what a test reads back through the host:
//
//   GET /…            a page with `<base href="/">`, naming the root and the path it saw
//   * /api/traks      `{root, path}` with the bearer, 401 without, and `cookie` and `user` —
//                     the `x-orkestra-user` header — when one came. A POST also answers an
//                     `id`, and keeps its body and `user` for `/api/created`
//   POST /api/push/notify  204, keeping the body for `/api/notified`
//   GET /api/notified `{notified}`: each body the host's notices came as, oldest first
//   GET /api/created  `{created}`: each POST to `/api/traks`, oldest first, as `{id, body, user?}`, the body as the text it came as
//   GET /api/stream   an event stream that sends one frame and stays open
//   GET /api/seen     `{seen}`: how many requests reached it besides health checks and this
//   POST /api/reload  204, or 422 and a `ReloadFailed` while the root holds a `reload-fails`
//   GET /api/env      the two tokens it was started with, `{CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN}`,
//                     and each variable `?names=A,B` asks for besides
//   GET /api/ownerless  what the root's `ownerless.json` holds, `{traks: [], goals: []}` without
//                     one, and 500 while the root holds an `ownerless-fails`
//   GET /api/traks/<id>/processes   `{processes}` out of `FAKE_ENGINE_PROCESSES`, a JSON
//                     object of trak id to list; 404 for a trak it does not name
//   GET /api/processes  the project checkout's, the list under `checkout` in the same object,
//                     or none
//
// Before it binds it opens `.orkestra/.database/store.sqlite` with a `log` table, as a real
// engine opens its store: the host's first backup pass waits for one.
//
// Once it listens it prints `serving <root> on <port>` on stdout and, with
// `FAKE_ENGINE_LEAK=1`, a line naming its `GH_TOKEN` on stderr — what the host's engine
// log is tested against.
//
// `FAKE_ENGINE_HOLD_MS` holds the bind back, as a first-boot migration does. Meanwhile it
// prints `MIGRATING` first with `FAKE_ENGINE_MIGRATING=1`, and a progress line every
// `FAKE_ENGINE_PROGRESS_MS` where that is set — what the supervisor's boot wait is tested
// against.
//
// Run with `node --import tsx`, so it is a plain child process the test can SIGKILL.
//
// A host that answers routes of its own launches a script of its own instead, which imports
// `serveFakeEngine` from here and passes them: an extra route is answered after the bearer
// check and before every route above, so it can also stand in for one of them.

import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { announce, health, MIGRATING } from "../../src/app/discovery.js"

const root = process.argv[process.argv.indexOf("--dir") + 1] ?? ""
const port = Number(process.env["ORKESTRA_API_PORT"])
const token = randomBytes(16).toString("hex")
let seen = 0
const created: { id: string; body: string; user?: string }[] = []
/** Each body `POST /api/push/notify` was sent, for `/api/notified`. */
const notified: string[] = []

/** A POST to `/api/traks` kept for `/api/created`, answered as any request there is. */
const keepCreated = (
  req: IncomingMessage,
  answer: Record<string, unknown>,
  res: ServerResponse,
) => {
  const chunks: Buffer[] = []
  req.on("data", (chunk: Buffer) => chunks.push(chunk))
  req.once("end", () => {
    const id = `fake-${String(created.length + 1)}`
    const user = req.headers["x-orkestra-user"]
    created.push({
      id,
      body: Buffer.concat(chunks).toString("utf8"),
      ...(typeof user === "string" ? { user } : {}),
    })
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ ...answer, id }))
  })
}

/** A `POST /api/push/notify` kept for `/api/notified`, answered 204. */
function keepNotified(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = []
  req.on("data", (chunk: Buffer) => chunks.push(chunk))
  req.once("end", () => {
    notified.push(Buffer.concat(chunks).toString("utf8"))
    res.writeHead(204).end()
  })
}

/** `GET /api/ownerless`: the file the test wrote, a 500 when it asked for one, else nothing ownerless. */
function ownerless(res: ServerResponse): void {
  if (existsSync(join(root, "ownerless-fails"))) {
    res.writeHead(500).end()
    return
  }
  const file = join(root, "ownerless.json")
  const body = existsSync(file) ? readFileSync(file, "utf8") : '{"traks":[],"goals":[]}'
  res.writeHead(200, { "content-type": "application/json" }).end(body)
}

/** A route a host adds, keyed by the exact request path, and answered with the bearer checked. */
export type FakeRoute = (req: IncomingMessage, res: ServerResponse) => void

/** Answers the routes above and `extra`, and binds once `FAKE_ENGINE_HOLD_MS` has passed. */
export function serveFakeEngine(extra: Readonly<Record<string, FakeRoute>> = {}): void {
  const server = createServer((req, res) => respond(extra, req, res))
  // `FAKE_ENGINE_ANNOUNCE_MS` holds the record back after the bind, as a real engine's
  // later `announce` can.
  const announceMs = Number(process.env["FAKE_ENGINE_ANNOUNCE_MS"] ?? "0")
  const holdMs = Number(process.env["FAKE_ENGINE_HOLD_MS"] ?? "0")
  const progressMs = Number(process.env["FAKE_ENGINE_PROGRESS_MS"] ?? "0")
  if (process.env["FAKE_ENGINE_MIGRATING"] === "1") console.log(MIGRATING)
  const progress =
    progressMs > 0
      ? setInterval(() => console.log("store: writing, 1 of 2"), progressMs)
      : undefined
  setTimeout(() => {
    clearInterval(progress)
    openStore()
    server.listen(port, "127.0.0.1", () => listening(announceMs))
  }, holdMs)
  process.on("SIGTERM", () => process.exit(0))
}

function respond(
  extra: Readonly<Record<string, FakeRoute>>,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const path = req.url ?? "/"
  if (path === "/api/health") {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(health(root, undefined)))
    return
  }
  if (path === "/api/seen") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ seen }))
    return
  }
  seen += 1
  if (path.startsWith("/api/") && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end()
    return
  }
  const route = extra[path]
  if (route !== undefined) {
    route(req, res)
    return
  }
  if (path === "/api/traks") {
    const cookie = req.headers.cookie
    const user = req.headers["x-orkestra-user"]
    const body = {
      root,
      path,
      ...(cookie === undefined ? {} : { cookie }),
      ...(user === undefined ? {} : { user }),
    }
    if (req.method === "POST") return keepCreated(req, body, res)
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body))
    return
  }
  if (path === "/api/push/notify" && req.method === "POST") {
    keepNotified(req, res)
    return
  }
  if (path === "/api/notified") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ notified }))
    return
  }
  if (path === "/api/created") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ created }))
    return
  }
  if (path === "/api/reload" && req.method === "POST") {
    if (!existsSync(join(root, "reload-fails"))) {
      res.writeHead(204).end()
      return
    }
    const failed = { _tag: "ReloadFailed", reason: "agents/broken.md: will not parse" }
    res.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify(failed))
    return
  }
  if (path === "/api/env" || path.startsWith("/api/env?")) {
    const names = new URL(path, "http://fake").searchParams.get("names")?.split(",") ?? []
    const env = {
      CLAUDE_CODE_OAUTH_TOKEN: process.env["CLAUDE_CODE_OAUTH_TOKEN"],
      GH_TOKEN: process.env["GH_TOKEN"],
      ...Object.fromEntries(names.map((name) => [name, process.env[name]])),
    }

    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(env))
    return
  }
  if (path === "/api/ownerless") {
    ownerless(res)
    return
  }
  const processes =
    path === "/api/processes" ? "checkout" : /^\/api\/traks\/([^/]+)\/processes$/u.exec(path)?.[1]
  if (processes !== undefined) {
    const lists = Schema.decodeUnknownSync(
      Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
    )(process.env["FAKE_ENGINE_PROCESSES"] ?? "{}")
    const list = lists[processes] ?? (processes === "checkout" ? [] : undefined)
    if (list === undefined) res.writeHead(404).end()
    else
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ processes: list }))
    return
  }
  if (path === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.write(`id: 1\ndata: ${JSON.stringify({ root })}\n\n`)
    return
  }
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8" })
    .end(`<!doctype html><html><head><base href="/" /></head><body>${root} ${path}</body></html>`)
}

/** The project's store, opened as a real engine's boot opens it, with the table a drill reads. */
const openStore = (): void => {
  const path = join(root, ".orkestra", ".database", "store.sqlite")
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(
    "create table if not exists log (of text not null, key text not null, line text not null)",
  )
  db.close()
}

function listening(announceMs: number): void {
  console.log(`serving ${root} on ${String(port)}`)
  // On stderr, and naming its token, as an engine printing another program's words could.
  const gh = process.env["GH_TOKEN"]
  if (process.env["FAKE_ENGINE_LEAK"] === "1" && gh !== undefined)
    console.error(`git said: could not push with ${gh}`)
  Effect.runFork(
    Effect.scoped(
      Effect.zipRight(
        Effect.zipRight(Effect.sleep(announceMs), announce(root, port, token)),
        Effect.never,
      ),
    ),
  )
}
// `realpathSync`, because `argv[1]` keeps a symlink in the path that `import.meta.url` resolves.
const main = process.argv[1]
if (main !== undefined && realpathSync(main) === fileURLToPath(import.meta.url)) serveFakeEngine()
