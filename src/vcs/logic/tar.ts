// logic: a tree of files as one tar stream, and back — how a set of files crosses the
// runner's `exec` pipe in one command rather than one per file.
//
// **Only what `tar` on any sandbox reads and writes.** The writer emits ustar entries
// and a GNU long-name record ahead of a name past a hundred bytes, which GNU tar and
// busybox both extract. The reader takes regular files from ustar, GNU long-name and pax
// `path=` records, and skips every other entry: a directory is implied by the files
// under it, and a link in a checkout is something a model left there, never a file this
// engine follows.

const BLOCK = 512
const NAME_FIELD = 100
const LONG_NAME = "././@LongLink"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const padded = (size: number): number => Math.ceil(size / BLOCK) * BLOCK

/** `value` in octal, zero-filled to `width - 1` digits and NUL-ended, as every numeric field is. */
const octal = (value: number, width: number): string =>
  `${value.toString(8).padStart(width - 1, "0")}\0`

/** One 512-byte header for an entry of `size` bytes named `name` — truncated where too long. */
const header = (name: Uint8Array, size: number, type: string, mode: number): Uint8Array => {
  const block = new Uint8Array(BLOCK)
  block.set(name.subarray(0, NAME_FIELD), 0)
  block.set(encoder.encode(octal(mode, 8)), 100)
  block.set(encoder.encode(octal(0, 8)), 108)
  block.set(encoder.encode(octal(0, 8)), 116)
  block.set(encoder.encode(octal(size, 12)), 124)
  block.set(encoder.encode(octal(0, 12)), 136)
  // The checksum is summed with its own field read as spaces.
  block.set(encoder.encode("        "), 148)
  block.set(encoder.encode(type), 156)
  block.set(encoder.encode("ustar\u000000"), 257)
  const sum = block.reduce((total, byte) => total + byte, 0)
  block.set(encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148)
  return block
}

/** The bytes of one entry: its header and its content, padded to the block. */
const entry = (name: Uint8Array, content: Uint8Array, type: string, mode: number): Uint8Array[] => {
  const body = new Uint8Array(padded(content.length))
  body.set(content)
  return [header(name, content.length, type, mode), body]
}

/**
 * `files`, by path relative to the archive's root, as one tar stream ended by its two
 * empty blocks. A file is written with its permission bits in `modes`, and readable by
 * everyone and writable by its owner where `modes` has none.
 */
export const tarOf = (
  files: ReadonlyMap<string, string | Uint8Array>,
  modes: ReadonlyMap<string, number> = new Map(),
): Uint8Array => {
  const parts: Uint8Array[] = []
  for (const [path, text] of files) {
    const name = encoder.encode(path)
    const content = typeof text === "string" ? encoder.encode(text) : text
    if (name.length > NAME_FIELD) {
      // NUL-ended, as GNU tar writes the long name it reads back.
      const long = new Uint8Array(name.length + 1)
      long.set(name)
      parts.push(...entry(encoder.encode(LONG_NAME), long, "L", 0o644))
    }
    parts.push(...entry(name, content, "0", modes.get(path) ?? 0o644))
  }
  parts.push(new Uint8Array(BLOCK * 2))
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A NUL-ended field as text. */
const field = (block: Uint8Array, start: number, length: number): string => {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)
  return decoder.decode(end === -1 ? raw : raw.subarray(0, end))
}

/** The `path=` record of a pax header, which overrides the name of the entry after it. */
const paxPath = (content: Uint8Array): string | undefined => {
  for (const line of decoder.decode(content).split("\n")) {
    const record = line.slice(line.indexOf(" ") + 1)
    if (record.startsWith("path=")) return record.slice("path=".length)
  }
  return undefined
}

/** A name as `tar -C <dir> .` writes it, without the `./` it starts with. */
const relativeName = (name: string): string => name.replace(/^(\.\/)+/u, "")

/**
 * What the front of a tar stream holds: `Short` of the `needs` bytes its first entry takes,
 * whose content and padding have to be there before anything after it can be read; the
 * `End`; or one whole `Entry` of `length` bytes. `pending` is the long or pax name the next
 * entry takes, and is handed back into the next step. `file` is the entry's regular file
 * and its path relative to the archive's root, where it is one.
 */
export type TarStep =
  | { readonly _tag: "Short"; readonly needs: number }
  | { readonly _tag: "End" }
  | {
      readonly _tag: "Entry"
      readonly length: number
      readonly pending: string | undefined
      readonly file: readonly [string, Uint8Array] | undefined
    }

/**
 * The first entry of `tar`, so a stream too large to hold is read one entry at a time.
 * The file's bytes are a view of `tar`, not a copy.
 */
export const tarStep = (tar: Uint8Array, pending: string | undefined): TarStep => {
  if (tar.length < BLOCK) return { _tag: "Short", needs: BLOCK }
  const block = tar.subarray(0, BLOCK)
  if (block.every((byte) => byte === 0)) return { _tag: "End" }
  const size = Number.parseInt(field(block, 124, 12).trim() || "0", 8)
  const length = BLOCK + padded(size)
  if (tar.length < length) return { _tag: "Short", needs: length }
  const type = field(block, 156, 1)
  const content = tar.subarray(BLOCK, BLOCK + size)
  if (type === "L")
    return { _tag: "Entry", length, pending: field(content, 0, size), file: undefined }
  if (type === "x")
    return { _tag: "Entry", length, pending: paxPath(content) ?? pending, file: undefined }
  const prefix = field(block, 345, 155)
  const named = field(block, 0, NAME_FIELD)
  const name = relativeName(pending ?? (prefix === "" ? named : `${prefix}/${named}`))
  const regular = (type === "0" || type === "") && name !== ""
  return { _tag: "Entry", length, pending: undefined, file: regular ? [name, content] : undefined }
}

/**
 * Every regular file in a tar stream, by its path relative to the archive's root. A
 * stream cut short ends the reading at the last whole entry; nothing in it is guessed.
 */
export const filesOfTar = (tar: Uint8Array): ReadonlyMap<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>()
  let at = 0
  let pending: string | undefined
  for (;;) {
    const step = tarStep(tar.subarray(at), pending)
    if (step._tag !== "Entry") return files
    at += step.length
    pending = step.pending
    if (step.file !== undefined) files.set(...step.file)
  }
}
