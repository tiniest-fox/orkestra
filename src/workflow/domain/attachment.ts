// A file a person sent with a message: what the log records of it, and never its bytes.

import { Schema } from "effect"

/**
 * One file sent with a chat, a new trak or a new goal. `path` is where it lies in the
 * checkout the turn runs in, relative to that checkout's root — under `ATTACHMENTS_DIR`.
 * The checkout holds the only copy, so once it is gone the name is all that is left.
 *
 * `type` passed the upload route's allowlist, which is why `isImage` may read the prefix.
 */
export const Attachment = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  size: Schema.Number,
  path: Schema.String,
})
export type Attachment = Schema.Schema.Type<typeof Attachment>

/**
 * The field every event that carries a message gains. Optional, so a log written before
 * it replays with none; the constructors leave the key off rather than write an empty list.
 */
export const Attached = Schema.optional(Schema.Array(Attachment))

/** Where the files go in a checkout, kept out of commits by the repository's `info/exclude`. */
export const ATTACHMENTS_DIR = ".orkestra/.attachments"

/** Whether the agent is also handed this file as a picture: Claude inline, Codex by path. */
export const isImage = (a: Attachment): boolean => a.type.startsWith("image/")

/** `{ attachments }` where there are any, and nothing where there are none. */
export const attachedField = (
  attachments: readonly Attachment[] | undefined,
): { readonly attachments?: readonly Attachment[] } =>
  attachments === undefined || attachments.length === 0 ? {} : { attachments }

/** The view the `attached` partial reads: each file's path and type, oldest first. */
export const attachedView = (
  attachments: readonly Attachment[],
): { readonly attached: readonly { readonly path: string; readonly type: string }[] } => ({
  attached: attachments.map((a) => ({ path: a.path, type: a.type })),
})
