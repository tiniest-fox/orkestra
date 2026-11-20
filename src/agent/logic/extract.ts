// logic: pull a JSON value out of an agent's prose, and say which slice of it
// that was. Pure, provider-agnostic.
//
// One entry point. Two strategies inside it, both scanning from the END of the
// response,
// because the output contract asks for the envelope last and an agent's prose
// routinely contains earlier JSON — an example, a config snippet, a diff. An
// extractor that takes the FIRST match reliably picks the wrong one.
//
// **The slice is reported rather than re-derived.** A surface that draws the
// response has to take the envelope back out of it — the same object is drawn
// properly as a card beneath — and the only thing that knows where it was is the
// scan that found it. A second recogniser at the surface restates rules that live
// here, so it is only ever as correct as the last delimiter form somebody thought
// of. Hence `Extracted.envelope`: found once, subtracted verbatim.

import { Option } from "effect"

/** A value taken out of a response, and the exact text it was written as. */
export interface Extracted {
  readonly value: unknown
  /**
   * The slice `value` came from, **fence delimiters included** — the string a
   * surface subtracts to show the words around the envelope without the envelope.
   * Removing the object alone leaves its markers drawing as an empty code block.
   */
  readonly envelope: string
}

/** A value and where it sat in the response: `[from, to)`. */
interface Found {
  readonly value: unknown
  readonly from: number
  readonly to: number
}

/**
 * `s` with every comma that directly precedes a closing `}` or `]` removed, commas
 * inside strings left alone.
 *
 * The one deviation from strict JSON a model writes routinely: a list of sections or
 * requirements built item by item ends in a comma. `JSON.parse` refuses the whole
 * envelope for it, and a turn that meant to file is then read as prose.
 */
const withoutTrailingCommas = (s: string): string => {
  let out = ""
  let inString = false
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i] ?? ""
    if (inString) {
      if (c === "\\") {
        out += c + (s[i + 1] ?? "")
        i += 1
        continue
      }
      if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
    } else if (c === ",") {
      let j = i + 1
      while (/\s/.test(s[j] ?? "")) j += 1
      if (s[j] === "}" || s[j] === "]") continue
    }
    out += c
  }
  return out
}

/**
 * What `JSON.parse` made of `s`, or its error text when neither `s` nor `s` without
 * trailing commas parses. The error is the strict parse's, so a position it names is
 * one in the text the agent wrote.
 */
const parseReporting = (s: string): { readonly value: unknown } | { readonly error: string } => {
  try {
    // Annotated, not asserted: JSON.parse returns `any`, and any -> unknown is
    // the one safe widening. Everything downstream must decode it.
    const parsed: unknown = JSON.parse(s)
    return { value: parsed }
  } catch (strict) {
    try {
      const parsed: unknown = JSON.parse(withoutTrailingCommas(s))
      return { value: parsed }
    } catch {
      return { error: strict instanceof Error ? strict.message : String(strict) }
    }
  }
}

const parse = (s: string): Option.Option<unknown> => {
  const parsed = parseReporting(s)
  return "value" in parsed ? Option.some(parsed.value) : Option.none()
}

/**
 * A fenced block, whatever its info string says.
 *
 * **Both delimiters are anchored to the start of a line, and that is what makes the
 * block's own JSON safe to scan over.** An envelope carries markdown in its string
 * values, so ``` inside it is ordinary — most artifacts this repo files contain one.
 * An unanchored closer lands on that first ``` and the truncated content does not
 * parse, so an earlier contract-shaped example wins the response instead: a turn that
 * quotes the contract and then files an artifact quoting `pnpm verify` returns the
 * quoted example. JSON forbids a literal newline inside a string, so a ``` the
 * envelope carries is never at a line start and this can never close on one.
 *
 * Three or more backticks **or** tildes, indentation allowed. A model reaches for a
 * fourth backtick precisely when the content holds backticks, which an artifact's JSON
 * routinely does, and a fence indented inside a list item is what a model writes when
 * it introduces the envelope with a bullet.
 */
const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*(`{3,}|~{3,})[ \t]*$/gm

/**
 * The last fenced block that holds JSON.
 *
 * Tag-agnostic on purpose. Models are trained hard toward ```json and will
 * reach for it however the prompt labels the fence, so treating the label as
 * significant only creates a failure mode. It also means a response that leads
 * with a ```ts block and ends with the envelope still resolves.
 */
const fenced = (text: string): Found | undefined => {
  let found: Found | undefined
  for (const m of text.matchAll(FENCE)) {
    // Each marker is a run of one character, so `startsWith` is "the same delimiter"
    // and CommonMark's "the closer is at least as long as the opener" in one test.
    if (!(m[3] ?? "").startsWith(m[1] ?? "")) continue
    const value = parse(m[2] ?? "")
    if (Option.isSome(value)) {
      found = { value: value.value, from: m.index, to: m.index + m[0].length }
    }
  }
  return found
}

/** A fence delimiter line: three or more backticks or tildes, indentation allowed. */
const DELIMITER_LINE = /^[ \t]*(?:`{3,}|~{3,})/gm

/** A delimiter line ending exactly where the span begins, with its marker and info string. */
const OPENER = /(?:^|\n)[ \t]*(`{3,}|~{3,})([^\n]*)\n[ \t]*$/

/** A delimiter line starting exactly where the span ends. No info string — see `isOpener`. */
const CLOSER = /^[ \t]*\n[ \t]*(`{3,}|~{3,})[ \t]*(?=\n|$)/

/**
 * Whether a delimiter line opens a block rather than closes the one above it.
 *
 * Nothing about the line itself settles this — ``` is spelled the same at both ends —
 * and getting it wrong is the mirror of the bug `widened` exists for: widening onto a
 * *closer* leaves that block's opener drawing alone over the rest of the response.
 *
 * An info string settles it, because CommonMark forbids one on a closer, and that is the
 * common case: a model reaching for ```` or ~~~ still writes `json` after it. Failing
 * that, an even number of delimiter lines before it means every block so far is closed,
 * so this one opens. The two are needed together — an unclosed block earlier in the prose
 * makes the count odd for an opener that plainly is one, which is precisely the input
 * where the info string carries the answer.
 */
const isOpener = (before: string, info: string): boolean =>
  info.trim() !== "" || [...before.matchAll(DELIMITER_LINE)].length % 2 === 0

/**
 * A span widened over the fence it sits inside, when it sits inside one.
 *
 * **The span covers its own delimiters rather than trusting `FENCE` to have matched.**
 * A block whose closer does not repeat its opener, or one whose pairing an unclosed
 * block earlier in the prose has desynchronised, is not matched as a fence at all — the
 * object is still found bare, and reporting it alone would have a surface leave the
 * delimiters behind as an empty code block.
 *
 * Unchanged when the span is not bracketed, which is the ordinary bare envelope an agent
 * ended a turn on with no fence at all.
 */
const widened = (text: string, found: Found): Found => {
  const open = OPENER.exec(text.slice(0, found.from))
  const close = CLOSER.exec(text.slice(found.to))
  if (open === null || close === null) return found
  if (!(close[1] ?? "").startsWith(open[1] ?? "")) return found
  const from = open.index + (open[0].startsWith("\n") ? 1 : 0)
  if (!isOpener(text.slice(0, from), open[2] ?? "")) return found
  return { value: found.value, from, to: found.to + close[0].length }
}

/**
 * The last complete JSON object in the text — the "ends with JSON, unfenced"
 * case, and the fallback when fence markers are absent or malformed.
 *
 * Every `{` is tried against the final `}`, latest-starting first, and `JSON.parse`
 * itself decides which one balances rather than a hand-rolled brace counter. That's
 * what keeps prose like "I edited {main.ts}" from widening the span, which a naive
 * first-brace-to-last-brace slice cannot do.
 *
 * Objects only — every schema we elicit is a struct, and admitting arrays would
 * make a bare markdown list of `[1,2]` look like a valid envelope.
 */
const bare = (text: string): Found | undefined => {
  const end = text.lastIndexOf("}")
  if (end === -1) return undefined
  for (let i = end - 1; i >= 0; i -= 1) {
    if (text[i] !== "{") continue
    const value = parse(text.slice(i, end + 1))
    if (Option.isSome(value)) return widened(text, { value: value.value, from: i, to: end + 1 })
  }
  return undefined
}

/**
 * A fenced block wins over an unfenced trailing object: an agent that fences its
 * envelope and then signs off ("let me know if you want changes") would
 * otherwise have the sign-off's stray punctuation break the trailing scan.
 *
 * Deliberately NOT a pluggable list. A per-provider `Extractor[]` could not help:
 * every agent is prompted to finish with JSON, so the variation is in how a
 * *model* writes prose, not in which CLI ran it. Real provider differences live in
 * `providers/<name>/normalize.ts`.
 */
export const extractJson = (text: string): Option.Option<Extracted> => {
  const found = fenced(text) ?? bare(text)
  return found === undefined
    ? Option.none()
    : Option.some({ value: found.value, envelope: text.slice(found.from, found.to) })
}

/**
 * A block that opens with a `"type"` key, its `{` first on its line: the first line of
 * every envelope. Anchored because prose that explains an envelope quotes the same key
 * inline — in a sentence or a code span — and taking that as a broken envelope
 * re-prompts an agent that wrote nothing wrong.
 */
const TYPED = /^[ \t]*\{\s*"type"\s*:/gm

/**
 * Why the envelope a response was written to end on does not parse, or `undefined` when
 * it has none or it parses.
 *
 * `extractJson` finding nothing cannot tell prose from an envelope with one bad comma,
 * and a turn read as prose is filed as a message the agent is never told about. This is
 * the other half: the last block that looks written as an envelope — a fence whose info
 * string is `json`, or a block that opens with a `"type"` key, fenced or bare with its
 * `{` opening a line — and the parser's complaint about it. The latest-starting candidate wins, for the reason
 * `extractJson` scans from the end: a valid block after a broken example is the answer.
 */
export const unparsedEnvelope = (text: string): string | undefined => {
  let last: { readonly from: number; readonly body: string } | undefined
  const fences: (readonly [number, number])[] = []
  for (const m of text.matchAll(FENCE)) {
    if (!(m[3] ?? "").startsWith(m[1] ?? "")) continue
    const from = m.index
    fences.push([from, from + m[0].length])
    const info = (m[0].split("\n")[0] ?? "").replace(/^[ \t]*(`{3,}|~{3,})/, "").trim()
    const body = m[2] ?? ""
    if (info.toLowerCase() === "json" || /^\s*\{\s*"type"\s*:/.test(body)) last = { from, body }
  }
  const typed = [...text.matchAll(TYPED)].findLast(
    (m) => !fences.some(([from, to]) => m.index >= from && m.index < to),
  )
  const brace = typed === undefined ? -1 : typed.index + typed[0].indexOf("{")
  if (brace !== -1 && (last === undefined || brace > last.from)) {
    const end = text.lastIndexOf("}")
    last = { from: brace, body: text.slice(brace, end < brace ? undefined : end + 1) }
  }
  if (last === undefined) return undefined
  const parsed = parseReporting(last.body)
  return "error" in parsed ? parsed.error : undefined
}
