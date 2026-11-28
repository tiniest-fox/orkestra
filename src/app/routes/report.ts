// A problem report about one trak: the preview, and the send through the host's
// destination. Answers with `@orkestra/shared/dto/report`. Spends nothing — no agent runs,
// nothing is appended, and the engine keeps no record of a sent report.

import { Effect } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import {
  ReportNotSentDto,
  type ReportSendAnswerDto,
  ReportSendRequestDto,
  ReportSentDto,
} from "@orkestra/shared/dto/report"
import type { TrakId } from "../../workflow/domain/trak.js"
import { Store } from "../../workflow/ports/store.js"
import { reportFor } from "../report.js"
import { Reports } from "../reports.js"
import { pathId } from "./common.js"

/**
 * Whether a report about `id` may be made: a 404 where the host has no destination, as for
 * a route that does not exist, and where the trak does not.
 */
const reportable = (id: TrakId) =>
  Effect.gen(function* () {
    if ((yield* (yield* Reports).destination) === undefined) return false
    const events = yield* (yield* Store)
      .events(id)
      .pipe(Effect.catchTag("StoreUndecodable", () => Effect.succeed(undefined)))
    return events === undefined || events.length > 0
  })

/** What would be sent now, with the log and no note. 404 where nothing may be reported. */
const previewRoute = Router.get(
  "/api/traks/:id/report",
  Effect.gen(function* () {
    const id = yield* pathId
    if (!(yield* reportable(id))) return ServerResponse.empty({ status: 404 })
    return yield* ServerResponse.json(yield* reportFor(id, { note: undefined, includeLog: true }))
  }),
)

/**
 * Body `ReportSendRequestDto` → the report rebuilt from the log as it is now, handed to the
 * host, and the host's answer. 404 where nothing may be reported.
 */
const sendRoute = Router.post(
  "/api/traks/:id/report",
  Effect.gen(function* () {
    const id = yield* pathId
    const request = yield* ServerRequest.schemaBodyJson(ReportSendRequestDto)
    if (!(yield* reportable(id))) return ServerResponse.empty({ status: 404 })
    const report = yield* reportFor(id, { note: request.note, includeLog: request.includeLog })
    const sent = yield* (yield* Reports).send(report)
    const answer: ReportSendAnswerDto =
      "reference" in sent
        ? ReportSentDto.make({ reference: sent.reference })
        : ReportNotSentDto.make({ reason: sent.reason })
    return yield* ServerResponse.json(answer)
  }),
)

export const reportRoutes = Router.empty.pipe(previewRoute, sendRoute)
