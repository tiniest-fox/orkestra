// The built client, served by the engine so one origin and one port carry both halves.
//
// `pnpm ui` keeps Vite's dev server in front of the client; this is for everything that
// is not a developer's own browser — a phone opening the engine's port, a tunnel in front
// of it. The client calls a same-origin `/api/...` either way, which is what lets it need
// no base-URL branch: served from here, the API is the same origin by construction.
//
// Here rather than in `workflow/` for `images.ts`'s reason: it drives nothing, takes no
// custody and touches no trak's state. It reads files out of `client/dist` and says what
// they are.
//
// **The bundle is a build artefact nothing here makes.** An engine serving a month-old
// `client/dist` looks exactly like one serving current code, while the developer's own
// `pnpm ui` shows the new code — so the two disagree and only the phone is wrong. The
// boot report below is the answer: `pnpm serve` prints when the bundle was built and names
// a source that is newer, and a missing bundle is a 503 that says how to build it rather
// than a 404 that says nothing is here.

import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { Data, Effect, Schema } from "effect"
import * as Headers from "@effect/platform/Headers"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { absent, fileInside } from "./images.js"
import { CLIENT_DIST, PACKAGE_ROOT } from "./packaged.js"
import { targetOf } from "./target.js"

/**
 * What the bundle is built from, relative to the checkout. A file newer than it is news.
 * None of these exist beside a `pnpm build` output, so a bundled engine reports its
 * client as built and never as stale — the copy it serves is the one the build took.
 */
const SOURCES = [
  "client/src",
  "client/public",
  "client/index.html",
  "client/launcher.html",
  "shared/src",
]

export const BUILD_COMMAND = "pnpm --filter @orkestra/client build"

/**
 * Extension → what to send it as. Unlike the image route's map this is not an allowlist:
 * the bundle is this repository's own build output rather than a model's text, so a
 * file in it with an extension not named here is served as bytes, not refused.
 */
const TYPES: ReadonlyMap<string, string> = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json"],
  // Chromium refuses to install from a manifest served as octet-stream.
  [".webmanifest", "application/manifest+json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
])

const typeOf = (path: string): string => {
  const dot = path.lastIndexOf(".")
  return (
    (dot === -1 ? undefined : TYPES.get(path.slice(dot).toLowerCase())) ??
    "application/octet-stream"
  )
}

/**
 * Vite content-hashes everything under `assets/`, so a URL there names one set of bytes
 * for ever and may be cached as long as the browser likes. Everything else — `index.html`
 * above all — is the thing a rebuild changes under the same name.
 */
const cacheControl = (requested: string): string =>
  requested.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache"

/** A file out of the bundle, or `undefined` where the path names none. */
const read = (root: string, requested: string): Effect.Effect<Uint8Array | undefined, Error> =>
  Effect.tryPromise({
    try: async () => {
      const file = await fileInside(root, requested)
      return file === undefined ? undefined : await readFile(file)
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(Effect.catchIf(absent, () => Effect.succeed(undefined)))

const serve = (bytes: Uint8Array, requested: string): ServerResponse.HttpServerResponse =>
  ServerResponse.uint8Array(bytes, {
    contentType: typeOf(requested),
    headers: Headers.fromInput({
      "x-content-type-options": "nosniff",
      "cache-control": cacheControl(requested),
    }),
  })

/** The path part of the request, decoded, without its leading slash. */
const requestedPath = (url: string): string | undefined => {
  const { pathname } = new URL(url, "http://localhost")
  try {
    return decodeURIComponent(pathname).slice(1)
  } catch {
    return undefined
  }
}

/**
 * The catch-all: a file that is in the bundle, else the app for any path the router
 * would not have routed under `/api/`.
 *
 * **`/api/*` is never the app.** The wildcard is reached for an API path that no route
 * matches, and answering `index.html` there would turn a genuine `/api/traks/bad-id` 404
 * into a 200 of HTML the client's decoder fails on with an error naming nothing useful.
 *
 * **Which it is, is `targetOf`'s to say and not a string test here.** A handler inside
 * the router sees the raw `request.url`, so `startsWith("api/")` misses every spelling
 * the router accepts and this one does not — `//api/nope` above all, which the URL
 * parser reads as the host `api` and the path `/nope`. `targetOf` runs the target
 * through a router built by the same library under the same config, so whatever
 * `apiRouter` would have routed under `/api/`, this refuses to answer the app for. The
 * guard in front asks the same question of the same function.
 *
 * A bundle that is not built is a 503 saying so, because a 404 at `/` reads as *nothing
 * is here* and the boot report that explains it has scrolled away by then.
 */
export const clientRoute = (root: string = CLIENT_DIST) =>
  Router.get(
    "*",
    Effect.gen(function* () {
      const request = yield* ServerRequest.HttpServerRequest
      if ((yield* targetOf) !== "other") return ServerResponse.empty({ status: 404 })
      const requested = requestedPath(request.url)
      if (requested === undefined) return ServerResponse.empty({ status: 404 })
      if (requested.includes("\0")) return ServerResponse.empty({ status: 404 })
      const file = requested === "" ? undefined : yield* read(root, requested)
      if (file !== undefined) return serve(file, requested)
      const index = yield* read(root, "index.html")
      if (index !== undefined) return serve(index, "index.html")
      return ServerResponse.text(
        `The client is not built, so the engine has nothing to serve here. Run \`${BUILD_COMMAND}\` and reload.`,
        { status: 503 },
      )
    }),
  )

/** What `client/vite.config.ts` writes beside the bundle, last of every file in it. */
const BuildFile = Schema.parseJson(Schema.Struct({ id: Schema.String }))

/**
 * The build id of the bundle `/` serves now, for `/api/health` — or `undefined` where the
 * bundle has none: not built, built before the id existed, or mid-rebuild.
 *
 * **Read per call, never at boot.** A rebuild under a running engine is the whole case:
 * `/` already serves the new files on the next request, and an id read once would go on
 * naming the old ones. **Any failure is `undefined`**, because the page reads a missing id
 * as *could not tell* and shows nothing — an unreadable file must not look like news.
 * Plain rather than an `Effect` for `answeringFor`'s reason: not answering is the answer.
 */
export const bundleId = async (root: string = CLIENT_DIST): Promise<string | undefined> => {
  try {
    const decoded = Schema.decodeUnknownEither(BuildFile)(
      await readFile(join(root, "build.json"), "utf8"),
    )
    return decoded._tag === "Right" ? decoded.right.id : undefined
  } catch {
    return undefined
  }
}

/**
 * What `pnpm serve` says about the bundle at boot.
 *
 * Missing and stale are each one line, because silence is the failure this guards
 * against: a bundle older than a source it was built from serves yesterday's UI with no
 * sign anywhere that it is not today's.
 */
export type BundleState = Data.TaggedEnum<{
  Missing: {}
  Built: { readonly builtAt: Date; readonly newer: string | undefined }
}>
export const BundleState = Data.taggedEnum<BundleState>()

interface Stamp {
  readonly path: string
  readonly at: number
}

const newest = (stamps: readonly (Stamp | undefined)[]): Stamp | undefined =>
  stamps.reduce<Stamp | undefined>(
    (best, stamp) =>
      stamp !== undefined && (best === undefined || stamp.at > best.at) ? stamp : best,
    undefined,
  )

/** The newest file at or under `path`, or `undefined` where there is nothing there. */
const newestUnder = async (path: string): Promise<Stamp | undefined> => {
  const info = await stat(path).catch(() => undefined)
  if (info === undefined) return undefined
  if (info.isFile()) return { path, at: info.mtimeMs }
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
  return newest(
    await Promise.all(files.map(async (file) => ({ path: file, at: (await stat(file)).mtimeMs }))),
  )
}

export const bundleState = (
  root: string = CLIENT_DIST,
  checkout: string = PACKAGE_ROOT,
): Effect.Effect<BundleState, Error> =>
  Effect.tryPromise({
    try: async (): Promise<BundleState> => {
      const index = await stat(join(root, "index.html")).catch(() => undefined)
      if (index === undefined) return BundleState.Missing()
      const sources = await Promise.all(
        SOURCES.map((source) => newestUnder(join(checkout, source))),
      )
      const latest = newest(sources)
      return BundleState.Built({
        builtAt: index.mtime,
        newer: latest !== undefined && latest.at > index.mtimeMs ? latest.path : undefined,
      })
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

/** The boot line, one per state, naming the bundle by its path in the checkout. */
export const bundleReport = (state: BundleState, root: string = CLIENT_DIST): string => {
  const at = relative(PACKAGE_ROOT, root)
  return BundleState.$match(state, {
    Missing: () =>
      `client: ${at} is not built — \`/\` answers 503 until \`${BUILD_COMMAND}\` has run`,
    Built: ({ builtAt, newer: newerSource }) =>
      newerSource === undefined
        ? `client: serving ${at}, built ${builtAt.toISOString()}`
        : `client: serving ${at} built ${builtAt.toISOString()}, but ${newerSource} is newer — rebuild with \`${BUILD_COMMAND}\``,
  })
}
