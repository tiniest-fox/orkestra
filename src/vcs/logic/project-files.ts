// logic: reading the two listings the project's file browser asks git for.
//
// Both commands run with `-z`, so a path is never quoted or escaped and a name holding a
// space or a newline survives. The splitting is here so each rule is a function of text.

import type { ProjectMatch } from "../types/project-files.js"

/**
 * How much of a matching line is kept. A minified file is one line, and the whole of it
 * per match would send the file where a reference to it was asked for.
 */
const TEXT_CAP = 400

/** The NUL-separated names of a `-z` listing, with the empty tail dropped. */
const names = (out: string): readonly string[] => out.split("\0").filter((name) => name !== "")

/**
 * The files the browser lists: `ls-files --cached --others` less `ls-files --deleted`.
 *
 * **`--cached` still names a tracked file deleted on disk**, and reading one fails, so the
 * deleted listing is taken away. Both listings are sorted by git; the answer keeps that
 * order, which is the tree's.
 */
export const filesListed = (listed: string, deleted: string): readonly string[] => {
  const gone = new Set(names(deleted))
  return names(listed).filter((path) => !gone.has(path))
}

/**
 * One row of `git grep -n -z` as a match, or `undefined` for a row that is not one.
 *
 * A match is `<path>\0<line>\0<text>`. A row that does not split that way is dropped rather
 * than guessed at — a path holding a newline breaks the row in two, and neither half is a
 * match anybody could open. The adapter reads rows one at a time and stops at its cap, so
 * the rule is per row rather than over the whole output.
 */
export const grepRow = (row: string): ProjectMatch | undefined => {
  const [path, line, ...rest] = row.split("\0")
  const number = Number(line)
  if (path === undefined || path === "" || rest.length === 0 || !Number.isInteger(number))
    return undefined
  // A NUL inside the text is not one `-I` lets through, so the rest is one string.
  return { path, line: number, text: rest.join("\0").slice(0, TEXT_CAP) }
}
