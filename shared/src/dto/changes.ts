// What a trak's work did to the files. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// Changes — what the work did to the files
// ============================================================================

/**
 * One line of a hunk.
 *
 * **`text` carries no marker.** The leading `+`, `-` or space is what `kind`
 * says, so a renderer draws the line rather than stripping a character off it —
 * and a context line whose own first character is a `+` cannot be misread.
 *
 * `oldLine` is absent on an added line and `newLine` on a removed one, which is
 * what lets both gutters be drawn from the same row without a sentinel number
 * standing for *not on this side*.
 *
 * **A `context` row may be a note about the file rather than a line of it**, and
 * `\ No newline at end of file` is the only one: it arrives as that text
 * verbatim with neither number, because it belongs to no side. Whether a file
 * ends in a newline is invisible otherwise — the two sides draw as identical
 * text — so it is carried rather than dropped, and a renderer that draws every
 * row the same way draws it as a line of the file with no number, which is
 * wrong but not misleading.
 */
export const ChangeLineDto = Schema.Struct({
  kind: Schema.Literal("add", "del", "context"),
  text: Schema.String,
  oldLine: Schema.optional(Schema.Number),
  newLine: Schema.optional(Schema.Number),
})
export type ChangeLineDto = Schema.Schema.Type<typeof ChangeLineDto>

/**
 * One run of changed lines with its context, as git's `@@` header describes it.
 *
 * `heading` is the text git puts after the closing `@@` — usually the enclosing
 * function, and empty when git found nothing to name. Empty rather than absent
 * because *no heading* and *a heading of nothing* are the same fact here, and one
 * representation of it is one branch fewer in every renderer.
 */
export const ChangeHunkDto = Schema.Struct({
  oldStart: Schema.Number,
  oldCount: Schema.Number,
  newStart: Schema.Number,
  newCount: Schema.Number,
  heading: Schema.String,
  lines: Schema.Array(ChangeLineDto),
})
export type ChangeHunkDto = Schema.Schema.Type<typeof ChangeHunkDto>

/**
 * One file, and what happened to it.
 *
 * **`additions` and `deletions` are always here, even when `hunks` is empty** —
 * a file dropped for being enormous still draws a row with its `+/−`, which is
 * the whole reason a cap is bearable. The one exception is a binary file, where
 * git counts no lines at all and both are `0`: there is nothing to report, and
 * inventing a number would be worse than the honest zero beside `binary`.
 *
 * `omitted` says **why** `hunks` is empty, and its absence with no hunks means
 * the file genuinely has none — a mode change, or a rename that moved the
 * content unaltered. `generated` is the one that has hunks and did not send them:
 * `.gitattributes` marks the file `linguist-generated`, and its patch is asked for on its
 * own — `GET /api/traks/:id/changes?at=&path=` — when a reader opens it.
 *
 * `oldPath` is present only on a rename, and `path` is always where the file is
 * now.
 */
export const FileChangeDto = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.optional(Schema.String),
  change: Schema.Literal("added", "modified", "deleted", "renamed"),
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
  omitted: Schema.optional(Schema.Literal("binary", "too-large", "generated")),
  hunks: Schema.Array(ChangeHunkDto),
})
export type FileChangeDto = Schema.Schema.Type<typeof FileChangeDto>

/**
 * What one slice of a trak's work did to the files.
 *
 * `at` echoes what was asked for — `all`, `uncommitted`, or a step index as a
 * string — so a response that arrives after the selection moved can be told from
 * the one that was asked for.
 *
 * `omittedFiles` is how many the file cap dropped, and it is absent when none
 * were. **Stated rather than silent**: a truncated list that says nothing reads
 * exactly like a complete one.
 */
export const ChangesDto = Schema.Struct({
  at: Schema.String,
  files: Schema.Array(FileChangeDto),
  omittedFiles: Schema.optional(Schema.Number),
})
export type ChangesDto = Schema.Schema.Type<typeof ChangesDto>
