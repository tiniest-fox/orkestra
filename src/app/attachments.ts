// The files a person sends with a message: taken into the OS temporary folder by the upload
// route, then moved into the checkout the turn runs in once a message names them.
//
// Here rather than in `workflow/` for `images.ts`'s reason: it drives nothing and takes no
// custody. The one thing `workflow/` asks of it is `Uploads.settle`, for a new trak whose
// checkout is made after its request was taken.
//
// **The checkout holds the only copy.** Nothing keeps an upload once it is placed, and an
// upload no message named waits in the temporary folder until the machine clears it.

import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { Effect, Layer, Option, Schema } from "effect"
import {
  type AttachmentUploadedDto,
  attachmentLimit,
  attachmentRefusal,
  MAX_ATTACHMENTS,
} from "@orkestra/shared/dto/attachments"
import { type Attachment, ATTACHMENTS_DIR } from "../workflow/domain/attachment.js"
import { type Placed, Uploads } from "../workflow/ports/uploads.js"
import type { CheckoutPlace } from "../vcs/logic/paths.js"
import { Sandboxes } from "../vcs/ports/sandboxes.js"
import { GitFailed } from "../vcs/types/errors.js"

/** Where uploads wait: one directory per upload, and one per new trak holding its own. */
const ROOT = join(tmpdir(), "orkestra-uploads")
const BYTES = "bytes"
const META = "meta.json"

/** What an upload's `meta.json` says of it. `path` is set once a message has claimed it. */
const Meta = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  size: Schema.Number,
  path: Schema.optional(Schema.String),
})
type Meta = Schema.Schema.Type<typeof Meta>
const decodeMeta = Schema.decodeUnknownOption(Schema.parseJson(Meta))

/** An upload a message claimed: where it waits, and what the log will record of it. */
interface Claimed {
  readonly dir: string
  readonly attachment: Attachment
}

/**
 * A name a file may be written under: the last segment of what the browser sent, with no
 * control character, no leading dot and nothing past a hundred characters. A name is
 * written by a person's file system, and a `../` in one is not a place to write to.
 */
const safeName = (name: string): string => {
  const last = name.split(/[/\\]/u).at(-1) ?? ""
  const clean = last
    .replaceAll(/\p{Cc}/gu, "")
    .replace(/^\.+/u, "")
    .slice(-100)
  return clean === "" ? "file" : clean
}

/** Only an id this module minted names a directory under `ROOT`. */
const UPLOAD_ID = /^[0-9a-f-]{36}$/u

/** `id`'s directory, or `undefined` for a string that is not an upload id. */
const uploadDir = (id: string): string | undefined =>
  UPLOAD_ID.test(id) ? join(ROOT, id) : undefined

/**
 * Take one file into the temporary folder: refused, naming the limit, where its type is off
 * the allowlist or it is over its limit. `status` is what the route answers a refusal with.
 */
export const receiveUpload = (
  name: string,
  type: string,
  bytes: Uint8Array,
): Effect.Effect<
  AttachmentUploadedDto | { readonly refused: string; readonly status: number },
  Error
> =>
  Effect.gen(function* () {
    const refused = attachmentRefusal(type, bytes.length, 0)
    if (refused !== undefined) {
      return { refused, status: attachmentLimit(type) === undefined ? 415 : 413 }
    }
    const id = randomUUID()
    const meta: Meta = { name: safeName(name), type, size: bytes.length }
    yield* Effect.tryPromise({
      try: async () => {
        const dir = join(ROOT, id)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, BYTES), bytes)
        await writeFile(join(dir, META), JSON.stringify(meta))
      },
      catch: (cause) => new Error(`could not keep the upload: ${String(cause)}`),
    })
    return { id, ...meta }
  })

const readMeta = (dir: string): Effect.Effect<Meta | undefined> =>
  Effect.tryPromise(() => readFile(join(dir, META), "utf8")).pipe(
    Effect.map((text) => Option.getOrUndefined(decodeMeta(text))),
    Effect.orElseSucceed(() => undefined),
  )

/**
 * The uploads `ids` names, each with the checkout path it will be placed at — or the
 * sentence a message naming them is refused with: more than a message may carry, or an id
 * the temporary folder no longer holds. Nothing is moved.
 *
 * **Each name is prefixed with its upload's first eight characters.** A pasted picture is
 * named `image.png` by every browser, so two in one checkout would otherwise overwrite
 * each other.
 */
export const claimUploads = (ids: readonly string[]): Effect.Effect<readonly Claimed[] | string> =>
  Effect.gen(function* () {
    if (ids.length > MAX_ATTACHMENTS) return `a message can carry at most ${MAX_ATTACHMENTS} files`
    const claimed: Claimed[] = []
    for (const id of new Set(ids)) {
      const dir = uploadDir(id)
      const meta = dir === undefined ? undefined : yield* readMeta(dir)
      if (dir === undefined || meta === undefined) {
        return "an attached file is no longer held by the engine: attach it again"
      }
      const path = `${ATTACHMENTS_DIR}/${id.slice(0, 8)}-${meta.name}`
      claimed.push({ dir, attachment: { name: meta.name, type: meta.type, size: meta.size, path } })
    }
    return claimed
  })

const failed = (op: string) => (cause: unknown) =>
  new GitFailed({ op, reason: cause instanceof Error ? cause.message : String(cause) })

/**
 * Write each claimed upload into the checkout at `checkout`, at its path — through the
 * sandbox where `at` names one, or where the checkout is in one. One `place` for every
 * file, so a sandbox is reached once per message. The uploads stay held: see `Placed`.
 */
const placed = (
  checkout: string,
  claimed: readonly Claimed[],
  at: CheckoutPlace | undefined,
): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    if (claimed.length === 0) return
    const files = new Map<string, Uint8Array>()
    for (const c of claimed) {
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(join(c.dir, BYTES)),
        catch: failed("read an upload"),
      })
      files.set(c.attachment.path, bytes)
    }
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    const place = at ?? (sandboxes === undefined ? undefined : yield* sandboxes.placeOf(checkout))
    if (sandboxes !== undefined && place !== undefined) {
      yield* sandboxes.place(place, files, false)
    } else {
      yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            [...files].map(async ([path, bytes]) => {
              await mkdir(dirname(join(checkout, path)), { recursive: true })
              await writeFile(join(checkout, path), bytes)
            }),
          ),
        catch: failed("place attachments in the checkout"),
      })
    }
  })

const releasing = (claimed: readonly Claimed[]): Effect.Effect<void> =>
  Effect.forEach(
    claimed,
    (c) => Effect.promise(() => rm(c.dir, { recursive: true, force: true })),
    {
      discard: true,
    },
  )

const NOTHING: Placed = { attachments: [], release: Effect.void }

/**
 * Write the uploads `ids` names into the checkout at `checkout` — the project's sandbox
 * where `at` names it — and answer what the log records of them, or the refusal sentence.
 * Ask it only once every refusal but a race has passed; `Placed.release` once appended.
 */
export const placeUploads = (
  ids: readonly string[] | undefined,
  checkout: string,
  at?: CheckoutPlace,
): Effect.Effect<Placed | string, GitFailed> =>
  Effect.gen(function* () {
    if (ids === undefined || ids.length === 0) return NOTHING
    const claimed = yield* claimUploads(ids)
    if (typeof claimed === "string") return claimed
    yield* placed(checkout, claimed, at)
    return { attachments: claimed.map((c) => c.attachment), release: releasing(claimed) }
  })

/**
 * Where a new trak's uploads wait: named for its project as well as its id, because a trak's
 * id is unique only in its project and `ROOT` is the machine's. Keyed by the id alone, an
 * engine on another project — or a test in another worker — whose trak had the same id
 * placed these files in its own checkout and removed them, and this trak's turn started
 * without them.
 */
const heldFor = (project: string, trak: string): string =>
  join(ROOT, `trak-${createHash("sha256").update(project).digest("hex").slice(0, 16)}-${trak}`)

/**
 * Hold the uploads `ids` names for a trak whose checkout is not made yet — `Uploads.settle`
 * places them once it is — and answer what its `TrakCreated` records, or the refusal.
 * Copied rather than moved, for `placeUploads`' reason: `Placed.release` once appended.
 */
const holdUploads = (
  project: string,
  ids: readonly string[] | undefined,
  trak: string,
): Effect.Effect<Placed | string, Error> =>
  Effect.gen(function* () {
    if (ids === undefined || ids.length === 0) return NOTHING
    const claimed = yield* claimUploads(ids)
    if (typeof claimed === "string") return claimed
    yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          claimed.map(async (c) => {
            const into = join(heldFor(project, trak), basename(c.dir))
            await mkdir(into, { recursive: true })
            await copyFile(join(c.dir, BYTES), join(into, BYTES))
            await writeFile(join(into, META), JSON.stringify({ ...c.attachment } satisfies Meta))
          }),
        ),
      catch: (cause) => new Error(`could not hold the uploads: ${String(cause)}`),
    })
    return { attachments: claimed.map((c) => c.attachment), release: releasing(claimed) }
  })

/** `Uploads.settle`: what `holdUploads` held for `trak`, placed at the paths it recorded. */
const settle = (project: string, trak: string, worktree: string): Effect.Effect<void, GitFailed> =>
  Effect.gen(function* () {
    const root = heldFor(project, trak)
    const names = yield* Effect.tryPromise(() => readdir(root)).pipe(
      Effect.orElseSucceed((): readonly string[] => []),
    )
    if (names.length === 0) return
    const claimed: Claimed[] = []
    for (const name of names) {
      const dir = join(root, name)
      const meta = yield* readMeta(dir)
      if (meta?.path !== undefined) {
        claimed.push({ dir, attachment: { ...meta, path: meta.path } })
      }
    }
    yield* placed(worktree, claimed, undefined)
    yield* Effect.promise(() => rm(root, { recursive: true, force: true }))
  })

/** `Uploads` for the project at `project`: what its routes hold, its `SetupWorktree` places. */
export const UploadsLayer = (project: string) =>
  Layer.succeed(Uploads, {
    hold: (ids, trak) => holdUploads(project, ids, trak),
    settle: (trak, worktree) => settle(project, trak, worktree),
  })
