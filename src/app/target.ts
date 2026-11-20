// What a request target *is*, decided the way the router decides it.
//
// **The guard and the router must never disagree about a path, and the only way to
// guarantee that is to ask the router.** `HttpRouter` hands the raw target to
// `find-my-way-ts`, which collapses runs of slashes, strips an absolute-form scheme and
// host, percent-decodes what `decodeURI` decodes, drops a trailing slash, cuts the query
// at `?`, `;` or `#`, and matches case-insensitively. A string test written here —
// `startsWith("/api/")` — sees none of that, so `//api/traks`, `/%61pi/traks`,
// `/API/traks` and `http://host/api/traks` all read as *not the API* to the test and as
// the API to the router. That is how the guard shipped one slash wide.
//
// Re-implementing the sanitiser would agree until the dependency moved, and it is a
// transitive dependency this package cannot import. So the classifier *is* a router: a
// short table of routes, each answering with what it matched, built and matched by the
// same library under the same config `apiRouter` runs under. Whatever the router accepts
// as `/api/…`, this calls `api`, by construction rather than by imitation.
//
// The same goes for the one path this file reads a parameter out of: which trak a
// hosted-process route is for, which the guard checks a turn's credential against.
//
// Shared because the decision is made more than once: the guard asks it to admit or
// refuse, and a fallback serving the client bundle at `/` has to ask it before answering
// `index.html` for a target the router would have routed under `/api/`.

import { Data, Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import type * as ServerRequest from "@effect/platform/HttpServerRequest"

/**
 * The four things a target can be, to the guard.
 *
 * `other` is everything the router would not route under `/api/` — the bundle, and any
 * target so malformed the router refuses to match it at all, which it then answers 404
 * whatever the guard does.
 */
export type Target = "health" | "session" | "api" | "other"

/** The handler's way of reporting a match: a router must answer a response, so it fails. */
class Matched extends Data.TaggedError("Matched")<{ readonly target: Target }> {}

const matched = (target: Target) => Effect.fail(new Matched({ target }))

/**
 * Most specific first is not needed — the radix tree ranks a static route above a
 * wildcard — but the order is the reading order, so it is written that way.
 *
 * **`/api` is listed as well as `/api/*`.** The wildcard needs a segment after the
 * slash, so a bare `/api` — and `/api/`, which the router strips to it — would fall to
 * `/*` and read as `other`: ungated to the guard, and the app to the bundle's fallback.
 * No route is registered there, but the classifier is the thing both of them ask, and it
 * costs one line to have it not depend on that staying true.
 */
const classifier = Router.empty.pipe(
  Router.all("/api/health", matched("health")),
  Router.all("/api/session", matched("session")),
  Router.all("/api", matched("api")),
  Router.all("/api/*", matched("api")),
  Router.all("/*", matched("other")),
)

/**
 * What the request's target is, as the router will see it.
 *
 * Built per request rather than once: `toHttpApp` reads the router config off the fiber,
 * and reading it here is what keeps this agreeing with `apiRouter` under whatever config
 * the request runs under. A router this small costs nothing to build.
 *
 * A target the router cannot match at all — a malformed percent-escape — is `other`: the
 * router answers it 404 on its own, and nothing under `/api/` was reachable by it.
 */
export const targetOf: Effect.Effect<Target, never, ServerRequest.HttpServerRequest> =
  classifier.pipe(
    Effect.map((): Target => "other"),
    Effect.catchTags({
      Matched: (e) => Effect.succeed(e.target),
      RouteNotFound: () => Effect.succeed<Target>("other"),
    }),
  )

/** The other answer a classifier gives: a path's trak, where it names one. */
class MatchedTrak extends Data.TaggedError("MatchedTrak")<{ readonly trak: string | undefined }> {}

const trakOfPath = Effect.flatMap(Router.params, (p) =>
  Effect.fail(new MatchedTrak({ trak: p["id"] })),
)

/**
 * The trak a request is for when its target is one of that trak's tool routes — the two
 * the shim forwards to, and the MCP endpoints and the GitHub token route a session in a
 * sandbox dials — as the router
 * extracts `:id`: the one credential scoped to a trak is checked against it. Nothing for
 * any other target.
 */
const trakToolRoutes = Router.empty.pipe(
  Router.all("/api/traks/:id/tools", trakOfPath),
  Router.all("/api/traks/:id/tools/*", trakOfPath),
  Router.all("/api/traks/:id/mcp", trakOfPath),
  Router.all("/api/traks/:id/mcp/*", trakOfPath),
  Router.all("/api/traks/:id/github", trakOfPath),
)

export const trakToolsOf: Effect.Effect<
  string | undefined,
  never,
  ServerRequest.HttpServerRequest
> = trakToolRoutes.pipe(
  Effect.map((): string | undefined => undefined),
  Effect.catchTags({
    MatchedTrak: (e) => Effect.succeed(e.trak),
    RouteNotFound: () => Effect.succeed(undefined),
  }),
)

/**
 * A goal's tool routes — the two the shim forwards to, and the MCP endpoint a goal
 * composer in the project's sandbox dials — which the credential its composer's server
 * holds is checked against.
 */
const goalToolRoutes = Router.empty.pipe(
  Router.all(
    "/api/goals/:id/tools",
    Effect.flatMap(Router.params, (p) => Effect.fail(new MatchedTrak({ trak: p["id"] }))),
  ),
  Router.all(
    "/api/goals/:id/tools/*",
    Effect.flatMap(Router.params, (p) => Effect.fail(new MatchedTrak({ trak: p["id"] }))),
  ),
  Router.all(
    "/api/goals/:id/mcp",
    Effect.flatMap(Router.params, (p) => Effect.fail(new MatchedTrak({ trak: p["id"] }))),
  ),
)

/** The goal a request is for when its target is one of that goal's tool routes. */
export const goalToolsOf: Effect.Effect<
  string | undefined,
  never,
  ServerRequest.HttpServerRequest
> = goalToolRoutes.pipe(
  Effect.map((): string | undefined => undefined),
  Effect.catchTags({
    MatchedTrak: (e) => Effect.succeed(e.trak),
    RouteNotFound: () => Effect.succeed(undefined),
  }),
)
