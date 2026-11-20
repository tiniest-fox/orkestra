/**
 * An ```overview fence, read into the parts of a plan, the files each would touch, and
 * the order they are built in — what `components/ArchitectureMap` draws.
 *
 * The grammar is the one the engine teaches, and the fence's text is also what the next
 * agent reads, so nothing here may need a character the text would not carry anyway:
 *
 *     1. Engine | Keeps what a view needs
 *        in: src/app
 *        + views.ts — The store beside the transcript
 *          sketch:
 *            define on_tool_result(turn, call)
 *              ...
 *        ~ server.ts — A route that reads a view
 *     outside: CLI | The agent process
 *     Client -> Engine: a press
 *     order: Provider layer first, then Engine, then Client.
 *
 * **`undefined` is the only failure, and it means "draw the source".** A fence that does
 * not read is still what the agent wrote and what the next one reads, so `Markdown` puts
 * it in a code block rather than an error — a half-drawn map would be the worse of the
 * two, showing a plan that is not the one written.
 *
 * **A sketch belongs to the file it is indented under**, and a file opens into it. A
 * `sketch:` at the part's own depth is the form filed before a file could carry one, and it
 * still reads: one sketch for the whole part.
 *
 * **Line by line, not block by block.** The other grammars split an item at a blank line,
 * and pseudo-code has blank lines in it: an indented line belongs to the part above it
 * whatever came between them.
 */

export type Touch = "new" | "changed"

export interface PlannedFile {
  /** Below the part's root, with `/` between folders. */
  readonly path: string
  readonly touch: Touch
  readonly note: string | undefined
  /** Pseudo-code for this file alone, dedented to its own left edge. */
  readonly sketch: string | undefined
}

export interface MapPart {
  readonly name: string
  readonly gist: string | undefined
  /** The folder its files hang from, where the agent named one. */
  readonly root: string | undefined
  readonly files: readonly PlannedFile[]
  /** Pseudo-code for the whole part — the older form, written at the part's own depth. */
  readonly sketch: string | undefined
}

/** Something a part talks to that the plan does not change. */
export interface Outside {
  readonly name: string
  readonly note: string | undefined
}

export interface MapLink {
  readonly from: string
  readonly to: string
  readonly label: string | undefined
}

export interface Overview {
  /** In call order — the order they were written in. */
  readonly parts: readonly MapPart[]
  readonly outside: readonly Outside[]
  readonly links: readonly MapLink[]
  readonly order: string | undefined
}

const PART = /^\d+\.\s+(.+)$/
const OUTSIDE = /^outside:\s*(.+)$/
const ORDER = /^order:\s*(.+)$/
const LINK = /^(.+?)\s*->\s*(.+?)(?::\s*(.*))?$/
const ROOT = /^in:\s*(.+)$/
const FILE = /^([+~])\s+(.+)$/

const indentOf = (line: string): number => line.length - line.trimStart().length

/** `Name | words`, either half trimmed, and the words optional. */
const named = (text: string): { name: string; note: string | undefined } | undefined => {
  const bar = text.indexOf("|")
  const name = (bar === -1 ? text : text.slice(0, bar)).trim()
  const note = bar === -1 ? "" : text.slice(bar + 1).trim()
  return name === "" ? undefined : { name, note: note === "" ? undefined : note }
}

/** `path — note`. An em dash or a spaced hyphen, since an agent types either. */
const plannedFile = (touch: Touch, text: string): Omit<PlannedFile, "sketch"> | undefined => {
  const [path = "", ...rest] = text.split(/\s+(?:—|--?)\s+/)
  const note = rest.join(" — ").trim()
  return path.trim() === ""
    ? undefined
    : { path: path.trim(), touch, note: note === "" ? undefined : note }
}

/** A file as it is read: its line, and its sketch's lines once a `sketch:` opens one. */
interface BuildingFile {
  readonly planned: Omit<PlannedFile, "sketch">
  /** How far the file's line was indented: a `sketch:` deeper than it is the file's. */
  readonly at: number
  sketch: string[] | undefined
}

interface Building {
  name: string
  gist: string | undefined
  root: string | undefined
  files: BuildingFile[]
  /** The part's own sketch: `undefined` until a `sketch:` line at the part's depth. */
  sketch: string[] | undefined
  /** The lines the open sketch is gathering into — the part's or a file's. */
  into: string[] | undefined
  /** How far the open `sketch:` line was indented: a deeper line is pseudo-code. */
  sketchAt: number
  /** Until a line comes back to the `sketch:` line's depth. */
  sketching: boolean
}

/** The sketch's lines with trailing blanks gone and the common indent taken off. */
const dedent = (lines: readonly string[]): string | undefined => {
  const end = lines.findLastIndex((l) => l.trim() !== "")
  if (end === -1) return undefined
  const kept = lines.slice(0, end + 1)
  const cut = Math.min(...kept.filter((l) => l.trim() !== "").map(indentOf))
  return kept.map((l) => l.slice(cut)).join("\n")
}

/** One indented line inside a part. `false` where it is not a line the grammar has. */
const intoPart = (part: Building, line: string): boolean => {
  if (part.sketching && indentOf(line) > part.sketchAt) {
    part.into?.push(line)
    return true
  }
  // A line back at the `sketch:` line's depth ends the sketch, and is read as one of these.
  part.sketching = false
  const body = line.trim()
  if (body === "sketch:") {
    // Indented under the last file, it is that file's; at the part's depth, the part's.
    const file = part.files.at(-1)
    const owner = file !== undefined && indentOf(line) > file.at ? file : part
    if (owner.sketch !== undefined) return false
    owner.sketch = []
    part.into = owner.sketch
    part.sketchAt = indentOf(line)
    part.sketching = true
    return true
  }
  const root = ROOT.exec(body)
  if (root?.[1] !== undefined && part.root === undefined) {
    part.root = root[1].trim()
    return true
  }
  const file = FILE.exec(body)
  if (file?.[1] === undefined || file[2] === undefined) return false
  const planned = plannedFile(file[1] === "+" ? "new" : "changed", file[2])
  if (planned === undefined) return false
  part.files.push({ planned, at: indentOf(line), sketch: undefined })
  return true
}

const finish = (part: Building): MapPart => ({
  name: part.name,
  gist: part.gist,
  root: part.root,
  files: part.files.map((f) => ({
    ...f.planned,
    sketch: f.sketch === undefined ? undefined : dedent(f.sketch),
  })),
  sketch: part.sketch === undefined ? undefined : dedent(part.sketch),
})

interface Gathered {
  parts: Building[]
  outside: Outside[]
  links: MapLink[]
  /** Every `order:` line, so a second one can be refused. */
  order: string[]
}

/** One unindented line. `false` where it is not a line the grammar has. */
const topLevel = (
  line: string,
  into: {
    parts: Building[]
    outside: Outside[]
    links: MapLink[]
    order: string[]
  },
): boolean => {
  const part = PART.exec(line)?.[1]
  if (part !== undefined) {
    const head = named(part)
    if (head === undefined) return false
    into.parts.push({
      name: head.name,
      gist: head.note,
      root: undefined,
      files: [],
      sketch: undefined,
      into: undefined,
      sketchAt: 0,
      sketching: false,
    })
    return true
  }
  const outside = OUTSIDE.exec(line)?.[1]
  if (outside !== undefined) {
    const entry = named(outside)
    if (entry === undefined) return false
    into.outside.push(entry)
    return true
  }
  const order = ORDER.exec(line)?.[1]
  if (order !== undefined) {
    into.order.push(order.trim())
    return true
  }
  const link = LINK.exec(line)
  if (link?.[1] === undefined || link[2] === undefined) return false
  const label = link[3]?.trim()
  into.links.push({
    from: link[1],
    to: link[2],
    label: label === "" ? undefined : label,
  })
  return true
}

export const parseOverview = (source: string): Overview | undefined => {
  const into: Gathered = { parts: [], outside: [], links: [], order: [] }
  // The part an indented line belongs to. An `outside:` or a link ends it, so an indented
  // line after one has nowhere to go.
  let current: Building | undefined
  for (const line of source.split("\n")) {
    if (line.trim() === "") {
      // Kept only inside a sketch, where it is part of the pseudo-code; `dedent` drops the
      // ones a sketch ends on.
      if (current?.sketching === true) current.into?.push("")
      continue
    }
    if (indentOf(line) > 0) {
      if (current === undefined || !intoPart(current, line)) return undefined
      continue
    }
    if (current !== undefined) current.sketching = false
    if (!topLevel(line, into)) return undefined
    current = PART.test(line) ? into.parts.at(-1) : undefined
  }
  // Two sentences about one order disagree with each other, or say one thing twice.
  if (into.parts.length === 0 || into.order.length > 1) return undefined
  return {
    parts: into.parts.map(finish),
    outside: into.outside,
    links: into.links,
    order: into.order[0],
  }
}
