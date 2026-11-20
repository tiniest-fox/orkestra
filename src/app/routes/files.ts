// The project checkout's files — the browser's tree, one file, a text search — and the
// search of put-away traks. Answers with `@orkestra/shared/dto/files`.

import { Effect } from "effect"
import * as Headers from "@effect/platform/Headers"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { Archive } from "../../workflow/ports/archive.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import {
  toArchivedTrakListDto,
  toFileContentDto,
  toFileSearchDto,
  toProjectFilesDto,
} from "../dto.js"
import { projectFile } from "../project-tree.js"
import { levelsHere } from "../people.js"

/** The most matching lines one search answers; the palette shows them grouped by file. */
const SEARCH_CAP = 200

/** The most put-away traks one search answers. */
const ARCHIVED_CAP = 50

/** One query parameter as one string, or `undefined` for none or for several. */
const searchParam = (name: string) =>
  Effect.map(ServerRequest.ParsedSearchParams, (params) => {
    const value = params[name]
    return typeof value === "string" ? value : undefined
  })

/**
 * The file browser's tree: every file git sees in the project checkout, on disk now.
 * Free, two `git` processes, and like the git bar it reads the checkout no trak owns, so
 * no custody is asked for.
 */
const filesRoute = Router.get(
  "/api/files",
  Effect.flatMap(Vcs, (vcs) =>
    Effect.flatMap(vcs.projectFiles(), (files) => ServerResponse.json(toProjectFilesDto(files))),
  ),
)

/**
 * One file the tree names. **404 for every path the tree does not name**, which is the
 * whole of the guard — `project-tree.ts` says why membership rather than a normalised path.
 * A binary file and one over the cap answer their size and no content.
 */
const fileContentRoute = Router.get(
  "/api/files/content",
  Effect.gen(function* () {
    const requested = yield* searchParam("path")
    if (requested === undefined) return ServerResponse.empty({ status: 400 })
    const file = yield* projectFile(yield* (yield* Vcs).projectFiles(), requested)
    if (file === undefined) return ServerResponse.empty({ status: 404 })
    return yield* ServerResponse.json(toFileContentDto(file), {
      headers: Headers.fromInput({ "cache-control": "no-store" }),
    })
  }),
)

/**
 * The lines of the tree's files holding `q`, as a fixed string and ignoring case. An empty
 * `q` is an answer with nothing in it rather than a search of every line.
 */
const fileSearchRoute = Router.get(
  "/api/files/search",
  Effect.gen(function* () {
    const q = yield* searchParam("q")
    if (q === undefined) return ServerResponse.empty({ status: 400 })
    if (q.trim() === "")
      return yield* ServerResponse.json(toFileSearchDto({ matches: [], cut: false }))
    return yield* ServerResponse.json(
      toFileSearchDto(yield* (yield* Vcs).grepProject(q, SEARCH_CAP)),
    )
  }),
)

/**
 * The put-away traks the viewer sees whose title or id holds `q`, out of the set the
 * `Archive` keeps — no log is opened, which is what the set is for: who sees each is the
 * audience index's. An empty `q` matches none.
 */
const archivedRoute = Router.get(
  "/api/traks/archived",
  Effect.gen(function* () {
    const q = yield* searchParam("q")
    if (q === undefined) return ServerResponse.empty({ status: 400 })
    if (q.trim() === "") return yield* ServerResponse.json(toArchivedTrakListDto([]))
    const levelOf = yield* levelsHere
    // Every match, then the cap: a cap taken first would fill with traks nobody here sees.
    const all = yield* (yield* Archive).matching(q, Number.POSITIVE_INFINITY)
    const seen = yield* Effect.filter(all, (t) =>
      Effect.map(levelOf({ trak: t.id }), (level) => level !== undefined),
    )
    return yield* ServerResponse.json(toArchivedTrakListDto(seen.slice(0, ARCHIVED_CAP)))
  }),
)

/** The file browser's three reads, and the search's one of the archive. */
export const fileRoutes = Router.empty.pipe(
  filesRoute,
  fileContentRoute,
  fileSearchRoute,
  archivedRoute,
)
