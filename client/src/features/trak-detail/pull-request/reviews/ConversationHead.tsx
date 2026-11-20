/**
 * The one line a conversation is at rest: who, where, and the first line of what they said.
 *
 * **The head does not move when the row opens.** Every part of it stays in the column it
 * was in shut; what goes is the preview, because the words are directly below it and
 * keeping both prints the same comment twice, once clamped and once whole. The author is
 * named here and nowhere else — the first comment under an open head is drawn bare.
 *
 * **One preview element, not one per width.** Below the breakpoint the head wraps to three
 * lines — the name, the place, the preview — by ordering rather than by a second copy
 * hidden at the other width: two elements carrying one comment's words is two matches for
 * anything that reads the page by text, and the browser tier does. The card is narrow
 * there, and a name and a file path on one line left one of them truncated to nothing.
 *
 * A line whose box has already said where it is carries no place and wraps to two — see
 * `Line.place`.
 */

import type { ReactNode } from "react"
import { ChevronRight, CornerDownRight } from "lucide-react"
import Avatar from "./Avatar"
import { gist, type Line } from "./reviewLines"

const ConversationHead = ({
  line,
  open,
}: {
  readonly line: Line
  readonly open: boolean
}): ReactNode => {
  const replies = line.comments.length - 1
  return (
    <span className="flex min-w-0 flex-1 items-center gap-x-2 gap-y-0.5 max-sm:flex-wrap">
      <Avatar who={line.who} size="sm" />
      {/* Fills a phone's first line so the chevron stays at its right edge; the preview does
          that on a desk, where it shares the line. */}
      <span className="min-w-0 truncate text-xs font-medium text-fg max-sm:grow max-sm:basis-0 sm:shrink-0">
        {line.who}
      </span>
      {line.place !== undefined && (
        <span className="min-w-0 shrink truncate font-mono text-xs text-fg-subtle max-sm:order-2 max-sm:basis-full">
          {line.place}
        </span>
      )}
      {line.outdated && (
        <span className="shrink-0 rounded-pill bg-surface-2 px-1.5 text-2xs text-fg-subtle">
          outdated
        </span>
      )}
      {!open && replies > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-fg-subtle">
          <CornerDownRight size={10} aria-hidden />
          {replies}
        </span>
      )}
      {!open && (
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted max-sm:order-3 max-sm:basis-full">
          {gist(line.comments[0]?.body ?? "")}
        </span>
      )}
      {!open && <ChevronRight size={12} aria-hidden className="shrink-0 text-fg-subtle" />}
    </span>
  )
}

export default ConversationHead
