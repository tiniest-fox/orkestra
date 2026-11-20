/**
 * Which files a chat box takes, and the sentence for one it refuses.
 *
 * **The client refuses before it uploads, and the engine refuses again.** The limits are
 * the engine's to enforce — its upload route checks the same list when a client is
 * bypassed — and they are repeated here so a person is told while the file is still in
 * their hand, rather than after a 20 MB upload comes back refused. A refusal names the
 * file and the limit it broke, because *could not attach* tells nobody what to do instead.
 *
 * **The allowlist and the limits are the engine's**, from `@orkestra/shared/dto/attachments`
 * through `api/attachments.ts`; only the sentences are this file's. A megabyte is
 * 1024 × 1024 bytes there, as `sizeOf` reads one, so a file the tile calls 5.0 MB is never
 * refused for being over 5 MB.
 */

import { FileText, FileType, ImageIcon } from "lucide-react"
import { MAX_ATTACHMENTS, attachmentLimit, isImageType } from "../api/attachments"
import { sizeOf } from "./size"

export type AttachKind = "image" | "pdf" | "text"

const MB = 1024 * 1024

const PLURAL: Readonly<Record<AttachKind, string>> = {
  image: "Images",
  pdf: "PDFs",
  text: "Text files",
}

const ALLOWED = "Attach PNG, JPEG, GIF or WebP images, PDFs or text files."

/**
 * Text told by its name rather than its type, sent as `text/plain`: a `.log` or a `.md`
 * arrives with `type: ""`, a `.yaml` or a `.sh` as an `application/` type the engine does
 * not list, and a `.ts` as `video/mp2t`.
 */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "ndjson",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "xml",
  "html",
  "css",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "sh",
  "sql",
  "diff",
  "patch",
])

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

/** A sentence about one file, with the file's name apart so a view can set it off. */
export interface Refusal {
  readonly name: string
  readonly line: string
}

/** What the box makes of one file: the kind it is and the type it uploads as, or why not. */
export type Admission =
  | { readonly _tag: "Admitted"; readonly kind: AttachKind; readonly type: string }
  | { readonly _tag: "Refused"; readonly refusal: Refusal }

/** One file as the browser describes it — `File`'s three fields, so a test needs no `File`. */
export interface Offered {
  readonly name: string
  readonly type: string
  readonly size: number
}

/** The kind a file is, read off its type — one the engine takes, or one it recorded. */
export const kindOf = (type: string): AttachKind =>
  isImageType(type) ? "image" : type === "application/pdf" ? "pdf" : "text"

const kindAndType = (
  file: Offered,
): { readonly kind: AttachKind; readonly type: string } | undefined => {
  if (attachmentLimit(file.type) !== undefined) return { kind: kindOf(file.type), type: file.type }
  if (TEXT_EXTENSIONS.has(extensionOf(file.name))) return { kind: "text", type: "text/plain" }
  return undefined
}

export const admit = (file: Offered): Admission => {
  const known = kindAndType(file)
  if (known === undefined)
    return {
      _tag: "Refused",
      refusal: {
        name: file.name,
        line:
          file.type === "image/svg+xml" || extensionOf(file.name) === "svg"
            ? `is an SVG. ${ALLOWED}`
            : `is not a file the agent can read. ${ALLOWED}`,
      },
    }
  const limit = attachmentLimit(known.type) ?? 0
  if (file.size > limit)
    return {
      _tag: "Refused",
      refusal: {
        name: file.name,
        line: `is ${sizeOf(file.size)}. ${PLURAL[known.kind]} can be up to ${String(limit / MB)} MB.`,
      },
    }
  return { _tag: "Admitted", ...known }
}

/**
 * Which of `offered` the box takes, given it already holds `held`, and the one sentence
 * the box shows for the rest. Files past the tenth are counted rather than named — a
 * folder of screenshots dropped at once is one fact, not twenty. Where both happen, the
 * count is the sentence: it is the limit nothing in the hand can fix by choosing again.
 */
export const take = (
  offered: readonly Offered[],
  held: number,
): {
  readonly admitted: readonly {
    readonly index: number
    readonly kind: AttachKind
    readonly type: string
  }[]
  readonly refusal: Refusal | undefined
} => {
  const admitted: { index: number; kind: AttachKind; type: string }[] = []
  let first: Refusal | undefined
  let over = 0
  offered.forEach((file, index) => {
    const admission = admit(file)
    if (admission._tag === "Refused") {
      first ??= admission.refusal
      return
    }
    if (held + admitted.length >= MAX_ATTACHMENTS) {
      over += 1
      return
    }
    admitted.push({ index, kind: admission.kind, type: admission.type })
  })
  const refusal =
    over === 0
      ? first
      : {
          name: over === 1 ? "1 file" : `${String(over)} files`,
          line: `${over === 1 ? "was" : "were"} not added. A message holds at most ${String(MAX_ATTACHMENTS)} files.`,
        }
  return { admitted, refusal }
}

export const KIND_ICON = { image: ImageIcon, pdf: FileType, text: FileText } as const

export const KIND_WORD: Readonly<Record<AttachKind, string>> = {
  image: "Image",
  pdf: "PDF",
  text: "Text",
}

/** What the attach button's picker offers — the same list, by type and by extension. */
export const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/*",
  "application/json",
  ...[...TEXT_EXTENSIONS].map((e) => `.${e}`),
].join(",")
