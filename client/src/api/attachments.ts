/**
 * The `attachments` slice's route: one file's bytes, uploaded as it is added to a chat box,
 * and the slice's limits, re-exported so the chat box refuses what the route would.
 */

import {
  AttachmentUploadedDto,
  MAX_ATTACHMENTS,
  attachmentLimit,
  isImageType,
} from "@orkestra/shared/dto/attachments"
import { Schema } from "effect"
import { ApiError, body, url } from "./http"

export { MAX_ATTACHMENTS, attachmentLimit, isImageType }

const decodeUploaded = Schema.decodeUnknownSync(AttachmentUploadedDto)
/**
 * The `attachments` field a request carries, or nothing: a message with no files sends
 * the body it sent before attachments existed.
 */
export const withAttachments = (
  ids: readonly string[],
): { readonly attachments?: readonly string[] } => (ids.length === 0 ? {} : { attachments: ids })

const PATH = "/api/attachments"

/**
 * `POST /api/attachments`. Free: the file waits in the engine's temporary folder until a
 * message names it, and spends nothing until then.
 *
 * **The body is the file's bytes, and its name rides the query** — `type` is the
 * `content-type`, which the caller passes because a browser reports no type for a `.log`.
 * `XMLHttpRequest` rather than `fetch` for one reason: `fetch` reports no upload progress,
 * and the tile's bar is that progress.
 *
 * A refusal the engine explains arrives as `RefusedError` through `body`, as on every
 * other route; one it does not, as `ApiError`. `signal` aborts the upload when the tile is
 * removed, and the promise then rejects with the signal's reason.
 */
export const uploadAttachment = (
  file: Blob,
  name: string,
  type: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<AttachmentUploadedDto> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url(`${PATH}?name=${encodeURIComponent(name)}`))
    xhr.setRequestHeader("content-type", type)
    xhr.responseType = "text"
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener("load", () => {
      // Through `body`, so a refusal is read exactly as every `fetch` route reads one.
      const response = new Response(xhr.status === 204 ? null : xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
      })
      body(response, PATH).then((parsed) => resolve(decodeUploaded(parsed)), reject)
    })
    xhr.addEventListener("error", () => reject(new ApiError(0, "network error", PATH)))
    signal.addEventListener("abort", () => {
      xhr.abort()
      reject(signal.reason)
    })
    xhr.send(file)
  })
