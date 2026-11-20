/**
 * A string a process wrote, drawn as the terminal would have drawn it.
 *
 * **Spans and nothing else** — no box, no font, no ink of its own. What this replaces is
 * the `{text}` in a caller's own element, so the caller keeps the whitespace rule, the
 * measure and the size it already had, and the colour arrives inside it. That is what
 * lets one component serve a scrolling wall of check output and a one-line failure
 * sentence without a variant between them.
 *
 * `format/ansi` decides what each escape becomes and carries the argument. There is no
 * `dangerouslySetInnerHTML` here and there must not be: this produces elements, so a
 * process that printed markup gets it escaped like any other text — the same reason
 * `Markdown` builds elements rather than HTML.
 */

import type { ReactNode } from "react"
import { ansiSpans } from "../format/ansi"

const AnsiText = ({ text }: { readonly text: string }): ReactNode =>
  ansiSpans(text).map((span, i) => (
    // A positional cut of one immutable string: the spans cannot reorder without the
    // string being a different string, which is the one shape an index key is for.
    // oxlint-disable-next-line react/no-array-index-key -- positional, and cannot reorder
    <span key={i} className={span.className} style={span.style}>
      {span.text}
    </span>
  ))

export default AnsiText
