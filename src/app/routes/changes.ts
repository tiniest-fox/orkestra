// What a trak's work did to the files. Answers with `@orkestra/shared/dto/changes`.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import { replayHistory } from "../../workflow/domain/replay.js"
import { Store } from "../../workflow/ports/store.js"
import { Vcs } from "../../vcs/ports/vcs.js"
import { rangeFor, requestedAt } from "../changes.js"
import { toChangesDto } from "../dto.js"
import { pathId, reasonPhrase } from "./common.js"

/**
 * What the work did to the files, for one slice of it.
 *
 * **Free, and a `git` process or three per call** — which is why the slice is
 * named rather than implied. A committed slice never moves, so a caller fetches
 * it once; only the uncommitted one is worth asking twice.
 *
 * **Nothing to read is 200 with no files, and only a malformed `at` is a 400.**
 * A step that changed nothing, a trak that never got a checkout, an uncommitted
 * slice of a checkout that has been removed, a step of an archived trak whose
 * commits git has pruned — each is a fact about the work, and answering an error
 * would make an empty state look like a broken one. The last is `Vcs` asking git
 * for the objects before diffing them, never a failure caught on the way past. What the
 * 400 is for is a value this route does not accept at all, which its own UI
 * cannot produce.
 *
 * `path` asks for one file of the slice with its hunks — how a file `.gitattributes` marks
 * `linguist-generated`, which the slice sends collapsed, is opened.
 */
const changesRoute = Router.get(
  "/api/traks/:id/changes",
  Effect.gen(function* () {
    const id = yield* pathId
    const params = yield* ServerRequest.ParsedSearchParams
    const asked = params["at"]
    const at = requestedAt(typeof asked === "string" ? asked : undefined)
    if (at === undefined) {
      return ServerResponse.empty({
        status: 400,
        statusText: "at must be all, uncommitted or a step",
      })
    }

    const store = yield* Store
    const events = yield* store.events(id)
    if (events.length === 0) return ServerResponse.empty({ status: 404 })

    const range = rangeFor(replayHistory(id, events), events, at)
    const path = params["path"]
    const only = typeof path === "string" ? path : undefined
    const changes = range === undefined ? { files: [] } : yield* (yield* Vcs).changes(range, only)
    return yield* ServerResponse.json(toChangesDto(at, changes))
  }).pipe(
    Effect.catchTag("StoreUndecodable", (e) =>
      Effect.succeed(ServerResponse.empty({ status: 422, statusText: reasonPhrase(e.reason) })),
    ),
  ),
)

export const changeRoutes = Router.empty.pipe(changesRoute)
