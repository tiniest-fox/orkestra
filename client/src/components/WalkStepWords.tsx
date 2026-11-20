/**
 * A walkthrough step's words with their code spans and bold drawn — the two marks a body
 * uses. Not `Markdown`, which draws this figure and so cannot be drawn by it.
 */

import type { ReactNode } from "react"

const WalkStepWords = ({ text }: { readonly text: string }): ReactNode =>
  text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") ? (
      // oxlint-disable-next-line react/no-array-index-key -- a split string never reorders
      <code key={i} className="rounded-control bg-surface-2 px-1 font-mono text-sm">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") ? (
      // oxlint-disable-next-line react/no-array-index-key -- a split string never reorders
      <strong key={i} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  )

export default WalkStepWords
