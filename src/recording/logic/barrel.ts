// logic: whether a barrel's edits leave what a test ran unchanged.
//
// A barrel here is a file whose top level is only named re-exports — `export { … } from`
// and `export type { … } from` — with no `export *` and nothing declared. Adding a name to a
// block whose module already ran runs no new code, so the print of every test importing it
// can stand. A new block, or a value name added to a block a compiler may have dropped, runs
// its module's top-level code, which only an earlier load by the same test, or its package
// declaring `"sideEffects": false`, vouches for. Duplicate and unknown names are not
// checked: `tsc` rejects them in a stage that is never skipped.

/** One name in a block: as written, and whether it carries an inline `type` modifier. */
interface Specifier {
  readonly text: string
  readonly type: boolean
}

/** One `export { … } from "…"` block: whether it is `export type`, its names, its source. */
interface Block {
  readonly type: boolean
  readonly names: ReadonlyMap<string, Specifier>
  readonly from: string
}

/** A token at the top level: a word, a string's contents, or one punctuation mark. */
type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "mark"; readonly text: string }

const TOKEN =
  /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<word>[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)|"(?<dq>[^"\\\n]*)"|'(?<sq>[^'\\\n]*)'|(?<mark>[{},;])/uy

/** The text's tokens, without whitespace or comments, or `undefined` at anything else. */
const tokensOf = (text: string): readonly Token[] | undefined => {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < text.length) {
    const found = TOKEN.exec(text)
    if (found === null) return undefined
    const { word, dq, sq, mark } = found.groups ?? {}
    if (word !== undefined) tokens.push({ kind: "word", text: word })
    else if (dq !== undefined || sq !== undefined)
      tokens.push({ kind: "string", text: dq ?? sq ?? "" })
    else if (mark !== undefined) tokens.push({ kind: "mark", text: mark })
  }
  return tokens
}

const isMark = (token: Token | undefined, text: string): boolean =>
  token?.kind === "mark" && token.text === text

const isWord = (token: Token | undefined, text: string): boolean =>
  token?.kind === "word" && token.text === text

/** A name's token as written: a string keeps its quotes, so `"a"` and `a` stay apart. */
const nameText = (token: Token | undefined): string | undefined =>
  token?.kind === "word"
    ? token.text
    : token?.kind === "string"
      ? JSON.stringify(token.text)
      : undefined

/** One specifier — `[type] name [as name]` — read from `at`, and where it ends. */
const specifierAt = (
  tokens: readonly Token[],
  at: number,
): { readonly specifier: Specifier; readonly next: number } | undefined => {
  const parts: string[] = []
  let i = at
  // `type` is a modifier only when a name follows it; `{ type }` exports a name `type`.
  const modified =
    isWord(tokens[i], "type") &&
    nameText(tokens[i + 1]) !== undefined &&
    !isWord(tokens[i + 1], "as")
  if (modified) parts.push(tokens[i++]?.text ?? "")
  const name = nameText(tokens[i++])
  if (name === undefined) return undefined
  parts.push(name)
  if (isWord(tokens[i], "as")) {
    const alias = nameText(tokens[i + 1])
    if (alias === undefined) return undefined
    parts.push("as", alias)
    i += 2
  }
  return { specifier: { text: parts.join(" "), type: modified }, next: i }
}

/** The block starting at `at`, and where the next one starts. */
const blockAt = (
  tokens: readonly Token[],
  at: number,
): { readonly block: Block; readonly next: number } | undefined => {
  if (!isWord(tokens[at], "export")) return undefined
  let i = at + 1
  const type = isWord(tokens[i], "type")
  if (type) i++
  if (!isMark(tokens[i++], "{")) return undefined
  const names = new Map<string, Specifier>()
  while (!isMark(tokens[i], "}")) {
    const one = specifierAt(tokens, i)
    if (one === undefined) return undefined
    names.set(one.specifier.text, one.specifier)
    i = one.next
    if (isMark(tokens[i], ",")) i++
    else if (!isMark(tokens[i], "}")) return undefined
  }
  i++
  const from = tokens[i + 1]
  if (!isWord(tokens[i], "from") || from?.kind !== "string") return undefined
  i += 2
  if (isMark(tokens[i], ";")) i++
  return { block: { type, names, from: from.text }, next: i }
}

/** The blocks of `text` in order, or `undefined` where its top level holds anything else. */
const blocksOf = (text: string): readonly Block[] | undefined => {
  const tokens = tokensOf(text)
  if (tokens === undefined || tokens.length === 0) return undefined
  const blocks: Block[] = []
  for (let i = 0; i < tokens.length;) {
    const one = blockAt(tokens, i)
    if (one === undefined) return undefined
    blocks.push(one.block)
    i = one.next
  }
  return blocks
}

export const isBarrel = (text: string): boolean => blocksOf(text) !== undefined

/** Whether `next` is `old` with names added, in a block of the same kind and source. */
const grown = (old: Block, next: Block): boolean =>
  old.type === next.type &&
  old.from === next.from &&
  [...old.names.keys()].every((n) => next.names.has(n))

/**
 * Whether a kept block's module may run where it did not. A compiler drops a block whose
 * names are all types — by an inline `type`, or by what a type-aware compiler knows of them —
 * and nothing in the text says which, so any value name gained by a block with a relative
 * source is vouched for: by its module being one the test ran, or by `"sideEffects": false`.
 * A bare source is kept as it was, as the rule is stated for kept blocks. An `export type`
 * block runs no module whatever it names, so it never needs vouching.
 */
const firstRuns = (old: Block, next: Block): boolean =>
  !next.type &&
  relativeFrom(next.from) &&
  [...next.names].some(([text, specifier]) => !specifier.type && !old.names.has(text))

/**
 * The blocks of `next` whose module may run for the first time — every new block, and every
 * kept one `firstRuns` says of — or `undefined` where some block of `old` is not kept in order
 * with its names. Order is kept because it is the order the sources run in.
 */
const addedBlocks = (
  old: readonly Block[],
  next: readonly Block[],
): readonly Block[] | undefined => {
  const added: Block[] = []
  let kept = 0
  for (const block of next) {
    const held = old[kept]
    if (held !== undefined && grown(held, block)) {
      kept++
      if (firstRuns(held, block)) added.push(block)
    } else added.push(block)
  }
  return kept === old.length ? added : undefined
}

/** The directory holding `path`, by the path the print names; the checkout's root is `""`. */
const dirOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0))

/** The directories from `path`'s own up to the checkout's root, nearest first. */
const dirsAbove = (path: string): readonly string[] => {
  const dirs: string[] = []
  for (let dir = dirOf(path); dir !== ""; dir = dirOf(dir)) dirs.push(dir)
  return [...dirs, ""]
}

/** `from` resolved beside `dir`, with `.` and `..` gone; a path above the root keeps its `..`. */
const joined = (dir: string, from: string): string => {
  const parts: string[] = []
  for (const part of [...dir.split("/"), ...from.split("/")]) {
    if (part === "" || part === ".") continue
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop()
    else parts.push(part)
  }
  return parts.join("/")
}

const manifestIn = (dir: string): string => (dir === "" ? "package.json" : `${dir}/package.json`)

/** Every `package.json` the barrel at `path` may belong to, nearest first. */
export const manifestsAbove = (path: string): readonly string[] => dirsAbove(path).map(manifestIn)

/** The extensions a TypeScript import names, and the source files each may be. */
const SOURCE_OF: Readonly<Record<string, readonly string[]>> = {
  ".js": [".js", ".ts", ".tsx", ".jsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
  ".jsx": [".jsx", ".tsx"],
  ".ts": [".ts"],
  ".tsx": [".tsx"],
  ".mts": [".mts"],
  ".cts": [".cts"],
}

const BARE = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]

/** The files a relative `from` beside `barrel` may resolve to, by the path the print names. */
const candidates = (barrel: string, from: string): readonly string[] => {
  const target = joined(dirOf(barrel), from)
  const ext = /\.[^./]+$/.exec(target)?.[0] ?? ""
  const swaps = SOURCE_OF[ext]
  if (swaps !== undefined) return swaps.map((e) => `${target.slice(0, -ext.length)}${e}`)
  return [target, ...BARE.map((e) => `${target}${e}`), ...BARE.map((e) => `${target}/index${e}`)]
}

const relativeFrom = (from: string): boolean => from.startsWith("./") || from.startsWith("../")

/** What a barrel's print carries and reads, by the paths the print names. */
export interface BarrelSources {
  /** The barrel's path. */
  readonly path: string
  /** Every source in the checkout the test ran. */
  readonly loaded: ReadonlySet<string>
  /** A `package.json`'s text now, or `undefined` where there is none. */
  readonly manifest: (path: string) => string | undefined
}

/** A barrel's package: the directory of its `package.json`, and whether it declares no side effects. */
interface Package {
  readonly dir: string
  readonly pure: boolean
}

/** The nearest `package.json` above the barrel, or `undefined` where there is none. */
const packageOf = (sources: BarrelSources): Package | undefined => {
  for (const dir of dirsAbove(sources.path)) {
    const text = sources.manifest(manifestIn(dir))
    if (text === undefined) continue
    try {
      const parsed: unknown = JSON.parse(text)
      const pure =
        typeof parsed === "object" &&
        parsed !== null &&
        "sideEffects" in parsed &&
        parsed.sideEffects === false
      return { dir, pure }
    } catch {
      return { dir, pure: false }
    }
  }
  return undefined
}

/**
 * Whether a block that may run for the first time runs nothing the test's print does not
 * stand for: its source is one the test ran, or a file of the barrel's own package, which
 * declares `"sideEffects": false`.
 * A bare source is another package's, whose side effects that declaration says nothing of.
 */
const vouchedFor = (
  block: Block,
  sources: BarrelSources,
  pkg: () => Package | undefined,
): boolean => {
  if (!relativeFrom(block.from)) return false
  const files = candidates(sources.path, block.from)
  if (files.some((f) => sources.loaded.has(f))) return true
  const found = pkg()
  if (found === undefined || !found.pure) return false
  return files.every((f) =>
    found.dir === "" ? !f.startsWith("../") : f.startsWith(`${found.dir}/`),
  )
}

/** Whether `next` differs from the barrel `old` only by names added, as `sources` allow. */
export const barrelGrows = (old: string, next: string, sources: BarrelSources): boolean => {
  const before = blocksOf(old)
  const after = blocksOf(next)
  if (before === undefined || after === undefined) return false
  const added = addedBlocks(before, after)
  if (added === undefined) return false
  let pkg: Package | undefined | "unread" = "unread"
  const once = (): Package | undefined => {
    if (pkg === "unread") pkg = packageOf(sources)
    return pkg
  }
  return added.every((block) => vouchedFor(block, sources, once))
}
