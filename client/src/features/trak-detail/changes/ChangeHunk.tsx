/**
 * One `@@` run: the band that says where it is, and its rows.
 *
 * **A changed row's whole width is washed**, GitHub's treatment — the tint runs to the end
 * of the scroller rather than stopping at the text, so a short added line and a long one
 * read as the same kind of thing. `diff-add-wash` and `diff-del-wash` are 10% where the
 * tone fills take 15%, because area amplifies a tint; `styles.css` carries that.
 *
 * **Lines never wrap, so the file's hunks are one horizontal scroller** — which is what
 * keeps a gutter honest about the row beside it, since a wrapped line would put two screen
 * rows against one number. The numbers and the sign ride `sticky left-0` so they are still
 * there once the code has scrolled, and they are opaque so it passes under rather than
 * through them. That is also why a context row carries `bg-surface` explicitly: the sticky
 * column takes `bg-inherit`, and inheriting *transparent* is the failure this prevents.
 *
 * **`select-none` on the gutters**, so copying a hunk gives you the code and not a column
 * of integers interleaved with it.
 */

import type { ReactNode } from "react"
import type { ChangeHunkDto, ChangeLineDto } from "../../../api/types"
import { isNoNewline } from "./changes"
import type { Tok } from "../../../hooks/useTokens"

/** The ground a row sits on. Every kind names one — see the sticky column above. */
const ROW: Readonly<Record<ChangeLineDto["kind"], string>> = {
  add: "bg-diff-add-wash",
  del: "bg-diff-del-wash",
  context: "bg-surface",
}

const SIGN: Readonly<Record<ChangeLineDto["kind"], string>> = {
  add: "text-tone-good",
  del: "text-tone-bad",
  context: "",
}

const MARK: Readonly<Record<ChangeLineDto["kind"], string>> = { add: "+", del: "−", context: "" }

/** A number, or a blank the same width — never a dash, which reads as a value. */
const Gutter = ({ n }: { readonly n: number | undefined }): ReactNode => (
  <span className="w-[34px] shrink-0 pr-2 text-right text-xs text-fg-subtle">
    {n === undefined ? "" : String(n)}
  </span>
)

/** The code, coloured where a grammar answered for it and as written where none did. */
const Code = ({ text, tokens }: { readonly text: string; readonly tokens: readonly Tok[] }) =>
  tokens.length === 0 ? (
    <>{text}</>
  ) : (
    <>
      {tokens.map((token, i) => (
        // A token has no identity of its own and the row is rebuilt whole whenever
        // anything about it changes — the one shape React's own guidance allows this for.
        // oxlint-disable-next-line react/no-array-index-key
        <span key={i} style={{ color: token.color }}>
          {token.text}
        </span>
      ))}
    </>
  )

const ChangeHunk = ({
  hunk,
  gutter,
  painted,
}: {
  readonly hunk: ChangeHunkDto
  /** `"pair"` draws both sides' numbers; `"new"` draws the new side alone — the phone's
   *  setting, 34px back for the code, at the admitted price that every deleted line has a
   *  blank gutter. */
  readonly gutter: "pair" | "new"
  /** This hunk's rows, coloured — `undefined` until a grammar lands, and for good where
   *  the language has none. */
  readonly painted: readonly (readonly Tok[])[] | undefined
}): ReactNode => (
  <>
    <div className="w-max min-w-full border-y border-border bg-surface-2 px-2 py-1 font-mono text-2xs text-fg-subtle">
      <span className="sticky left-2 flex gap-3">
        <span className="shrink-0">
          @@ −{String(hunk.oldStart)},{String(hunk.oldCount)} +{String(hunk.newStart)},
          {String(hunk.newCount)} @@
        </span>
        {hunk.heading !== "" && <span className="truncate text-fg-muted">{hunk.heading}</span>}
      </span>
    </div>

    {hunk.lines.map((line, i) => (
      <div
        // Positional and with no id on the wire, and the list never reorders: a hunk is
        // replaced whole or not at all.
        // oxlint-disable-next-line react/no-array-index-key
        key={i}
        className={`flex w-max min-w-full whitespace-pre font-mono text-sm ${ROW[line.kind]}`}
      >
        {isNoNewline(line) ? (
          // Not a line of the file, so it takes neither a number nor a sign. Drawn rather
          // than dropped: whether a file ends in a newline is exactly the kind of change
          // that is invisible and matters.
          <span className="sticky left-2 py-0.5 text-2xs text-fg-subtle">{line.text}</span>
        ) : (
          <>
            <span className="sticky left-0 flex shrink-0 select-none bg-inherit">
              {gutter === "pair" && <Gutter n={line.oldLine} />}
              <Gutter n={line.newLine} />
              <span aria-hidden className={`w-[14px] text-center ${SIGN[line.kind]}`}>
                {MARK[line.kind]}
              </span>
            </span>
            <span className="pr-3 text-fg">
              <Code text={line.text} tokens={painted?.[i] ?? []} />
            </span>
          </>
        )}
      </div>
    ))}
  </>
)

export default ChangeHunk
