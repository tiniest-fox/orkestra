// logic: from the functions V8 counted no call to, the spans of the original source an
// edit may touch without the test noticing.
//
// **Only a block body, and only from inside it.** A function's name and its parameters are
// visible without calling it — a rename changes what the module exports, and a parameter
// changes `length`, which some libraries dispatch on — so the span starts after the `{`.
// An expression-bodied arrow gets no span: its end is wherever V8 says, and a span that
// overran it would let an edit outside the function through.

import { closing } from "./lex.js"
import type { InlineMap, Mapping } from "./source-map.js"

export type Span = readonly [number, number]

/**
 * What may come before a function's parameters: keywords, its name, `*` and `#`. Anything
 * else — a quoted name, a computed `[key]`, the `=` of a class field V8 reports as a
 * function of its own — is a head this cannot read, and the function gets no span.
 */
const HEAD = /[\w$#*\s]/

const skipSpace = (text: string, i: number): number => {
  let j = i
  while (j < text.length && /\s/.test(text.charAt(j))) j++
  return j
}

/**
 * The `[start, end)` inside the braces of the block body of the function at `start` in
 * `text`, which has to close before `end`. `undefined` for an expression body, or a head
 * that does not read as a function's.
 */
export const blockBody = (text: string, start: number, end: number): Span | undefined => {
  let i = start
  while (i < end && HEAD.test(text.charAt(i))) i++
  let after: number
  if (text.charAt(i) === "(") {
    const closed = closing(text, i)
    if (closed === undefined) return undefined
    after = skipSpace(text, closed)
  } else after = i
  if (text.startsWith("=>", after)) after = skipSpace(text, after + 2)
  if (text.charAt(after) !== "{") return undefined
  const closed = closing(text, after)
  if (closed === undefined || closed > end) return undefined
  return [after + 1, closed - 1]
}

/** The index of the first mapping at or after `generated`. */
const firstAt = (mappings: readonly Mapping[], generated: number): number => {
  let low = 0
  let high = mappings.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if ((mappings[mid]?.generated ?? 0) < generated) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * Where a span of the generated text came from: from the first token mapped inside it to
 * the last, closing brace included. Narrower than the body whenever a token at either end
 * has no mapping, which only ever refuses an edit that was safe.
 */
const mapped = (map: InlineMap, body: Span): Span | undefined => {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (let k = firstAt(map.mappings, body[0]); k < map.mappings.length; k++) {
    const m = map.mappings[k]
    if (m === undefined || m.generated > body[1]) break
    low = Math.min(low, m.original)
    high = Math.max(high, m.original)
  }
  return low < high ? [low, high] : undefined
}

/**
 * The spans of the original text an edit may fall in, from the uncalled functions'
 * `[start, end)` in `generated`. With no map, `generated` is the original text itself.
 */
export const allowedSpans = (
  generated: string,
  uncalled: readonly Span[],
  map: InlineMap | undefined,
): readonly Span[] =>
  uncalled.flatMap(([start, end]) => {
    const body = blockBody(generated, start, end)
    if (body === undefined) return []
    if (map === undefined) return [body]
    const span = mapped(map, body)
    return span === undefined ? [] : [span]
  })
