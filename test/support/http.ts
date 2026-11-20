// The router, driven as an Effect with a request provided — the way every flow that
// presses a route puts one through. Shared by the surface's own theme and by any theme
// whose subject is what a press does to the engine.
//
// **A test mounts only the route groups it presses**, through `mount`. A test file that
// imports a group is one `verify-light` selects when that group changes, so a helper that
// mounted every group made every test using it run on an edit to any route. A test whose
// subject spans the API passes the whole of it to `serving` — `serving(apiRouter())`.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { clientRoute } from "../../src/app/client-bundle.js"
import { trakGate } from "../../src/app/routes/common.js"
import { withProjectFiles } from "../../src/workflow/ports/project-files.js"

type Group = Router.HttpRouter<unknown, unknown>
type ErrorOf<G> = G extends Router.HttpRouter<infer E, infer _R> ? E : never
type ContextOf<G> = G extends Router.HttpRouter<infer _E, infer R> ? R : never

/** Requests put through `router`, and the router itself for a test that drives it whole. */
export const serving = <E, R>(router: Router.HttpRouter<E, R>) => {
  /**
   * Put one request through the router.
   *
   * `orDie` on the error channel is deliberate: the errors it can carry here are a
   * method nothing routes and a body that does not parse, and both would be bugs in
   * the test rather than outcomes to assert on. Every status a test checks comes
   * back as a response, not as a failure — a GET to a path nothing names included,
   * since the client wildcard answers that one itself.
   */
  const call = (request: Request) =>
    Router.toHttpApp(router).pipe(
      Effect.flatMap((app) =>
        Effect.provideService(app, ServerRequest.HttpServerRequest, ServerRequest.fromWeb(request)),
      ),
      Effect.scoped,
      Effect.orDie,
    )

  const post = (id: string, path: string, body: unknown) =>
    call(
      new Request(`http://localhost/api/traks/${id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )

  const get = (path: string) => call(new Request(`http://localhost/api/traks${path}`))

  return { router, call, post, get }
}

/**
 * The named route groups, assembled as `apiRouter` in `src/app/server.ts` assembles every
 * group: the client wildcard last, which answers a GET no group names with 404, and each
 * request run against the project files held now. A change to how `apiRouter` wraps its
 * groups belongs here too, or a test mounted this way stops seeing what the engine serves.
 */
export const mount = <const G extends ReadonlyArray<Group>>(...groups: G) => {
  const router = groups
    .reduce<Group>((all, group) => all.pipe(Router.concat(group)), Router.empty)
    .pipe(Router.concat(Router.empty.pipe(clientRoute())))
    .pipe(Router.use(trakGate))
    .pipe(Router.use((app) => withProjectFiles(app)))
  // The fold forgets which groups it joined; this restores the union of their errors and
  // requirements, which is what `Router.concat` written out by hand would have inferred.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- see above
  return serving(router as Router.HttpRouter<ErrorOf<G[number]>, ContextOf<G[number]>>)
}
