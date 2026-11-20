/**
 * The plumbing every transport file in `api/` shares: the two failures a caller can branch
 * on, the base URL, `fetch` itself and the session. **It imports no wire slice** — only
 * `common`, whose refusals every route can answer with — so an edit to one slice reaches
 * the hooks that read that slice and no others. Each slice's routes are in the file named
 * for it: `api/trak.ts` decodes the `trak` slice, `api/fleet.ts` the `fleet` slice.
 *
 * Everything above `api/` depends on those files' signatures, never on how they are
 * served. That is the whole bet: the Rust app shipped as both a local Tauri app and a
 * hosted web service, and `orkestra-networking` existed because those two transports were
 * written by hand twice. When Tauri or Electron lands here, `api/` changes and every hook
 * and component recompiles untouched.
 *
 * **Across those files: reads, one stream, a login, eight things that spend and six that
 * cost nothing.**
 * `POST /api/traks` starts a trak, `POST /act` approves a plan, says something to it,
 * answers what it asked or sends the composer a reason to replan, `POST /resume` picks up
 * a trak whose process died mid-command, `POST /file` asks a step for what it has, and
 * `POST /reenter` hands the composer what a person wrote and ticked, as one string —
 * all eight cost the same as `pnpm ork`,
 * because a real `claude` runs the moment any of them answers. `POST /merge`,
 * `POST /close`, `POST /abandon` and `POST /stop` spend nothing at all: the first three
 * are `git` and a log line — the two archive routes among them delete the trak's branch
 * here and on GitHub — and the fourth kills a turn already paid for. They all claim
 * custody, so the same disabled-while-driving contract holds for every one but the last
 * two — archiving an unfinished trak and stopping are the two actions whose point is to
 * override a drive already under way. `POST /mode` and `POST /hold` are the other two
 * that cost nothing, and they claim no custody at all: each is one log line the engine
 * reads at the trak's next gate, so both land while a turn runs and neither disables
 * for it. `POST /api/openers` and `POST /api/traks/:id/open` cost nothing and claim no
 * custody either, and they append no event at all — one writes the machine's terminal
 * or editor pick, the other opens that app at a trak's checkout, a window on the
 * *engine's* machine. The git bar's four presses, `POST /api/git/{fetch,pull,reconcile,push}`,
 * cost nothing and claim no custody too: they are `git` against the project checkout, which no
 * trak owns. `POST /file` is the stop's twin with the opposite ending — it
 * re-enters the step at once, so it spends — and `/act`'s `replan` sends the composer a
 * person's words.
 * `/act`'s one remaining action, skipping, is still `pnpm ork`.
 *
 * Three bans hold that shape, and all are relaxed for `src/api/**` in
 * `client/.oxlintrc.json` — an exemption is only worth something if the ban around
 * it holds, so do not widen the override:
 *
 *   · `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource` are `no-restricted-globals`
 *     everywhere else.
 *   · `effect` is type-only everywhere else. Under `api/` it is a value, for one
 *     reason — decoding, below.
 */

import { Schema } from "effect"
import { RefusalDto as RefusalSchema } from "@orkestra/shared/dto/common"
import type { LoginRequestDto, RefusalDto } from "./types"

// ============================================================================
// Failure — the only shape a caller can branch on
// ============================================================================

/**
 * A non-2xx answer from the engine. The server sends **no body** on any of them
 * (`ServerResponse.empty({ status, statusText })`), so the reason phrase is all
 * there is. A read-only client meets two of them — 404 for an unknown id, and 500
 * for an engine failure the router deliberately does not catch.
 *
 * **Branch on `status`, display `statusText`**, which matters again the moment the
 * POSTs come back: `409 Not parked` and `409 Held by pid <n>` are one status code
 * told apart by a reason phrase, and a reason phrase is the most fragile thing on
 * the wire — HTTP/2 has none, and a proxy may rewrite it. A UI that switches on the
 * phrase breaks silently the day the server is not reached over HTTP/1.1; one that
 * switches on 409 and *shows* the phrase degrades to "the server refused this".
 *
 * A plain `Error` subclass, not the engine's `Data.TaggedError`: there is no Effect
 * error channel in the client to tag, TanStack Query types `error` as `Error`, and
 * a rejected promise is already how a `queryFn` reports failure. Fields are assigned
 * in the body because `erasableSyntaxOnly` bans parameter properties, and `name` is
 * set because subclassing `Error` does not do it.
 */
/**
 * A refusal the engine explained.
 *
 * Apart from `ApiError` because the two license different answers: a bare status is
 * something to report, where this is something a surface can act on — a dirty tree
 * names its files and asks you to commit them. Branching on `refusal._tag` is
 * exhaustive, so a refusal the engine grows is a compile error here rather than a
 * message that quietly reads as "something went wrong".
 */
export class RefusedError extends Error {
  readonly status: number
  readonly refusal: RefusalDto
  readonly path: string

  constructor(status: number, refusal: RefusalDto, path: string) {
    super(`${path} — ${String(status)} ${refusal._tag}`)
    this.name = "RefusedError"
    this.status = status
    this.refusal = refusal
    this.path = path
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly path: string

  constructor(status: number, statusText: string, path: string) {
    super(`${path} — ${String(status)} ${statusText}`)
    this.name = "ApiError"
    this.status = status
    this.statusText = statusText
    this.path = path
  }
}

// ============================================================================
// Decoding — why `effect` is a value import in `api/` and nowhere else
// ============================================================================

/**
 * Every decoder in `api/` is `Schema.decodeUnknownSync` or `decodeUnknownEither`, for this
 * reason. `res.json()` trusts the server completely, and the two modes this is aimed at are
 * exactly where that trust breaks: a Tauri app against a stale background `serve`,
 * a hosted deploy one version behind. Type-only imports make DTO drift a *compile*
 * error, which is worth nothing at runtime — undefined-field access surfaces in some
 * component instead of once, here, in words.
 *
 * `decodeUnknownSync` throws a `ParseError`, which is precisely how a `queryFn`
 * reports a bad response, so nothing else has to be plumbed. It is deliberately
 * **not** wrapped in `ApiError`: "the server sent a shape this version does not
 * understand" and "the server said 409" are different facts, and collapsing them is
 * the catch-all trap `effect-idiom` names.
 *
 * `Either` for the refusal: a body that is not a refusal is an ordinary outcome.
 */
const decodeRefusal = Schema.decodeUnknownEither(RefusalSchema)

// ============================================================================
// Requests
// ============================================================================

/**
 * Absolute, resolved per call against the page's `<base>` — see `base.ts`.
 *
 * With no prefix this is the same request `fetch("/api/traks")` would make — dev goes
 * through the Vite proxy to whichever port the engine bound, so there is no base URL
 * to configure and the engine needs no CORS headers. Under a host's `/p/x/` it is
 * `/p/x/api/traks`, which the host strips before the engine sees it. **Do not turn this
 * into a base-URL branch**; `client/vite.config.ts` records why there isn't one.
 *
 * The leading `/` every path here is written with is dropped, because a root-relative
 * path ignores the base's own path. It is spelled out absolute rather than left relative
 * because Node's `fetch` refuses to parse a relative URL, and it throws before MSW can
 * intercept. Per call, not once at module scope: a module-scope read runs at import
 * time, and a static import hoists above the test's `beforeAll`.
 */
export const url = (path: string): string => new URL(`.${path}`, document.baseURI).toString()

/**
 * The body, or the failure that explains why there isn't one.
 *
 * A 4xx now usually *has* a body — a `RefusalDto` saying which refusal it was — so this
 * reads it before giving up. `decodeRefusal` returning a `Left` is the ordinary case
 * for the responses that still carry nothing (a 404, a 400 from `schemaBodyJson`), and
 * those fall back to `ApiError`: a status with no explanation is a different fact from
 * an explained one, and collapsing them would make every refusal look answerable.
 */
export const body = async (res: Response, path: string): Promise<unknown> => {
  if (!res.ok) {
    const refusal = decodeRefusal(await res.json().catch(() => undefined))
    if (refusal._tag === "Right") throw new RefusedError(res.status, refusal.right, path)
    throw new ApiError(res.status, res.statusText, path)
  }
  // `204` is the two setting routes: the change is on the log and the stream carries it,
  // so there is no body, and parsing an empty one is a `SyntaxError` wearing a success.
  if (res.status === 204) return undefined
  const parsed: unknown = await res.json()
  return parsed
}

export const get = async (path: string): Promise<unknown> => body(await fetch(url(path)), path)

/**
 * `content-type` is load-bearing: `ServerRequest.schemaBodyJson` refuses a body without
 * it, and that arrives as a 400 nothing in the UI can explain.
 */
export const post = async (path: string, payload: unknown): Promise<unknown> =>
  body(
    await fetch(url(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    path,
  )

export const trakPath = (id: string): string => `/api/traks/${encodeURIComponent(id)}`

// ============================================================================
// The session — asked before anything else, because the guard answers every other
// route 401 without one
// ============================================================================

/**
 * `GET /api/session`. Whether this browser is in: `true` for a session the guard issued
 * and for an engine started with no passphrase, which asks nothing of anyone. `false` is
 * the one answer that is not an error — it is what the login screen is drawn for.
 */
export const session = async (): Promise<boolean> => {
  const res = await fetch(url("/api/session"))
  if (res.status === 401) return false
  if (!res.ok) throw new ApiError(res.status, res.statusText, "/api/session")
  return true
}

/**
 * `POST /api/session`. The passphrase the engine was started with, for a cookie the
 * browser then sends on its own. A wrong one is an `ApiError` with status 401, and it is
 * answered slowly on purpose — the guard throttles failures.
 */
export const login = async (passphrase: string): Promise<void> => {
  const request: LoginRequestDto = { passphrase }
  const res = await fetch(url("/api/session"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new ApiError(res.status, res.statusText, "/api/session")
}
