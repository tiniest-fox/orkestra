/**
 * A ```diff fence from an agent's markdown, drawn as the Changes tab draws a change.
 *
 * **The ground carries the change.** An added row is washed `diff-add-wash`, a removed row
 * `diff-del-wash`, and the sign moves out of the text into a column of its own — so a
 * change quoted in a document and the same change under Changes read as one thing. The
 * alternative, shiki's `diff` grammar, colours the text instead and its added-line green
 * fails 4.5:1 on every plate this app has.
 *
 * **The text is coloured as code where the fence names its language** — ```diff ts — by
 * the highlighter a code fence uses, the whole block at once so a string or a comment that
 * spans lines keeps its colour. With no language it stays in the ink it stands in: a diff
 * names no file, so nothing else can say what it is.
 *
 * **The sign is real text, which is where this parts company with `ChangeHunk`.** There the
 * sign rides beside two line numbers nobody wants in a copied hunk, and the row's kind is
 * on the wire for anything that asks. Here it is the only thing that says added or removed
 * to a reader who is not seeing the wash, so it is neither `aria-hidden` nor `select-none`.
 *
 * **No line numbers.** An agent's block is a handful of bare `+` and `-` lines, not a patch
 * file; nothing knows the numbers, and a blank gutter on every row is a column of nothing.
 *
 * **Lines scroll sideways rather than wrap**, `ChangeHunk`'s rule, and the rows sit inside
 * one `w-max min-w-full` element rather than carrying that pair themselves. A row that is a
 * direct child of the scroller resolves `min-w-full` against the visible pane, so every row
 * shorter than the widest one ends at the pane edge and scrolling right shows bare ground
 * beside a change. Wrapped, the rows stretch to the widest one and every wash runs the
 * whole scrolled width. The sign is sticky and opaque for the same reason its gutter is:
 * still there once the code has scrolled under it, which is why a context row names
 * `bg-canvas`, its figure's ground, rather than inheriting transparent.
 *
 * **A `@@` row is a band — `bg-surface` with rules**, the ground a figure's header band
 * takes, so it reads as a divider inside the figure rather than as a line of code. It
 * starts at column 0 in every patch ever written, so it takes no sign column. A `---`/`+++` file
 * header draws as an unwashed row in the subtle ink: the one row that says which file this
 * is has nothing else saying so, and that is a known gap rather than a choice.
 */

import type { ReactNode } from "react"
import type { Grammar } from "../format/grammar"
import { useTokens } from "../hooks/useTokens"

/** One line of the fence, split the way the rows need it split. */
interface Row {
  readonly kind: "add" | "del" | "context" | "range" | "header"
  /** The line without its leading sign. */
  readonly text: string
}

/** The ground a row sits on. Every kind names one — see the sticky column above. */
const WASH: Readonly<Record<Row["kind"], string>> = {
  add: "bg-diff-add-wash",
  del: "bg-diff-del-wash",
  context: "bg-canvas",
  range: "border-y border-guide bg-surface text-fg-subtle",
  header: "bg-canvas text-fg-subtle",
}

const SIGN: Readonly<Record<Row["kind"], string>> = {
  add: "text-tone-good",
  del: "text-tone-bad",
  context: "",
  range: "",
  header: "",
}

const MARK: Readonly<Record<Row["kind"], string>> = {
  add: "+",
  del: "−",
  context: "",
  range: "",
  header: "",
}

/** A file header starts with a sign and is not a change, so it is caught before `-` is. */
const HEADER = /^(?:---|\+\+\+)(?:\s|$)/

/**
 * The block's lines as rows.
 *
 * **A context line loses its leading space only when every context line has one.** A patch
 * writes context as ` text`, and stripping the space is what lines it up with the text
 * behind a sign. An agent's bare block writes context as `text`, and stripping there takes
 * one space of indentation off every context row and leaves them a column out. Which form
 * this is can be read off the block: a blank line is written as nothing in both.
 */
export const rowsOf = (source: string): readonly Row[] => {
  const lines = source.split("\n")
  const context = lines.filter((line) => !/^[@+-]/.test(line))
  const patch =
    context.some((line) => line !== "") &&
    context.every((line) => line === "" || line.startsWith(" "))
  return lines.map((line): Row => {
    if (HEADER.test(line)) return { kind: "header", text: line }
    if (line.startsWith("@@")) return { kind: "range", text: line }
    if (line.startsWith("+")) return { kind: "add", text: line.slice(1) }
    if (line.startsWith("-")) return { kind: "del", text: line.slice(1) }
    return { kind: "context", text: patch ? line.slice(1) : line }
  })
}

/** A row's text, coloured where the highlighter has painted it. */
const Text = ({
  row,
  painted,
}: {
  readonly row: Row
  readonly painted: readonly { readonly text: string; readonly color: string }[] | undefined
}): ReactNode => {
  if (painted === undefined || row.kind === "range" || row.kind === "header") return row.text
  return painted.map((token, j) => (
    // A line's tokens never reorder.
    // oxlint-disable-next-line react/no-array-index-key
    <span key={j} style={{ color: token.color }}>
      {token.text}
    </span>
  ))
}

const DiffBlock = ({
  source,
  lang,
}: {
  readonly source: string
  /** The language the fence named after `diff`, or `undefined` to leave the text uncoloured. */
  readonly lang: Grammar | undefined
}): ReactNode => {
  const rows = rowsOf(source)
  // Every row's text as one source, so the highlighter sees the code whole; a range or a
  // header row is an empty line to it, and keeps its place in the count.
  const code = rows.map((row) => (row.kind === "range" || row.kind === "header" ? "" : row.text))
  const painted = useTokens(lang, [code.join("\n")])?.[0]
  return (
    <div className="min-w-0 overflow-x-auto font-mono text-sm leading-4">
      <div className="w-max min-w-full py-1">
        {rows.map((row, i) => (
          <div
            // Positional and never reordered: the block is replaced whole or not at all.
            // oxlint-disable-next-line react/no-array-index-key
            key={i}
            className={`flex whitespace-pre ${WASH[row.kind]}`}
          >
            {row.kind !== "range" && (
              // 14px is `ChangeHunk`'s own width for the mark.
              <span
                className={`sticky left-0 w-[14px] shrink-0 bg-inherit text-center ${SIGN[row.kind]}`}
              >
                {MARK[row.kind]}
              </span>
            )}
            <span className={`pr-2.5 ${row.kind === "range" ? "pl-2.5" : ""}`}>
              <Text row={row} painted={painted?.[i]} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DiffBlock
