/**
 * One person's comments on the pull request as a card of their own: their name and a count
 * as its head, and each comment as a line inside it.
 *
 * **Built like a review card, so one head tick means one thing across the pane.** The tick
 * in the head reaches every line under it; pressed with all of them on it clears them, and
 * otherwise it ticks them all. What differs from a review card is what the head has to say:
 * there is no verdict and no review to link out to, so it carries the count and, on a desk,
 * how long ago the person last spoke.
 *
 * `commenterBlocks` decides who gets a card — two comments or more — and this file never
 * draws a head over one line.
 */

import type { ReactNode } from "react"
import { elapsedText } from "../../../../format/activity"
import Avatar from "./Avatar"
import ConversationRow from "./ConversationRow"
import { isPicked } from "../picks/reentryBody"
import type { Picked } from "../picks/reentryBody"
import { picksOf, type Line } from "./reviewLines"
import Tick from "../../../../components/Tick"

const CommenterCard = ({
  who,
  lines,
  picked,
  onToggle,
  onToggleAll,
  now,
}: {
  readonly who: string
  /** Oldest first, and every one of them this person's. */
  readonly lines: readonly Line[]
  readonly picked: readonly Picked[]
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  /** Absent with `onToggle`: the head's tick over every pick under it. */
  readonly onToggleAll: ((picked: readonly Picked[]) => void) | undefined
  readonly now: number
}): ReactNode => {
  const group = picksOf(lines)
  const on = group.filter((pick) => isPicked(picked, pick.key)).length
  const latest = elapsedText(Math.max(...lines.map((line) => line.comments[0]?.at ?? 0)), now)
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-surface border border-border bg-surface">
      <div className="flex min-w-0 items-center gap-x-2 bg-surface-2 py-1 pl-2.5 pr-2">
        {onToggleAll !== undefined && group.length > 0 && (
          <label className="flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-hover-bare max-sm:h-11">
            <Tick
              on={on === group.length}
              some={on > 0}
              label={`Everything from ${who} — ${String(group.length)} comments`}
              onChange={() => {
                onToggleAll(group)
              }}
            />
          </label>
        )}
        <Avatar who={who} size="sm" />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{who}</span>
        <span className="shrink-0 text-2xs text-fg-subtle">{String(lines.length)} comments</span>
        <span className="flex-1" />
        {/* Not on a phone: the card there is too narrow for the name and the time both. */}
        {latest !== undefined && (
          <span className="shrink-0 text-2xs text-fg-subtle max-sm:hidden">
            latest {latest} ago
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col divide-y divide-border">
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

export default CommenterCard
