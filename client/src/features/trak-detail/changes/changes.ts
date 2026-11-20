/**
 * Everything the Changes surface works out before it draws anything: the totals, which
 * files open folded, how a path splits for the header, which of a hunk's two sides a row
 * belongs to, and what language a file is.
 *
 * **The two-sides split is the one non-obvious piece and it is here rather than in the
 * renderer.** Highlighting a diff row on its own restarts the grammar at every line, so a
 * template literal or a block comment loses its colour after row one. The way past is to
 * tokenise each hunk's old-side text and its new-side text as two whole blocks and put the
 * token stream back onto rows — which needs the mapping from a row to `(side, index)`, and
 * that mapping is a pure function of the hunk. It is still wrong for a comment that opened
 * above the hunk; three lines of context is all a unified diff knows.
 *
 * Kind `pure`: `api/types`, `format/grammar`, and no React.
 */

import type { ChangeHunkDto, ChangeLineDto, FileChangeDto } from "../../../api/types"
import type { Grammar } from "../../../format/grammar"
import { grammarOf } from "../../../format/grammar"

/**
 * The marker git writes when a file's last line has no newline.
 *
 * **It reaches the client as a `context` row**, because the wire carries a kind and a text
 * and has nowhere else to put it. Matched by text so it can be drawn as what it is — a note
 * about the file rather than a line of it — and it is the one row with no numbers and no
 * sign.
 */
export const NO_NEWLINE = String.raw`\ No newline at end of file`

export const isNoNewline = (line: ChangeLineDto): boolean =>
  line.kind === "context" && line.text === NO_NEWLINE

/** `+N −M` for a file, in the minus sign the rest of the app uses rather than a hyphen. */
export const counts = (file: FileChangeDto): string =>
  `+${String(file.additions)} −${String(file.deletions)}`

/** `26 files +1147 −259` — the header total, right-aligned beside the picker. */
export const total = (files: readonly FileChangeDto[]): string => {
  const added = files.reduce((n, file) => n + file.additions, 0)
  const removed = files.reduce((n, file) => n + file.deletions, 0)
  return `${String(files.length)} file${files.length === 1 ? "" : "s"} +${String(added)} −${String(removed)}`
}

/**
 * A path split into the part that is dimmed and the part that is not.
 *
 * The basename carries the weight because it is what a reader scans for; the directory is
 * still there because two `index.ts` are otherwise the same row twice.
 */
export const splitPath = (path: string): { readonly dir: string; readonly name: string } => {
  const cut = path.lastIndexOf("/")
  return cut === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) }
}

/**
 * The files that open folded: the ones whose body says nothing you came to read.
 *
 * A deleted file's hunks are the file, and nobody opens a diff to read a file that is
 * gone; a binary and an over-cap file have no hunks at all and their card is a sentence
 * saying why. A generated file — `linguist-generated` in `.gitattributes` — is one the
 * project said nobody reads, and its hunks are asked for only once it is opened. All four
 * still draw their `+/−`, which is the half that is worth seeing.
 */
export const initiallyFolded = (files: readonly FileChangeDto[]): ReadonlySet<string> =>
  new Set(
    files
      .filter((file) => file.change === "deleted" || file.omitted !== undefined)
      .map((file) => file.path),
  )

/** What the cap dropped, said at the foot of both layouts of the diff — one wording, so
 *  the two cannot drift. `undefined` where nothing was dropped and no note is owed. */
export const omittedFootnote = (omitted: number | undefined): string | undefined =>
  omitted === undefined || omitted === 0
    ? undefined
    : omitted === 1
      ? "1 more file changed and is not shown."
      : `${String(omitted)} more files changed and are not shown.`

/** Why a card has no hunks to draw, in words, or `undefined` where it has some. */
export const omittedWords = (file: FileChangeDto): string | undefined => {
  if (file.omitted === "binary") return "Binary file — no line changes to show"
  if (file.omitted === "too-large")
    return `Too large to show — ${String(file.additions + file.deletions)} lines changed`
  // A change map's excerpt, which asks for nothing; the Changes tab's card reads the patch
  // when it is opened, and says so itself.
  if (file.omitted === "generated") return "Generated file — its lines load in Changes"
  // A pure rename, and a mode change, both arrive with counts of zero and nothing to draw.
  // An empty card would read as a diff that failed to load.
  if (file.hunks.length === 0) return "No line changes in this file"
  return undefined
}

/**
 * A file's hunks cut to `cap` lines: whole hunks while they fit, then the last one cut
 * short, and how many lines were left out.
 *
 * **Cut from the end of a hunk and never its start**, so row `i` of a shown hunk is still
 * row `i` of the hunk — which is what lets the colouring, worked out over whole hunks,
 * be laid on by index.
 */
export const capHunks = (
  hunks: readonly ChangeHunkDto[],
  cap: number,
): { readonly shown: readonly ChangeHunkDto[]; readonly hidden: number } => {
  const shown: ChangeHunkDto[] = []
  let left = cap
  for (const hunk of hunks) {
    if (left <= 0) break
    shown.push(hunk.lines.length <= left ? hunk : { ...hunk, lines: hunk.lines.slice(0, left) })
    left -= hunk.lines.length
  }
  const all = hunks.reduce((n, hunk) => n + hunk.lines.length, 0)
  return { shown, hidden: Math.max(0, all - cap) }
}

/** Which side of a hunk a row's text belongs to, and its index down that side. */
export interface Placed {
  readonly side: "old" | "new"
  readonly row: number
}

/**
 * A hunk as two blocks of source and the map back onto its rows.
 *
 * A context line is on both sides and is placed on the new one, arbitrarily and
 * consistently — the two texts are identical there, so which is read makes no difference
 * to the colour. The no-newline marker is on neither: it is not source.
 */
export const sidesOf = (
  hunk: ChangeHunkDto,
): {
  readonly old: string
  readonly new: string
  /** One entry per line of the hunk, in the hunk's own order. `undefined` where the row
   *  carries no source — the no-newline marker is the only one. */
  readonly placed: readonly (Placed | undefined)[]
} => {
  const before: string[] = []
  const after: string[] = []
  const placed: (Placed | undefined)[] = []
  for (const line of hunk.lines) {
    if (isNoNewline(line)) {
      placed.push(undefined)
      continue
    }
    if (line.kind === "del") {
      placed.push({ side: "old", row: before.length })
      before.push(line.text)
      continue
    }
    if (line.kind === "context") before.push(line.text)
    placed.push({ side: "new", row: after.length })
    after.push(line.text)
  }
  return { old: before.join("\n"), new: after.join("\n"), placed }
}

/** The shiki grammar a path wants, by its extension — `format/grammar` holds the map. */
export const languageOf = (path: string): Grammar | undefined => {
  const name = splitPath(path).name
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? undefined : grammarOf(name.slice(dot + 1))
}
