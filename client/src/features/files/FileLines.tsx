/**
 * A file's text with a line-number gutter, coloured by its extension's grammar —
 * `hooks/useTokens`, the highlighter a fenced block and a diff use. A language outside
 * `format/grammar`'s list draws in plain ink in the same gutter.
 *
 * **Lines scroll sideways rather than wrap**, `DiffBlock`'s rule and the person's pick:
 * the rows sit inside one `w-max min-w-full` element so every row runs the whole scrolled
 * width, and the gutter is sticky and opaque so the numbers stay put while the code moves
 * under them.
 *
 * **`line` is where a search opened the file**: that row is washed and scrolled into view,
 * a layout effect on this box alone, so the frame that paints the file already shows it.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import { grammarOf } from "../../format/grammar"
import { useTokens } from "../../hooks/useTokens"

/** The extension, or nothing for a file with none. */
const extensionOf = (path: string): string => {
  const name = path.split("/").at(-1) ?? path
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1)
}

/** A trailing newline ends the last line rather than starting an empty one. */
const linesOf = (text: string): readonly string[] =>
  (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n")

const FileLines = ({
  path,
  text,
  line,
}: {
  readonly path: string
  readonly text: string
  readonly line: number | undefined
}): ReactNode => {
  const rows = linesOf(text)
  const painted = useTokens(grammarOf(extensionOf(path)), [text])?.[0]
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    const hit = node.querySelector("[data-hit]")
    // A few rows of context above the hit, so it does not sit on the pane's top edge.
    node.scrollTop = hit instanceof HTMLElement ? Math.max(0, hit.offsetTop - 80) : 0
  }, [path, line])
  const gutter = `${String(String(rows.length).length + 3)}ch`
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-auto bg-canvas">
      <div className="w-max min-w-full py-2 font-mono text-sm leading-5">
        {rows.map((raw, i) => {
          const n = i + 1
          const tokens = painted?.[i]
          return (
            <div
              // The file is replaced whole or not at all; its rows never reorder.
              // oxlint-disable-next-line react/no-array-index-key
              key={i}
              data-hit={n === line ? "" : undefined}
              role={n === line ? "mark" : undefined}
              aria-label={n === line ? `Line ${String(n)}` : undefined}
              className={`flex ${n === line ? "bg-tone-waiting-bg" : ""}`}
            >
              <span
                aria-hidden
                style={{ width: gutter }}
                className={`sticky left-0 shrink-0 pr-3 pl-3 text-right text-fg-subtle tabular-nums select-none ${n === line ? "bg-tone-waiting-bg" : "bg-canvas"}`}
              >
                {n}
              </span>
              <span className="pr-4 whitespace-pre text-fg">
                {tokens === undefined || tokens.length === 0
                  ? raw === ""
                    ? " "
                    : raw
                  : tokens.map((token, j) => (
                      // A line's tokens never reorder.
                      // oxlint-disable-next-line react/no-array-index-key
                      <span key={j} style={{ color: token.color }}>
                        {token.text}
                      </span>
                    ))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default FileLines
