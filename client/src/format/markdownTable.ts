/**
 * A table written in plain markdown, read into the shape a table fence reads into — so
 * `components/Markdown` draws both through `MarkedTable` and a table looks one way however
 * the agent wrote it.
 *
 * **It refuses what the `table` fence refuses** — no rows under the head, or a head left
 * empty — so a table that reads one way as a fence does not read another way here. A
 * refused table draws as a plain grid, which shows its heads whatever is under them.
 *
 * **A cell keeps only what that table can draw**: words, a code span and a bold run. A cell
 * holding anything else — a link, a picture, emphasis — answers `undefined`, and the table
 * draws as a plain grid in the same frame rather than losing the link. So does a table
 * with more columns than the figure lays out, or with none.
 *
 * Kind `pure`: a type from the renderer, and no React.
 */

import type { ExtraProps } from "react-markdown"
import type { Column, MarkedTableConfig, Row } from "./markedTable"

type Node = NonNullable<ExtraProps["node"]>
type Child = Node["children"][number]

/** The most columns `MarkedTable` lays out — the same cap a table fence has. */
const MOST_COLUMNS = 4

/** A cell's text with its code spans and bold runs written back, or `undefined` past that. */
const textOf = (node: Child): string | undefined => {
  if (node.type === "text") return node.value
  if (node.type !== "element") return ""
  const inner = node.children.map(textOf)
  if (inner.some((t) => t === undefined)) return undefined
  const text = inner.join("")
  if (node.tagName === "code") return `\`${text}\``
  if (node.tagName === "strong") return `**${text}**`
  if (node.tagName === "th" || node.tagName === "td") return text
  // A `br` an agent wrote inside a cell reads as a space once the cell wraps.
  if (node.tagName === "br") return " "
  return undefined
}

/** Every row's cells, the head row first, in the order written. */
const rowsOf = (node: Child, out: (string | undefined)[][]): void => {
  if (node.type !== "element") return
  if (node.tagName === "tr") {
    out.push(
      node.children
        .filter((c) => c.type === "element")
        .map((c) => {
          const text = textOf(c)
          return text === undefined ? undefined : text.trim()
        }),
    )
    return
  }
  for (const child of node.children) rowsOf(child, out)
}

export const tableOf = (node: ExtraProps["node"]): MarkedTableConfig | undefined => {
  if (node === undefined) return undefined
  const read: (string | undefined)[][] = []
  for (const child of node.children) rowsOf(child, read)
  const [head, ...body] = read
  if (head === undefined || head.length === 0 || head.length > MOST_COLUMNS) return undefined
  if (body.length === 0 || head.some((cell) => cell === undefined || cell === "")) return undefined
  if (read.some((cells) => cells.some((c) => c === undefined))) return undefined
  const columns: Column[] = head.map((cell, i) => ({
    head: cell ?? "",
    role: "plain",
    lead: i === 0,
    path: false,
  }))
  const rows: Row[] = body.map((cells) => ({
    cells: columns.map((_, i) => ({ text: cells[i] ?? "", mark: undefined, verdict: undefined })),
    icon: undefined,
    detail: undefined,
    detailLabel: "",
    section: undefined,
  }))
  return { columns, rows, key: [], notes: [] }
}
