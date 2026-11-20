// logic: git's patch text, as files → hunks → lines. Pure, and the only place
// that reads the unified-diff format.
//
// **Everything is read off the patch, and nothing is asked of git twice.** The
// counts a `--numstat` would give are the `+`/`-` lines of the patch we already
// have, so a second invocation could only ever disagree with this one — and it
// would still say `-` for the binary files, which are the one case it looks like
// it would rescue.
//
// The caps live here rather than in the adapter because they are decisions about
// the *answer*, and this is the only thing that can apply them and keep the
// counts honest: a file's `+/−` is known by the time its hunks are dropped.

import type { ChangeHunk, ChangeKind, ChangeLine, Changes, FileChange } from "../types/changes.js"

/**
 * How many files one answer carries, and how long one file's patch may be.
 *
 * **The point of both is that the answer is finite**, not that these numbers are
 * right. A branch that touched a lockfile and a build directory is the ordinary
 * case, and neither the wire nor a browser should carry it whole — so the list
 * is cut and what was cut is counted, which is the difference between a bounded
 * answer and a quiet lie. Raise them if a real trak proves them mean; do not
 * remove them.
 *
 * `FILE_CAP` is exported because the adapter has to stop before the cut as well:
 * an untracked file costs a `git` process each, so a thousand of them would be a
 * thousand spawns to produce a list this then throws most of away.
 */
export const FILE_CAP = 200
const LINE_CAP = 1200

/** `@@ -a,b +c,d @@ heading` — either count omitted means 1, as git writes it. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** A file being read, before it is a `FileChange`. */
interface Draft {
  path: string
  oldPath: string | undefined
  change: ChangeKind
  binary: boolean
  additions: number
  deletions: number
  /** Body lines seen, against `LINE_CAP` — counted even once they stop being kept. */
  bodyLines: number
  hunks: ChangeHunk[]
}

/** A hunk being read, with the two line numbers walking down it. */
interface OpenHunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly heading: string
  readonly lines: ChangeLine[]
  oldLine: number
  newLine: number
  remainingOld: number
  remainingNew: number
}

/**
 * The path out of a `diff --git a/x b/x` line.
 *
 * **The halves are matched against each other rather than split on the first
 * space**, because a path may contain one: `a/my file.ts b/my file.ts` splits
 * four ways and only one of them has the two sides agreeing. A rename disagrees
 * by construction, so it falls back to the first plausible split and is then
 * corrected by the `rename from`/`rename to` lines, which are unambiguous.
 *
 * A path git C-quotes — one holding a `"`, a backslash or a control character —
 * is left as git wrote it, quotes and all. `core.quotePath=false` on the
 * invocation covers the non-ASCII case, which is the one that turns up.
 */
const headerPath = (rest: string): { path: string; oldPath: string | undefined } => {
  const marks: number[] = []
  for (let i = rest.indexOf(" b/"); i !== -1; i = rest.indexOf(" b/", i + 1)) marks.push(i)
  const agreed = marks.find((i) => rest.slice(2, i) === rest.slice(i + 3))
  if (agreed !== undefined) return { path: rest.slice(agreed + 3), oldPath: undefined }
  const first = marks[0]
  if (first === undefined) return { path: rest, oldPath: undefined }
  return { path: rest.slice(first + 3), oldPath: rest.slice(2, first) }
}

/**
 * A `---`/`+++` path, without its prefix and without the tab git appends when
 * the name contains a space.
 */
const sidePath = (rest: string): string => {
  const tab = rest.indexOf("\t")
  const path = tab === -1 ? rest : rest.slice(0, tab)
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path
}

const startDraft = (line: string): Draft => {
  const { path, oldPath } = headerPath(line.slice("diff --git ".length))
  return {
    path,
    oldPath,
    change: "modified",
    binary: false,
    additions: 0,
    deletions: 0,
    bodyLines: 0,
    hunks: [],
  }
}

const openHunk = (found: RegExpExecArray): OpenHunk => {
  const oldStart = Number(found[1])
  const oldCount = found[2] === undefined ? 1 : Number(found[2])
  const newStart = Number(found[3])
  const newCount = found[4] === undefined ? 1 : Number(found[4])
  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    heading: found[5] ?? "",
    lines: [],
    oldLine: oldStart,
    newLine: newStart,
    remainingOld: oldCount,
    remainingNew: newCount,
  }
}

/**
 * The hunk as it goes onto the file, **sharing the `lines` array** with the open
 * one: it is pushed the moment the `@@` header is read and fills as the body is
 * walked, so there is no end-of-hunk to detect and no second pass.
 */
const hunkOf = (open: OpenHunk): ChangeHunk => ({
  oldStart: open.oldStart,
  oldCount: open.oldCount,
  newStart: open.newStart,
  newCount: open.newCount,
  heading: open.heading,
  lines: open.lines,
})

/**
 * One body line, onto the hunk and onto the file's counts.
 *
 * `keep` is false once the file is over `LINE_CAP`: the walk carries on so the
 * counts and the hunk boundaries stay right, and only the rows stop being
 * stored.
 */
const takeBody = (hunk: OpenHunk, draft: Draft, raw: string, keep: boolean): void => {
  const marker = raw.charAt(0)
  draft.bodyLines += 1
  const text = raw.slice(1)
  const line: ChangeLine =
    marker === "+"
      ? { kind: "add", text, newLine: hunk.newLine }
      : marker === "-"
        ? { kind: "del", text, oldLine: hunk.oldLine }
        : { kind: "context", text, oldLine: hunk.oldLine, newLine: hunk.newLine }
  if (marker === "+") {
    draft.additions += 1
    hunk.newLine += 1
    hunk.remainingNew -= 1
  } else if (marker === "-") {
    draft.deletions += 1
    hunk.oldLine += 1
    hunk.remainingOld -= 1
  } else {
    hunk.oldLine += 1
    hunk.newLine += 1
    hunk.remainingOld -= 1
    hunk.remainingNew -= 1
  }
  if (keep) hunk.lines.push(line)
}

/**
 * `\ No newline at end of file`, which is git's note about the line above rather
 * than a line of the file.
 *
 * **Kept, and kept verbatim, as a `context` row with no numbers on it.** It is
 * the only thing that says a file's trailing newline was added or removed —
 * without it the two sides draw as identical text with nothing explaining why
 * they are there. A `ChangeLine` is a kind and a text with both numbers
 * optional, so the row it wants is one the shape already has; it moves neither
 * line number and counts toward neither `additions` nor `deletions`, because it
 * is on neither side.
 *
 * **Read outside the hunk body as well as inside it**, which is why this is not
 * a branch of `takeBody`: git writes the marker after the line it is about, and
 * when that is the hunk's last line git's own counts have already run out. A
 * body line always carries a `+`, `-` or space marker, so a leading backslash
 * can only be this.
 */
const takeMarker = (hunk: OpenHunk, draft: Draft, raw: string, keep: boolean): void => {
  draft.bodyLines += 1
  if (keep) hunk.lines.push({ kind: "context", text: raw })
}

/** Is this line still inside the hunk, by git's own count rather than by shape? */
const inBody = (hunk: OpenHunk): boolean => hunk.remainingOld > 0 || hunk.remainingNew > 0

/**
 * The header lines between hunks, each of which is git stating a fact about the
 * file rather than about its content.
 *
 * `--- /dev/null` is how a `--no-index` diff of an untracked file says *added*,
 * where a tracked one says it with `new file mode` — both are here because the
 * uncommitted slice is the two kinds concatenated.
 *
 * **`+++` is what settles the path, and `rename to` overrides it.** The
 * `diff --git` line already agrees with `+++` for everything that is not a
 * rename, so this only matters where that line is ambiguous; a rename's two
 * sides differ by construction, which is what the `rename` lines are for.
 */
const takeHeader = (draft: Draft, line: string): void => {
  if (line.startsWith("new file mode ") || line === "--- /dev/null") draft.change = "added"
  else if (line.startsWith("deleted file mode ") || line === "+++ /dev/null") {
    draft.change = "deleted"
  } else if (line.startsWith("rename from ")) {
    draft.change = "renamed"
    draft.oldPath = line.slice("rename from ".length)
  } else if (line.startsWith("rename to ")) {
    draft.change = "renamed"
    draft.path = line.slice("rename to ".length)
  } else if (line.startsWith("+++ ") && draft.change !== "renamed") {
    draft.path = sidePath(line.slice("+++ ".length))
    draft.oldPath = undefined
  } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
    draft.binary = true
  }
}

/**
 * A finished draft, with the caps applied.
 *
 * A binary file loses its hunks because it never had any, and reports `0/0`
 * because git counts no lines in one. An over-cap file keeps every number and
 * loses only the rows.
 */
const finish = (draft: Draft): FileChange => {
  const omitted = draft.binary ? "binary" : draft.bodyLines > LINE_CAP ? "too-large" : undefined
  return {
    path: draft.path,
    ...(draft.oldPath === undefined || draft.oldPath === draft.path
      ? {}
      : { oldPath: draft.oldPath }),
    change: draft.change,
    additions: draft.binary ? 0 : draft.additions,
    deletions: draft.binary ? 0 : draft.deletions,
    binary: draft.binary,
    ...(omitted === undefined ? {} : { omitted }),
    hunks: omitted === undefined ? draft.hunks : [],
  }
}

/**
 * Every file in a patch, in the order git printed them.
 *
 * **A hunk is left by git's own line counts, never by what a line looks like.**
 * A removed line whose content starts with `--` reads as `---` once its marker
 * is on the front, and a shape test would take it for the next file's header and
 * lose the rest of the hunk. The `@@` header says how many lines of each side to
 * expect, and that is what decides where the body ends.
 */
const parseFiles = (patch: string): readonly FileChange[] => {
  const out: FileChange[] = []
  let draft: Draft | undefined
  let hunk: OpenHunk | undefined
  for (const line of patch.split("\n")) {
    if (hunk !== undefined && draft !== undefined && line.startsWith("\\")) {
      takeMarker(hunk, draft, line, draft.bodyLines < LINE_CAP)
      continue
    }
    if (hunk !== undefined && draft !== undefined && inBody(hunk)) {
      takeBody(hunk, draft, line, draft.bodyLines < LINE_CAP)
      continue
    }
    if (line.startsWith("diff --git ")) {
      if (draft !== undefined) out.push(finish(draft))
      draft = startDraft(line)
      hunk = undefined
      continue
    }
    if (draft === undefined) continue
    const found = HUNK.exec(line)
    if (found === null) {
      takeHeader(draft, line)
      continue
    }
    hunk = openHunk(found)
    draft.hunks.push(hunkOf(hunk))
  }
  if (draft !== undefined) out.push(finish(draft))
  return out
}

/**
 * A patch — or several concatenated — as one answer, sorted and capped.
 *
 * **Sorted by path**, because the uncommitted slice is git's tracked diff with a
 * `--no-index` diff per untracked file appended, and an answer where every new
 * file lands in a clump at the bottom reads as two lists rather than one.
 *
 * The cap is applied after the sort, so which files a truncated answer holds is
 * a fact about the paths rather than about the order git happened to print them.
 */
export const parseUnifiedDiff = (patch: string): Changes => {
  const files = [...parseFiles(patch)].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
  const dropped = files.length - FILE_CAP
  return {
    files: dropped > 0 ? files.slice(0, FILE_CAP) : files,
    ...(dropped > 0 ? { omittedFiles: dropped } : {}),
  }
}
