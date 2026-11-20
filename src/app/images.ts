// A file out of a trak's own checkout, so a picture an agent made can be looked at.
//
// Here rather than in `workflow/` for `records.ts`'s reason: it drives nothing, takes no
// custody and touches no trak's state. It reads one file and says what it is.
//
// **The confinement is the whole file.** A trak's checkout is a real directory on the
// machine serving this, and the path naming a file inside it was written by a model. So
// the root and the file are each resolved through their symlinks first and only then
// compared: a link inside the checkout pointing at `~/.ssh` resolves to somewhere
// outside it, and a check made before the resolution would have let it through.
//
// **A sandboxed checkout is read there**, with the same two resolutions made by
// `realpath` inside the sandbox and the file then copied out. It is a read, so a stopped
// sandbox is not started for a picture: the answer is that nothing can be read now.

import { readFile, realpath, stat } from "node:fs/promises"
import { join, sep } from "node:path"
import { type Cause, Effect, Option } from "effect"
import type { GitFailed } from "../vcs/types/errors.js"
import { Sandboxes } from "../vcs/ports/sandboxes.js"

/**
 * Extension → what to send it as. The map is also the allowlist, so a path with no entry
 * here is not served at all.
 *
 * **Raster only, and SVG is the omission worth naming.** An SVG is a document that can
 * carry script — harmless inside an `<img>`, which never runs it, and not harmless when
 * the URL is opened on its own, because the engine and the surface share an origin. That
 * would be script from a model's text running as the app. Nothing an agent takes a
 * picture with writes one, so the case is refused rather than sandboxed.
 */
const TYPES: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
])

export interface TrakImage {
  readonly bytes: Uint8Array
  readonly contentType: string
}

/** No picture to serve: none by that name, or — `"stopped"` — a sandbox nothing can be read from now. */
type NoImage = undefined | "stopped"

const typeOf = (path: string): string | undefined => {
  const dot = path.lastIndexOf(".")
  return dot === -1 ? undefined : TYPES.get(path.slice(dot).toLowerCase())
}

/** Strictly inside the root, both already resolved. The root itself is a directory. */
const under = (root: string, file: string): boolean => file.startsWith(`${root}${sep}`)

/**
 * The regular file `requested` names inside `root`, resolved, or `undefined` where it
 * names nothing there. Shared with the route that serves the built client, which confines
 * a path out of a URL the same way this confines one out of a model's text.
 *
 * `join` reads an absolute `requested` as a relative one, so `/etc/passwd` lands inside
 * the root instead of at the root of the disk. A `..` climb is what `under` catches, once
 * the links are gone. Throws what `realpath` and `stat` throw — `absent` says which of
 * those mean *no such file*.
 */
export const fileInside = async (root: string, requested: string): Promise<string | undefined> => {
  const base = await realpath(root)
  const file = await realpath(join(base, requested))
  if (!under(base, file)) return undefined
  if (!(await stat(file)).isFile()) return undefined
  return file
}

const read = async (worktree: string, requested: string): Promise<TrakImage | undefined> => {
  const contentType = typeOf(requested)
  // A NUL is not a filename, and `realpath` throws on one — which would be a 500 for a
  // string an agent wrote rather than a picture that is not there.
  if (contentType === undefined || requested.includes("\0")) return undefined
  const file = await fileInside(worktree, requested)
  if (file === undefined) return undefined
  return { bytes: await readFile(file), contentType }
}

/**
 * The codes that mean *this string names no file*, which is the whole of what a bad
 * `requested` can be. Enumerated rather than accumulated: the path was written by a model,
 * so every way a filename can be impossible arrives here from the same place, and a set
 * built one observed case at a time is a 500 waiting for the next one.
 *
 * `EIO` and `EACCES` are the deliberate omissions — a file that exists and could not be
 * read is not the same answer, and saying *there is no such picture* about one is the
 * catch-all this split exists to avoid.
 */
const NO_SUCH_FILE: ReadonlySet<string> = new Set([
  "ENOENT", // nothing at that name
  "ENOTDIR", // a component of it is a file
  "ENAMETOOLONG", // longer than a name may be, so nothing can have it
  "ELOOP", // a symlink cycle, which an agent can leave in its own checkout
])

/** Whether a failure means the file is simply not there. */
export const absent = (error: unknown): boolean => {
  const code: unknown = error instanceof Error && "code" in error ? error.code : undefined
  return typeof code === "string" && NO_SUCH_FILE.has(code)
}

/**
 * The image `requested` names inside `worktree`, or `undefined` where there is none to
 * serve — a path that is not an image, one that lands outside the checkout, and a file
 * that is not there — or `"stopped"` for a checkout in a sandbox that is not running.
 *
 * **A missing file is an answer; anything else is not.** A shot dies with the checkout it
 * was taken in, so a path naming no file is the ordinary case and becomes `undefined` —
 * `NO_SUCH_FILE` is the whole of that set. A disk that will not answer stays in the error
 * channel: collapsing it would say *there is no such picture* about one nobody could read.
 * A sandbox that cannot be reached is the same, and stays there as a `GitFailed`.
 */
export const trakImage = (
  worktree: string,
  requested: string,
): Effect.Effect<TrakImage | NoImage, Cause.UnknownException | GitFailed> =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    const place = sandboxes === undefined ? undefined : yield* sandboxes.placeOf(worktree)
    if (sandboxes === undefined || place === undefined) {
      return yield* Effect.tryPromise(() => read(worktree, requested)).pipe(
        Effect.catchIf(
          (failure) => absent(failure.error),
          () => Effect.succeed(undefined),
        ),
      )
    }
    const contentType = typeOf(requested)
    if (contentType === undefined || requested.includes("\0")) return undefined
    const bytes = yield* sandboxes.readInside(place, requested)
    return bytes === undefined || bytes === "stopped" ? bytes : { bytes, contentType }
  })
