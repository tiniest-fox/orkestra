// types: what a diff is, once git's patch text has been read.
//
// Plain shapes rather than Schemas, like `MergeOutcome`: nothing decodes one.
// They are produced by `logic/diff.ts` from text the adapter already has and
// consumed by a mapper, so there is no boundary for a Schema to guard.

/** What happened to the file, as git's own patch headers say it. */
export type ChangeKind = "added" | "modified" | "deleted" | "renamed"

/**
 * One line of a hunk, without its `+`/`-`/space marker — `kind` is what that
 * marker said, so nothing downstream strips a character off the text.
 *
 * A line number is absent on the side the line is not on: `oldLine` on an added
 * line, `newLine` on a removed one — and **both are absent on the one row that
 * is not a line at all**, `\ No newline at end of file`, which arrives as a
 * `context` row whose `text` is that marker verbatim.
 */
export interface ChangeLine {
  readonly kind: "add" | "del" | "context"
  readonly text: string
  readonly oldLine?: number
  readonly newLine?: number
}

/**
 * One `@@` run: where it sits on each side, and the lines in it.
 *
 * `heading` is what git prints after the closing `@@`, usually the enclosing
 * function. Empty when there is none.
 */
export interface ChangeHunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly heading: string
  readonly lines: readonly ChangeLine[]
}

/**
 * One file, and what happened to it.
 *
 * **The counts survive the hunks going.** A file dropped for being enormous
 * still says how much of it changed, which is what makes a cap bearable rather
 * than a hole. A binary file is the one place both are `0`: git counts no lines
 * in one, and a made-up number would be worse than the zero beside `binary`.
 *
 * `omitted` says why `hunks` is empty. Absent with no hunks means the file
 * really has none — a mode change, or a rename that moved the content unaltered.
 * `generated` is a file `.gitattributes` marks `linguist-generated`, whose hunks are
 * asked for by path rather than sent with the slice.
 */
export interface FileChange {
  readonly path: string
  readonly oldPath?: string
  readonly change: ChangeKind
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
  readonly omitted?: "binary" | "too-large" | "generated"
  readonly hunks: readonly ChangeHunk[]
}

/**
 * A whole slice, and what the file cap dropped from it.
 *
 * `omittedFiles` is absent when nothing was dropped, and a count rather than a
 * boolean because *how many* is what tells a reader whether they are looking at
 * most of the work or a corner of it.
 */
export interface Changes {
  readonly files: readonly FileChange[]
  readonly omittedFiles?: number
}
