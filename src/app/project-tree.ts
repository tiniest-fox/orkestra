// One file out of the project checkout, for the file browser to draw.
//
// Here rather than in `vcs/` for `images.ts`'s reason: it reads a file and says what it
// is, and git's part — which files there are — is already answered by `Vcs.projectFiles`.
//
// **The list git gave is the guard, asked twice.** A path is served only when that list
// names it, which refuses `../`, an absolute path, and every file `.gitignore` keeps out —
// `.env`, `node_modules` — by never having listed them. Then the path is resolved through
// its links, and the resolved file's path relative to the real root has to be in the list
// too: git lists a committed symlink as a file, so `cfg -> .env`, `cfg -> .git/config` or a
// link to `~/.ssh` passes the first ask and fails the second. A link to another listed file
// still opens.

import { readFile, realpath, stat } from "node:fs/promises"
import { relative, sep } from "node:path"
import { Data, type Cause, Effect } from "effect"
import type { ProjectFiles } from "../vcs/types/project-files.js"
import { absent, fileInside } from "./images.js"

/**
 * The largest file the viewer is sent. The page colours a file in one pass on its main
 * thread, so the cap is what keeps one file from holding the page.
 */
const VIEWER_CAP = 1024 * 1024

/** How far in a NUL byte makes a file binary — git's own heuristic, at git's own width. */
const SNIFF = 8000

/** What the viewer is sent for one file. */
export type ProjectFile = Data.TaggedEnum<{
  Text: { readonly path: string; readonly text: string; readonly lines: number }
  Binary: { readonly path: string; readonly bytes: number }
  TooLarge: { readonly path: string; readonly bytes: number }
}>
export const ProjectFile = Data.taggedEnum<ProjectFile>()

/** A trailing newline ends the last line rather than starting another. */
const lineCount = (text: string): number => {
  if (text === "") return 0
  const breaks = text.split("\n").length - 1
  return text.endsWith("\n") ? breaks : breaks + 1
}

const read = async (files: ProjectFiles, path: string): Promise<ProjectFile | undefined> => {
  const file = await fileInside(files.root, path)
  if (file === undefined) return undefined
  // Git names paths with `/` whatever the platform writes.
  const resolved = relative(await realpath(files.root), file)
    .split(sep)
    .join("/")
  if (!files.paths.includes(resolved)) return undefined
  // The size is asked first so a huge file is never read, and the bytes are measured again
  // after: a file that grew between the two is still over the cap.
  const { size } = await stat(file)
  if (size > VIEWER_CAP) return ProjectFile.TooLarge({ path, bytes: size })
  const bytes = await readFile(file)
  if (bytes.length > VIEWER_CAP) return ProjectFile.TooLarge({ path, bytes: bytes.length })
  if (bytes.subarray(0, SNIFF).includes(0)) return ProjectFile.Binary({ path, bytes: bytes.length })
  const text = bytes.toString("utf8")
  return ProjectFile.Text({ path, text, lines: lineCount(text) })
}

/**
 * The file `requested` names in the project checkout, or `undefined` where the browser
 * may not serve it — a path git did not list, a link whose target git did not list, and a
 * file deleted since the list was read. A disk that will not answer stays in the error
 * channel, as `trakImage` keeps it.
 */
export const projectFile = (
  files: ProjectFiles,
  requested: string,
): Effect.Effect<ProjectFile | undefined, Cause.UnknownException> =>
  files.paths.includes(requested)
    ? Effect.tryPromise(() => read(files, requested)).pipe(
        Effect.catchIf(
          (failure) => absent(failure.error),
          () => Effect.succeed(undefined),
        ),
      )
    : Effect.succeed(undefined)
