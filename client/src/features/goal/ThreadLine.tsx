/**
 * One of the goal's own lines in the thread. What the person said to the composer is
 * their bubble, anchored right as on a trak; everything else is a quiet line with a glyph
 * — a landing in good ink, a failure in bad.
 */

import { GitMerge, PlayCircle, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"
import Line from "../trak-detail/turns/activity/Line"
import Said from "../trak-detail/turns/output/Said"
import type { LineWords } from "./words"

const INK = { good: "text-tone-good", bad: "text-tone-bad" } as const

const ThreadLine = ({ words }: { readonly words: LineWords }): ReactNode => {
  if (words._tag === "Said")
    return (
      <li className="flex min-w-0 justify-end pl-10 max-sm:pl-0">
        <Said text={words.text} attachments={words.attachments} />
      </li>
    )
  const Glyph = words.tone === "good" ? GitMerge : words.tone === "bad" ? TriangleAlert : PlayCircle
  const ink = words.tone === undefined ? "text-fg-subtle" : INK[words.tone]
  return (
    <li className="min-w-0">
      <Line lead={<Glyph size={12} aria-hidden className={ink} />}>
        <span className={`font-mono text-xs ${words.tone === undefined ? "text-fg-muted" : ink}`}>
          {words.text}
        </span>
      </Line>
    </li>
  )
}

export default ThreadLine
