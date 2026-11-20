// logic: just enough of a JavaScript lexer to follow brackets.
//
// No parser is a dependency here, and none is needed for what this answers: where a
// bracket closes, and whether an edit leaves the brackets around it as they were. The
// lexer tracks the brackets, strings, comments, template literals and regular
// expressions that can hide one. It is wrong in the places a lexer without a parser is
// always wrong — a `/` after `)` is read as division, JSX text is read as code — and
// every caller turns a lexer that disagrees with itself into "not confined", which re-runs
// the test.

/** Where the lexer stands: the open brackets, innermost last, and what it is inside. */
export interface LexState {
  readonly open: string
  readonly mode: "code" | "line" | "block" | "single" | "double" | "template" | "regex"
}

export const START: LexState = { open: "", mode: "code" }

const CLOSES: Record<string, string> = { ")": "(", "]": "[", "}": "{" }

/** Words after which a `/` opens a regular expression rather than dividing. */
const BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "instanceof",
  "yield",
  "await",
])

const isWord = (c: string): boolean => /[\w$]/.test(c)

/** Whether a `/` at `i` opens a regular expression, judged by what precedes it. */
const regexAt = (text: string, i: number): boolean => {
  let j = i - 1
  while (j >= 0 && /\s/.test(text.charAt(j))) j--
  if (j < 0) return true
  const c = text.charAt(j)
  if (c === ")" || c === "]" || c === "}") return false
  if (!isWord(c)) return true
  let k = j
  while (k >= 0 && isWord(text.charAt(k))) k--
  return BEFORE_REGEX.has(text.slice(k + 1, j + 1))
}

interface Cursor {
  open: string
  mode: LexState["mode"]
  i: number
  inClass: boolean
}

/** Moves `at` past one character of code. `false` when a bracket closes one never opened. */
const codeStep = (text: string, at: Cursor): boolean => {
  const c = text.charAt(at.i)
  const next = text.charAt(at.i + 1)
  if (c === "/" && next === "/") at.mode = "line"
  else if (c === "/" && next === "*") at.mode = "block"
  else if (c === "/" && regexAt(text, at.i)) at.mode = "regex"
  else if (c === "'") at.mode = "single"
  else if (c === '"') at.mode = "double"
  else if (c === "`") at.open += "`"
  else if (c === "(" || c === "[" || c === "{") at.open += c
  else if (c in CLOSES) {
    const top = at.open.slice(-1)
    // `}` also ends a template's `${`, which was pushed as `$`.
    if (c === "}" && top === "$") at.open = at.open.slice(0, -1)
    else if (top === CLOSES[c]) at.open = at.open.slice(0, -1)
    else return false
  }
  at.i += c === "/" && (next === "/" || next === "*") ? 2 : 1
  return true
}

/** Moves `at` past one character inside a template literal's text. */
const templateStep = (text: string, at: Cursor): void => {
  const c = text.charAt(at.i)
  if (c === "\\") at.i += 2
  else if (c === "`") {
    at.open = at.open.slice(0, -1)
    at.i += 1
  } else if (c === "$" && text.charAt(at.i + 1) === "{") {
    at.open += "$"
    at.i += 2
  } else at.i += 1
}

/** Moves `at` past one character of a comment, a string or a regular expression. */
const quotedStep = (text: string, at: Cursor): void => {
  const c = text.charAt(at.i)
  const ends =
    (at.mode === "line" && c === "\n") ||
    (at.mode === "single" && c === "'") ||
    (at.mode === "double" && c === '"') ||
    (at.mode === "regex" && c === "/" && !at.inClass)
  if (at.mode === "block" && c === "*" && text.charAt(at.i + 1) === "/") {
    at.mode = "code"
    at.i += 2
    return
  }
  if (c === "\\" && at.mode !== "line" && at.mode !== "block") {
    at.i += 2
    return
  }
  if (at.mode === "regex" && c === "[") at.inClass = true
  if (at.mode === "regex" && c === "]") at.inClass = false
  if (ends) at.mode = "code"
  at.i += 1
}

/**
 * Lex `text` from `from` to `to`, starting in `state`. `undefined` where the text closes
 * a bracket that `state` did not hold open — which is the text reaching outside itself —
 * or where a string or a regular expression runs past the end of a line.
 */
export const lex = (
  text: string,
  from: number,
  to: number,
  state: LexState = START,
): LexState | undefined => {
  const at: Cursor = { open: state.open, mode: state.mode, i: from, inClass: false }
  while (at.i < to) {
    const inTemplate = at.mode === "code" && at.open.endsWith("`")
    if (inTemplate) templateStep(text, at)
    else if (at.mode === "code") {
      if (!codeStep(text, at)) return undefined
    } else {
      const c = text.charAt(at.i)
      const quoted = at.mode === "single" || at.mode === "double" || at.mode === "regex"
      if (quoted && c === "\n") return undefined
      quotedStep(text, at)
    }
  }
  return { open: at.open, mode: at.mode }
}

/**
 * The offset just past the bracket that closes the one at `at`, or `undefined` where it
 * never closes. `at` must be an opening bracket in code.
 */
export const closing = (text: string, at: number): number | undefined => {
  const cursor: Cursor = { open: "", mode: "code", i: at, inClass: false }
  do {
    if (cursor.mode === "code" && cursor.open.endsWith("`")) templateStep(text, cursor)
    else if (cursor.mode === "code") {
      if (!codeStep(text, cursor)) return undefined
    } else {
      if (cursor.mode !== "line" && cursor.mode !== "block" && text.charAt(cursor.i) === "\n")
        return undefined
      quotedStep(text, cursor)
    }
    if (cursor.i > text.length) return undefined
  } while (cursor.open !== "" || cursor.mode !== "code")
  return cursor.i
}
