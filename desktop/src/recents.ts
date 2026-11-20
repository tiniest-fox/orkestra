// The projects opened before, most recent first — the first state this system keeps
// outside a project.
//
// Pure: what the list becomes when a project is opened, or is found not to open any
// more, what a stored file reads as, and what the launch window draws for each entry.
// `recents-file.ts` does the reading and writing.

import { basename } from "node:path"
import type { RecentProjectDto } from "@orkestra/shared/launcher"

/** Enough for a menu; a longer list is a search. */
export const RECENTS_LIMIT = 10

/** `path` moved to the front, once, and the tail cut to the limit. */
export const bumped = (recents: readonly string[], path: string): readonly string[] =>
  [path, ...recents.filter((p) => p !== path)].slice(0, RECENTS_LIMIT)

export const without = (recents: readonly string[], path: string): readonly string[] =>
  recents.filter((p) => p !== path)

/**
 * The file's text as a list, or empty. A file this app did not write — missing, not
 * JSON, or JSON of another shape — reads as no recents rather than as a failure: the
 * list is a convenience, and a menu with nothing in it is the honest answer.
 */
export const parseRecents = (text: string): readonly string[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof parsed !== "object" || parsed === null || !("recents" in parsed)) return []
  const list: unknown = parsed.recents
  if (!Array.isArray(list)) return []
  return list.filter((p): p is string => typeof p === "string").slice(0, RECENTS_LIMIT)
}

export const serializeRecents = (recents: readonly string[]): string =>
  `${JSON.stringify({ recents }, undefined, 2)}\n`

/**
 * The launch window's rows: the folder's own name, and the path as a person reads it.
 * `home` becomes `~` because nine entries in ten start with the same characters and
 * those characters answer nothing; a path outside home is left whole.
 */
export const rowsOf = (recents: readonly string[], home: string): readonly RecentProjectDto[] =>
  recents.map((path) => ({
    path,
    name: basename(path),
    short: path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path,
  }))
