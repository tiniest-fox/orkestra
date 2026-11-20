/**
 * The drafted file's goal branch on its gate card: the branch every trak of the goal lands
 * on, which the composer may have proposed and the person keeps, changes or clears. Empty
 * is no goal branch, and the traks land on the default branch. A draft the goal has moved
 * past draws the branch read-only, and nothing where it named none.
 *
 * Nothing here is sent: what the person leaves rides Approve, which the card holds. A value
 * that differs from the composer's draft is drawn in the accent color.
 */

import { GitBranch } from "lucide-react"
import type { ReactNode } from "react"
import { useId } from "react"

const DraftBranch = ({
  drafted,
  branch,
  onChange,
}: {
  /** The composer's proposal, or `""` where it proposed none. */
  readonly drafted: string
  readonly branch: string
  /** Absent on a draft the goal has moved past, which is only read. */
  readonly onChange: ((next: string) => void) | undefined
}): ReactNode => {
  const id = useId()
  const ink = branch.trim() === drafted.trim() ? "text-fg-muted" : "text-accent"
  if (onChange === undefined)
    return branch === "" ? undefined : (
      <span className={`inline-flex items-center gap-1 font-mono text-2xs ${ink}`}>
        <GitBranch size={11} aria-hidden className="opacity-70" />
        {branch}
      </span>
    )
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={`inline-flex items-center gap-1 text-sm ${ink}`}>
        <GitBranch size={13} aria-hidden className="opacity-70" />
        Goal branch
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="None — traks land on the default branch"
        value={branch}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 rounded-control border border-border bg-canvas px-2.5 font-mono text-sm text-fg placeholder:font-sans placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent max-sm:h-11 max-sm:text-base"
      />
      <span className="text-2xs text-fg-subtle">
        Every trak lands here, and one pull request takes it to the default branch when the goal is
        done.
      </span>
    </div>
  )
}

export default DraftBranch
