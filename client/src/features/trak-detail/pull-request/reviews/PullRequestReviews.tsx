/**
 * What the forge's reviewers said, and which of their conversations can be sent back.
 *
 * **The section's state is the forge's own decision, not a tally of the reviews below it.**
 * `reviewDecision` is what the forge is holding the merge on, and counting verdicts here
 * would be a second opinion about it — one that disagrees the moment somebody dismisses a
 * review. The faces beside it are a mark rather than a verdict: they say who, and nothing
 * about how it is going. The count riding behind the decision is the one thing counted
 * here, because it is about the lines below rather than about the merge: it is how many of
 * them carry a tick, which is what the section offers to send back.
 *
 * **Every conversation is one line until it is pressed, inside the card of the person whose
 * review it belongs to** — one card per reviewer, `reviewers`. The comments on the pull
 * request itself sit under the reviewers, a card per person who wrote more than one and a
 * plain line for a person who wrote one —
 * `commenterBlocks` — and the settled conversations one more behind a counted disclosure —
 * read to, not from: no tick on any of them, because a tick would invite sending back work
 * somebody has already answered.
 *
 * **On a phone the whole section starts folded to its one line**, so the trak's ending and
 * the card's other two rows are on the first screen and the review is a press away. The
 * fold is the section's own verdict, which is why `press` is on it rather than on a line of
 * its own.
 *
 * Nothing here approves, replies or resolves. Every press re-enters the trak.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import type { PullRequestFoundDto } from "../../../../api/types"
import AvatarStack from "./AvatarStack"
import CommenterCard from "./CommenterCard"
import ConversationRow from "./ConversationRow"
import Fold from "./Fold"
import PullRequestSection from "../PullRequestSection"
import ReviewCard from "./ReviewCard"
import { reviewHeadline, TRUNCATED_NOTE, wasTruncated } from "../pullRequest"
import { isPicked } from "../picks/reentryBody"
import type { Picked } from "../picks/reentryBody"
import {
  commentLines,
  commenterBlocks,
  picksOf,
  resolvedLines,
  reviewers,
  reviewLines,
  type Line,
} from "./reviewLines"

/** The box the lines that belong to no reviewer sit in — the same edge as a review's card. */
const LineBox = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-surface">
    {children}
  </div>
)

/** The box under *On the pull request*: a card per person who wrote twice, a line for one. */
const Commenters = ({
  comments,
  picked,
  onToggle,
  onToggleAll,
  now,
}: {
  readonly comments: readonly Line[]
  readonly picked: readonly Picked[]
  readonly onToggle: ((picked: Picked) => void) | undefined
  readonly onToggleAll: ((picked: readonly Picked[]) => void) | undefined
  readonly now: number
}): ReactNode => (
  // The review cards' own spacing, so a commenter's card and a reviewer's read as the same
  // kind of thing.
  <div className="flex min-w-0 flex-col gap-2">
    {commenterBlocks(comments).map((block) =>
      block.kind === "one" ? (
        <LineBox key={block.line.key}>
          <ConversationRow
            line={block.line}
            on={block.line.pick !== undefined && isPicked(picked, block.line.pick.key)}
            onToggle={onToggle}
            now={now}
          />
        </LineBox>
      ) : (
        <CommenterCard
          key={block.who}
          who={block.who}
          lines={block.lines}
          picked={picked}
          onToggle={onToggle}
          onToggleAll={onToggleAll}
          now={now}
        />
      ),
    )}
  </div>
)

const PullRequestReviews = ({
  pull,
  picked,
  onToggle,
  onToggleAll,
  now,
  withheld,
  phone,
}: {
  readonly pull: PullRequestFoundDto
  readonly picked: readonly Picked[]
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  /** Absent with `onToggle`: what a reviewer's head tick sends the whole group to. */
  readonly onToggleAll: ((picked: readonly Picked[]) => void) | undefined
  readonly now: number
  /** Whether nobody has confirmed this answer this session — `PullRequestSection`. */
  readonly withheld: boolean
  /** Below the breakpoint the section starts folded; the page reads the seam once. */
  readonly phone: boolean
}): ReactNode => {
  const [open, setOpen] = useState(!phone)
  const comments = commentLines(pull.conversation, pull.number)
  const resolved = resolvedLines(pull.reviews)
  // The section's own count, worked out once: the verdict prints it and the folded row on a
  // phone prints it again, and two counts drawn an inch apart have to be one number.
  const toAnswer =
    pull.reviews.reduce((n, review) => n + picksOf(reviewLines(review, pull.number)).length, 0) +
    comments.length
  const anything = pull.reviews.length + comments.length + resolved.length > 0
  const row = (line: Line): ReactNode => (
    <ConversationRow
      key={line.key}
      line={line}
      on={line.pick !== undefined && isPicked(picked, line.pick.key)}
      onToggle={onToggle}
      now={now}
    />
  )
  return (
    <PullRequestSection
      heading="Review"
      verdict={reviewHeadline(pull.decision, toAnswer)}
      withheld={withheld}
      press={
        anything
          ? {
              open,
              onPress: () => {
                setOpen(!open)
              },
            }
          : undefined
      }
      aside={<AvatarStack people={pull.reviews.map((review) => review.who)} />}
    >
      {/* No count here: the verdict directly above already carries it. This says what the
          press does, which a phone needs and a desk — where the section opens — does not. */}
      {!open && phone && toAnswer > 0 && (
        <span className="text-2xs text-fg-subtle">Press the line above to read them</span>
      )}
      {open && (
        <div className="flex min-w-0 flex-col gap-2.5">
          {/* Keyed on the person, who is one card however many reviews they left. */}
          {reviewers(pull.reviews).map((reviewer) => (
            <ReviewCard
              key={reviewer.who}
              reviewer={reviewer}
              number={pull.number}
              picked={picked}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              now={now}
            />
          ))}
          {wasTruncated(pull.truncated, "reviews", "threads") && (
            <p className="text-2xs text-fg-subtle">{TRUNCATED_NOTE}</p>
          )}
          {comments.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <h5 className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
                On the pull request
              </h5>
              <Commenters
                comments={comments}
                picked={picked}
                onToggle={onToggle}
                onToggleAll={onToggleAll}
                now={now}
              />
              {wasTruncated(pull.truncated, "conversation") && (
                <p className="text-2xs text-fg-subtle">{TRUNCATED_NOTE}</p>
              )}
            </div>
          )}
          {resolved.length > 0 && (
            <Fold summary={`${String(resolved.length)} resolved`}>
              <LineBox>{resolved.map(row)}</LineBox>
            </Fold>
          )}
        </div>
      )}
    </PullRequestSection>
  )
}

export default PullRequestReviews
