/**
 * One comment somebody left: who wrote it as a disc and a handle, when, and their words.
 *
 * **`bare` is the words alone**, for a row whose own head has already said who wrote it —
 * drawing both puts one person's disc and name twice, an inch apart. The first comment of
 * an opened conversation is drawn bare; its replies keep their byline, because the head
 * named the opener and not them.
 *
 * **A reply steps in one level and no further, and that is a limit rather than a choice.**
 * `ReviewThreadDto.comments` is a flat list with no parent field, so which comment a reply
 * answers is not on the wire and cannot be recovered here — a four-message argument between
 * two people draws as one opening and three replies, all at the same depth. Threading it
 * properly is a change to the forge adapter.
 *
 * The body goes through `Markdown` because that is what a forge stores: a comment with a
 * list or a fenced block in it reads as a paragraph of punctuation otherwise.
 */

import type { ReactNode } from "react"
import { CornerDownRight } from "lucide-react"
import type { PullRequestCommentDto } from "../../../../api/types"
import Markdown from "../../../../components/Markdown"
import { elapsedText } from "../../../../format/activity"
import Avatar from "./Avatar"

const ForgeComment = ({
  comment,
  now,
  reply = false,
  bare = false,
}: {
  readonly comment: PullRequestCommentDto
  /** Read once by the pane, so every row on it measures against the same moment. */
  readonly now: number
  readonly reply?: boolean
  readonly bare?: boolean
}): ReactNode => {
  const words = (
    <div className="min-w-0 text-sm text-fg-muted">
      <Markdown>{comment.body}</Markdown>
    </div>
  )
  if (bare) return words
  const elapsed = elapsedText(comment.at, now)
  return (
    <div className={`flex min-w-0 gap-2 ${reply ? "pl-3" : ""}`}>
      {reply && <CornerDownRight size={12} aria-hidden className="mt-1 shrink-0 text-fg-subtle" />}
      <Avatar who={comment.who} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-2xs">
          <span className="font-medium text-fg">{comment.who}</span>
          {elapsed !== undefined && <span className="text-fg-subtle">{elapsed} ago</span>}
        </span>
        {words}
      </div>
    </div>
  )
}

export default ForgeComment
