// logic: the mermaid blocks in a markdown document — the fences the client hands
// to its diagram renderer, found by CommonMark's rules rather than a regex.
//
// A regex for "```mermaid" also matches an example shown inside a longer fence,
// which is exactly what a document explaining mermaid carries. So a closer has to
// be the opener's character, at least as long, with nothing after it but spaces,
// and a fence left open runs to the end of the document as it does on screen.
//
// Only top-level fences are found: one inside a list item or a blockquote is
// indented or prefixed past what this scan reads.

const OPENER = /^( {0,3})(`{3,}|~{3,})(.*)$/u

interface Open {
  readonly indent: number
  readonly marker: string
  readonly mermaid: boolean
  readonly lines: string[]
}

const opened = (line: string): Open | undefined => {
  const match = OPENER.exec(line)
  if (match === null) return undefined
  const [, indent = "", marker = "", info = ""] = match
  // A backtick fence's info string may not hold a backtick; that line is inline code.
  if (marker.startsWith("`") && info.includes("`")) return undefined
  return {
    indent: indent.length,
    marker,
    mermaid: info.trim().split(/\s+/u)[0] === "mermaid",
    lines: [],
  }
}

const closes = (line: string, fence: Open): boolean => {
  const trimmed = line.replace(/^ {0,3}/u, "").trimEnd()
  return (
    trimmed.length >= fence.marker.length &&
    trimmed === fence.marker.charAt(0).repeat(trimmed.length)
  )
}

/** The source of every top-level fenced block whose info string's first word is `mermaid`. */
export const mermaidSources = (markdown: string): readonly string[] => {
  const found: string[] = []
  let fence: Open | undefined
  for (const line of markdown.split(/\r?\n/u)) {
    if (fence === undefined) {
      fence = opened(line)
    } else if (closes(line, fence)) {
      if (fence.mermaid) found.push(fence.lines.join("\n"))
      fence = undefined
    } else {
      // Content loses up to as many leading spaces as the opener was indented by.
      const strip = Math.min(fence.indent, line.length - line.trimStart().length)
      fence.lines.push(line.slice(strip))
    }
  }
  if (fence?.mermaid === true) found.push(fence.lines.join("\n"))
  return found
}
