/**
 * Pseudo-code in the rules-pseudo notation, split into coloured runs — what a ```pseudo
 * fence and an overview's sketch draw through `components/PseudoCode`.
 *
 * **Ported from tiniestfox's own pass** (`packages/kit/src/ui/pseudo.ts`), so the notation
 * colours the same here as where it was defined: `define`, `each x in xs`, `while`, `if`,
 * `else`, `return` and `skip` are keywords; `{a hole}` and `"a string"` keep their own hue
 * whatever surrounds them; `#` opens a comment at a line's start or after a space; and a
 * line that opens no core block but has a body under it is a rules line, its words in
 * the `rule` hue. The palette is `--color-syntax-*` in `styles.css`.
 *
 * Kind `pure`: no React.
 */

/** The hues a run can carry, in the order a run's number names them, from 1. */
export const PSEUDO_HUES = [
  "keyword",
  "string",
  "constant",
  "tag",
  "name",
  "call",
  "comment",
  "rule",
  "hole",
] as const
export type PseudoHue = (typeof PSEUDO_HUES)[number]

/** One stretch of a line: its text, and its hue where it has one. */
export interface PseudoRun {
  readonly text: string
  readonly hue: PseudoHue | undefined
}

/** The core keywords that open a block or a statement. */
const HEADS = new Set(["define", "each", "while", "if", "else", "return", "skip"])
/** Words that join a condition — keywords only in an `if` or `while` head. */
const JOINS = new Set(["and", "or", "not", "is"])
const CONSTANTS = new Set(["true", "false", "null"])

/** A hue's place in a line's hue array: 0 is plain. */
const n = (hue: PseudoHue): number => PSEUDO_HUES.indexOf(hue) + 1

/** A line that has nothing to say: blank, or only a comment. */
const quiet = (line: string): boolean => /^\s*(?:#.*)?$/.test(line)

const indentOf = (line: string): number => /^\s*/.exec(line)?.[0].length ?? 0

/**
 * Where a line's comment, strings and holes are, which nothing else colours over, and the
 * first comma outside them, which is where a loop head's rules start.
 */
const scan = (line: string): { hues: number[]; comma: number | undefined } => {
  const hues = Array.from({ length: line.length }, () => 0)
  let comma: number | undefined
  const fill = (from: number, to: number, hue: number): void => {
    for (let k = from; k < to; k += 1) hues[k] = hue
  }
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === "{" || ch === '"') {
      const end = line.indexOf(ch === "{" ? "}" : '"', i + 1)
      const stop = end === -1 ? line.length : end + 1
      fill(i, stop, ch === "{" ? n("hole") : n("string"))
      i = stop - 1
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      fill(i, line.length, n("comment"))
      break
    } else if (ch === "," && comma === undefined) comma = i
  }
  return { hues, comma }
}

/**
 * What a line is, by its first words. A loop (`each x in xs`, `while`) can carry rules
 * after a comma; a condition joins with keywords; a statement opens no core block, so with
 * a body under it it is a rules line. `each retry` is a handler, so a statement.
 */
interface Head {
  readonly define: boolean
  readonly loop: boolean
  readonly condition: boolean
  readonly statement: boolean
}

const headOf = (words: readonly string[]): Head => {
  const [first = "", second] = words
  const loop = (first === "each" && words.includes("in")) || first === "while"
  return {
    define: first === "define",
    loop,
    condition: first === "if" || first === "while" || (first === "else" && second === "if"),
    statement: !loop && (first === "each" || !HEADS.has(first)),
  }
}

/** The hue one word takes, or `undefined` where it stays as `scan` left it. */
const wordHue = (
  line: string,
  word: string,
  at: number,
  place: { readonly index: number; readonly rules: number | undefined; readonly head: Head },
  firstIn: boolean,
): PseudoHue | undefined => {
  const { index, rules, head } = place
  if (/^\d/.test(word) || CONSTANTS.has(word)) return "constant"
  if (rules !== undefined && at >= rules) return "rule"
  if (index === 0 && HEADS.has(word)) return "keyword"
  if (head.condition && (word === "if" || JOINS.has(word))) return "keyword"
  if (head.loop && word === "in" && firstIn) return "keyword"
  if (head.define && index === 1) return "call"
  if (line[at + word.length] === "(") return "call"
  return undefined
}

/** One line's runs, given where its rules start, or `undefined` where it has none. */
const lineRuns = (
  line: string,
  hues: number[],
  rules: number | undefined,
  head: Head,
): readonly PseudoRun[] => {
  // Only what starts a word, outside a comment, string or hole.
  const words = [...line.matchAll(/[A-Za-z_]\w*|\d+(?:\.\d+)?[A-Za-z%]*/g)].filter(
    (m) => hues[m.index] === 0 && (m.index === 0 || !/\w/.test(line[m.index - 1] ?? "")),
  )
  let seenIn = false
  for (const [index, m] of words.entries()) {
    const word = m[0]
    const hue = wordHue(line, word, m.index, { index, rules, head }, !seenIn)
    if (hue === "keyword" && word === "in") seenIn = true
    if (hue !== undefined) for (let k = m.index; k < m.index + word.length; k += 1) hues[k] = n(hue)
  }
  const out: PseudoRun[] = []
  let k = 0
  while (k < hues.length) {
    const hue = hues[k] ?? 0
    let end = k + 1
    while (end < hues.length && hues[end] === hue) end += 1
    out.push({ text: line.slice(k, end), hue: hue === 0 ? undefined : PSEUDO_HUES[hue - 1] })
    k = end
  }
  return out
}

/**
 * The runs of each line of a pseudo block, split on `\n`. A line is a rules line when the
 * next line with something to say is indented deeper and the line opens no core block; on a
 * loop's head the rules ride after its first comma. A rules line's words are `rule`, but a
 * number, string, hole or comment on it keeps its own hue.
 */
export const pseudoRuns = (text: string): readonly (readonly PseudoRun[])[] => {
  const lines = text.split("\n")
  return lines.map((line, i) => {
    const { hues, comma } = scan(line)
    const words = [...line.matchAll(/[A-Za-z_]\w*/g)].filter((m) => hues[m.index] === 0)
    const head = headOf(words.map((m) => m[0]))
    const next = quiet(line) ? undefined : lines.slice(i + 1).find((l) => !quiet(l))
    const body = next !== undefined && indentOf(next) > indentOf(line)
    const rules =
      body && head.statement
        ? indentOf(line)
        : body && head.loop && comma !== undefined
          ? comma + 1
          : undefined
    return lineRuns(line, hues, rules, head)
  })
}
