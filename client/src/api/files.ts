/** The `files` slice's routes: the project checkout's files — the file browser and the ⌘K palette. */

import { Schema } from "effect"
import {
  FileContentDto as FileContentSchema,
  FileSearchDto as FileSearchSchema,
  ProjectFilesDto as ProjectFilesSchema,
} from "@orkestra/shared/dto/files"
import { get } from "./http"
import type { FileContentDto, FileSearchDto, ProjectFilesDto } from "./types"

const decodeProjectFiles = Schema.decodeUnknownSync(ProjectFilesSchema)
const decodeFileContent = Schema.decodeUnknownSync(FileContentSchema)
const decodeFileSearch = Schema.decodeUnknownSync(FileSearchSchema)

/**
 * `GET /api/files`. Free: two `git ls-files` against the project checkout. Every file git
 * sees there on disk now — ignored ones are not in it, and nothing else can be opened.
 */
export const projectFiles = async (): Promise<ProjectFilesDto> =>
  decodeProjectFiles(await get("/api/files"))

/**
 * `GET /api/files/content?path=`. Free. The file's text, or its size where it is binary or
 * over the viewer's cap. A 404 for any path the list does not name.
 */
export const fileContent = async (path: string): Promise<FileContentDto> =>
  decodeFileContent(await get(`/api/files/content?path=${encodeURIComponent(path)}`))

/**
 * `GET /api/files/search?q=`. Free: one `git grep` over the same files, uncommitted edits
 * included — a fixed string, ignoring case, capped.
 */
export const searchFiles = async (q: string): Promise<FileSearchDto> =>
  decodeFileSearch(await get(`/api/files/search?q=${encodeURIComponent(q)}`))
