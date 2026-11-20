// The reading half of `icon.ts`: asks git which files the checkout tracks and reads the
// best candidate into a `data:` address the rail's page can draw.

// oxlint-disable-next-line eslint/no-restricted-imports -- macOS icon tools, outside every engine
import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { iconMime, rankIcons } from "./icon.js"

/** Past this a file is artwork rather than an icon, and is not sent to the page. */
const MAX_BYTES = 256 * 1024

/** How many candidates are tried before the tile settles for letters. */
const TRIES = 4

const tracked = (root: string, env: NodeJS.ProcessEnv): Promise<readonly string[]> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "ls-files", "-z"],
      { maxBuffer: 64 * 1024 * 1024, timeout: 10_000, env },
      (error, stdout) => resolve(error === null ? stdout.split("\0") : []),
    )
  })

const asDataUrl = async (root: string, path: string): Promise<string | undefined> => {
  const mime = iconMime(path)
  if (mime === undefined) return undefined
  try {
    const file = join(root, path)
    if ((await stat(file)).size > MAX_BYTES) return undefined
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`
  } catch {
    return undefined
  }
}

/**
 * The first of `candidates` that reads. Recursive rather than a loop for `src/supervisor/engine.ts`'s
 * reason: the next read is worth making only once this one has come back empty.
 */
const firstReadable = async (
  root: string,
  candidates: readonly string[],
): Promise<string | undefined> => {
  const [path, ...rest] = candidates
  if (path === undefined) return undefined
  return (await asDataUrl(root, path)) ?? firstReadable(root, rest)
}

/**
 * The picture for the checkout at `root`, or `undefined` where there is none to draw —
 * no git, no candidate, or candidates too large or unreadable. Never a throw: the tile
 * has two letters on a colour to fall back on, and a missing picture is not a failure.
 * `env` is what git runs with; the host hands it its environment without the store's variables.
 */
export const findIcon = async (
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> =>
  firstReadable(root, rankIcons(await tracked(root, env)).slice(0, TRIES))
