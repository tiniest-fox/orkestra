/**
 * One reviewer as a card of their own: their name and verdict as its head, and the
 * conversations from every review they left as lines inside it — `reviewers`.
 *
 * **A comment sits under the reviewer who made it, never in one pile below every reviewer.**
 * Whose review it was is what gives a comment its weight — one pile makes three people
 * asking for three things read as one person asking for three. Each review arrives with its
 * threads nested in it; the only joining done here is one person's reviews into one card.
 *
 * **Select-all lives in the head, beside the name of the person it selects from.** One tick
 * reaches everything under it that carries a tick of its own — the unanswered
 * conversations — and never the summary or a settled one, which have none. A reviewer with
 * nothing to send back gets no head tick rather than one that does nothing. With some of
 * them on it draws the dash, the same as a commenter's card: one head tick, one rule.
 *
 * **A reviewer with nothing left to answer and nothing to say is not drawn.** Their face is
 * still in the stack beside the section's verdict and their settled conversations are still
 * in the fold at its foot, so nothing is lost — what is dropped is a name with an empty
 * card under it, which at five reviewers is most of the section.
 */

import type { ReactNode } from "react"
import { elapsedText } from "../../../../format/activity"
import { toneInk } from "../../../../format/tone"
import Avatar from "./Avatar"
import ConversationRow from "./ConversationRow"
import ForgeLink from "./ForgeLink"
import { reviewVerdict } from "../pullRequest"
import { isPicked } from "../picks/reentryBody"
import type { Picked } from "../picks/reentryBody"
import { picksOf, reviewLines, standingReview, type Reviewer } from "./reviewLines"
import Tick from "../../../../components/Tick"

const ReviewCard = ({
  reviewer,
  number,
  picked,
  onToggle,
  onToggleAll,
  now,
}: {
  readonly reviewer: Reviewer
  readonly number: number
  readonly picked: readonly Picked[]
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  /** Absent with `onToggle`: the head's tick over every pick under it. */
  readonly onToggleAll: ((picked: readonly Picked[]) => void) | undefined
  readonly now: number
}): ReactNode => {
  const lines = reviewer.reviews.flatMap((review) => reviewLines(review, number))
  if (lines.length === 0) return null

  const { who } = reviewer
  const standing = standingReview(reviewer)
  const verdict = reviewVerdict(standing)
  const latest = reviewer.reviews.at(-1) ?? standing
  const elapsed = elapsedText(latest.at, now)
  const group = picksOf(lines)
  const on = group.filter((pick) => isPicked(picked, pick.key)).length
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-surface border border-border bg-surface">
      {/* Wraps on a phone, where the verdict drops under the name rather than crowding it out. */}
      <div className="flex min-w-0 items-center gap-x-2 bg-surface-2 py-1 pl-2.5 pr-2 max-sm:flex-wrap">
        {onToggleAll !== undefined &&
          (group.length === 0 ? (
            <span aria-hidden className="w-8 shrink-0" />
          ) : (
            <label className="flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-hover-bare max-sm:h-11">
              <Tick
                on={on === group.length}
                some={on > 0}
                label={`Everything from ${who} — ${String(group.length)} to answer`}
                onChange={() => {
                  onToggleAll(group)
                }}
              />
            </label>
          ))}
        <Avatar who={who} size="sm" />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{who}</span>
        <span
          className={`shrink-0 text-2xs font-medium max-sm:order-last max-sm:basis-full max-sm:pb-1 ${toneInk[verdict.tone]}`}
        >
          {verdict.text}
        </span>
        <span className="flex-1" />
        {/* Not on a phone: the card there is too narrow for the name and the time both. */}
        {elapsed !== undefined && (
          <span className="shrink-0 text-2xs text-fg-subtle max-sm:hidden">{elapsed} ago</span>
        )}
        {/* The review the verdict came from, which is the one a reader is checking. */}
        <ForgeLink url={standing.url} label={`Open ${who}'s review on GitHub`} />
      </div>
      <div className="flex min-w-0 flex-col divide-y divide-border">
        {/* Keyed on the pick's own string, for `PullRequestChecks`' reason: a key worked out
            separately from the tick's is free to drift from it. */}
        {lines.map((line) => (
          <ConversationRow
            key={line.key}
            line={line}
            on={line.pick !== undefined && isPicked(picked, line.pick.key)}
            onToggle={onToggle}
            now={now}
          />
        ))}
      </div>
    </div>
  )
}

export default ReviewCard
