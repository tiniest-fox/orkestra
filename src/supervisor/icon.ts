// Which file in a checkout is the project's picture, decided from the list of files git
// tracks — the tile draws it, and two letters on a colour where there is none.
//
// Pure over the list, so the choice is testable without a repository; `icon-file.ts` asks
// git for the list and reads the winner. The tracked files rather than a walk of the
// directory, because a walk enters `node_modules` and every trak's worktree.

/** The names a project's picture goes by, best first. */
const NAMES = ["favicon", "icon", "apple-touch-icon", "logo"] as const

/** The kinds an `<img>` draws, best first: a vector scales to the tile. */
const KINDS = ["svg", "png", "ico"] as const

const MIME: Record<(typeof KINDS)[number], string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
}

interface Candidate {
  readonly path: string
  readonly depth: number
  readonly name: number
  readonly kind: number
}

const candidate = (path: string): Candidate | undefined => {
  const segments = path.split("/")
  const file = (segments.at(-1) ?? "").toLowerCase()
  const dot = file.lastIndexOf(".")
  const kind = KINDS.findIndex((k) => k === file.slice(dot + 1))
  // `icon-512.png` and `favicon.svg` both count; `iconography.png` does not.
  const name = NAMES.findIndex((n) => new RegExp(`^${n}(?:[-_.@]|$)`, "u").test(file.slice(0, dot)))
  if (dot === -1 || kind === -1 || name === -1) return undefined
  return { path, depth: segments.length, name, kind }
}

/**
 * The tracked files that could be the picture, best first: the one highest in the tree,
 * then by name, then by kind, then by path so the answer is the same every launch.
 */
export const rankIcons = (files: readonly string[]): readonly string[] =>
  files
    .flatMap((path) => candidate(path) ?? [])
    .sort(
      (a, b) =>
        a.depth - b.depth || a.name - b.name || a.kind - b.kind || a.path.localeCompare(b.path),
    )
    .map((c) => c.path)

/** The media type a `data:` address for `path` carries, or `undefined` for a kind not drawn. */
export const iconMime = (path: string): string | undefined => {
  const kind = KINDS.find((k) => path.toLowerCase().endsWith(`.${k}`))
  return kind === undefined ? undefined : MIME[kind]
}
