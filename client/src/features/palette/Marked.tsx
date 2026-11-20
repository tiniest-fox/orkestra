/** `text` with every occurrence of `query` washed — `marked` decides where they are. */

import type { ReactNode } from "react"
import { marked } from "./matches"

const Marked = ({ text, query }: { readonly text: string; readonly query: string }): ReactNode =>
  marked(text, query).map((run, i) =>
    run.hit ? (
      // The runs of one string never reorder.
      // oxlint-disable-next-line react/no-array-index-key
      <mark key={i} className="rounded-control bg-tone-waiting-bg text-fg">
        {run.text}
      </mark>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key
      <span key={i}>{run.text}</span>
    ),
  )

export default Marked
