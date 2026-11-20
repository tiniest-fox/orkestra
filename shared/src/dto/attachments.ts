// Attachments: a file a person sends with a message, its upload, and the limits both ends
// check. Part of the wire contract; `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// Attachments — a file sent with a chat, a new trak or a new goal
// ============================================================================

const MB = 1024 * 1024

const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

/**
 * The most bytes a file of `type` may hold, or `undefined` for a type that may not be
 * attached at all — this is the allowlist. Images are PNG, JPEG, GIF and WebP up to 5 MB,
 * the limit Claude takes inline, so an image never changes route because of its size. PDFs
 * go to 20 MB, and text files — every `text/` type, and JSON — to 1 MB.
 *
 * **SVG is the omission worth naming.** An SVG is a document that can carry script, and
 * the engine and the surface share an origin, so it is refused rather than sanitized. Any
 * other binary file but a PDF is refused because the agent cannot read it.
 */
export const attachmentLimit = (type: string): number | undefined => {
  if (IMAGE_TYPES.has(type)) return 5 * MB
  if (type === "application/pdf") return 20 * MB
  if (type.startsWith("text/") || type === "application/json") return MB
  return undefined
}

/** The most files one message may carry. */
export const MAX_ATTACHMENTS = 10

/** Whether a file of this type reaches Claude inline and Codex as a local image. */
export const isImageType = (type: string): boolean => IMAGE_TYPES.has(type)

const kindOf = (type: string): string =>
  isImageType(type) ? "an image" : type === "application/pdf" ? "a PDF" : "a text file"

/**
 * Why a file of `type` and `size` may not be sent, naming the limit — or `undefined` where
 * it may. `count` is how many the message already carries, this one not among them. The
 * one rule both ends ask: the chat bar before it uploads, the upload route after.
 */
export const attachmentRefusal = (
  type: string,
  size: number,
  count: number,
): string | undefined => {
  const limit = attachmentLimit(type)
  if (limit === undefined) {
    return "only PNG, JPEG, GIF and WebP images, PDFs and text files can be attached"
  }
  if (size > limit) return `${kindOf(type)} can be at most ${limit / MB} MB`
  if (count >= MAX_ATTACHMENTS) return `a message can carry at most ${MAX_ATTACHMENTS} files`
  return undefined
}

/**
 * `POST /api/attachments`: the file was taken, and waits under `id` until a message names
 * it. The body is the file's bytes; its name and type travel as the `name` query parameter
 * and the `content-type` header. A refusal is `AttachmentRefusedDto`, in `common.ts` with
 * every other refusal body.
 */
export const AttachmentUploadedDto = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  size: Schema.Number,
})
export type AttachmentUploadedDto = Schema.Schema.Type<typeof AttachmentUploadedDto>

/**
 * A file a sent message carried, as the log records it: never its bytes. `path` is where
 * it lies in the checkout the turn ran in, relative to that checkout's root —
 * `.orkestra/.attachments/<first 8 characters of the upload id>-<name>`. A trak's image is
 * drawn through `/api/traks/:id/image?path=`, and nothing serves it once that checkout is
 * gone.
 */
export const AttachmentDto = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  size: Schema.Number,
  path: Schema.String,
})
export type AttachmentDto = Schema.Schema.Type<typeof AttachmentDto>

/** The optional list of upload ids each of the four message requests takes. */
export const AttachmentIdsDto = Schema.optional(Schema.Array(Schema.String))
