/**
 * What the client reads off a mermaid source before and after it is drawn: which kind of
 * diagram it is, the source turned to run left to right, and the drawing's natural width.
 *
 * **Every flowchart and state diagram runs left to right, whatever the source wrote.** A
 * figure is wider than it is tall, and a top-to-bottom graph of any length is a column down
 * the page. The rewrite is of the source, so mermaid still does the layout. Sequence
 * diagrams and every other type are left as written.
 */

/**
 * The header line's index: the first line that is not blank, a `%%` comment or directive,
 * or part of a leading `---` frontmatter block. `-1` when the source holds no such line.
 */
const headerAt = (lines: readonly string[]): number => {
  let i = 0
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, at) => at > 0 && line.trim() === "---")
    if (close === -1) return -1
    i = close + 1
  }
  for (; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? ""
    if (line !== "" && !line.startsWith("%%")) return i
  }
  return -1
}

const FLOW_HEADER = /^(\s*(?:flowchart-elk|flowchart|graph))(?:\s+(?:TD|TB|BT|RL|LR)\b)?/i
const STATE_HEADER = /^\s*stateDiagram(?:-v2)?\b/
const DIRECTION = /^(\s*)direction\s+\w+/

/** The first word of the header, as the figure's band names it. */
export const diagramKind = (source: string): string => {
  const lines = source.split("\n")
  const header = lines[headerAt(lines)] ?? ""
  if (FLOW_HEADER.test(header)) return "flowchart"
  if (STATE_HEADER.test(header)) return "state diagram"
  if (/^\s*sequenceDiagram\b/.test(header)) return "sequence"
  return "diagram"
}

/**
 * A state diagram's top-level `direction` set to LR, or one added under the header.
 *
 * Only depth zero: a composite state (`state X { … }`) may name its own direction, and
 * that one is the source's choice for the inside of the box.
 */
const stateSideways = (lines: readonly string[], header: number): readonly string[] => {
  let depth = 0
  for (let i = header + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ""
    if (depth === 0 && DIRECTION.test(line))
      return lines.with(i, line.replace(DIRECTION, "$1direction LR"))
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
  }
  return [...lines.slice(0, header + 1), "  direction LR", ...lines.slice(header + 1)]
}

/** The source with a flowchart or state diagram turned to run left to right. */
export const sideways = (source: string): string => {
  const lines = source.split("\n")
  const header = headerAt(lines)
  const line = lines[header]
  if (line === undefined) return source
  if (FLOW_HEADER.test(line))
    return lines.with(header, line.replace(FLOW_HEADER, "$1 LR")).join("\n")
  if (STATE_HEADER.test(line)) return stateSideways(lines, header).join("\n")
  return source
}

/** The natural width an SVG declares in its viewBox, rounded up; `0` where it declares none. */
export const svgWidth = (svg: string): number => {
  const width = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/.exec(svg)?.[1]
  return width === undefined ? 0 : Math.ceil(Number(width))
}

/**
 * How far a drawing `natural` px wide is shrunk into `room` px: to fit, but never below
 * 0.8 — past that the text is too small to read, so it stays at 0.8 and scrolls sideways.
 * A drawing that fits, or one not yet measured, is drawn at full size.
 */
export const fitScale = (natural: number, room: number): number =>
  natural > room && room > 0 ? Math.max(0.8, room / natural) : 1
