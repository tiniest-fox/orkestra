// A file a person attaches, taken before the message that names it is sent. Answers with
// `@orkestra/shared/dto/attachments`.

import { Effect, Stream } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import { attachmentLimit, attachmentRefusal } from "@orkestra/shared/dto/attachments"
import { AttachmentRefusedDto } from "@orkestra/shared/dto/common"
import { receiveUpload } from "../attachments.js"
import { refuse } from "./common.js"

/**
 * The refusal a file of `type` and `size` is answered with — `415` for a type off the
 * allowlist, `413` for a size over its limit — or `undefined` where it may be taken.
 */
const refusedAs = (type: string, size: number) => {
  const reason = attachmentRefusal(type, size, 0)
  return reason === undefined
    ? undefined
    : refuse(attachmentLimit(type) === undefined ? 415 : 413, AttachmentRefusedDto.make({ reason }))
}

/**
 * The request's body, or `undefined` once it passes `limit` bytes — read no further than
 * the chunk that passed it, so a `content-length` that lies, or none, cannot have a body
 * of any size held in memory before it is refused.
 */
const boundedBody = (request: ServerRequest.HttpServerRequest, limit: number) =>
  Effect.map(
    Stream.runFoldWhile(
      request.stream,
      { size: 0, chunks: new Array<Uint8Array>() },
      (read) => read.size <= limit,
      (read, chunk) => {
        read.chunks.push(chunk)
        return { size: read.size + chunk.length, chunks: read.chunks }
      },
    ),
    (read) => {
      if (read.size > limit) return undefined
      const body = new Uint8Array(read.size)
      let at = 0
      for (const chunk of read.chunks) {
        body.set(chunk, at)
        at += chunk.length
      }
      return body
    },
  )

/**
 * Take one file into the OS temporary folder and answer the id a message names it by. The
 * body is the file's bytes, its type the `content-type` header and its name the `name`
 * query parameter. **The same limits the chat bar checks**, asked again here because a
 * request need not come from the chat bar: `415` for a type off the allowlist, `413` for a
 * file over its limit. Spends nothing, and names no trak: an upload belongs to nothing
 * until a message carries it.
 */
const uploadRoute = Router.post(
  "/api/attachments",
  Effect.gen(function* () {
    const request = yield* ServerRequest.HttpServerRequest
    const params = yield* ServerRequest.ParsedSearchParams
    const name = typeof params["name"] === "string" ? params["name"] : "file"
    const type = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
    // Refused before a byte is read: a type off the allowlist, and a body whose
    // `content-length` says it is over its limit.
    const declared = Number(request.headers["content-length"] ?? Number.NaN)
    const early = refusedAs(type, Number.isFinite(declared) ? declared : 0)
    if (early !== undefined) return yield* early
    const limit = attachmentLimit(type) ?? 0
    const bytes = yield* boundedBody(request, limit)
    // A body that passed its limit with no `content-length` saying so, or a false one.
    const over = refusedAs(type, limit + 1)
    if (bytes === undefined && over !== undefined) return yield* over
    const taken = yield* receiveUpload(name, type, bytes ?? new Uint8Array())
    if ("refused" in taken) {
      return yield* refuse(taken.status, AttachmentRefusedDto.make({ reason: taken.refused }))
    }
    return yield* ServerResponse.json(taken, { status: 201 })
  }),
)

export const attachmentRoutes = Router.empty.pipe(uploadRoute)
