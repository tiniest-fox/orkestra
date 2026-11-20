// logic: whether every difference between two texts of one source file falls inside the
// body of a function the test never called.
//
// Three things have to hold, and each closes a way an edit inside a body still reaches the
// test:
//
// 1. **Every hunk lies inside one allowed span.** A hunk is one run of changed text.
// 2. **The new text compiles as a module.** A syntax error anywhere fails the import, called
//    or not, and so does an early error — a duplicate `let`, a `super` outside a method —
//    which a parse alone accepts.
// 3. **The brackets of each span edited end as they did.** Otherwise an edit that closes
//    the body early — `} sideEffect(); function g() {` — stays inside the old span by
//    offsets and puts new code at the top level.

import { stripTypeScriptTypes } from "node:module"
import type { Span } from "./allowance.js"
import { lex } from "./lex.js"

/** One changed run: `[start, end)` in the old text, replaced by `[from, to)` of the new. */
interface Hunk {
  readonly start: number
  readonly end: number
  readonly from: number
  readonly to: number
}

/** Above this many cells the line diff gives up and calls the whole middle one hunk. */
const MAX_CELLS = 4_000_000

const offsets = (lines: readonly string[]): number[] => {
  const at = [0]
  for (const line of lines) at.push((at.at(-1) ?? 0) + line.length)
  return at
}

/** Lines with their newlines kept, so joining them gives the text back. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Every pair of equal lines in a longest common subsequence of the two, in order. */
const commonLines = (a: readonly string[], b: readonly string[]): (readonly [number, number])[] => {
  const n = a.length
  const m = b.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
  const pairs: (readonly [number, number])[] = []
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++
    else j++
  }
  return pairs
}

/** A hunk narrowed to the characters that actually differ. */
const narrowed = (old: string, next: string, h: Hunk): Hunk => {
  let { start, end, from, to } = h
  while (start < end && from < to && old.charAt(start) === next.charAt(from)) {
    start++
    from++
  }
  while (end > start && to > from && old.charAt(end - 1) === next.charAt(to - 1)) {
    end--
    to--
  }
  return { start, end, from, to }
}

/** The hunks between two texts, by line and then narrowed by character. */
export const hunks = (old: string, next: string): readonly Hunk[] => {
  const a = linesOf(old)
  const b = linesOf(next)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const atA = offsets(a)
  const atB = offsets(b)
  const pairs =
    midA.length * midB.length > MAX_CELLS
      ? []
      : commonLines(midA, midB).map(([i, j]): readonly [number, number] => [i + head, j + head])
  const found: Hunk[] = []
  let i = head
  let j = head
  const last: readonly [number, number] = [a.length - tail, b.length - tail]
  for (const [pi, pj] of [...pairs, last]) {
    if (pi > i || pj > j)
      found.push({ start: atA[i] ?? 0, end: atA[pi] ?? 0, from: atB[j] ?? 0, to: atB[pj] ?? 0 })
    i = pi + 1
    j = pj + 1
  }
  return found.map((h) => narrowed(old, next, h))
}

/** The text with its types stripped, or `undefined` where it does not strip. */
const stripped = (text: string): string | undefined => {
  try {
    return stripTypeScriptTypes(text)
  } catch {
    return undefined
  }
}

/**
 * Whether JavaScript compiles as a module without running it. Handed in, because Node
 * compiles a module in-process only behind a flag, so the adapter asks a child `node`.
 */
export type Compiles = (javascript: string) => boolean

const sameState = (a: ReturnType<typeof lex>, b: ReturnType<typeof lex>): boolean =>
  a !== undefined && b !== undefined && a.open === b.open && a.mode === b.mode

/**
 * Whether `next` differs from `old` only inside `allowed`. Also `false` where either text
 * fails to strip, which includes TypeScript that only a compiler, not a stripper, accepts,
 * and where `next` stripped does not compile.
 */
export const confined = (
  old: string,
  next: string,
  allowed: readonly Span[],
  compiles: Compiles,
): boolean => {
  const found = hunks(old, next)
  const touched = new Set<Span>()
  for (const h of found) {
    const span = allowed.find(([a, b]) => a <= h.start && h.end <= b)
    if (span === undefined) return false
    touched.add(span)
  }
  for (const span of touched) {
    const [a, b] = span
    if (found.some((h) => (h.start < a && a < h.end) || (h.start < b && b < h.end))) return false
    const shift = (at: number, inside: boolean): number =>
      found
        .filter((h) => h.end <= at && (inside || h.start < at))
        .reduce((sum, h) => sum + (h.to - h.from) - (h.end - h.start), 0)
    if (!sameState(lex(old, a, b), lex(next, a + shift(a, false), b + shift(b, true)))) return false
  }
  // Last, because it is the one that costs a process.
  const js = stripped(next)
  return stripped(old) !== undefined && js !== undefined && compiles(js)
}
