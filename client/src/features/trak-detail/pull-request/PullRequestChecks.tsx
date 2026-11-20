/**
 * What the forge's checks say, and which of them can be sent back.
 *
 * **One line when nothing is failing.** The section's verdict is the counted verdicts and
 * the chevron is on it, so the count is printed once — it used to be the verdict and a fold
 * button an inch under it, both the same string. Opening it is the grid of every check,
 * three across. The verdict's own words are never *all passing*: the forge's rollup mixes
 * skipped, queued and unrecognised nodes in with the green ones, and `countedVerdicts`
 * carries that argument.
 *
 * **Only the failing ones are cards**, always drawn, because a failing check is the only
 * kind there is work to send back about. The rest wait in the grid behind the verdict.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import type { PullRequestCheckDto } from "../../../api/types"
import { elapsedText } from "../../../format/activity"
import CheckGrid from "../checks/CheckGrid"
import CheckMark from "../checks/CheckMark"
import ForgeLink from "./reviews/ForgeLink"
import PullRequestSection from "./PullRequestSection"
import SelectCard from "./picks/SelectCard"
import {
  checkPick,
  checksHeadline,
  failingChecks,
  otherChecks,
  TRUNCATED_NOTE,
} from "./pullRequest"
import { isPicked } from "./picks/reentryBody"
import type { Picked } from "./picks/reentryBody"

const PullRequestChecks = ({
  checks,
  number,
  truncated,
  picked,
  onToggle,
  now,
  withheld,
}: {
  readonly checks: readonly PullRequestCheckDto[]
  /** The pull request's number, which every block sent back names. */
  readonly number: number
  /** Whether the engine read only the first page, which a short list cannot say by itself. */
  readonly truncated: boolean
  readonly picked: readonly Picked[]
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
  readonly now: number
  /** Whether nobody has confirmed this answer this session — `PullRequestSection`. */
  readonly withheld: boolean
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const failing = failingChecks(checks)
  const rest = otherChecks(checks)
  return (
    <PullRequestSection
      heading="Checks"
      verdict={checksHeadline(checks)}
      withheld={withheld}
      press={
        rest.length === 0
          ? undefined
          : {
              open,
              onPress: () => {
                setOpen(!open)
              },
            }
      }
    >
      {failing.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* **The React key is the pick's own string**, on both lists. Two checks may share
              a name and two may share a link, so a list keyed on either hands React two
              children under one key — and a key worked out separately from the tick's is
              free to drift from it. `checkKey` is the one place either is decided. */}
          {failing.map((check) => {
            const pick = checkPick(check, number, now)
            const elapsed = elapsedText(check.at, now)
            return (
              <SelectCard
                key={pick.key}
                picked={pick}
                on={isPicked(picked, pick.key)}
                onToggle={onToggle}
                mark={<CheckMark verdict={check.verdict} />}
                head={
                  <>
                    <span className="min-w-0 break-all font-mono text-xs text-fg">
                      {check.name}
                    </span>
                    <span className="text-2xs font-medium text-tone-bad">failed</span>
                  </>
                }
                out={
                  check.url === undefined ? undefined : (
                    <ForgeLink url={check.url} label={`Open the ${check.name} run on GitHub`} />
                  )
                }
                meta={elapsed === undefined ? undefined : <span>{elapsed} ago</span>}
              />
            )
          })}
        </div>
      )}
      {open && <CheckGrid checks={rest} />}
      {truncated && <p className="text-2xs text-fg-subtle">{TRUNCATED_NOTE}</p>}
    </PullRequestSection>
  )
}

export default PullRequestChecks
