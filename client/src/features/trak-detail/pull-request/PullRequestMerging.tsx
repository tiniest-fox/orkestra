/**
 * Whether the forge would merge this as it stands — and, once it is not open, where the pull
 * request ended up instead.
 *
 * **Named for what it answers rather than for conflicts alone**, because it carries two ways
 * of refusing: a conflict, and a branch behind its base. The forge reports *behind* only
 * where it is actually refusing for that reason, which makes it the same kind of fact as a
 * conflict rather than a separate concern.
 *
 * **Blocked and unstable are not drawn at any value.** They are rollups of the Checks and
 * Review sections, and this section saying what those two already say is precisely the
 * aggregate the pane does not have.
 *
 * **Once the pull request is not open, no mergeability is rendered at all — including
 * clean.** The forge keeps answering clean after a merge, so drawing it there reads as
 * *ready to merge* about work that is already in. What stands in its place is where the pull
 * request went.
 *
 * The local `git merge-tree` result is not drawn here or anywhere on this pane while a pull
 * request exists. Its only job was labelling a Merge press, and there is no Merge press.
 *
 * **This section never waits for anything, and that asymmetry is deliberate.** It reads
 * three fields the traks list's coarse answer already carries, so a card drawn before the
 * detailed answer arrives has the whole of what Merging will ever say — no placeholder row,
 * no loading mark, nothing that changes when the rest lands. Checks and Review are the two
 * that hold space, because those two are the ones with rows still coming.
 */

import type { ReactNode } from "react"
import PullRequestSection from "./PullRequestSection"
import SelectCard from "./picks/SelectCard"
import { mergingPick, mergingWords, stateWords, type Merging } from "./pullRequest"
import { isPicked } from "./picks/reentryBody"
import type { Picked } from "./picks/reentryBody"

const PullRequestMerging = ({
  pull,
  picked,
  onToggle,
  withheld,
}: {
  readonly pull: Merging
  readonly picked: readonly Picked[]
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  /** Whether nobody has confirmed this answer this session — `PullRequestSection`. */
  readonly withheld: boolean
}): ReactNode => {
  const ended = stateWords(pull)
  if (ended !== undefined)
    return <PullRequestSection heading="Merging" verdict={ended} withheld={withheld} />

  const words = mergingWords(pull.merging)
  const pick = mergingPick(pull)
  return (
    <PullRequestSection heading="Merging" verdict={words} withheld={withheld}>
      {pick !== undefined && words.reason !== undefined && (
        <SelectCard
          picked={pick}
          on={isPicked(picked, pick.key)}
          onToggle={onToggle}
          head={<span className="min-w-0 text-sm text-fg-muted">{words.reason}</span>}
        />
      )}
    </PullRequestSection>
  )
}

export default PullRequestMerging
