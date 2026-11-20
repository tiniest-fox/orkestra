// The project checkout's files: the browser's tree, one file, and a text search. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// The project checkout's files — the file browser's tree, one file, and a text search
// ============================================================================

/**
 * `GET /api/files`: every file git sees in the project checkout, on disk now — tracked
 * files still there, and untracked ones `.gitignore` does not exclude. Relative to the
 * checkout's root, in git's order, which is the tree's.
 */
export const ProjectFilesDto = Schema.Struct({ paths: Schema.Array(Schema.String) })
export type ProjectFilesDto = Schema.Schema.Type<typeof ProjectFilesDto>

/** A file the viewer can draw: its text, and how many lines that is. */
export const FileTextDto = Schema.TaggedStruct("Text", {
  path: Schema.String,
  text: Schema.String,
  lines: Schema.Number,
})
/** A file with a NUL byte near its start, so not text — its size and nothing else. */
export const FileBinaryDto = Schema.TaggedStruct("Binary", {
  path: Schema.String,
  bytes: Schema.Number,
})
/**
 * A file over the viewer's cap — its size and nothing else. The cap is what keeps one
 * colouring pass from holding the page.
 */
export const FileTooLargeDto = Schema.TaggedStruct("TooLarge", {
  path: Schema.String,
  bytes: Schema.Number,
})
/** `GET /api/files/content?path=`: one file the list names, as the viewer draws it. */
export const FileContentDto = Schema.Union(FileTextDto, FileBinaryDto, FileTooLargeDto)
export type FileContentDto = Schema.Schema.Type<typeof FileContentDto>

/** One line holding the searched text. `line` is 1-based. */
export const FileMatchDto = Schema.Struct({
  path: Schema.String,
  line: Schema.Number,
  text: Schema.String,
})
export type FileMatchDto = Schema.Schema.Type<typeof FileMatchDto>

/**
 * `GET /api/files/search?q=`: the lines of those files holding `q`, as a fixed string and
 * ignoring case, uncommitted edits included. `cut` says the cap left some out.
 */
export const FileSearchDto = Schema.Struct({
  matches: Schema.Array(FileMatchDto),
  cut: Schema.Boolean,
})
export type FileSearchDto = Schema.Schema.Type<typeof FileSearchDto>
