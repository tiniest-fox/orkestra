/**
 * The files attached to one chat box, each uploaded the moment it is added.
 *
 * **Uploading while the person is still typing is the point.** A message names its files
 * by the ids the upload answered with, so by the time the send is pressed the bytes are
 * already on the engine and the send is one small request. The send stays shut while any
 * upload is in flight — `uploading` — and a file the box refuses never starts one:
 * `format/attachments.ts` decides, before a byte moves.
 *
 * **Held per `scope`, as `useSendChat` holds a draft per trak.** The trak screen's bar
 * never unmounts while the reader steps between a parent and its pieces, and nothing on it
 * names the addressee, so a screenshot attached at one piece must not ride the next send at
 * another. A page with one addressee passes a constant.
 *
 * **Free.** Nothing here spends: an uploaded file waits in the engine's temporary folder
 * until a message that names it is sent, and the send is the caller's acting hook.
 */

import { useEffect, useRef, useState } from "react"
import { RefusedError } from "../api/http"
import { uploadAttachment } from "../api/attachments"
import { type AttachKind, type Refusal, take } from "../format/attachments"
import { refusalSaid } from "../format/refusal"

/** One file in the box: uploading while `progress` is a number, uploaded once `id` is. */
export interface Attaching {
  readonly key: string
  readonly name: string
  readonly kind: AttachKind
  readonly size: number
  /** 0–1 while uploading; `undefined` once the engine has it. */
  readonly progress: number | undefined
  readonly id: string | undefined
  /** An object URL for an image's tile, revoked when the tile goes. */
  readonly preview: string | undefined
}

export interface Attachments {
  readonly files: readonly Attaching[]
  /** The sentence for what the box last refused, or `undefined`. */
  readonly refusal: Refusal | undefined
  readonly add: (files: readonly File[]) => void
  readonly remove: (key: string) => void
  /** Every uploaded file's id, in the order they were added. */
  readonly ids: readonly string[]
  readonly uploading: boolean
  /** Empty this scope's box, once its message has been taken. */
  readonly clear: () => void
}

interface Held {
  readonly files: readonly Attaching[]
  readonly refusal: Refusal | undefined
}

const EMPTY: Held = { files: [], refusal: undefined }

const failed = (name: string, error: unknown): Refusal => ({
  name,
  line:
    error instanceof RefusedError
      ? `was refused. ${refusalSaid(error.refusal)}`
      : "could not be uploaded. Add it again to retry.",
})

const forget = (file: Attaching): void => {
  if (file.preview !== undefined) URL.revokeObjectURL(file.preview)
}

export const useAttachments = (scope: string): Attachments => {
  const [held, setHeld] = useState<Readonly<Record<string, Held>>>({})
  const next = useRef(0)
  const uploads = useRef(new Map<string, AbortController>())
  // What the unmount below has to let go of: every preview, and every upload in flight.
  const latest = useRef(held)
  latest.current = held

  useEffect(
    () => () => {
      for (const upload of uploads.current.values()) upload.abort()
      for (const box of Object.values(latest.current)) box.files.forEach(forget)
    },
    [],
  )

  const here = held[scope] ?? EMPTY
  const edit = (at: string, change: (box: Held) => Held): void => {
    setHeld((all) => ({ ...all, [at]: change(all[at] ?? EMPTY) }))
  }
  const patch = (at: string, key: string, change: Partial<Attaching>): void => {
    edit(at, (box) => ({
      ...box,
      files: box.files.map((f) => (f.key === key ? { ...f, ...change } : f)),
    }))
  }
  const drop = (at: string, key: string, refusal?: Refusal): void => {
    uploads.current.get(key)?.abort()
    uploads.current.delete(key)
    edit(at, (box) => {
      box.files.filter((f) => f.key === key).forEach(forget)
      return {
        files: box.files.filter((f) => f.key !== key),
        refusal: refusal ?? box.refusal,
      }
    })
  }

  const upload = (at: string, key: string, file: File, type: string): void => {
    const control = new AbortController()
    uploads.current.set(key, control)
    uploadAttachment(file, file.name, type, (p) => patch(at, key, { progress: p }), control.signal)
      .then((done) => {
        uploads.current.delete(key)
        patch(at, key, { progress: undefined, id: done.id })
        return undefined
      })
      .catch((error: unknown) => {
        // A removed tile aborts its own upload, and there is nothing left to tell.
        if (control.signal.aborted) return
        drop(at, key, failed(file.name, error))
      })
  }

  const add = (files: readonly File[]): void => {
    const { admitted, refusal } = take(files, here.files.length)
    const at = scope
    const adding = admitted.flatMap(({ index, kind, type }) => {
      const file = files[index]
      if (file === undefined) return []
      next.current += 1
      const key = `a${String(next.current)}`
      return [
        {
          attaching: {
            key,
            name: file.name,
            kind,
            size: file.size,
            progress: 0,
            id: undefined,
            preview: kind === "image" ? URL.createObjectURL(file) : undefined,
          },
          file,
          type,
        },
      ]
    })
    // A new batch replaces the last sentence, whether or not it earns one of its own.
    edit(at, (box) => ({ files: [...box.files, ...adding.map((a) => a.attaching)], refusal }))
    for (const a of adding) upload(at, a.attaching.key, a.file, a.type)
  }

  return {
    files: here.files,
    refusal: here.refusal,
    add,
    remove: (key) => drop(scope, key),
    ids: here.files.flatMap((f) => (f.id === undefined ? [] : [f.id])),
    uploading: here.files.some((f) => f.id === undefined),
    clear: () => {
      edit(scope, (box) => {
        box.files.forEach(forget)
        return EMPTY
      })
    },
  }
}
