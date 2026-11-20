/**
 * A line of an agent's words with its code spans drawn as code, and nothing else parsed.
 *
 * For the short strings a figure pulls out of a fence — a file's note, a part's gist —
 * which are nearly always naming a file or a symbol and which `Markdown` cannot draw
 * inline: it builds paragraphs. The span takes `Markdown`'s own `code` look, so a name
 * reads the same in a figure as in the prose around it.
 */

import type { ReactNode } from "react"

const CodeSpans = ({ text }: { readonly text: string }): ReactNode =>
  text.split(/(`[^`]+`)/g).map((run, i) =>
    run.startsWith("`") ? (
      // A split string never reorders.
      // oxlint-disable-next-line react/no-array-index-key
      <code key={i} className="rounded-control bg-surface-2 px-1 font-mono text-sm">
        {run.slice(1, -1)}
      </code>
    ) : (
      run
    ),
  )

export default CodeSpans
