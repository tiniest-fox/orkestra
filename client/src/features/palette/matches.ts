/**
 * What the ⌘K palette finds, in the order it draws them: traks, then files by path, then
 * lines in files. The live traks and the paths are matched here, over what the page
 * already holds; the lines and the put-away traks are the engine's answers, grouped here.
 *
 * Every match ignores case and is a plain substring, the same rule the engine's search
 * uses, so the three sections agree about what *matches* means.
 */

import type {
  ArchivedTrakDto,
  ArchivedTrakListDto,
  FileMatchDto,
  FileSearchDto,
  TrakSummaryDto,
} from "../../api/types"

/** The most paths one query draws. A one-letter query matches most of a repository. */
const PATH_CAP = 50

const holds = (text: string, needle: string): boolean => text.toLowerCase().includes(needle)

/** The live traks whose title, request or id holds `query`, in the list's order. */
export const traksMatching = (
  traks: readonly TrakSummaryDto[],
  query: string,
): readonly TrakSummaryDto[] => {
  const needle = query.toLowerCase()
  return traks.filter(
    (t) => holds(t.title ?? "", needle) || holds(t.description, needle) || holds(t.id, needle),
  )
}

/**
 * The paths holding `query` — those whose file name holds it first, since that is what
 * somebody typing a name is after — at most `PATH_CAP`, and whether more were left out.
 */
export const pathsMatching = (
  paths: readonly string[],
  query: string,
): { readonly paths: readonly string[]; readonly cut: boolean } => {
  const needle = query.toLowerCase()
  const named: string[] = []
  const under: string[] = []
  for (const path of paths) {
    if (holds(nameOf(path), needle)) named.push(path)
    else if (holds(path, needle)) under.push(path)
  }
  const all = [...named, ...under]
  return { paths: all.slice(0, PATH_CAP), cut: all.length > PATH_CAP }
}

/** One file's matching lines, under it. */
export interface FileLines {
  readonly path: string
  readonly lines: readonly FileMatchDto[]
}

/** The engine's matches, one group per file, in the order the engine sent them. */
export const linesByFile = (matches: readonly FileMatchDto[]): readonly FileLines[] => {
  const groups = new Map<string, FileMatchDto[]>()
  for (const match of matches) {
    const group = groups.get(match.path) ?? []
    group.push(match)
    groups.set(match.path, group)
  }
  return [...groups].map(([path, lines]) => ({ path, lines }))
}

/** What one query found, matched and grouped, section by section. */
export interface Found {
  readonly live: readonly TrakSummaryDto[]
  readonly archived: readonly ArchivedTrakDto[]
  readonly paths: readonly string[]
  readonly pathsCut: boolean
  readonly lines: readonly FileLines[]
  readonly linesCut: boolean
}

/** Every section for `query`, from what the page holds and what the engine answered. */
export const findAll = (
  query: string,
  traks: readonly TrakSummaryDto[],
  paths: readonly string[],
  archived: ArchivedTrakListDto | undefined,
  lines: FileSearchDto | undefined,
): Found => {
  const files = pathsMatching(paths, query)
  return {
    live: traksMatching(traks, query),
    archived: archived?.traks ?? [],
    paths: files.paths,
    pathsCut: files.cut,
    lines: linesByFile(lines?.matches ?? []),
    linesCut: lines?.cut ?? false,
  }
}

/** Whether a query found nothing in any section. */
export const foundNothing = (found: Found): boolean =>
  found.live.length + found.archived.length + found.paths.length + found.lines.length === 0

/** The last segment of a path. */
export const nameOf = (path: string): string => path.split("/").at(-1) ?? path

/** Everything before the last segment, with its slash, or nothing at the top. */
export const folderOf = (path: string): string => {
  const cut = path.lastIndexOf("/")
  return cut === -1 ? "" : path.slice(0, cut + 1)
}

/** A file's badge: its extension, short and upper-cased, or two dots for none. */
export const badgeOf = (path: string): string => {
  const name = nameOf(path)
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "··" : name.slice(dot + 1, dot + 5).toUpperCase()
}

/** `text` cut into runs, each saying whether it is an occurrence of `query`. */
export const marked = (
  text: string,
  query: string,
): readonly { readonly text: string; readonly hit: boolean }[] => {
  if (query === "") return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const runs: { text: string; hit: boolean }[] = []
  let from = 0
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) runs.push({ text: text.slice(from, at), hit: false })
    runs.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
  }
  if (from < text.length) runs.push({ text: text.slice(from), hit: false })
  return runs
}
