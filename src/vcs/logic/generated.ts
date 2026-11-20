// logic: which changed files `.gitattributes` marks `linguist-generated`, and the answer
// with those files collapsed.
//
// **GitHub's attribute rather than one of our own**, so the line that collapses a file in
// a pull request collapses it here as well. A collapsed file keeps its `+/−` and loses its
// hunks: the reader sees that it changed and by how much, and asks for the patch by path
// when they open it.

import type { Changes } from "../types/changes.js"

/**
 * The paths `git check-attr -z linguist-generated` says carry the attribute.
 *
 * The output is `<path>\0<attribute>\0<value>\0` per path. `set` and `true` are the two
 * values GitHub reads as generated; `unset`, `false` and `unspecified` are the ones it does
 * not, and a `linguist-generated=false` line is how a project takes one file back out.
 */
export const generatedIn = (checkAttr: string): ReadonlySet<string> => {
  const fields = checkAttr.split("\0")
  const marked = new Set<string>()
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const path = fields[i]
    const value = fields[i + 2]
    if (path !== undefined && (value === "set" || value === "true")) marked.add(path)
  }
  return marked
}

/** The answer with every file in `generated` collapsed: its counts kept, its hunks dropped. */
export const collapseGenerated = (changes: Changes, generated: ReadonlySet<string>): Changes => ({
  ...changes,
  files: changes.files.map((file) =>
    generated.has(file.path) ? { ...file, omitted: "generated", hunks: [] } : file,
  ),
})
