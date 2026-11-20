/**
 * A ```changes fence, read into buckets of files — and joined to a step's diff where a page
 * has one to give.
 *
 * ```
 * ## The figure key
 * why: an output section can declare a figure
 * ~ src/library/types/agent.ts
 *   FIGURES, the names a section may declare
 * > web/components/InlineCode.tsx -> web/components/CodeSpans.tsx
 *   code spans, now shared with the map
 * ```
 *
 * A `## ` line opens a bucket and the `why:` line under it says what the bucket is for.
 * Each file starts with its kind — `+` added, `~` modified, `-` deleted, `>` renamed as
 * `old -> new` — then its whole path, and an indented line under it says why it changed.
 *
 * **`undefined` is the whole failure**, and the caller draws the fence as the source it is,
 * as every figure does: a guess at what a malformed one meant would draw a bucket nobody
 * wrote.
 *
 * **The join flags only what the diff can prove.** A path the agent named that the diff
 * lacks is warned, and a changed file nobody named gathers in an Unexplained bucket — but
 * both are claims about the *whole* diff, so a diff the engine capped makes neither. A file
 * the capped list happens to hold still gets its counts.
 *
 * Kind `pure`: sibling pure modules, and no React.
 */

export type ChangeKind = "added" | "modified" | "deleted" | "renamed"

/** One file as the agent wrote it. */
export interface ChangeEntry {
  readonly kind: ChangeKind
  /** Where the file is now — a rename's new path. */
  readonly path: string
  readonly oldPath: string | undefined
  readonly why: string | undefined
}

export interface ChangeBucket {
  readonly name: string
  readonly why: string | undefined
  readonly entries: readonly ChangeEntry[]
}

/** All the join reads of one file in the step's diff — `FileChangeDto` satisfies it. */
export interface DiffFile {
  readonly path: string
  readonly oldPath?: string | undefined
  readonly change: ChangeKind
  readonly additions: number
  readonly deletions: number
}

/** One drawn file: what the agent wrote, and what the diff says where there is a diff. */
export interface MapFile {
  readonly kind: ChangeKind
  readonly path: string
  readonly oldPath: string | undefined
  readonly why: string | undefined
  /** Only where the file is in the step's diff. */
  readonly counts: { readonly added: number; readonly deleted: number } | undefined
  /** Named by the agent, absent from a diff that is known to be whole. */
  readonly missing: boolean
}

export interface MapBucket {
  readonly name: string
  readonly why: string | undefined
  readonly files: readonly MapFile[]
  /** The bucket the join adds for changed files nobody named. */
  readonly unexplained: boolean
}

const KIND: Readonly<Record<string, ChangeKind>> = {
  "+": "added",
  "~": "modified",
  "-": "deleted",
  ">": "renamed",
}

const ENTRY = /^([+~>-]) (\S.*)$/
const RENAME = " -> "

type DraftEntry = { kind: ChangeKind; path: string; oldPath: string | undefined; why: string[] }
type Draft = { name: string; why: string | undefined; entries: DraftEntry[] }

/** A file line, or `undefined` where its path is not one the join could match. */
const entryOf = (mark: string, body: string): DraftEntry | undefined => {
  const kind = KIND[mark]
  if (kind === undefined) return undefined
  const halves = body.split(RENAME)
  if (kind !== "renamed")
    return halves.length === 1
      ? { kind, path: body.trim(), oldPath: undefined, why: [] }
      : undefined
  const [from, to] = halves
  if (halves.length !== 2 || from === undefined || to === undefined) return undefined
  if (from.trim() === "" || to.trim() === "") return undefined
  return { kind, path: to.trim(), oldPath: from.trim(), why: [] }
}

/** Reads a ```changes fence, or `undefined` where it does not parse. */
export const parseChanges = (source: string): readonly ChangeBucket[] | undefined => {
  const buckets: Draft[] = []
  for (const line of source.split("\n")) {
    if (line.trim() === "") continue
    const bucket = buckets.at(-1)
    const last = bucket?.entries.at(-1)
    if (line.startsWith("## ")) {
      const name = line.slice(3).trim()
      if (name === "") return undefined
      buckets.push({ name, why: undefined, entries: [] })
    } else if (line.startsWith("why:")) {
      // Under its heading and nowhere else: a `why:` after a file would be read as the
      // bucket's by one reader and the file's by another.
      if (bucket === undefined || bucket.why !== undefined || bucket.entries.length > 0)
        return undefined
      bucket.why = line.slice(4).trim()
    } else if (/^\s/.test(line)) {
      if (last === undefined) return undefined
      last.why.push(line.trim())
    } else {
      const match = ENTRY.exec(line)
      const entry = match === null ? undefined : entryOf(match[1] ?? "", match[2] ?? "")
      if (bucket === undefined || entry === undefined) return undefined
      bucket.entries.push(entry)
    }
  }
  if (buckets.length === 0 || buckets.some((b) => b.entries.length === 0)) return undefined
  // A bucket is opened by its name and a file by its path, and the grammar puts every file
  // in exactly one bucket — so a repeat of either is a fence that does not say one thing.
  const names = buckets.map((b) => b.name)
  const paths = buckets.flatMap((b) => b.entries.map((e) => e.path))
  if (new Set(names).size !== names.length || new Set(paths).size !== paths.length) return undefined
  return buckets.map((b) => ({
    name: b.name,
    why: b.why === "" ? undefined : b.why,
    entries: b.entries.map((e) => ({
      kind: e.kind,
      path: e.path,
      oldPath: e.oldPath,
      why: e.why.length === 0 ? undefined : e.why.join(" "),
    })),
  }))
}

/**
 * What the step's diff can say about one figure, or nothing where there is no diff.
 *
 * `complete` is false where the engine capped the list, and that is what withholds the
 * missing warnings and the Unexplained bucket.
 */
export interface DiffJoin {
  readonly files: readonly DiffFile[]
  readonly complete: boolean
}

export const UNEXPLAINED = "Unexplained"

/**
 * The buckets to draw: as the agent wrote them where there is no diff, and joined by exact
 * path where there is one. A joined file takes the diff's kind and old path, since git's
 * reading of a rename is the true one.
 */
export const joinChanges = (
  buckets: readonly ChangeBucket[],
  diff: DiffJoin | undefined,
): readonly MapBucket[] => {
  const byPath = new Map((diff?.files ?? []).map((file) => [file.path, file]))
  const drawn: MapBucket[] = buckets.map((bucket) => ({
    name: bucket.name,
    why: bucket.why,
    unexplained: false,
    files: bucket.entries.map((entry): MapFile => {
      const file = byPath.get(entry.path)
      return file === undefined
        ? { ...entry, counts: undefined, missing: diff?.complete === true }
        : {
            kind: file.change,
            path: entry.path,
            oldPath: file.oldPath ?? entry.oldPath,
            why: entry.why,
            counts: { added: file.additions, deleted: file.deletions },
            missing: false,
          }
    }),
  }))
  if (diff === undefined || !diff.complete) return drawn
  const named = new Set(buckets.flatMap((bucket) => bucket.entries.map((entry) => entry.path)))
  const rest = diff.files.filter((file) => !named.has(file.path))
  if (rest.length === 0) return drawn
  return [
    ...drawn,
    {
      name: UNEXPLAINED,
      why: undefined,
      unexplained: true,
      files: rest.map((file) => ({
        kind: file.change,
        path: file.path,
        oldPath: file.oldPath,
        why: undefined,
        counts: { added: file.additions, deleted: file.deletions },
        missing: false,
      })),
    },
  ]
}

/** A bucket's row summary: files of each kind, lines where counted, and how many are missing. */
export interface BucketTotals {
  readonly kinds: Readonly<Record<ChangeKind, number>>
  /** `undefined` where no file in the bucket was found in a diff. */
  readonly lines: { readonly added: number; readonly deleted: number } | undefined
  readonly missing: number
}

export const bucketTotals = (files: readonly MapFile[]): BucketTotals => {
  const kinds = { added: 0, modified: 0, deleted: 0, renamed: 0 }
  let lines: { added: number; deleted: number } | undefined
  let missing = 0
  for (const file of files) {
    kinds[file.kind] += 1
    if (file.counts !== undefined) {
      lines ??= { added: 0, deleted: 0 }
      lines.added += file.counts.added
      lines.deleted += file.counts.deleted
    }
    if (file.missing) missing += 1
  }
  return { kinds, lines, missing }
}
