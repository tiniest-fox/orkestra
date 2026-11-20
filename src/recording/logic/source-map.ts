// logic: the inline source map a runner leaves at the foot of the code it compiled, read
// as offsets rather than lines and columns.
//
// Decoded here rather than through `node:module`'s `SourceMap`, because the question is
// "every mapping inside this span", and that class only answers "the mapping nearest this
// point".

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** One mapping: an offset in the generated text and the offset it came from. */
export interface Mapping {
  readonly generated: number
  readonly original: number
}

/** What the engine needs of a map: the one file it came from, and where each token went. */
export interface InlineMap {
  readonly source: string
  readonly sourceContent: string | undefined
  readonly mappings: readonly Mapping[]
}

/**
 * A map comment on a line of its own. The last one in the file is the map: a runner that
 * wraps the code it compiled closes the wrapper after it, so it is not the last line.
 */
const INLINE =
  /^\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([\w+/=]+)$/gm

/** The offset each line starts at, so a line and a column become one number. */
export const lineStarts = (text: string): readonly number[] => {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

/** Every number one segment's VLQ encodes. `undefined` on a character that is not base64. */
const segment = (text: string): number[] | undefined => {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const c of text) {
    const digit = BASE64.indexOf(c)
    if (digit < 0) return undefined
    value += (digit & 31) << shift
    if ((digit & 32) === 0) {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1)
      value = 0
      shift = 0
    } else shift += 5
  }
  return values
}

interface Decoded {
  readonly sources: readonly string[]
  readonly sourcesContent: readonly (string | undefined)[]
  readonly mappings: string
}

const decoded = (json: string): Decoded | undefined => {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== "object" || parsed === null) return undefined
    const sources = "sources" in parsed ? parsed.sources : undefined
    const mappings = "mappings" in parsed ? parsed.mappings : undefined
    const content = "sourcesContent" in parsed ? parsed.sourcesContent : undefined
    if (!Array.isArray(sources) || typeof mappings !== "string") return undefined
    return {
      sources: sources.map(String),
      sourcesContent: Array.isArray(content)
        ? content.map((c: unknown) => (typeof c === "string" ? c : undefined))
        : [],
      mappings,
    }
  } catch {
    return undefined
  }
}

/**
 * The inline map at the foot of `generated`, for a file compiled from exactly one source.
 * `undefined` where there is none, it does not decode, or it names several sources —
 * offsets into one file are all a print can hold.
 *
 * `original` is the source's text, which turns its lines into offsets; a map whose
 * mappings point past it is not a map of that text.
 *
 * **Mappings on the generated text's first line are dropped.** A runner that wraps the
 * code it compiled puts its wrapper there and leaves the map as it was, so every column
 * on that line is off by the wrapper's length.
 */
export const inlineMap = (generated: string, original: string): InlineMap | undefined => {
  const found = [...generated.matchAll(INLINE)].at(-1)
  if (found?.[1] === undefined) return undefined
  const map = decoded(Buffer.from(found[1], "base64").toString("utf8"))
  const [source] = map?.sources ?? []
  if (map === undefined || source === undefined || map.sources.length !== 1) return undefined
  const genStarts = lineStarts(generated)
  const origStarts = lineStarts(original)
  const mappings: Mapping[] = []
  let column = 0
  let origLine = 0
  let origColumn = 0
  for (const [index, group] of map.mappings.split(";").entries()) {
    column = 0
    for (const text of group.split(",")) {
      if (text === "") continue
      const v = segment(text)
      if (v === undefined) return undefined
      column += v[0] ?? 0
      if (v.length < 4) continue
      origLine += v[2] ?? 0
      origColumn += v[3] ?? 0
      const genStart = genStarts[index]
      const origStart = origStarts[origLine]
      if (genStart === undefined || origStart === undefined) return undefined
      if (origStart + origColumn > original.length) return undefined
      if (index > 0)
        mappings.push({ generated: genStart + column, original: origStart + origColumn })
    }
  }
  return { source, sourceContent: map.sourcesContent[0], mappings }
}
